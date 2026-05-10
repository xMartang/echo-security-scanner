import { prisma } from '@/common/db/client.js';
import { createLogger } from '@/common/utils/log/logger.js';
import { env } from '@/bullmq/config/env.js';
import type { PrismaClient } from '@prisma/client';

/**
 * Hard-deletes ImageVulnerability rows not confirmed by any scanner for
 * VULNERABILITY_RETENTION_DAYS days (default 30).
 *
 * This is STORAGE HYGIENE, not staleness logic. Staleness is already handled by the
 * lastSeenAt >= lastScannedAt filter in the repository layer -- stale rows are invisible
 * to the API immediately after the scan that missed them. This job just prevents the
 * table from growing unbounded over months of continuous scanning.
 *
 * Only ImageVulnerability rows are deleted. Cve and Package rows are reference data
 * shared across images and are NOT touched.
 */

const logger = createLogger({
  serviceName: env.SERVICE_NAME,
  dir: env.LOG_DIR,
  level: env.LOG_LEVEL,
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function pruneStaleVulnerabilities(db: PrismaClient = prisma): Promise<void> {
  const retentionDays = env.VULNERABILITY_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY);

  const { count } = await db.imageVulnerability.deleteMany({
    where: { lastSeenAt: { lt: cutoff } },
  });

  if (count > 0) {
    logger.info(
      { count, cutoffDate: cutoff.toISOString(), retentionDays },
      'pruned stale ImageVulnerability rows',
    );
  } else {
    logger.info(
      { cutoffDate: cutoff.toISOString(), retentionDays },
      'no stale ImageVulnerability rows to prune',
    );
  }
}
