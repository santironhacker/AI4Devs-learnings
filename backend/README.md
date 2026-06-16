# Backend — super-users Platform

Express 5 API server (TypeScript, Prisma, Zod-validated env). Entry point: [server.ts](server.ts) → [src/app.ts](src/app.ts).

## Requirements

- Node.js 20+
- PostgreSQL (local instance or Docker container)

## Environment variables

Configuration is validated at startup via [src/config/env.ts](src/config/env.ts). Create a `.env` file in `backend/` with at least:

```
DATABASE_URL="postgresql://user:password@localhost:5432/superusers"
JWT_ACCESS_SECRET="<32+ char secret>"
JWT_REFRESH_SECRET="<32+ char secret>"
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=604800
FRONTEND_ORIGIN="http://localhost:5173"
PORT=3000
NODE_ENV=development
BCRYPT_ROUNDS=12
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
LOGIN_RATE_LIMIT_MAX=5
LOCKOUT_MAX_ATTEMPTS=5
LOCKOUT_DURATION_SECONDS=60
LOG_LEVEL=info
```

If any required variable is missing or invalid, the process logs the validation errors and exits immediately.

## Install dependencies

```bash
cd backend
npm install
```

## Local development

Start the dev server with hot reload (via `tsx watch`):

```bash
npm run dev
```

The server listens on `PORT` (default `3000`) and exposes a health check at `GET /api/v1/health`, which verifies database connectivity.

### Database setup

Apply Prisma migrations to your local database:

```bash
npm run prisma:migrate:dev
```

Validate the Prisma schema:

```bash
npm run prisma:validate
```

## Build

Compile TypeScript to `dist/`:

```bash
npm run build
```

## Run the production build

After building, start the compiled server:

```bash
npm start
```

This runs `node dist/server.js` using the same environment variables as development (ensure `NODE_ENV=production` and production secrets/`DATABASE_URL` are set).

## Linting

```bash
npm run lint
```

## Unit tests

A test runner (Vitest) is **not yet wired up** in `package.json` — see [docs/testing-scaffolding/README.md](../docs/testing-scaffolding/README.md) for the planned test strategy (application, repository, and API layers). Once configured, the workflow will be:

```bash
npm run test:unit        # application/service layer (mocked repositories)
npm run test:repository  # repository layer (real Postgres test DB)
npm run test:integration # full HTTP layer via supertest
```

Repository and API tests require the test database described by `backend/.env.test`:

```bash
npm run migrate:test
```

which applies migrations to the database at `DATABASE_URL` configured in `.env.test` (`postgresql://test:test@localhost:5433/superusers_test`).

## Deployment

There is currently no Dockerfile or CI/CD pipeline configured for this backend. To deploy manually to any Node-capable host:

1. Provide all required environment variables (see above) with production values.
2. Install dependencies: `npm ci`
3. Apply database migrations: `npx prisma migrate deploy`
4. Build: `npm run build`
5. Start: `npm start`

Ensure `FRONTEND_ORIGIN` matches the deployed frontend's origin (used for CORS) and that `NODE_ENV=production` is set.
