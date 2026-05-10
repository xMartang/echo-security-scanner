/**
 * Sandboxed BullMQ processor for `scan-image` jobs.
 *
 * BullMQ forks a child process per job and `import()`s this file. The child
 * inherits `process.env` from the parent bullmq.ts process (including
 * SERVICE_NAME=bullmq, DATABASE_URL, etc.).
 *
 * Lazy singletons prevent double-init when BullMQ reuses the forked process
 * across multiple jobs in the same child.
 */

import 'dotenv/config';
import type { SandboxedJob } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import type { ScanImageJobData, ScanImageJobResult } from '@/bullmq/types/job-payload.js';
import { env } from '@/bullmq/config/env.js';
import { createLogger } from '@/common/utils/log/logger.js';
import { createImageRepository } from '@/common/db/repositories/image.repository.js';
import { ingestScanResults } from '@/bullmq/tasks/scanners/trivy/scan-ingestion.service.js';
import { scan } from '@/bullmq/tasks/scanners/trivy/scanner.service.js';
import { retryOnDBError } from '@/common/utils/db/retry.js';

// -- Lazy singletons --

let sharedPrisma: PrismaClient | undefined;
function getSharedPrisma(): PrismaClient {
  if (!sharedPrisma) {
    sharedPrisma = new PrismaClient();
    process.on('exit', () => { void sharedPrisma?.$disconnect(); });
  }
  return sharedPrisma;
}

// Sandboxed processors run in child processes separate from the main bullmq
// process. Using SERVICE_NAME + '-scan' routes logs to scan-processor.*.log,
// avoiding concurrent multi-process writes to the same rotating log file.
const logger = createLogger({
  serviceName: `${env.SERVICE_NAME}-scan`,
  dir: env.LOG_DIR,
  level: env.LOG_LEVEL,
});

// -- Processor --

/**
 * Core scan logic -- exported so integration tests can call it directly without
 * going through the BullMQ sandbox (which requires compiled JS on disk).
 */
export async function processScanJob(
  imageName: string,
  imageTag: string,
  prismaClient?: PrismaClient,
): Promise<ScanImageJobResult> {
  const db = prismaClient ?? getSharedPrisma();
  const repo = createImageRepository(db);
  const imageRef = `${imageName}:${imageTag}`;

  // 1. Mark image SCANNING so operators see it in progress.
  const image = await repo.upsertImage(imageName, imageTag);
  await repo.markScanning(image.id);
  logger.info({ image: imageRef }, 'scan started');

  try {
    // 2. Invoke Trivy via execa; stream output through json-stream pipeline.
    const { result, stderr } = await scan(imageName, imageTag);
    if (stderr) logger.debug({ image: imageRef, stderr }, 'trivy stderr output');

    // 3. Ingest CVE results -- wrap with retryOnDBError for transient Postgres errors.
    await retryOnDBError(
      () => ingestScanResults(imageName, imageTag, result, db),
    );

    // 4. Build severity breakdown for logging.
    const cveSummary: Record<string, number> = {};
    for (const { severity } of result.vulnerabilities) {
      cveSummary[severity] = (cveSummary[severity] ?? 0) + 1;
    }

    logger.info(
      { image: imageRef, total: result.vulnerabilities.length, cveSummary },
      'scan completed',
    );
    return { cveCount: result.vulnerabilities.length };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, image: imageRef }, 'scan failed');
    await repo.markFailed(image.id, errorMessage);
    return { cveCount: 0 };
  }
}

/**
 * Default export consumed by BullMQ's sandboxed Worker.
 * Must be the default export of this file.
 */
export default async function (job: SandboxedJob<ScanImageJobData>): Promise<ScanImageJobResult> {
  return processScanJob(job.data.imageName, job.data.imageTag);
}
