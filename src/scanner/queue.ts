import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { ScanImageJobData, SchedulerTickJobData } from '@/scanner/types/job-payload.js';
import { env } from '@/scanner/config/env.js';

// Single shared ioredis connection for BullMQ.
// maxRetriesPerRequest: null is required by BullMQ — without it BullMQ throws on reconnect.
// lazyConnect: true prevents ioredis from connecting at module-load time, so importing this
// module in tests (where env.REDIS_URL may not point to a running Redis) doesn't fail.
export const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

/** Queue for individual image scan jobs — processed by the sandboxed scan worker. */
export const scanQueue = new Queue<ScanImageJobData>('image-scan', { connection });

/**
 * Queue for scheduler tick jobs — processed by an in-process BullMQ Worker.
 *
 * Kept separate from `image-scan` so the sandboxed scan worker never sees tick
 * jobs (BullMQ Workers consume ALL jobs from a queue without name filtering).
 */
export const schedulerQueue = new Queue<SchedulerTickJobData>('image-scheduler', { connection });
