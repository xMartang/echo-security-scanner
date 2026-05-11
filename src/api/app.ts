import express from 'express';
import type { Express } from 'express';
import type pino from 'pino';
import type { PrismaClient } from '@prisma/client';
import { createRequestLogger } from '@/api/middleware/request-logger.js';
import { createErrorHandler } from '@/api/middleware/error-handler.js';
import { createHealthRouter } from '@/api/routes/health.routes.js';
import { createImagesRouter } from '@/api/routes/images.routes.js';
import { createCvesRouter } from '@/api/routes/cves.routes.js';
import { createHealthService } from '@/api/services/health.service.js';
import { createImageRepository } from '@/common/db/repositories/image.repository.js';
import { createCveRepository } from '@/common/db/repositories/cve.repository.js';
import { env } from '@/api/config/env.js';

export type AppDeps = {
  logger: pino.Logger;
  db: PrismaClient;
};

/**
 * Creates the Express application.
 * Accepts all external dependencies so the app is fully testable without
 * touching module-level singletons.
 */
export function createApp(deps: AppDeps): Express {
  const { logger, db } = deps;

  const imageRepo = createImageRepository(db);
  const cveRepo = createCveRepository(db);
  const healthService = createHealthService({
    db,
    scannerStalenessThresholdMs: env.SCANNER_STALENESS_THRESHOLD_MS,
  });

  const app = express();

  app.use(express.json());
  app.use(createRequestLogger(logger));

  app.use('/health', createHealthRouter(healthService));
  app.use('/api/images', createImagesRouter(imageRepo, cveRepo, logger));
  app.use('/api/cves', createCvesRouter(imageRepo, cveRepo, logger));

  app.use(createErrorHandler(logger));

  return app;
}
