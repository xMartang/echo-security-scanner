# Project: Container Security Scanner

A background scanning service that periodically checks container images for CVE vulnerabilities using Trivy, persists results in PostgreSQL via Prisma, and exposes a REST API built with Express.

## Tech Stack & Infrastructure
- **Runtime:** Node.js (v24+, as 24 is the Active LTS) / TypeScript (strict mode)
- **Package Manager:** pnpm
- **Framework:** Express
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Queue:** BullMQ
- **Cache/Store:** Redis (BullMQ backend)
- **Scanner:** Trivy (client/server mode — see `docs/architecture.md`)
- **Testing:** Jest + ts-jest
- **Linting:** ESLint (@typescript-eslint)
- **Config:** dotenv + zod (validate all env vars at startup; fail fast if any are missing)

## Project Structure
```
src/
  common/         # Shared by both services: DB, logger, errors, base env
    config/
      env.ts      # Base zod schema (DATABASE_URL, LOG_LEVEL, LOG_DIR, SERVICE_NAME)
    db/           # Prisma client singleton + repositories
    utils/
      db/         # DB helpers (retryOnDBError)
      errors.ts   # Domain error classes
      log/        # Logger + log-transport.mjs
  api/            # Express REST API service
    index.ts      # API entrypoint
    config/env.ts # API env (extends common + PORT)
    app.ts        # Express app factory
    controllers/  # REST controllers
    middleware/   # Express middleware
    routes/       # Route definitions
    services/
      health.service.ts  # DB + scanner staleness check
    types/
      api-envelope.ts
  bullmq/         # BullMQ task runner service (renamed from scanner/)
    index.ts      # BullMQ entrypoint
    config/env.ts # BullMQ env (extends common + REDIS_URL, TRIVY_SERVER_URL, SCAN_INTERVAL_MS)
    queue.ts      # BullMQ queue + Redis connection
    worker.ts     # Sandboxed worker factory
    services/
      scheduler.service.ts  # Registers all repeatable tasks
    types/
      job-payload.ts        # Shared BullMQ job types
      task.types.ts         # TaskConfig interface — contract new tasks must satisfy
    tasks/
      scanners/
        trivy/              # Trivy-specific logic (scanner, persistence, scheduler-tick)
          index.ts          # Exports trivyTaskConfig: TaskConfig
          scan-image.job.ts
          scanner.service.ts
          persistence.service.ts
          scheduler-tick.job.ts
      stale-vuln-cleanup/   # Weekly stale-vulnerability cleanup task (unrelated to scanning)
        index.ts            # Exports staleVulnCleanupTaskConfig: TaskConfig
        prune-stale-vulnerabilities.job.ts
prisma/
  schema.prisma
```

## Service Boundary
API and Scanner share only the database. The API has no knowledge of Redis, BullMQ, Trivy, or scanner internals. The database is the only contract between the two services.

## Key Rules (read the docs)
Each doc governs a specific layer — Claude must follow all of them:

| File | Governs |
|---|---|
| `.claude/rules/conventions.md` | Naming, TypeScript standards, commands |
| `.claude/rules/architecture.md` | Trivy strategy, DB schema, BullMQ concurrency |
| `.claude/rules/docker.md` | Service connectivity, socket strategy |
| `.claude/rules/performance.md` | Event loop safety, BullMQ job design |

## API Layer Conventions
- All routes are prefixed with `/api`
- All responses use a consistent envelope:
  - **Success:** `{ data: T }`
  - **Error:** `{ error: { message: string, code?: string } }`
- Use a single global error-handling middleware (Express 4-arg signature) — never handle errors inline in route handlers.
- HTTP status codes: `200` success, `201` created, `400` bad input, `404` not found, `500` internal.
- Validate query params and route params explicitly before use; return `400` with a descriptive message on invalid input.
- Log every request (method, path, status, duration) via middleware.

## Environment Variables
All env vars must be declared and validated using zod in the service-specific `config/env.ts`. No `process.env` access outside these files.

**Common (both services)** — defined in `src/common/config/env.ts`:
```
DATABASE_URL
LOG_LEVEL     # default "info"
LOG_DIR       # default "./logs"
SERVICE_NAME
```

**API only** — extended in `src/api/config/env.ts`:
```
PORT          # default 3000
```

**Scanner only** — extended in `src/scanner/config/env.ts`:
```
REDIS_URL
TRIVY_SERVER_URL      # e.g. http://trivy-server:8080
SCAN_INTERVAL_MS      # default 900000 (15 min)
```

## Infrastructure Commands
- `docker compose up --build` — start the entire stack
- `pnpm prisma:migrate` — run database migrations (`prisma migrate dev`)
- `pnpm prisma:studio` — open Prisma Studio
- `pnpm build` — compile TypeScript
- `pnpm dev` — run API in dev mode (`tsx watch src/api/index.ts`)
- `pnpm dev:worker` — run Scanner in dev mode (`tsx watch src/scanner/index.ts`)
- `pnpm test` — run Jest
- `pnpm lint` — run ESLint
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm start` — run compiled API output
- `pnpm start:worker` — run compiled Scanner output

## Naming Conventions (enforced in code review)
- **No single-letter or cryptic variable names.** Exceptions: loop counters `i`, `j`, `k`.
- **Prisma transaction client:** always `trx`, never `tx`.
- **Upserted / saved DB records:** prefix with `saved` or name the entity explicitly — e.g. `savedPackage`, `savedCve`, not `p` or `c`.
- **Comparison results in sort callbacks:** name what is being compared — e.g. `cveIdOrder`, not `c`.
- **Map keys that store DB ids:** use descriptive names — e.g. `packageIdByName`, `cveDbIdByCveId`, not `pkgMap` or `cveMap`.

## Quality Gates
Claude MUST run `pnpm lint && pnpm typecheck && pnpm test` before suggesting any code changes or commits.