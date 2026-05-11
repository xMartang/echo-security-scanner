import { Worker, Queue as BullQueue } from 'bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '@/bullmq/config/env.js';
import { processSchedulerTick } from '@/bullmq/tasks/scanners/trivy/scheduler-tick.job.js';
import { SCAN_ALL_IMAGES_JOB_ID, SCHEDULER_QUEUE_NAME } from '@/bullmq/tasks/scanners/trivy/consts.js';
import { pruneStaleVulnerabilities } from '@/bullmq/tasks/stale-vuln-cleanup/prune-stale-vulnerabilities.job.js';
import { STALE_VULN_CLEANUP_INTERVAL_MS } from '@/bullmq/tasks/stale-vuln-cleanup/index.js';
import { STALE_VULN_CLEANUP_QUEUE_NAME, PRUNE_JOB_NAME } from '@/bullmq/tasks/stale-vuln-cleanup/consts.js';
import type { SchedulerTickJobData } from '@/bullmq/types/job-payload.js';

/**
 * Registers repeatable jobs and starts in-process workers.
 *
 * Currently registered tasks:
 *   1. scan-all-images              -- Trivy CVE scanner, runs every SCAN_INTERVAL_MS
 *   2. prune-stale-vulnerabilities  -- weekly storage cleanup (NOT staleness filtering)
 *
 * Adding a new task: create a module under tasks/, export a TaskConfig,
 * import it here and add another upsertJobScheduler + Worker registration.
 */
export async function setupScheduler(
  schedulerQueue: Queue,
  connection: Redis,
): Promise<Worker[]> {
  // Task 1: Trivy image scanner -- idempotent, safe to call on every restart.
  await schedulerQueue.upsertJobScheduler(
    SCAN_ALL_IMAGES_JOB_ID,
    {
      every: env.SCAN_INTERVAL_MS,
      immediately: true, // First scan starts on boot, not after the first interval.
    },
    {
      name: 'scheduler-tick',
      data: {},
    },
  );

  const scanTickWorker = new Worker<SchedulerTickJobData>(
    SCHEDULER_QUEUE_NAME,
    processSchedulerTick,
    { connection, concurrency: 1 },
  );

  // Task 2: Weekly stale-vulnerability cleanup -- deletes ImageVulnerability rows
  // older than VULNERABILITY_RETENTION_DAYS days. NOT staleness filtering; purely
  // operational storage maintenance.
  const staleVulnCleanupQueue = new BullQueue(STALE_VULN_CLEANUP_QUEUE_NAME, { connection });
  await staleVulnCleanupQueue.upsertJobScheduler(
    PRUNE_JOB_NAME,
    { every: STALE_VULN_CLEANUP_INTERVAL_MS },
    { name: PRUNE_JOB_NAME, data: {} },
  );

  const staleVulnCleanupWorker = new Worker(
    STALE_VULN_CLEANUP_QUEUE_NAME,
    async () => { await pruneStaleVulnerabilities(); },
    { connection, concurrency: 1 },
  );

  return [scanTickWorker, staleVulnCleanupWorker];
}
