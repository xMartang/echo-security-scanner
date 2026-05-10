import type { Job, Queue } from 'bullmq';
import type { SchedulerTickJobData } from '@/types/job-payload.js';
import { IMAGES } from '@/config/images.js';
import { scanQueue } from '@/queue/queue.js';

/**
 * Builds the list of scan jobs for a given tick.
 * Pure function — exported so tests can verify job structure without touching Redis.
 *
 * jobId is STABLE (no timestamp) so BullMQ deduplicates concurrent ticks:
 *   - While a job is WAITING or ACTIVE, a second tick for the same image is a no-op.
 *   - removeOnComplete: { count: 0 } purges the job from Redis immediately on success,
 *     freeing the stable ID so the next tick can re-enqueue it cleanly.
 *
 * BullMQ v5 forbids ':' in custom jobIds — '__' used as separator.
 */
export function buildScanJobs(_triggeredAt?: string) {
  return IMAGES.map((img) => ({
    name: 'scan-image',
    data: { imageName: img.name, imageTag: img.tag },
    opts: {
      jobId: `scan__${img.name}__${img.tag}`,
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      removeOnComplete: { count: 0 },  // Purge immediately — stable ID re-enqueues cleanly
      removeOnFail: { count: 50 },     // Keep last 50 failures for debug visibility
    },
  }));
}

/**
 * Enqueues scan jobs into the provided queue. Accepts the queue as a parameter
 * so the scheduler service and tests can inject a custom queue instance.
 */
export async function enqueueScanJobs(queue: Queue, triggeredAt: string): Promise<void> {
  await queue.addBulk(buildScanJobs(triggeredAt));
}

/**
 * In-process tick processor consumed by BullMQ Worker.
 * Uses the singleton scanQueue — not sandboxed because it only enqueues, no Trivy work.
 */
export async function processSchedulerTick(job: Job<SchedulerTickJobData>): Promise<void> {
  const triggeredAt = job.data.triggeredAt ?? new Date().toISOString();
  await enqueueScanJobs(scanQueue, triggeredAt);
}
