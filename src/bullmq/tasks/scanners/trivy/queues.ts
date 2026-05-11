import { Queue } from 'bullmq';
import type { ScanImageJobData, SchedulerTickJobData } from '@/bullmq/types/job-payload.js';
import { connection } from '@/bullmq/connection.js';
import {
  SCAN_QUEUE_NAME,
  SCHEDULER_QUEUE_NAME,
} from '@/bullmq/tasks/scanners/trivy/consts.js';

/** Queue for individual image scan jobs -- processed by the sandboxed scan worker. */
export const scanQueue = new Queue<ScanImageJobData>(SCAN_QUEUE_NAME, { connection });

/**
 * Queue for scheduler tick jobs -- processed by an in-process BullMQ Worker.
 *
 * Kept separate from `image-scan` so the sandboxed scan worker never sees tick
 * jobs (BullMQ Workers consume ALL jobs from a queue without name filtering).
 */
export const schedulerQueue = new Queue<SchedulerTickJobData>(SCHEDULER_QUEUE_NAME, { connection });
