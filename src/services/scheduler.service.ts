import { Worker } from 'bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '@/config/env.js';
import { processSchedulerTick } from '@/queue/jobs/scheduler-tick.job.js';
import type { SchedulerTickJobData } from '@/types/job-payload.js';

/**
 * Registers (or refreshes) the repeatable scheduler tick on `schedulerQueue`
 * and starts an in-process Worker that processes tick jobs by fan-out.
 *
 * `inboundScanQueue` is the queue that scan jobs are added to; injected so
 * integration tests can pass a queue backed by a test Redis instance without
 * relying on the module-level singleton.
 *
 * Also triggers an immediate fan-out on startup so the first batch runs
 * without waiting up to SCAN_INTERVAL_MS.
 */
export async function setupScheduler(
  schedulerQueue: Queue,
  inboundScanQueue: Queue,
  connection: Redis,
): Promise<Worker> {
  // Idempotent — safe to call on every restart.
  await schedulerQueue.upsertJobScheduler(
    'scan-all-images',
    { 
      every: env.SCAN_INTERVAL_MS,
      immediately: true // Immediate fan-out — first scan starts on boot, not after first interval.
    },
    {
      name: 'scheduler-tick',
      data: { triggeredAt: new Date().toISOString() },
    },
  );

  const tickWorker = new Worker<SchedulerTickJobData>(
    'image-scheduler',
    processSchedulerTick,
    { connection, concurrency: 1 },
  );

  return tickWorker;
}
