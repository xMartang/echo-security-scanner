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
import type { ScanImageJobData, ScanImageJobResult } from '@/scanner/types/job-payload.js';
import { env } from '@/scanner/config/env.js';
import { createLogger } from '@/common/utils/log/logger.js';
import { createImageRepository } from '@/common/db/repositories/image.repository.js';
import { persistScanResults } from '@/scanner/services/persistence.service.js';
import { scan } from '@/scanner/services/scanner.service.js';
import { retryOnDBError } from '@/common/utils/db/retry.js';

// ── Lazy singletons ──────────────────────────────────────────────────────────

let sharedPrisma: PrismaClient | undefined;
function getSharedPrisma(): PrismaClient {
  if (!sharedPrisma) {
    sharedPrisma = new PrismaClient();
    process.on('exit', () => { void sharedPrisma?.$disconnect(); });
  }
  return sharedPrisma;
}

const logger = createLogger({
  serviceName: env.SERVICE_NAME,
  dir: env.LOG_DIR,
  level: env.LOG_LEVEL,
});

// ── Processor ────────────────────────────────────────────────────────────────

/**
 * Core scan logic — exported so integration tests can call it directly without
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

    // 3. Persist CVE results — wrap with retryOnDBError for transient Postgres errors.
    await retryOnDBError(
      () => persistScanResults(imageName, imageTag, result, db),
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
    // 5. Never throw out of the processor — log, update DB status, return.
    //
    // Pino's `err` serializer captures type, message, and full stack trace
    // (including the "Caused by:" chain from ScanFailedError). This is the
    // primary visibility mechanism since the bullmq sandbox is isolated from
    // both the API process and the parent worker process.
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
