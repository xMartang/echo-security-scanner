import type { Job, Queue } from 'bullmq';
import type { SchedulerTickJobData, ScanImageJobData } from '@/bullmq/types/job-payload.js';
import { IMAGES, type ImageRef } from '@/bullmq/tasks/scanners/trivy/images.js';
import { scanQueue } from '@/bullmq/queue.js';

/**
 * Builds the list of scan jobs for a given set of images and tick timestamp.
 * Pure function â€” exported so tests can verify job structure without touching Redis.
 *
 * jobId includes the tick timestamp so each tick produces unique IDs, enabling
 * BullMQ native job history (removeOnComplete: { count: N }) to work correctly.
 * Deduplication of concurrent scans is handled by enqueueScanJobs() via queue
 * state inspection rather than ID uniqueness.
 *
 * BullMQ v5 forbids ':' in custom jobIds â€” '__' used as separator.
 */
export function buildScanJobs(images: readonly ImageRef[], triggeredAt: string) {
  return images.map((img) => ({
    name: 'scan-image',
    data: { imageName: img.name, imageTag: img.tag },
    opts: {
      jobId: `scan__${img.name}__${img.tag}__${triggeredAt}`,
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      // Keep last 100 completed jobs visible in BullMQ Board / Redis history.
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  }));
}

/**
 * Enqueues scan jobs for images not already waiting or actively scanning.
 *
 * Dedup strategy: inspect queue state before adding. getJobs(['waiting','active'])
 * returns at most IMAGES.length items â€” negligible cost. Single-process worker means
 * no cross-process race condition.
 */
export async function enqueueScanJobs(queue: Queue, triggeredAt: string): Promise<void> {
  const inFlight = await queue.getJobs(['waiting', 'active']);
  const inFlightKeys = new Set(
    inFlight
      .filter((j) => j.name === 'scan-image')
      .map((j) => {
        const d = j.data as ScanImageJobData;
        return `${d.imageName}:${d.imageTag}`;
      }),
  );

  const imagesToScan = IMAGES.filter(
    (img) => !inFlightKeys.has(`${img.name}:${img.tag}`),
  );

  if (imagesToScan.length === 0) return;

  await queue.addBulk(buildScanJobs(imagesToScan, triggeredAt));
}

/**
 * In-process tick processor consumed by BullMQ Worker.
 * Uses the singleton scanQueue â€” not sandboxed because it only enqueues, no Trivy work.
 */
export async function processSchedulerTick(job: Job<SchedulerTickJobData>): Promise<void> {
  const triggeredAt = job.data.triggeredAt ?? new Date().toISOString();
  await enqueueScanJobs(scanQueue, triggeredAt);
}
