import { fileURLToPath } from 'node:url';
import os from 'node:os';
import type { TaskConfig } from '@/bullmq/tasks/task.types.js';
import { IMAGES } from '@/bullmq/tasks/scanners/images.js';
import { SCAN_ALL_IMAGES_JOB_ID, SCAN_QUEUE_NAME } from '@/bullmq/tasks/scanners/trivy/consts.js';
import { env } from '@/bullmq/config/env.js';

/**
 * TaskConfig for the Trivy container image scanner.
 *
 * Scans 10 fixed images via BullMQ sandboxed jobs; one job per image.
 * The scheduler-tick job fans out scan jobs on each interval.
 */
export const trivyTaskConfig: TaskConfig = {
  queueName: SCAN_QUEUE_NAME,
  processorFilePath: fileURLToPath(
    new URL('./scan-image.job.js', import.meta.url),
  ),
  concurrency: Math.min(IMAGES.length, Math.max(1, Math.floor(os.availableParallelism() / 2))),
  schedule: {
    jobSchedulerId: SCAN_ALL_IMAGES_JOB_ID,
    everyMs: env.SCAN_INTERVAL_MS,
  },
};
