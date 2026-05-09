# Project: Container Security Scanner

A background scanning service that periodically checks container images for CVE vulnerabilities using Trivy, persists results in PostgreSQL via Prisma, and exposes a REST API built with Express.

## Tech Stack & Infrastructure
- **Runtime:** Node.js (v20+) / TypeScript (strict mode)
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
  api/          # Express routes and controllers
  services/     # ScannerService, SchedulerService, HealthService
  queue/        # BullMQ worker and job definitions
  db/           # Prisma client singleton and repository layer
  config/       # Env var validation (zod schemas)
  types/        # Shared TypeScript types and interfaces
  utils/        # Shared helpers (logger, error classes)
prisma/
  schema.prisma
docs/
  architecture.md
  conventions.md
  docker.md
  performance.md
```

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
All env vars must be declared and validated in `src/config/env.ts` using zod. No `process.env` access outside this file.

Required vars:
```
DATABASE_URL
REDIS_URL
TRIVY_SERVER_URL      # e.g. http://trivy-server:8080
SCAN_INTERVAL_MS      # default 900000 (15 min)
PORT                  # default 3000
```

## Infrastructure Commands
- `docker-compose up --build` — start the entire stack
- `pnpm prisma:migrate` — run database migrations (`prisma migrate dev`)
- `pnpm prisma:studio` — open Prisma Studio
- `pnpm build` — compile TypeScript
- `pnpm dev` — run in dev mode (`tsx watch`)
- `pnpm test` — run Jest
- `pnpm lint` — run ESLint
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm start` — run compiled output

## Quality Gates
Claude MUST run `pnpm lint && pnpm typecheck && pnpm test` before suggesting any code changes or commits.