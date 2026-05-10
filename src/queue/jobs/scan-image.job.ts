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
import { PrismaClient, ScanStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { ScanImageJobData, ScanImageJobResult } from '@/types/job-payload.js';
import { env } from '@/config/env.js';
import { createLogger } from '@/utils/log/logger.js';
import { createImageRepository } from '@/db/repositories/image.repository.js';
import { persistScanResults } from '@/services/persistence.service.js';
import { scan } from '@/services/scanner.service.js';
import { retryOnDBError } from '@/utils/db/retry.js';

const SCAN_HISTORY_MAX_ROWS = 1_000;

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

// ── Scan history ──────────────────────────────────────────────────────────────

/**
 * Persists one row to ScanHistory and prunes the table to SCAN_HISTORY_MAX_ROWS.
 * Best-effort — callers should .catch() so a history failure never aborts a scan.
 */
async function saveScanHistory(
  db: PrismaClient,
  data: {
    imageName: string;
    imageTag: string;
    status: ScanStatus;
    cveCount?: number;
    cveSummary?: Prisma.InputJsonValue;
    errorMessage?: string;
    startedAt: Date;
    completedAt: Date;
  },
): Promise<void> {
  await db.scanHistory.create({ data });

  // Prune oldest rows when the table exceeds the cap.
  const totalCount = await db.scanHistory.count();
  if (totalCount > SCAN_HISTORY_MAX_ROWS) {
    const toDelete = await db.scanHistory.findMany({
      orderBy: { startedAt: 'asc' },
      take: totalCount - SCAN_HISTORY_MAX_ROWS,
      select: { id: true },
    });
    if (toDelete.length > 0) {
      await db.scanHistory.deleteMany({
        where: { id: { in: toDelete.map((r) => r.id) } },
      });
    }
  }
}

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
  const startedAt = new Date();

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

    // 4. Build severity breakdown for logging and history.
    const cveSummary: Record<string, number> = {};
    for (const { severity } of result.vulnerabilities) {
      cveSummary[severity] = (cveSummary[severity] ?? 0) + 1;
    }

    // 5. Write to ScanHistory (best-effort — don't let a history failure abort the scan).
    await saveScanHistory(db, {
      imageName,
      imageTag,
      status: ScanStatus.SUCCESS,
      cveCount: result.vulnerabilities.length,
      cveSummary,
      startedAt,
      completedAt: new Date(),
    }).catch((err) => logger.warn({ err, image: imageRef }, 'failed to save scan history'));

    logger.info(
      { image: imageRef, total: result.vulnerabilities.length, cveSummary },
      'scan completed',
    );
    return { cveCount: result.vulnerabilities.length };
  } catch (err) {
    // 6. Never throw out of the processor — log, record history, update DB status, return.
    //
    // Pino's `err` serializer captures type, message, and full stack trace
    // (including the "Caused by:" chain from ScanFailedError). This is the
    // primary visibility mechanism since the bullmq sandbox is isolated from
    // both the API process and the parent worker process.
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, image: imageRef }, 'scan failed');

    await saveScanHistory(db, {
      imageName,
      imageTag,
      status: ScanStatus.FAILED,
      errorMessage,
      startedAt,
      completedAt: new Date(),
    }).catch((histErr) => logger.warn({ err: histErr, image: imageRef }, 'failed to save scan history'));

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
