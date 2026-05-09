import type { Job } from 'bullmq';
import type { SchedulerTickJobData } from '@/types/job-payload.js';
import { IMAGES } from '@/config/images.js';
import { scanQueue } from '@/queue/queue.js';

/**
 * In-process tick processor — no sandboxing needed; it only enqueues jobs.
 *
 * Adds one `scan-image` job per image to the `image-scan` queue.
 * jobId deduplicates within a single tick so re-scheduling the same tick
 * (e.g. after restart) doesn't double-enqueue.
 */
export async function processSchedulerTick(job: Job<SchedulerTickJobData>): Promise<void> {
  const triggeredAt = job.data.triggeredAt ?? new Date().toISOString();

  const bulkJobs = IMAGES.map((img) => ({
    name: 'scan-image',
    data: { imageName: img.name, imageTag: img.tag },
    opts: {
      jobId: `${img.name}:${img.tag}:${triggeredAt}`,
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  }));

  await scanQueue.addBulk(bulkJobs);
}
