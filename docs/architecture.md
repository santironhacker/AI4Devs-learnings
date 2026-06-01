# Architecture — super-users Platform

> Derived from Linear project **super-users** (team: Santironhacker) issues SAN-5, SAN-6, SAN-7, SAN-8.
> Generated: 2026-05-31 · Phase 1 scaffolding review applied: 2026-06-01

> **Scope note:** This document covers Phase 1 architecture and scaffolding. The complete testing strategy (frontend unit + E2E, backend application/repository/API layers) is maintained separately in [`docs/testing-scaffolding/`](testing-scaffolding/) and is treated as Phase 2 work.

---

## 1. Overview

The **super-users** platform is a foundational user-management and authentication application delivered end-to-end across a Vue 3 single-page frontend and an Express 5 REST backend. It covers the complete identity lifecycle: account registration with hashed credentials, email/password login with JWT-based session management, transparent access-token refresh via rotation, server-side logout, and role-based access control (RBAC) that protects both API endpoints and frontend routes. The initial scope targets two roles — `USER` and `ADMIN` — with the architecture deliberately open to extension as the product grows.

---

## 2. Tech Stack

| Layer | Technology | Version | Rationale |
|---|---|---|---|
| **Frontend framework** | Vue 3 (Composition API) | `^3.5.35` | Decided in SAN-5. Composition API enables fine-grained reactivity and clean composable reuse. |
| **Frontend state** | Pinia | `^3.0.4` | Decided in SAN-5. Official Vue state library; replaces Vuex with a simpler API, first-class TypeScript support, and DevTools integration. |
| **Frontend routing** | Vue Router | `^5.0.7` | Decided in SAN-5. Ships with typed route guards used by SAN-7 and SAN-8 for auth/role protection. |
| **HTTP client** | Axios | `^1.x` | Decided in SAN-5. Centralized instance with request/response interceptors for token injection and 401 silent-refresh handling (SAN-7). |
| **Frontend testing** | Vitest | `^3.x` | Component and store unit tests; shares Vite config, no separate Jest setup needed. |
| **Backend framework** | Express.js | `^5.2.1` | Decided in SAN-5. Minimal, unopinionated HTTP layer; Express 5 is the current TC-endorsed stable branch. |
| **ORM** | Prisma | `^7.8.0` | Decided in SAN-5. Type-safe query builder with migration tooling; Prisma 7 ships a TypeScript-native runtime (no Rust engine), up to 3× faster with ~90% smaller bundles. |
| **Database** | PostgreSQL | `^16` | Decided in SAN-5. Relational integrity for `User`↔`Session` relationships; UUID primary keys and cascading deletes modelled in the Prisma schema. |
| **Rate limiting** | express-rate-limit | `^7.x` | In-process rate limiter applied to all `/api/v1/auth` endpoints (SAN-7). No Redis store needed for v1 single-instance deployment. |
| **Logging** | pino | `^9.x` | Structured JSON logging for the Express backend; `pino-http` middleware for per-request logging. Low overhead, Railway-friendly stdout output. |
| **Backend testing** | Vitest + supertest | `^3.x` / `^7.x` | API integration tests run against a real PostgreSQL instance in Docker; unit tests use Vitest built-in mocks. |
| **Linter** | ESLint + `@typescript-eslint` | ESLint `^9.x` / `@typescript-eslint` `^8.x` | Main linter for both frontend and backend packages. `@typescript-eslint` `^8.x` is the latest line and requires ESLint `^9.x`; both are compatible with Node `^22 LTS`, TypeScript `^5.x`, Vue 3, and Express 5. Used by the CI `lint` step (Section 10.4). |
| **Runtime** | Node.js | `^22 LTS` | Peer requirement of Express 5 and Prisma 7. |

---

## 3. Project Structure

```
super-users/
├── frontend/                        # Vue 3 SPA — deployed to Vercel
│   ├── public/
│   │   └── favicon.ico
│   ├── src/
│   │   ├── assets/
│   │   ├── components/
│   │   │   ├── auth/
│   │   │   │   ├── LoginForm.vue        # SAN-7
│   │   │   │   └── RegisterForm.vue     # SAN-6
│   │   │   └── ui/
│   │   │       ├── LoadingSpinner.vue
│   │   │       └── ErrorBanner.vue
│   │   ├── composables/
│   │   │   └── useAuth.ts
│   │   ├── router/
│   │   │   └── index.ts                 # Route definitions + beforeEach guards (SAN-7, SAN-8)
│   │   ├── services/
│   │   │   ├── axios.ts                 # Centralized Axios instance w/ interceptors + queued 401 refresh (SAN-5, SAN-7)
│   │   │   ├── authService.ts           # register / login / logout / refresh calls
│   │   │   └── userService.ts           # getMe / updateMe calls
│   │   ├── stores/
│   │   │   └── auth.ts                  # useAuthStore — accessToken, user, isAuthenticated, isAdmin, init() (SAN-7, SAN-8)
│   │   ├── types/
│   │   │   └── api.ts                   # Shared ApiResponse<T> / ApiError envelope (mirrors backend/src/types/api.ts)
│   │   ├── validation/
│   │   │   └── auth.schemas.ts          # zod schemas for login/register, shared with VeeValidate
│   │   ├── views/
│   │   │   ├── LoginView.vue            # /login (SAN-7)
│   │   │   ├── RegisterView.vue         # /register (SAN-6)
│   │   │   ├── ProfileView.vue          # /profile — requiresAuth (SAN-8)
│   │   │   ├── AdminView.vue            # /admin — requiresAuth + requiresRole:ADMIN (SAN-8)
│   │   │   ├── ForbiddenView.vue        # 403 — authenticated but insufficient role (SAN-8)
│   │   │   └── NotFoundView.vue         # 404 fallback
│   │   ├── App.vue
│   │   └── main.ts                      # Awaits useAuthStore().init() before app.mount() (cold-load hydration)
│   ├── tests/
│   │   ├── unit/
│   │   │   ├── stores/
│   │   │   │   └── auth.spec.ts         # Pinia store unit tests (Vitest)
│   │   │   └── composables/
│   │   │       └── useAuth.spec.ts
│   │   └── setup.ts                     # Vitest global setup (jsdom, mock resets)
│   ├── index.html
│   ├── vercel.json                      # SPA rewrite — all paths → /index.html (Section 10.1)
│   ├── vite.config.ts                   # Vitest config co-located here
│   ├── tsconfig.json
│   └── package.json
│
├── backend/                         # Express 5 REST API — deployed to Railway via Docker
│   ├── prisma/
│   │   ├── schema.prisma            # Data model (see Section 4)
│   │   └── migrations/
│   ├── seeds/
│   │   ├── seed-admin.ts            # CLI script: creates the first ADMIN user (see Section 12)
│   │   └── README.md                # Seed usage instructions and safety notes
│   ├── src/
│   │   ├── config/
│   │   │   └── env.ts               # zod-validated env loader; fails fast at startup (Section 7.1)
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts       # JWT verification → req.user (SAN-8)
│   │   │   ├── requireRole.ts       # RBAC role check (SAN-8)
│   │   │   ├── rateLimiter.ts       # express-rate-limit instances for auth endpoints (SAN-7)
│   │   │   └── errorHandler.ts      # Centralised error response shape
│   │   ├── modules/
│   │   │   ├── health/
│   │   │   │   └── health.router.ts # GET /api/v1/health — DB ping readiness check (Section 5.3)
│   │   │   ├── auth/
│   │   │   │   ├── auth.router.ts
│   │   │   │   ├── auth.controller.ts
│   │   │   │   ├── auth.service.ts
│   │   │   │   └── lockout.ts        # In-memory failed-attempt tracker (Section 6, restart-volatile)
│   │   │   └── users/
│   │   │       ├── users.router.ts
│   │   │       ├── users.controller.ts
│   │   │       └── users.service.ts
│   │   ├── lib/
│   │   │   ├── prisma.ts            # Singleton PrismaClient
│   │   │   ├── jwt.ts               # signAccessToken / signRefreshToken / verifyToken helpers
│   │   │   ├── cookies.ts           # Refresh-cookie attribute builder (env-aware, Section 6)
│   │   │   └── logger.ts            # pino instance + pino-http middleware export
│   │   ├── types/
│   │   │   ├── express.d.ts         # Augments Express.Request with user: { id: string; role: Role }
│   │   │   └── api.ts               # Shared ApiResponse<T> / ApiError envelope (mirrored in frontend)
│   │   └── app.ts                   # Express app setup: CORS (credentials), JSON body, logger, routers, error handler
│   ├── tests/
│   │   ├── integration/
│   │   │   ├── auth.spec.ts         # supertest tests for /api/v1/auth/* against real DB
│   │   │   └── users.spec.ts        # supertest tests for /api/v1/users/*
│   │   ├── unit/
│   │   │   └── auth.service.spec.ts # Vitest unit tests with built-in mocks
│   │   └── setup.ts                 # DB reset helpers, test PrismaClient, global beforeAll/afterAll
│   ├── server.ts                    # HTTP server entry point
│   ├── Dockerfile                   # Production image for Railway (see Section 10)
│   ├── .dockerignore
│   ├── tsconfig.json
│   └── package.json
│
├── .github/
│   └── workflows/
│       └── ci.yml                   # PR pipeline: install → prisma validate → tsc --noEmit → lint → tests (Section 10.4)
│
├── docs/
│   ├── architecture.md              # This document
│   ├── seeds.md                     # Seed scripts catalogue and runbook
│   └── testing-scaffolding/         # Phase 2 — full testing strategy (frontend + backend)
│       └── README.md
│
├── docker-compose.test.yml          # PostgreSQL 16 service for integration test runs (Section 10.5)
├── .env.example                     # Template for all required env vars (see Section 7)
└── README.md
```

---

## 4. Data Model

Prisma schema as specified in SAN-5, reflecting the `User`↔`Session` relationship required by SAN-6, SAN-7, and SAN-8.

```prisma
// backend/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String    @id @default(uuid())
  email        String    @unique
  passwordHash String
  name         String?
  role         Role      @default(USER)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  sessions     Session[]
}

model Session {
  id           String   @id @default(uuid())
  userId       String
  refreshToken String   @unique
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

enum Role {
  USER
  ADMIN
}
```

**Key decisions embedded in the model (SAN-5):**
- UUID primary keys (`@default(uuid())`) — no sequential ID exposure.
- `passwordHash` — bcrypt output, never the raw password.
- `Session` table with `refreshToken` enables server-side revocation and reuse detection.
- `onDelete: Cascade` — deleting a `User` purges all their sessions.
- `role` enum defaults to `USER`; elevated to `ADMIN` out-of-band.

> **Phase 1 decision — account lockout is *not* persisted.** No `failedLoginAttempts` / `lockedUntil` columns are added to `User`. Lockout state lives in an in-memory map (`backend/src/modules/auth/lockout.ts`) and is intentionally volatile (see Section 6). This keeps the schema minimal for v1; promoting lockout to persistent storage later is an additive migration that does not change the API contract.

---

## 5. API Design

All request and response bodies are `application/json`. Every response uses a shared envelope so the frontend services and backend controllers agree on a single shape.

**Success envelope** — the payload is wrapped in a `data` key:

```json
{ "data": { /* endpoint-specific payload */ } }
```

**Error envelope:**

```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable message" } }
```

The envelope is typed once and shared on both sides:

```typescript
// backend/src/types/api.ts — mirrored verbatim in frontend/src/types/api.ts
export type ApiResponse<T> = { data: T };
export type ApiError = { error: { code: string; message: string } };
```

The success tables below describe the contents of `data` (e.g. `201 { user, accessToken }` means the body is `{ "data": { "user": {...}, "accessToken": "..." } }`). The `204 No Content` logout response carries no body and therefore no envelope.

All routes are mounted under the `/api/v1` prefix. The version segment is part of the URL from the first scaffold so that future `/api/v2` routes can coexist without breaking existing clients.

### 5.1 Auth routes — `/api/v1/auth`

Rate-limited by `express-rate-limit` on all endpoints in this group (see Section 9 for thresholds). Login additionally enforces account lockout (see Section 6).

| Method | Path | Auth | Request body | Success response | Source |
|---|---|---|---|---|---|
| `POST` | `/api/v1/auth/register` | None | `{ email, password, name? }` | `201 { user: { id, email, name, role }, accessToken }` + httpOnly refresh cookie | SAN-6 |
| `POST` | `/api/v1/auth/login` | None | `{ email, password }` | `200 { user: { id, email, name, role }, accessToken }` + httpOnly refresh cookie | SAN-7 |
| `POST` | `/api/v1/auth/refresh` | httpOnly cookie | — | `200 { accessToken }` + rotated refresh cookie | SAN-7 |
| `POST` | `/api/v1/auth/logout` | httpOnly cookie | — | `204 No Content` + cleared cookie | SAN-7 |

### 5.2 User routes — `/api/v1/users`

| Method | Path | Auth | Request body | Success response | Source |
|---|---|---|---|---|---|
| `GET` | `/api/v1/users/me` | `requireAuth` | — | `200 { id, email, name, role, createdAt }` | SAN-8 |
| `PATCH` | `/api/v1/users/me` | `requireAuth` | `{ name? }` | `200 { id, email, name, role, createdAt }` | SAN-8 |
| `GET` | `/api/v1/users` | `requireAuth` + `requireRole(ADMIN)` | — | `200 [{ id, email, name, role, createdAt }]` | SAN-8 |

### 5.3 Health route — `/api/v1/health`

Used by Railway as the readiness/health-check endpoint (see Section 10.6). Not rate-limited and not authenticated.

| Method | Path | Auth | Behaviour | Success response |
|---|---|---|---|---|
| `GET` | `/api/v1/health` | None | Runs a lightweight `prisma.$queryRaw\`SELECT 1\`` to confirm DB connectivity | `200 { status: "ok", db: "connected" }` |

On a DB connectivity failure the endpoint returns `503 { error: { code: "DB_UNAVAILABLE", message: "Database not reachable" } }` so Railway holds traffic off an instance that cannot serve requests. This endpoint is exempt from the shared success envelope's `data` wrapper for simplicity and probe-friendliness.

### 5.4 Error codes

| HTTP | Code | Trigger |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Invalid/missing fields |
| `401` | `INVALID_CREDENTIALS` | Wrong email or password (generic, no enumeration) |
| `401` | `INVALID_REFRESH_TOKEN` | Refresh token missing, tampered, or reused |
| `401` | `SESSION_EXPIRED` | Refresh token expired |
| `401` | `UNAUTHORIZED` | Missing or invalid access token on protected route |
| `403` | `FORBIDDEN` | Authenticated but insufficient role |
| `404` | `USER_NOT_FOUND` | Resource not found |
| `409` | `EMAIL_TAKEN` | Duplicate email on register |
| `423` | `ACCOUNT_LOCKED` | Too many failed login attempts; includes `retryAfter` (seconds) in response body |
| `429` | `RATE_LIMITED` | Too many requests to an auth endpoint; `Retry-After` header set |
| `500` | `INTERNAL_ERROR` | Unhandled server error |
| `503` | `DB_UNAVAILABLE` | Health check could not reach the database |

---

## 6. Authentication & Authorization

### Strategy (SAN-5, SAN-7)

**Stateless access tokens + stateful refresh tokens (rotation-based session management).**

1. **Access token** — signed JWT (`HS256`), payload `{ sub: userId, role }`, TTL **15 minutes**. Kept exclusively in memory (Pinia store) — never in `localStorage` or a cookie — to mitigate XSS token theft.
2. **Refresh token** — signed JWT, TTL **7 days**, stored in an **httpOnly cookie**. Each use rotates the token (old session row deleted, new one created). Reuse detection (presenting an already-consumed token) revokes **all** sessions for that user immediately. The full cookie attributes are environment-aware — see *Refresh cookie attributes* below.
3. **Session table** — `Session` rows are the server-side authority. Logout deletes the row; expired or tampered tokens without a matching row are rejected as `INVALID_REFRESH_TOKEN`.

### Refresh cookie attributes

The frontend (Vercel) and backend (Railway) are served from **different origins** in production, so the refresh cookie must be a cross-site cookie there. The attributes differ by environment and are built in `backend/src/lib/cookies.ts`:

| Attribute | Production | Development (localhost, http) |
|---|---|---|
| `HttpOnly` | ✅ | ✅ |
| `Secure` | ✅ (HTTPS only) | ❌ (no TLS locally) |
| `SameSite` | `None` (required for cross-origin cookie transport) | `Lax` |
| `Path` | `/api/v1/auth` (scopes the cookie to the auth endpoints only) | `/api/v1/auth` |
| `Max-Age` | matches `JWT_REFRESH_TTL` | matches `JWT_REFRESH_TTL` |

> **Why this matters:** `SameSite=None` is mandatory for the browser to send the cookie on cross-origin requests to Railway, but browsers reject `SameSite=None` unless `Secure` is also set — which requires HTTPS. Locally there is no TLS, so dev falls back to `SameSite=Lax`. Getting this wrong is the single most common cause of "auth works locally but breaks in production" on this stack. The cookie is scoped to `Path=/api/v1/auth` so it is **not** sent on every `/api/v1/users` request — only on refresh/logout — reducing exposure.

The Axios instance must send `withCredentials: true` globally for the browser to include the cookie on cross-origin calls (see Section 6 *Frontend* and the interceptor spec).

### RBAC (SAN-8)

Two roles: `USER` (default) and `ADMIN`.

- **Backend:** `requireAuth` middleware verifies the access token and hydrates `req.user`. `requireRole(role)` checks `req.user.role`. Applied per-route as composable middleware — the chain is `requireAuth → requireRole` for elevated endpoints. The `req.user` shape is declared once in `backend/src/types/express.d.ts`:

  ```typescript
  // backend/src/types/express.d.ts
  import type { Role } from '@prisma/client';
  declare global {
    namespace Express {
      interface Request {
        user?: { id: string; role: Role };
      }
    }
  }
  export {};
  ```

  `user` is optional on the base `Request` type (it is only populated after `requireAuth` runs); handlers behind `requireAuth` can safely assume it is present.
- **Frontend:** Vue Router `beforeEach` guard reads `meta.requiresAuth` and `meta.requiresRole`. Session restoration happens once at app boot via `useAuthStore().init()` (see *Frontend cold-load hydration* below), so guards read already-resolved auth state synchronously rather than each triggering their own refresh. Unauthenticated users hitting a `requiresAuth` route are redirected to `/login?redirect=<intended-path>`. An authenticated user with an insufficient role is routed to the `ForbiddenView.vue` (403) view. `v-if="isAdmin"` gates admin UI elements for UX only — the backend is the security boundary.

### Frontend cold-load hydration

The access token lives only in memory (Pinia), so on a full page load / refresh it is gone while the httpOnly refresh cookie persists. To restore the session deterministically before any route is evaluated:

1. `main.ts` calls `await useAuthStore().init()` **before** `app.mount('#app')`.
2. `init()` makes a single `POST /api/v1/auth/refresh` call. On success it stores the new access token and hydrates `user`; on failure (no/invalid cookie) it clears auth state and resolves normally (no error thrown).
3. Because hydration completes before mount, the first navigation's `beforeEach` guard sees a settled `isAuthenticated` / `isAdmin` — eliminating the flash-of-login-screen race and avoiding per-guard refresh calls.

### CORS

Configured in `backend/src/app.ts`. The origin is restricted to `FRONTEND_ORIGIN` and **`credentials: true` is required** so the browser will send and accept the httpOnly refresh cookie on cross-origin requests:

```typescript
app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
```

Without `credentials: true` on the server (and `withCredentials: true` on Axios), the refresh cookie is silently dropped on cross-origin calls and the entire refresh/logout flow fails in production.

### Rate limiting

`express-rate-limit` (in-process, no Redis) is applied as a router-level middleware to the entire `/api/v1/auth` group:

| Endpoint group | Window | Max requests | On breach |
|---|---|---|---|
| All `/api/v1/auth/*` | 15 minutes | 20 requests per IP | `429 RATE_LIMITED` + `Retry-After` header |
| `POST /api/v1/auth/login` | 15 minutes | 10 requests per IP | `429 RATE_LIMITED` + `Retry-After` header |

The stricter limit on login is applied after the general auth limiter, so login is subject to both (whichever triggers first).

### Account lockout (v1)

Tracked in-process in memory in `backend/src/modules/auth/lockout.ts` (a module-level `Map<email, { attempts, lockedUntil }>`). On each failed login attempt the failure counter for that email is incremented. When the counter reaches **5 consecutive failures** the account is locked for **60 seconds**. During lockout, login attempts return `423 ACCOUNT_LOCKED` with `{ retryAfter: <seconds remaining> }` in the response body. A successful login resets the counter.

> **Phase 1 limitation — accepted and explicit.** The in-memory store has two known consequences that are acceptable for v1 but must not be treated as bugs:
> 1. **It is cleared on every process restart.** Railway restarts the container on each deploy (frequent during early development), which resets all counters. An attacker who can trigger or wait for a deploy can therefore reset their lockout. Rate limiting (Section 6 *Rate limiting*) remains in force as a second layer regardless of restarts.
> 2. **It is per-process.** If Railway ever scales the backend beyond a single replica, each instance keeps its own counter and the effective threshold multiplies by the replica count.
>
> Both are tolerable because Phase 1 runs a **single Railway replica** and lockout is a secondary defense behind rate limiting. Promoting lockout to a persistent/shared store (Redis or a DB column) is a future change that does **not** alter the API contract (`423 ACCOUNT_LOCKED` + `retryAfter` stays identical). No `User` columns are added for this in Phase 1 (see Section 4).

### Security posture

- bcrypt cost factor 12 (SAN-6).
- Generic `INVALID_CREDENTIALS` message — same for unknown email and wrong password (prevents account enumeration, SAN-7).
- Rate limiting on all auth endpoints; stricter limit on login (see above).
- Account lockout after 5 consecutive failures, 60-second window (v1 in-memory).
- CORS restricted to `FRONTEND_ORIGIN` with `credentials: true` (SAN-5).
- `passwordHash` never returned in any API response (SAN-6, SAN-8).
- Refresh token in an `httpOnly` cookie scoped to `Path=/api/v1/auth`; `Secure` + `SameSite=None` in production (see *Refresh cookie attributes*).
- Secrets validated at startup (`env.ts`, Section 7.1) — weak/missing signing keys abort boot rather than reaching production.
- Container runs as a non-root user (Section 10.2).

---

## 7. Environment Configuration

### Backend (`backend/.env`)

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | Prisma connection string for PostgreSQL (Railway managed instance in production) | `postgresql://user:pass@localhost:5432/superusers` |
| `JWT_ACCESS_SECRET` | Secret for signing access tokens (min 32 chars) | `a-very-long-random-secret` |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens (separate from access) | `another-very-long-random-secret` |
| `JWT_ACCESS_TTL` | Access token TTL in seconds | `900` (15 minutes) |
| `JWT_REFRESH_TTL` | Refresh token TTL in seconds | `604800` (7 days) |
| `FRONTEND_ORIGIN` | CORS allowed origin (Vercel deployment URL in production) | `http://localhost:5173` |
| `PORT` | HTTP server port | `3000` |
| `NODE_ENV` | Runtime environment | `development` / `production` |
| `BCRYPT_ROUNDS` | bcrypt cost factor (default 12) | `12` |
| `RATE_LIMIT_WINDOW_MS` | Auth rate-limit window in milliseconds | `900000` (15 minutes) |
| `RATE_LIMIT_MAX` | Max requests per IP per window for all auth endpoints | `20` |
| `LOGIN_RATE_LIMIT_MAX` | Max login attempts per IP per window | `10` |
| `LOCKOUT_MAX_ATTEMPTS` | Failed login attempts before account is locked | `5` |
| `LOCKOUT_DURATION_SECONDS` | Account lockout duration in seconds | `60` |
| `LOG_LEVEL` | pino log level (`trace`, `debug`, `info`, `warn`, `error`) | `info` |

### 7.1 Startup validation (`backend/src/config/env.ts`)

All environment variables are parsed and validated **once at startup** with a `zod` schema. The validated, typed, frozen object is the only way the rest of the codebase reads configuration — no `process.env.X` access outside `env.ts`.

```typescript
// backend/src/config/env.ts (shape)
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.coerce.number().int().positive(),
  JWT_REFRESH_TTL: z.coerce.number().int().positive(),
  FRONTEND_ORIGIN: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive(),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive(),
  LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOCKOUT_DURATION_SECONDS: z.coerce.number().int().positive().default(60),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = Object.freeze(parsed.data);
```

**Rationale:** A missing or malformed variable (e.g. an `JWT_ACCESS_SECRET` shorter than 32 chars, or an unset `DATABASE_URL`) fails **loudly at boot with a descriptive message** rather than surfacing as an obscure error deep inside a request handler in production. `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` enforce a 32-character minimum to reject weak signing keys.

### Backend test override (`backend/.env.test`)

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | Points to the Docker PostgreSQL instance used for integration tests | `postgresql://test:test@localhost:5433/superusers_test` |

### Frontend (`frontend/.env`)

| Variable | Description | Example |
|---|---|---|
| `VITE_API_BASE_URL` | Base URL for the Express backend | `http://localhost:3000` |

---

## 8. Findings from Linear

This section documents every technology choice and architectural decision extracted from the Linear issues, with a reference to the originating ticket.

### 8.1 Technologies explicitly decided

| Technology | Decision | Source |
|---|---|---|
| Vue 3 (Composition API) | Frontend framework | SAN-5 |
| Pinia | Frontend state management | SAN-5 |
| Vue Router | Client-side routing with navigation guards | SAN-5, SAN-7, SAN-8 |
| Axios | HTTP client with centralized interceptors | SAN-5, SAN-7 |
| Express.js (Node.js) | Backend HTTP framework | SAN-5 |
| Prisma ORM | Database access layer | SAN-5 |
| PostgreSQL | Primary relational database | SAN-5 |
| bcrypt (cost factor 12) | Password hashing algorithm | SAN-5, SAN-6 |
| JWT (HS256) | Token format for access and refresh tokens | SAN-5, SAN-7 |

### 8.2 Architectural decisions already made

| Decision | Detail | Source |
|---|---|---|
| Dual-token auth (access + refresh) | Short-lived access JWT (15m) in memory; long-lived refresh JWT (7d) in httpOnly cookie | SAN-5, SAN-7 |
| Refresh-token rotation | Every refresh call deletes the old `Session` and creates a new one | SAN-7 |
| Reuse detection | Presenting a consumed refresh token revokes all sessions for that user | SAN-7 |
| Session table | `Session` model provides server-side revocation; logout is reliable | SAN-5, SAN-7 |
| RBAC with two roles | `USER` (default) and `ADMIN` via `Role` enum; enforced by `requireAuth` + `requireRole` middleware | SAN-5, SAN-8 |
| No account enumeration | Login returns identical `401 INVALID_CREDENTIALS` for unknown email and wrong password | SAN-7 |
| Shared error envelope | All errors: `{ "error": { "code": string, "message": string } }` | SAN-5 |
| CORS with credentials | Restricted to `FRONTEND_ORIGIN`; `credentials: true` required for cookie transport | SAN-5 |
| UUID primary keys | Both `User` and `Session` use `uuid()` defaults | SAN-5 |
| Cascade delete sessions | `onDelete: Cascade` on `Session.userId` | SAN-5 |
| Access token in memory only | Access token never persisted to `localStorage`; Pinia store only | SAN-6, SAN-7 |
| Refresh token in httpOnly cookie | Mitigates JS-based cookie theft | SAN-6, SAN-7 |
| App bootstrap refresh | On SPA load, attempt `refresh()` to silently restore session | SAN-7 |
| Email normalization | Emails lowercased before lookup/storage | SAN-6, SAN-7 |
| Email verification | Out of scope for initial delivery; treated as optional stretch | SAN-5, SAN-6 |
| Rate limiting on auth endpoints | Specified as a requirement, implementation TBD | SAN-7 |
| Backend is the security boundary | Frontend `v-if` and route guards are UX only; every request is verified server-side | SAN-8 |

### 8.3 Decisions resolved post-ticket (user input)

| Decision | Detail |
|---|---|
| Rate-limit library | `express-rate-limit` (in-process); no Redis store for v1 single-instance Railway deployment |
| Rate-limit thresholds | All auth: 20 req / 15 min per IP; login: 10 req / 15 min per IP |
| Account lockout | In scope for v1; 5 consecutive failures → 60-second lockout; tracked in-memory (restart-volatile, per-process — limitation documented in Section 6) |
| Admin seeding | CLI seed script at `backend/seeds/seed-admin.ts`; runbook in `docs/seeds.md` |
| API versioning | `/api/v1/` prefix from initial scaffold; future versions can coexist at `/api/v2/` |
| Logging | `pino` + `pino-http`; structured JSON to stdout; log level controlled via `LOG_LEVEL` env var |
| Frontend deployment | Vercel (direct, no Docker); `vercel.json` SPA rewrite |
| Backend deployment | Railway with a non-root multi-stage `Dockerfile` in `backend/` |
| Database hosting | Railway managed PostgreSQL instance |
| Migration execution | Single release command `npx prisma migrate deploy && node dist/server.js`; failed migration aborts the release and the previous container keeps serving (Section 10). Railway injects `DATABASE_URL` into the container at runtime. For local/test runs against the dockerized test DB, use `npm run migrate:test` from `backend/`, which loads `backend/.env.test` via `dotenv-cli` before invoking `prisma migrate deploy` |
| Container user | Runs as the non-root `node` user (defense-in-depth; the app writes nothing to disk) |
| Health check | `GET /api/v1/health` with a DB ping; Railway readiness probe (Sections 5.3, 10.6) |
| Env validation | `zod` schema in `config/env.ts`; fails fast at startup (Section 7.1) |
| Refresh cookie | Env-aware: prod `SameSite=None; Secure`, dev `SameSite=Lax`; `Path=/api/v1/auth` (Section 6) |
| API envelope | Success `{ data: T }`, error `{ error: { code, message } }`; shared `types/api.ts` (Section 5) |
| Frontend 401 handling | Queued single-flight refresh in `services/axios.ts` (Section 6) |
| Cold-load hydration | `useAuthStore().init()` awaited in `main.ts` before mount (Section 6) |
| Form validation | VeeValidate + zod; schemas shared with the API contract |
| CI | GitHub Actions `ci.yml`; required check on PRs (Section 10.4) |
| Admin seed idempotency | `seed-admin.ts` upserts on email (Section 12) |
| Testing strategy | Full strategy deferred to Phase 2; documented in [`docs/testing-scaffolding/`](testing-scaffolding/) |

---

## 9. Testing Strategy

> **Deferred to Phase 2.** The complete testing scaffolding — frontend (unit + end-to-end) and backend (application layer, repository layer, API layer) — is documented separately in [`docs/testing-scaffolding/`](testing-scaffolding/). Phase 1 establishes the *testability seams* (singleton Prisma client, service/repository separation, typed env, shared API envelope) so that the Phase 2 suites slot in without refactoring.

The tooling chosen for that phase is fixed here so scaffolding does not pre-empt it:

- **Frontend:** Vitest (unit, shares Vite config) + Playwright (E2E).
- **Backend:** Vitest for the application and repository layers; Vitest + supertest for the API layer, running against a real PostgreSQL 16 instance via `docker-compose.test.yml` (Section 10.5).

See the Phase 2 document for layer-by-layer scope, directory conventions, the test-database lifecycle (migrations + truncation), and run commands.

---

## 10. Deployment

> **Execution scope:** Deployment is **not** part of the Phase 1 scaffolding effort — it is tracked as a separate follow-up task. The full set of deployment decisions and the order-of-operations runbook are consolidated in [`docs/deployment.md`](deployment.md). The subsections below remain the source of truth for the technical decisions themselves.

### 10.1 Frontend → Vercel

- Deploy the `frontend/` directory directly to Vercel (no Docker).
- Set `VITE_API_BASE_URL` in Vercel environment variables to the Railway backend URL.
- `vite build` produces a static SPA; Vercel serves it with automatic CDN and HTTPS.
- SPA fallback (`/*` → `index.html`) **must** be configured in `frontend/vercel.json`, otherwise any hard refresh or direct-URL visit to a client route (e.g. `/profile`) returns a 404:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### 10.2 Backend → Railway (Docker)

Railway builds and runs the `backend/Dockerfile`. The image is a **multi-stage build** that runs as the **non-root `node` user** in the production stage (defense-in-depth: a compromised app process is an unprivileged user, not container root; this stack writes nothing to local disk, so there is no permission cost). `prisma generate` runs at **build time**, not startup.

```dockerfile
# ---- Builder stage ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build            # tsc → dist/

# ---- Production stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# node:22-alpine already ships an unprivileged `node` user
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
# Release command — see 10.3. Migrations run before the server starts.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
```

- All secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, etc.) are set as Railway environment variables; `env.ts` validates them at startup (Section 7.1) and the container exits immediately if any are missing or invalid.
- `FRONTEND_ORIGIN` must be set to the Vercel deployment URL to allow credentialed CORS requests.

### 10.3 Migration execution (release model)

Migrations run as part of a **single release command** — the container's `CMD` — so the schema is always brought up to date *before* the new code begins serving:

```sh
npx prisma migrate deploy && node dist/server.js
```

- `migrate deploy` applies committed migrations only (never generates or prompts — unlike `migrate dev`); it is the correct, non-interactive command for production.
- **If the migration fails**, the `&&` short-circuits: `node dist/server.js` never runs, the new container exits non-zero, and **Railway keeps the previous healthy container serving traffic**. The deployment is marked failed rather than going live against a half-migrated database.
- `db push` is **never** used in production — only `migrate deploy`. Initial Railway setup also uses `migrate deploy` against the freshly provisioned database.

### 10.4 Continuous Integration (`.github/workflows/ci.yml`)

A GitHub Actions workflow runs on every pull request and is a **required status check** (merge is blocked until it passes):

1. `npm ci` (frontend + backend)
2. `npx prisma validate` — schema sanity
3. `tsc --noEmit` — typecheck both packages
4. `lint` — both packages, ESLint + `@typescript-eslint` (see Section 2)
5. **tests** — frontend (Vitest) and backend (Vitest + supertest), the latter against a PostgreSQL **service container** so the API-layer tests run end-to-end in CI

This keeps `main` green and catches schema/type regressions before they reach a Railway deploy.

### 10.5 Test database (`docker-compose.test.yml`)

A dedicated, ephemeral PostgreSQL instance for the backend test suites. The major version matches production (`16`); it is mapped to host port **5433** to avoid clashing with a local dev Postgres on 5432, and it persists no volume (fresh on each `up`):

```yaml
services:
  postgres-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: superusers_test
    ports:
      - "5433:5432"
```

`backend/.env.test` points `DATABASE_URL` at this instance (`postgresql://test:test@localhost:5433/superusers_test`). The test-database lifecycle (apply migrations before the suite, truncate between files) is detailed in the Phase 2 testing document.

### 10.6 Database & Railway runtime

For someone new to deploys, three runtime contracts must line up — all are configured for you by Railway except the first, which the code must honour:

- **Bind to the injected port.** Railway assigns the HTTP port at runtime via the `PORT` env var; `server.ts` **must** listen on `process.env.PORT` (never a hardcoded value), or Railway routes traffic to a port the app isn't listening on and the service appears down.
- **Health check.** Railway polls `GET /api/v1/health` (Section 5.3) to decide when a new container is ready before switching traffic to it, and to detect an unhealthy instance afterwards. The endpoint pings the DB so it reports `503` if the database is unreachable.
- **Database connection.** PostgreSQL is provisioned as a Railway plugin attached to the backend service; `DATABASE_URL` is **injected automatically** at runtime — credentials are never copy-pasted into config.
- **Migrations before go-live.** Because migrations run inside the release command (Section 10.3), each new version updates the schema *before* the new container begins serving; a failed migration aborts the release and leaves the previous version live.

---

## 11. Logging

`pino` is the structured logger for the Express backend. Configuration lives in `backend/src/lib/logger.ts`.

```typescript
// backend/src/lib/logger.ts
import pino from 'pino';
import { env } from '../config/env';
export const logger = pino({ level: env.LOG_LEVEL });
```

> Configuration is read from the validated `env` object (Section 7.1), not directly from `process.env` — this is the convention throughout the backend.

`pino-http` is registered as early middleware in `app.ts` to emit one structured log line per request including method, URL, status code, and response time:

```typescript
import pinoHttp from 'pino-http';
app.use(pinoHttp({ logger }));
```

**Log levels in use:**

| Level | Usage |
|---|---|
| `info` | Incoming requests (via pino-http), server start |
| `warn` | Rate-limit hits, failed login attempts, lockout triggers |
| `error` | Unhandled errors caught by `errorHandler.ts` |
| `debug` | Token verification steps, DB queries (dev only) |

Output is newline-delimited JSON to stdout — Railway captures and indexes this automatically. In development, pipe through `pino-pretty` for human-readable output:

```bash
npm run dev | npx pino-pretty
```

---

## 12. Admin Seeding

The `ADMIN` role cannot be self-assigned through the registration API (all registrations default to `USER`). The first admin user is created via a CLI seed script.

### Script location

```
backend/seeds/seed-admin.ts
```

### Usage

```bash
# From backend/
DATABASE_URL="..." npx tsx seeds/seed-admin.ts \
  --email admin@example.com \
  --password "SecurePassword1"
```

The script:
1. Validates the provided email and password against the same rules as the registration endpoint.
2. **Upserts on `email`** — if a user with that email already exists it is updated (promoted to `ADMIN`, password re-hashed); otherwise a new `User` row is created with `role: ADMIN`. This makes the script **idempotent**: re-running it is safe and never throws a duplicate-email error.
3. Stores a bcrypt-hashed password (never the raw value).
4. Prints the resulting user ID and whether it was created or updated, then exits.

### Documentation

Full runbook, safety notes (never run against production without a DB backup), and instructions for adding future seed scripts are maintained in [`docs/seeds.md`](seeds.md).

---

*End of architecture document.*
