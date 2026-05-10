import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { IMAGES } from '@/bullmq/tasks/scanners/trivy/images.js';

/**
 * Sandboxed concurrency cap:
 *   min(imageCount, max(1, floor(availableParallelism / 2)))
 *
 * Uses half the CPU cores to keep the event loop responsive for BullMQ
 * bookkeeping and Redis I/O. Never exceeds the number of images (no idle
 * workers). Minimum 1 so progress is always possible.
 */
export function calculateConcurrency(imageCount: number, availableParallelism: number): number {
  return Math.min(imageCount, Math.max(1, Math.floor(availableParallelism / 2)));
}

// Resolve the compiled processor file path.
// In production (node dist/bullmq.js) this points to the compiled ESM output.
const processorPath = fileURLToPath(
  new URL('./tasks/scanners/trivy/scan-image.job.js', import.meta.url),
);

/**
 * Creates a sandboxed BullMQ Worker for image-scan jobs.
 *
 * Passing a file path (not a function) causes BullMQ to fork a child process
 * per job. A crash, hang, or OOM in the Trivy pipeline kills only that child;
 * the parent worker continues dispatching.
 *
 * Called once by the bullmq.ts entrypoint after startup checks complete.
 */
export function createScanWorker(connection: ConnectionOptions): Worker {
  const concurrency = calculateConcurrency(IMAGES.length, os.availableParallelism());
  return new Worker('image-scan', processorPath, { connection, concurrency });
}
