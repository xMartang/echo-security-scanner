# Coding Conventions

## Naming
- Variables/Functions: lowerCamelCase
- Classes/Constructors: PascalCase
- Constants: UPPER_CASE_SNAKE
- Types/Interfaces: PascalCase (no `I` prefix)
- Files: kebab-case (e.g., `scan-scheduler.ts`, `image-repository.ts`)
- Prisma-generated types may be re-exported from the relevant service's `types/` directory with cleaner aliases if needed.

## Coding Standards
- **Async:** Always use `async/await`; avoid raw callbacks or `.then()` chains.
- **Error handling:** Use standard `Error` objects or custom classes extending `Error`. Define domain errors in `src/common/utils/errors.ts` (e.g., `ScanFailedError`, `ImageNotFoundError`).
- **Comparisons:** Always use `===`.
- **Imports:** ES Modules (`import`/`export`) at the top of every file. Use `.js` extensions in import paths (required for ESM + TypeScript).
- **Return types:** Prefer explicit return types on all exported functions.
- **`any`:** Forbidden. Use `unknown` when the type is genuinely uncertain, then narrow.
- **Non-null assertions (`!`):** Never use without an inline comment explaining why the value cannot be null.

## TypeScript Config
- `strict: true` in `tsconfig.json` — non-negotiable.
- Path aliases configured (`@/` maps to `src/`) — use them instead of deep relative imports.
- Compiled output: `/dist`. Source: `/src`.

## Library-Specific Patterns

### Prisma
- Access the DB only through repository functions in `src/common/db/`. Never import `PrismaClient` directly in services or routes.
- Use a singleton `PrismaClient` instance exported from `src/common/db/client.ts`.
- Wrap multi-step writes in `prisma.$transaction([...])` to ensure atomicity.

### BullMQ
- Define job payload types explicitly — no untyped `data` objects.
- Workers must catch all errors and never throw out of the processor function; handle failure by updating DB status instead.

### Express
- Controllers are thin: extract params/query, call a service, return the response envelope.
- No business logic in route handlers.
- All async route handlers must be wrapped to forward errors to the global error middleware (use a `asyncHandler` utility wrapper).

### execa
- Always use the Promise-based API.
- Capture both `stdout` and `stderr`; log `stderr` even on success (Trivy sometimes writes warnings there).

## Commands
- Build: `pnpm build`
- Dev: `pnpm dev` (via `tsx watch`)
- Test: `pnpm test`
- Lint: `pnpm lint`
- Type check: `pnpm typecheck` (`tsc --noEmit`)
- Start: `pnpm start`

## Quality Gates
Claude MUST run `pnpm lint && pnpm typecheck && pnpm test` before suggesting any code changes or commits.