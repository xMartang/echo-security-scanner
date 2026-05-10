import type { Job, Queue } from 'bullmq';
import type { SchedulerTickJobData, ScanImageJobData } from '@/bullmq/types/job-payload.js';
import { IMAGES, type ImageRef } from '@/bullmq/tasks/scanners/images.js';
import { scanQueue } from '@/bullmq/tasks/scanners/trivy/queues.js';
import { env } from '@/bullmq/config/env.js';
import { createLogger } from '@/common/utils/log/logger.js';

const logger = createLogger({
  serviceName: env.SERVICE_NAME,
  dir: env.LOG_DIR,
  level: env.LOG_LEVEL,
});

// How many completed/failed job records to retain per image in BullMQ / Redis.
// Enough history for one full day of 15-min scans (96 ticks) with some headroom.
const COMPLETED_JOB_HISTORY = 100;
const FAILED_JOB_HISTORY = 50;

/**
 * Builds the list of scan jobs for a given set of images and tick timestamp.
 * Pure function -- exported so tests can verify job structure without touching Redis.
 *
 * jobId includes the tick timestamp so each tick produces unique IDs, enabling
 * BullMQ native job history to work correctly. Deduplication of concurrent scans
 * is handled by enqueueScanJobs() via queue state inspection rather than ID uniqueness.
 *
 * BullMQ v5 forbids ':' in custom jobIds -- '__' used as separator.
 */
export function buildScanJobs(images: readonly ImageRef[], triggeredAt: string) {
  return images.map((img) => ({
    name: 'scan-image',
    data: { imageName: img.name, imageTag: img.tag },
    opts: {
      jobId: `scan__${img.name}__${img.tag}__${triggeredAt.replace(/:/g, '')}`,
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      removeOnComplete: { count: COMPLETED_JOB_HISTORY },
      removeOnFail: { count: FAILED_JOB_HISTORY },
    },
  }));
}

/**
 * Enqueues scan jobs for images not already waiting or actively scanning.
 *
 * Dedup strategy: inspect queue state before adding. getJobs(['waiting','active'])
 * returns at most IMAGES.length items -- negligible cost. Single-process worker means
 * no cross-process race condition.
 *
 * Returns counts so the caller can emit structured log entries without the
 * pure-function body needing to know about the logger.
 */
export async function enqueueScanJobs(
  queue: Queue,
  triggeredAt: string,
): Promise<{ enqueued: number; skipped: number; skippedImages: string[] }> {
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
  const skippedImages = IMAGES
    .filter((img) => inFlightKeys.has(`${img.name}:${img.tag}`))
    .map((img) => `${img.name}:${img.tag}`);

  if (imagesToScan.length > 0) {
    await queue.addBulk(buildScanJobs(imagesToScan, triggeredAt));
  }

  return { enqueued: imagesToScan.length, skipped: skippedImages.length, skippedImages };
}

/**
 * In-process tick processor consumed by BullMQ Worker.
 * Uses the singleton scanQueue -- not sandboxed because it only enqueues, no Trivy work.
 */
export async function processSchedulerTick(_job: Job<SchedulerTickJobData>): Promise<void> {
  // Always use the wall-clock time of THIS invocation, not the template data.
  // The scheduler template stores a static triggeredAt (set once at startup);
  // reusing it would give every tick the same jobIds and BullMQ would
  // deduplicate against completed jobs, preventing the second batch from running.
  const triggeredAt = new Date().toISOString();
  const { enqueued, skipped, skippedImages } = await enqueueScanJobs(scanQueue, triggeredAt);

  if (skipped > 0) {
    logger.debug(
      { skipped, skippedImages },
      'scheduler tick: some images already in-flight, skipping',
    );
  }
  if (enqueued > 0) {
    logger.debug({ enqueued }, 'scheduler tick: enqueued scan jobs');
  }
  if (enqueued === 0 && skipped === 0) {
    logger.debug('scheduler tick: no images to scan');
  }
}
