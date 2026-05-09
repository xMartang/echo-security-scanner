import { Worker } from 'bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '@/config/env.js';
import { IMAGES } from '@/config/images.js';
import { scanQueue } from '@/queue/queue.js';
import { processSchedulerTick } from '@/queue/jobs/scheduler-tick.job.js';

/**
 * Registers (or refreshes) the repeatable scheduler tick on `schedulerQueue`
 * and starts an in-process Worker that processes tick jobs by fan-out to the
 * `image-scan` queue.
 *
 * Also enqueues an immediate fan-out on startup so the first batch runs
 * without waiting up to SCAN_INTERVAL_MS.
 *
 * Returns the tick Worker so the bullmq.ts entrypoint can close it during
 * graceful shutdown.
 */
export async function setupScheduler(
  schedulerQueue: Queue,
  connection: Redis,
): Promise<Worker> {
  // Register (or refresh) the repeatable job that fires every SCAN_INTERVAL_MS.
  // upsertJobScheduler is idempotent — safe to call on every restart.
  await schedulerQueue.upsertJobScheduler(
    'scan-all-images',
    { every: env.SCAN_INTERVAL_MS },
    {
      name: 'scheduler-tick',
      data: { triggeredAt: new Date().toISOString() },
    },
  );

  // In-process Worker for the scheduler queue (not sandboxed — pure enqueue, no Trivy).
  const tickWorker = new Worker<import('@/types/job-payload.js').SchedulerTickJobData>(
    'image-scheduler',
    processSchedulerTick,
    { connection, concurrency: 1 },
  );

  // Immediate fan-out so the first scan batch starts on boot rather than after
  // the first SCAN_INTERVAL_MS delay.
  const now = new Date().toISOString();
  const initialJobs = IMAGES.map((img) => ({
    name: 'scan-image',
    data: { imageName: img.name, imageTag: img.tag },
    opts: {
      jobId: `${img.name}:${img.tag}:${now}`,
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  }));
  await scanQueue.addBulk(initialJobs);

  return tickWorker;
}
