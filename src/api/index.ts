/**
 * API entrypoint -- boots Express, listens on PORT, handles graceful shutdown.
 *
 * Expected env vars: SERVICE_NAME=api  DATABASE_URL  PORT  ...
 */

import 'dotenv/config';
import { env } from '@/api/config/env.js';
import { FLUSH_WAIT_MS } from '@/common/consts.js';
import { createLogger } from '@/common/utils/log/logger.js';
import { prisma } from '@/common/db/client.js';
import { createApp } from '@/api/app.js';

// Shutdown timing constants (internal -- not operator-configurable).
const HARD_KILL_TIMEOUT_MS = 20_000; // force-exit if graceful shutdown hangs
const SERVER_CLOSE_TIMEOUT_MS = 15_000; // max time to drain in-flight HTTP requests

const logger = createLogger({
  serviceName: env.SERVICE_NAME,
  dir: env.LOG_DIR,
  level: env.LOG_LEVEL,
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection -- exiting');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception -- exiting');
  process.exit(1);
});

const app = createApp({ logger, db: prisma });

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'api listening');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutdown signal received, draining api');

  // Hard-kill safety net: started AFTER SIGTERM, not at startup.
  // .unref() so it does not prevent the event loop from exiting naturally.
  const hardKillTimer = setTimeout(() => {
    logger.fatal(`forced exit: api shutdown timed out after ${HARD_KILL_TIMEOUT_MS / 1000} s`);
    process.exit(1);
  }, HARD_KILL_TIMEOUT_MS).unref();

  // Stop accepting new connections; let in-flight requests finish.
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, SERVER_CLOSE_TIMEOUT_MS);
    server.close(() => {
      clearTimeout(timeout);
      resolve();
    });
  });

  await prisma.$disconnect();
  logger.info('api shutdown complete');
  logger.flush?.();
  await new Promise<void>((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));

  clearTimeout(hardKillTimer);
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
