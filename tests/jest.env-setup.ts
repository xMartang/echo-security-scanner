/**
 * Jest setup file (runs before each test suite loads its modules).
 *
 * Sets the env vars required by zod validation in src/common/config/env.ts
 * and src/bullmq/config/env.ts so test suites that import service modules
 * (which transitively load env.ts) can initialize without erroring.
 *
 * Wired via `setupFiles` in jest.config.js -- runs BEFORE module imports.
 */

process.env.SERVICE_NAME ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.TRIVY_SERVER_URL ??= 'http://localhost:8080';
process.env.LOG_LEVEL ??= 'fatal';
process.env.LOG_DIR ??= './logs/test';
