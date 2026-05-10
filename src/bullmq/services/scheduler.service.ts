import { Worker, Queue as BullQueue } from 'bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '@/bullmq/config/env.js';
import { processSchedulerTick } from '@/bullmq/tasks/scanners/trivy/scheduler-tick.job.js';
import { pruneStaleVulnerabilities } from '@/bullmq/tasks/hygiene/prune-stale-vulnerabilities.job.js';
import type { SchedulerTickJobData } from '@/bullmq/types/job-payload.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Registers repeatable jobs and starts in-process workers.
 *
 * Currently registered tasks:
 *   1. scan-all-images   -- Trivy CVE scanner, runs every SCAN_INTERVAL_MS
 *   2. prune-stale-vulnerabilities -- weekly storage hygiene (NOT staleness logic)
 *
 * Adding a new task: create a module under tasks/, export a TaskConfig,
 * import it here and add another upsertJobScheduler + Worker registration.
 */
export async function setupScheduler(
  schedulerQueue: Queue,
  inboundScanQueue: Queue,
  connection: Redis,
): Promise<Worker[]> {
  //   -  - Task 1: Trivy image scanner   -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -
  // Idempotent -- safe to call on every restart.
  await schedulerQueue.upsertJobScheduler(
    'scan-all-images',
    {
      every: env.SCAN_INTERVAL_MS,
      immediately: true, // First scan starts on boot, not after the first interval.
    },
    {
      name: 'scheduler-tick',
      data: { triggeredAt: new Date().toISOString() },
    },
  );

  const scanTickWorker = new Worker<SchedulerTickJobData>(
    'image-scheduler',
    processSchedulerTick,
    { connection, concurrency: 1 },
  );

  //   -  - Task 2: Weekly storage hygiene   -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -
  // Deletes ImageVulnerability rows not confirmed in 30+ days. This is NOT
  // staleness logic -- the API already excludes stale CVEs via lastSeenAt filter.
  // This job prevents unbounded table growth over months of scanning.
  const hygieneQueue = new BullQueue('hygiene', { connection });
  await hygieneQueue.upsertJobScheduler(
    'prune-stale-vulnerabilities',
    { every: SEVEN_DAYS_MS },
    { name: 'prune-stale-vulnerabilities', data: {} },
  );

  const hygieneWorker = new Worker(
    'hygiene',
    async () => { await pruneStaleVulnerabilities(); },
    { connection, concurrency: 1 },
  );

  return [scanTickWorker, hygieneWorker];
}
