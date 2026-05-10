import { prisma } from '@/common/db/client.js';
import { createLogger } from '@/common/utils/log/logger.js';
import { env } from '@/bullmq/config/env.js';
import type { PrismaClient } from '@prisma/client';

/**
 * Hard-deletes ImageVulnerability rows not confirmed by any scanner for 30+ days.
 *
 * This is STORAGE HYGIENE, not staleness logic. Staleness is already handled by the
 * lastSeenAt >= lastScannedAt filter in the repository layer — stale rows are invisible
 * to the API immediately after the scan that missed them. This job just prevents the
 * table from growing unbounded over months of continuous scanning.
 *
 * Only ImageVulnerability rows are deleted. Cve and Package rows are reference data
 * shared across images and are NOT touched.
 */

const RETENTION_DAYS = 30;

const logger = createLogger({
  serviceName: env.SERVICE_NAME,
  dir: env.LOG_DIR,
  level: env.LOG_LEVEL,
});

export async function pruneStaleVulnerabilities(db: PrismaClient = prisma): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const { count } = await db.imageVulnerability.deleteMany({
    where: { lastSeenAt: { lt: cutoff } },
  });

  logger.info(
    { count, cutoffDate: cutoff.toISOString(), retentionDays: RETENTION_DAYS },
    'pruned stale ImageVulnerability rows',
  );
}
