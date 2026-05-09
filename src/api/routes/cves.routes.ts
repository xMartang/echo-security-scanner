import { Router } from 'express';
import { asyncHandler } from '@/api/middleware/async-handler.js';
import { validateSeverity } from '@/api/middleware/validate-severity.js';
import { createCvesController } from '@/api/controllers/cves.controller.js';
import type { ImageRepository } from '@/db/repositories/image.repository.js';
import type { CveRepository } from '@/db/repositories/cve.repository.js';

export function createCvesRouter(imageRepo: ImageRepository, cveRepo: CveRepository): Router {
  const router = Router();
  const ctrl = createCvesController(imageRepo, cveRepo);

  // GET /api/cves?severity=
  router.get('/', validateSeverity, asyncHandler(ctrl.listCves.bind(ctrl)));

  // GET /api/cves/:cveId/images
  router.get('/:cveId/images', asyncHandler(ctrl.listImagesByCve.bind(ctrl)));

  return router;
}
