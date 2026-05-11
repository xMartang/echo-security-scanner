/**
 * BullMQ entrypoint -- boots the scan worker, scheduler, and graceful shutdown.
 *
 * Expected env vars (inherited from process.env / docker-compose environment):
 *   SERVICE_NAME=bullmq  DATABASE_URL  REDIS_URL  TRIVY_SERVER_URL  ...
 */

import 'dotenv/config';
import { env } from '@/bullmq/config/env.js';
import { FLUSH_WAIT_MS } from '@/common/consts.js';
import { createLogger } from '@/common/utils/log/logger.js';
import { prisma } from '@/common/db/client.js';
import { imageRepository } from '@/common/db/repositories/image.repository.js';
import { connection } from '@/bullmq/connection.js';
import { scanQueue, schedulerQueue } from '@/bullmq/tasks/scanners/trivy/queues.js';
import { createScanWorker } from '@/bullmq/tasks/scanners/trivy/worker.js';
import { SCAN_QUEUE_NAME, SCHEDULER_QUEUE_NAME } from '@/bullmq/tasks/scanners/trivy/consts.js';
import { setupScheduler } from '@/bullmq/services/scheduler.service.js';

// Shutdown timing constants (internal -- not operator-configurable).
const HARD_KILL_TIMEOUT_MS = 25_000; // force-exit if graceful shutdown hangs
const SCAN_WORKER_DRAIN_TIMEOUT_MS = 20_000; // max time to let in-flight scans finish

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

async function main() {
  logger.info({ redisUrl: env.REDIS_URL, trivyUrl: env.TRIVY_SERVER_URL }, 'bullmq starting');

  // Recover images left in SCANNING state by a previous crashed worker.
  const recoveredCount = await imageRepository.markStuckScanningAsFailed();
  if (recoveredCount > 0) {
    logger.warn({ recoveredCount }, 'marked stuck SCANNING images as FAILED');
  }

  logger.debug({ queue: SCAN_QUEUE_NAME }, 'setting up sandboxed scan worker');
  const scanWorker = createScanWorker(connection);
  logger.info({ queue: SCAN_QUEUE_NAME, concurrency: scanWorker.concurrency }, 'scan worker ready');

  logger.debug({ schedulerQueue: SCHEDULER_QUEUE_NAME, scanQueue: SCAN_QUEUE_NAME }, 'setting up scheduler and stale-vuln-cleanup worker');
  const [tickWorker, staleVulnCleanupWorker] = await setupScheduler(schedulerQueue, connection);
  logger.info({ intervalMs: env.SCAN_INTERVAL_MS }, 'scheduler ready');

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'shutdown signal received');

    // Hard-kill safety net: started AFTER SIGTERM, not at startup.
    const hardKillTimer = setTimeout(() => {
      logger.fatal(`forced exit: shutdown timed out after ${HARD_KILL_TIMEOUT_MS / 1000} s`);
      process.exit(1);
    }, HARD_KILL_TIMEOUT_MS).unref();

    try {
      logger.debug('closing scan queue and scheduler queue');
      await scanQueue.close();
      await schedulerQueue.close();

      logger.debug(`draining scan worker (${SCAN_WORKER_DRAIN_TIMEOUT_MS / 1000} s timeout)`);
      await Promise.race([
        scanWorker.close(),
        new Promise<void>((resolve) => setTimeout(resolve, SCAN_WORKER_DRAIN_TIMEOUT_MS)),
      ]);

      logger.debug('closing scheduler tick worker');
      await tickWorker.close();

      logger.debug('closing stale-vuln-cleanup worker');
      await staleVulnCleanupWorker.close();

      logger.debug('disconnecting Prisma and Redis');
      await prisma.$disconnect();
      await connection.quit();
    } catch (shutdownErr) {
      logger.error({ err: shutdownErr }, 'error during shutdown sequence');
    }

    logger.info('bullmq shutdown complete');
    logger.flush?.();
    await new Promise<void>((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));

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
