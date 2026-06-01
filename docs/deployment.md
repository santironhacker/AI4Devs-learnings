# Deployment — super-users Platform

> Consolidates every deployment-related decision recorded in [`docs/architecture.md`](architecture.md).
> Deployment work is **out of scope for the Phase 1 scaffolding effort** and is tracked as a separate follow-up task. Generated: 2026-06-01.

---

## 1. Scope and split

Two deploy targets, deployed independently:

| App | Target | Build artifact | Reference |
|---|---|---|---|
| `frontend/` (Vue 3 SPA) | **Vercel** (direct, no Docker) | Static `vite build` output | [architecture.md §10.1](architecture.md#101-frontend--vercel) |
| `backend/` (Express 5 API) | **Railway** (Docker) | Multi-stage Node image | [architecture.md §10.2](architecture.md#102-backend--railway-docker) |
| PostgreSQL 16 | **Railway managed plugin**, attached to the backend service | — | [architecture.md §8.3](architecture.md#83-decisions-resolved-post-ticket-user-input), [§10.6](architecture.md#106-database--railway-runtime) |

---

## 2. Frontend — Vercel

Decisions:
- Deploy `frontend/` directly to Vercel (no Docker). See [architecture.md §10.1](architecture.md#101-frontend--vercel).
- SPA fallback **must** be configured in `frontend/vercel.json` — without it, any hard refresh or direct visit to a client route (e.g. `/profile`) returns 404:

  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```

- `VITE_API_BASE_URL` set in Vercel env vars to the Railway backend URL. See [architecture.md §7 (Frontend)](architecture.md#frontend-frontendenv).
- Vercel automatically provides CDN + HTTPS.

---

## 3. Backend — Railway (Docker)

### 3.1 Dockerfile contract

Multi-stage build, runs as the non-root `node` user, `prisma generate` at **build time**. Verbatim spec in [architecture.md §10.2](architecture.md#102-backend--railway-docker):

```dockerfile
# ---- Builder stage ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Production stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
```

### 3.2 Release model — migrations before go-live

Single release command runs migrations and then the server. See [architecture.md §10.3](architecture.md#103-migration-execution-release-model).

```sh
npx prisma migrate deploy && node dist/server.js
```

- `migrate deploy` applies committed migrations only (non-interactive — the correct production command).
- On migration failure, `&&` short-circuits, the new container exits non-zero, and **Railway keeps the previous healthy container serving traffic**.
- `db push` is **never** used in production. Initial Railway setup also uses `migrate deploy`.

### 3.3 Railway runtime contracts

From [architecture.md §10.6](architecture.md#106-database--railway-runtime):

| Contract | Requirement |
|---|---|
| **Port binding** | `server.ts` must listen on `process.env.PORT` (Railway injects it at runtime). Never hardcoded. |
| **Health check** | Railway polls `GET /api/v1/health` ([architecture.md §5.3](architecture.md#53-health-route--apiv1health)) to gate traffic switching and detect unhealthy instances. Endpoint pings the DB; returns `503 DB_UNAVAILABLE` on failure. |
| **Database connection** | PostgreSQL is a Railway plugin attached to the backend service. `DATABASE_URL` is **injected automatically** — credentials never copy-pasted. |
| **Migrations before go-live** | Handled by the release command above (§3.2). |

---

## 4. Environment variables (production)

Full schema and validation rules in [architecture.md §7](architecture.md#7-environment-configuration) and [§7.1](architecture.md#71-startup-validation-backendsrcconfigenvts). The full set is parsed by `zod` at startup; the container exits immediately on missing/invalid values.

### 4.1 Set in Railway (backend)

| Variable | Production source |
|---|---|
| `DATABASE_URL` | Auto-injected by the Postgres plugin |
| `JWT_ACCESS_SECRET` | Manually pasted; min 32 chars |
| `JWT_REFRESH_SECRET` | Manually pasted; min 32 chars (distinct from access) |
| `JWT_ACCESS_TTL` | `900` (15 min) |
| `JWT_REFRESH_TTL` | `604800` (7 days) |
| `FRONTEND_ORIGIN` | Vercel deployment URL (required for CORS + credentialed cookie transport) |
| `PORT` | Injected by Railway |
| `NODE_ENV` | `production` |
| `BCRYPT_ROUNDS` | `12` |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_MAX` | Per [architecture.md §6 *Rate limiting*](architecture.md#rate-limiting) |
| `LOCKOUT_MAX_ATTEMPTS`, `LOCKOUT_DURATION_SECONDS` | Per [architecture.md §6 *Account lockout (v1)*](architecture.md#account-lockout-v1) |
| `LOG_LEVEL` | `info` (see §6 below) |

### 4.2 Set in Vercel (frontend)

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | Railway backend URL |

### 4.3 Cross-origin bootstrapping order

Production frontend (Vercel) and backend (Railway) live on **different origins**. The order of operations to avoid CORS/cookie failures:

1. Deploy backend to Railway with a placeholder `FRONTEND_ORIGIN` (or no-CORS startup).
2. Deploy frontend to Vercel with `VITE_API_BASE_URL` set to the Railway URL.
3. Update Railway's `FRONTEND_ORIGIN` to the Vercel URL and redeploy.
4. Verify a credentialed request from Vercel → Railway succeeds (login + refresh flows).

---

## 5. Refresh cookie — production attributes

The most common cause of "auth works locally but breaks in production" on this stack. Full table and rationale in [architecture.md §6 *Refresh cookie attributes*](architecture.md#refresh-cookie-attributes):

| Attribute | Production |
|---|---|
| `HttpOnly` | ✅ |
| `Secure` | ✅ (HTTPS only — Vercel/Railway both terminate TLS) |
| `SameSite` | `None` (required for cross-origin transport) |
| `Path` | `/api/v1/auth` (scopes cookie to auth endpoints only) |
| `Max-Age` | Matches `JWT_REFRESH_TTL` |

Server-side CORS **must** set `credentials: true` and Axios **must** send `withCredentials: true`; otherwise the cookie is silently dropped. See [architecture.md §6 *CORS*](architecture.md#cors).

---

## 6. Logging in production

From [architecture.md §11](architecture.md#11-logging):

- `pino` emits newline-delimited JSON to **stdout**.
- Railway captures and indexes stdout automatically — no extra log agent needed.
- `LOG_LEVEL` env var controls verbosity (default `info`).
- `pino-http` middleware emits one structured line per request (method, URL, status, response time).
- `pino-pretty` is **dev only** — never piped in production.

---

## 7. CI relationship to deployment

CI is configured during scaffolding (see [architecture.md §10.4](architecture.md#104-continuous-integration-githubworkflowsciyml)) and is a **required PR check** that runs `npm ci → prisma validate → tsc --noEmit → lint → tests` against a PostgreSQL service container. CI does **not** deploy — Railway and Vercel each watch the `main` branch and deploy independently on merge.

---

## 8. What this document does NOT decide (open for the deployment task)

These are explicitly left for the future deployment task and are *not* in `architecture.md`:

- Railway and Vercel **account ownership** and access (who holds the org, who can deploy).
- **Custom domains** (none specified in the architecture).
- **Preview environments** on PRs (Vercel offers this natively; Railway requires configuration).
- **Secret rotation policy** for `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`.
- **Backup policy** for the Railway Postgres plugin.
- **Observability beyond stdout logs** (no APM/metrics target chosen in the architecture).
- **Multi-replica scaling** — the architecture explicitly assumes a single Railway replica for Phase 1 (see [architecture.md §6 *Account lockout (v1)*](architecture.md#account-lockout-v1)). Going multi-replica requires promoting lockout (and possibly rate limiting) to a shared store.

---

## 9. Cross-references

- [architecture.md §6 — Authentication & Authorization](architecture.md#6-authentication--authorization) (cookie attributes, CORS, RBAC, rate limiting, lockout)
- [architecture.md §7 — Environment Configuration](architecture.md#7-environment-configuration) (full env var schema)
- [architecture.md §10 — Deployment](architecture.md#10-deployment) (10.1 Vercel, 10.2 Dockerfile, 10.3 release model, 10.4 CI, 10.5 test DB, 10.6 Railway runtime contracts)
- [architecture.md §11 — Logging](architecture.md#11-logging) (Railway stdout capture)
- [architecture.md §12 — Admin Seeding](architecture.md#12-admin-seeding) (run against production DB only with a backup)

---

*End of deployment document.*
