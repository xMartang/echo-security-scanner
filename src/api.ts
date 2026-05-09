/**
 * API entrypoint — boots Express, listens on PORT, handles graceful shutdown.
 *
 * Expected env vars: SERVICE_NAME=api  DATABASE_URL  REDIS_URL  PORT  …
 */

import 'dotenv/config';
import { env } from '@/config/env.js';
import { createLogger } from '@/utils/log/logger.js';
import { prisma } from '@/db/client.js';
import { connection } from '@/queue/queue.js';
import { createApp } from '@/api/app.js';

const logger = createLogger({
  serviceName: env.SERVICE_NAME,
  dir: env.LOG_DIR,
  level: env.LOG_LEVEL,
});

// ── Unhandled error guards ────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection — exiting');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — exiting');
  process.exit(1);
});

// ── Boot ──────────────────────────────────────────────────────────────────────

const app = createApp({
  logger,
  db: prisma,
  redis: connection,
  trivyUrl: env.TRIVY_SERVER_URL,
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'api listening');
});

// Hard-kill safety net — unref so it doesn't block the event loop normally.
const hardKillTimer = setTimeout(() => {
  logger.fatal('forced exit: api shutdown timed out after 20 s');
  process.exit(1);
}, 20_000).unref();

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutdown signal received, draining api');

  // Stop accepting new connections; finish in-flight requests or timeout after 15 s.
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 15_000);
    server.close(() => {
      clearTimeout(timeout);
      resolve();
    });
  });

  await prisma.$disconnect();
  logger.info('api shutdown complete');
  logger.flush?.();
  await new Promise<void>((resolve) => setTimeout(resolve, 200));

  clearTimeout(hardKillTimer);
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
