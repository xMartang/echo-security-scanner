/**
 * BullMQ entrypoint â€” boots the scan worker, scheduler, and graceful shutdown.
 *
 * Expected env vars (inherited from process.env / docker-compose environment):
 *   SERVICE_NAME=bullmq  DATABASE_URL  REDIS_URL  TRIVY_SERVER_URL  â€¦
 */

import 'dotenv/config';
import { env } from '@/bullmq/config/env.js';
import { createLogger } from '@/common/utils/log/logger.js';
import { prisma } from '@/common/db/client.js';
import { imageRepository } from '@/common/db/repositories/image.repository.js';
import { connection, scanQueue, schedulerQueue } from '@/bullmq/queue.js';
import { createScanWorker } from '@/bullmq/worker.js';
import { setupScheduler } from '@/bullmq/services/scheduler.service.js';

const logger = createLogger({
  serviceName: env.SERVICE_NAME,
  dir: env.LOG_DIR,
  level: env.LOG_LEVEL,
});

// â”€â”€ Unhandled error guards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection â€” exiting');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception â€” exiting');
  process.exit(1);
});

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function main() {
  logger.info('bullmq entrypoint starting');

  // Recover images left in SCANNING state by a previous crashed worker.
  const recoveredCount = await imageRepository.markStuckScanningAsFailed();
  if (recoveredCount > 0) {
    logger.warn({ recoveredCount }, 'marked stuck SCANNING images as FAILED');
  }

  // Create the sandboxed scan worker (forked child processes, one per job).
  const scanWorker = createScanWorker(connection);
  logger.info({ concurrency: scanWorker.concurrency }, 'scan worker started');

  // Setup scheduler: register all repeatable tasks.
  const [tickWorker, hygieneWorker] = await setupScheduler(schedulerQueue, scanQueue, connection);
  logger.info({ intervalMs: env.SCAN_INTERVAL_MS }, 'scheduler started');

  // â”€â”€ Graceful shutdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'shutdown signal received, draining bullmq');

    // Hard-kill safety net: started AFTER SIGTERM, not at startup.
    const hardKillTimer = setTimeout(() => {
      logger.fatal('forced exit: shutdown timed out after 25 s');
      process.exit(1);
    }, 25_000).unref();

    try {
      await scanQueue.close();
      await schedulerQueue.close();

      // Give in-flight sandboxed jobs up to 20 s to finish before moving on.
      await Promise.race([
        scanWorker.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 20_000)),
      ]);
      await tickWorker.close();
      await hygieneWorker.close();

      await prisma.$disconnect();
      await connection.quit();
    } catch (shutdownErr) {
      logger.error({ err: shutdownErr }, 'error during shutdown sequence');
    }

    logger.info('bullmq shutdown complete');
    logger.flush?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    clearTimeout(hardKillTimer);
    process.exit(0);
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  logger.info('bullmq ready');
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'bullmq startup failed');
  process.exit(1);
});
