# Testing Scaffolding — super-users Platform (Phase 2)

> Companion to [`../architecture.md`](../architecture.md). Phase 1 establishes the testability seams (singleton Prisma client, service/repository separation, typed env, shared API envelope); this document defines the full test strategy that slots into them. Treated as **Phase 2** work — none of it blocks the Phase 1 scaffold.
> Generated: 2026-06-01

---

## 1. Goals & Principles

- **Test by layer, not by file.** Each layer has a distinct responsibility, fixture strategy, and speed budget. Fast layers run on every save; slow layers run pre-merge.
- **The test pyramid.** Many fast unit tests (application + repository logic, frontend units), fewer integration tests (API layer against a real DB), fewest E2E tests (critical user journeys only).
- **Real database for the layers that own SQL.** Repository and API layers run against a real PostgreSQL 16 instance (`docker-compose.test.yml`) — mocking Prisma at those layers tests the mock, not the query.
- **Deterministic isolation.** Every test starts from a known DB state via truncation between tests; no cross-test ordering dependencies.
- **One source of truth for shapes.** Tests assert against the shared `ApiResponse<T>` / `ApiError` envelope (`types/api.ts`) so frontend and backend cannot drift.

### Tooling (fixed in Phase 1)

| Area | Layer | Runner | Notes |
|---|---|---|---|
| Frontend | Unit | Vitest (jsdom) | Shares `vite.config.ts`; `@vue/test-utils` for components |
| Frontend | E2E | Playwright | Real browser, runs against a built SPA + live backend |
| Backend | Application layer | Vitest | Service logic in isolation; repositories mocked |
| Backend | Repository layer | Vitest | Real PostgreSQL; verifies actual queries/constraints |
| Backend | API layer | Vitest + supertest | Full HTTP cycle against the real DB |

---

## 2. Backend — Application Layer

**What it covers:** business/service logic in `backend/src/modules/*/*.service.ts` and helpers (`lib/jwt.ts`, `modules/auth/lockout.ts`) — in isolation from the database and HTTP.

- **Scope:** registration rules, password hashing invocation, login validation, token issuance/rotation decisions, reuse-detection logic, lockout counter behaviour, email normalisation.
- **Dependencies are mocked:** the repository layer, `bcrypt`, `lib/jwt.ts`, and clock/`Date` where lockout timing matters. Use Vitest `vi.mock()` / `vi.useFakeTimers()`.
- **Why mock here:** the application layer's job is *decisions*, not persistence. Mocking the repository keeps these tests sub-millisecond and lets us drive every branch (e.g. reuse detected → revoke all sessions) without DB setup.
- **Location:** `backend/tests/unit/` (e.g. `auth.service.spec.ts`, `lockout.spec.ts`).
- **Run:** `npm run test:unit` inside `backend/`.

**Representative cases**

| Case | Expectation |
|---|---|
| Register with new email | repo `createUser` called once with bcrypt hash, never raw password |
| Register with taken email | throws `EMAIL_TAKEN`; repo `createUser` not called |
| Login wrong password | generic `INVALID_CREDENTIALS`; lockout counter incremented |
| 5th consecutive failure | account locked; `ACCOUNT_LOCKED` with `retryAfter` |
| Successful login | lockout counter reset to 0 |
| Refresh with consumed token | all sessions for user revoked (reuse detection) |
| Email casing | `Foo@Bar.com` normalised to lowercase before lookup/store |

---

## 3. Backend — Repository Layer

**What it covers:** the data-access code that talks to Prisma/PostgreSQL — query correctness, constraints, cascade behaviour, and the mapping between rows and domain objects.

- **Scope:** user/session CRUD, the `@unique` email constraint, `onDelete: Cascade` purging sessions, refresh-token uniqueness, timestamp defaults.
- **Database:** the **real** `superusers_test` PostgreSQL 16 instance from `docker-compose.test.yml` (host port 5433). No Prisma mocking at this layer.
- **Why real DB:** these tests exist precisely to catch what a mock hides — a wrong `where`, a missing index, a constraint that doesn't fire, a cascade that doesn't cascade.
- **Isolation:** tables truncated before each test (see §6). Migrations applied once before the suite.
- **Location:** `backend/tests/repository/`.
- **Run:** `npm run test:repository` inside `backend/` (after `docker compose -f docker-compose.test.yml up -d`).

**Representative cases**

| Case | Expectation |
|---|---|
| Insert duplicate email | DB rejects via `@unique`; surfaces as a catchable error |
| Delete user with sessions | all `Session` rows for that user removed (`onDelete: Cascade`) |
| Insert session, reuse refreshToken | second insert rejected by `@unique` on `refreshToken` |
| `createdAt` / `updatedAt` | populated by DB defaults without explicit assignment |
| Find by email (normalised) | returns the row regardless of stored vs. queried casing contract |

---

## 4. Backend — API Layer

**What it covers:** the full HTTP request/response cycle for every endpoint, exercising routers → middleware → controllers → services → repositories → DB as one stack.

- **Scope:** every route in Section 5 of the architecture: register, login, refresh (rotation + cookie), logout, `GET/PATCH /users/me`, admin `GET /users`, `GET /health`. Plus cross-cutting middleware: `requireAuth`, `requireRole`, rate limiting, the shared error envelope, CORS credentials.
- **Tooling:** `supertest` against the assembled Express `app` (imported from `app.ts`, not a live server) + the real test DB.
- **Assertions:** status codes, the `{ data }` / `{ error: { code, message } }` envelope, `Set-Cookie` attributes on auth responses (httpOnly, SameSite, Path), absence of `passwordHash` in any payload, `Retry-After` / `retryAfter` on rate-limit and lockout responses.
- **Isolation:** truncate between tests (§6); each test seeds only what it needs via repository helpers.
- **Location:** `backend/tests/integration/` (e.g. `auth.spec.ts`, `users.spec.ts`, `health.spec.ts`).
- **Run:** `npm run test:integration` inside `backend/`.

**Representative cases**

| Endpoint | Case | Expectation |
|---|---|---|
| `POST /auth/register` | valid | `201`, `{ data: { user, accessToken } }`, httpOnly refresh cookie set, no `passwordHash` |
| `POST /auth/register` | duplicate email | `409 EMAIL_TAKEN` |
| `POST /auth/login` | wrong password ×5 | `423 ACCOUNT_LOCKED` with `retryAfter` |
| `POST /auth/refresh` | valid cookie | `200` new access token + rotated cookie; old session row gone |
| `POST /auth/refresh` | reused cookie | `401 INVALID_REFRESH_TOKEN`; all user sessions revoked |
| `POST /auth/logout` | valid cookie | `204`, cookie cleared, session row deleted |
| `GET /users/me` | no token | `401 UNAUTHORIZED` |
| `GET /users` | USER role | `403 FORBIDDEN` |
| `GET /users` | ADMIN role | `200` list, no `passwordHash` on any item |
| `GET /health` | DB up | `200 { status: "ok", db: "connected" }` |
| any auth route | over rate limit | `429 RATE_LIMITED` + `Retry-After` |

---

## 5. Frontend — Unit Tests

**What it covers:** Pinia stores, composables, services, and components in `frontend/src/` — in a jsdom environment, with the network mocked.

- **Scope:**
  - **Stores** (`stores/auth.ts`): `init()` hydration paths (refresh succeeds → token set; fails → state cleared), `isAuthenticated` / `isAdmin` getters, login/logout mutations.
  - **Services** (`services/axios.ts`): the queued single-flight 401 refresh — assert that N concurrent 401s trigger exactly **one** refresh call and all originals are replayed.
  - **Composables** (`composables/useAuth.ts`).
  - **Validation** (`validation/auth.schemas.ts`): zod schemas accept/reject the right inputs.
  - **Components** (`LoginForm.vue`, `RegisterForm.vue`): render, VeeValidate error display, submit wiring.
- **Mocking:** Axios is mocked (`vi.mock`); no real network. Pinia uses `createTestingPinia`.
- **Location:** `frontend/tests/unit/`.
- **Run:** `npm run test` inside `frontend/`.

**Representative cases**

| Unit | Case | Expectation |
|---|---|---|
| `auth.init()` | refresh 200 | access token stored, `isAuthenticated` true |
| `auth.init()` | refresh 401 | state cleared, resolves without throwing |
| axios interceptor | 3 concurrent 401s | exactly 1 `/auth/refresh` call; 3 originals retried |
| axios interceptor | refresh fails | pending requests rejected; redirect to `/login` |
| `RegisterForm` | invalid email | VeeValidate shows error; submit blocked |
| `isAdmin` getter | role ADMIN / USER | true / false |

---

## 6. Frontend — End-to-End (E2E)

**What it covers:** critical user journeys through a **real browser** against a **built SPA + live backend + real DB** — the only layer that proves the cross-origin cookie flow actually works.

- **Tooling:** Playwright.
- **Environment:** `vite build` + preview (or a deployed preview URL) for the frontend; the backend running with the test database. Because E2E is the one place the `SameSite`/`Secure`/`withCredentials` chain is exercised against a browser, it is the gate for the highest-risk Phase 1 integration point (see architecture *Architectural Risks*).
- **Keep it thin:** E2E is slow and brittle — cover journeys, not permutations. Edge cases belong in the API/unit layers.
- **Location:** `frontend/tests/e2e/`.
- **Run:** `npm run test:e2e` inside `frontend/`.

**Critical journeys**

| Journey | Steps |
|---|---|
| Register → land authenticated | fill register form → submit → redirected to `/profile`, name shown |
| Login → refresh persistence | login → hard-reload page → still authenticated (cold-load `init()` + refresh cookie) |
| Logout | logout → redirected to `/login` → `/profile` now redirects to `/login?redirect=/profile` |
| RBAC block | login as USER → visit `/admin` → `ForbiddenView` (403) shown |
| RBAC allow | login as ADMIN (seeded) → `/admin` → user list renders |
| Guard redirect round-trip | visit `/profile` unauthenticated → bounced to login → after login, returned to `/profile` |

---

## 7. Test Database Lifecycle

Shared by the repository (§3) and API (§4) layers. Configured against `docker-compose.test.yml` (architecture §10.5); `backend/.env.test` sets `DATABASE_URL=postgresql://test:test@localhost:5433/superusers_test`.

1. **Once before the suite** (`beforeAll` in `backend/tests/setup.ts`): bring up the container if needed, then `prisma migrate deploy` against the test DB so its schema matches production migrations.
2. **Before each test** (`beforeEach`): truncate all tables (`TRUNCATE "Session", "User" RESTART IDENTITY CASCADE`) for a clean, deterministic state.
3. **After the suite** (`afterAll`): `prisma.$disconnect()`.
4. **In-memory lockout reset:** between tests, clear the lockout map (`lockout.__resetForTests()`) since it is process-global, not DB-backed.

```
backend/tests/
├── setup.ts            # migrate-once, truncate-each, disconnect-all, lockout reset
├── helpers/
│   ├── factories.ts    # seed a USER / ADMIN, mint tokens
│   └── client.ts       # supertest agent bound to the assembled app
├── unit/               # §2 application layer (mocked repo)
├── repository/         # §3 repository layer (real DB)
└── integration/        # §4 API layer (real DB)
```

---

## 8. CI Integration

The GitHub Actions workflow (architecture §10.4) runs these as a **required check** on every PR:

1. Frontend unit (Vitest) — fast, no services.
2. Backend application layer (Vitest) — fast, no services.
3. Backend repository + API layers — against a PostgreSQL **service container** (image `postgres:16-alpine`), with migrations applied in a CI step.
4. Frontend E2E (Playwright) — runs against a built SPA + a backend wired to the CI Postgres service.

Static checks (`prisma validate`, `tsc --noEmit`, lint) run before the test jobs so type/schema regressions fail fast and cheap.

---

## 9. Out of Scope (Phase 2)

- Load/performance testing.
- Contract testing between independently deployed services (single backend in Phase 1/2).
- Visual regression testing.
- Mutation testing.

These can be revisited if the product grows beyond the two-service, two-role shape described in the architecture.
