import type { Job, Queue } from 'bullmq';
import type { SchedulerTickJobData } from '@/types/job-payload.js';
import { IMAGES } from '@/config/images.js';
import { scanQueue } from '@/queue/queue.js';

/**
 * Builds the list of scan jobs for a given tick timestamp.
 * Pure function — exported so tests can verify job structure without touching Redis.
 */
export function buildScanJobs(_triggeredAt?: string) {
  // jobId is stable per image (no timestamp) so BullMQ deduplicates concurrent ticks:
  // if a scan is already WAITING/ACTIVE, a second tick for the same image is a no-op.
  // After completion (removeOnComplete) the slot is free for the next tick.
  // BullMQ v5 forbids ':' in custom jobIds, so we use '__' as separator.
  return IMAGES.map((img) => ({
    name: 'scan-image',
    data: { imageName: img.name, imageTag: img.tag },
    opts: {
      jobId: `scan__${img.name}__${img.tag}`,
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
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
