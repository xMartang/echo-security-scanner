import { Router } from 'express';
import { asyncHandler } from '@/api/middleware/async-handler.js';
import { validateSeverity } from '@/api/middleware/validate-severity.js';
import { createImagesController } from '@/api/controllers/images.controller.js';
import type { ImageRepository } from '@/db/repositories/image.repository.js';
import type { CveRepository } from '@/db/repositories/cve.repository.js';

export function createImagesRouter(imageRepo: ImageRepository, cveRepo: CveRepository): Router {
  const router = Router();
  const ctrl = createImagesController(imageRepo, cveRepo);

  // GET /api/images
  router.get('/', asyncHandler(ctrl.listImages.bind(ctrl)));

  // GET /api/images/:name/:tag/cves?severity=
  router.get('/:name/:tag/cves', validateSeverity, asyncHandler(ctrl.listImageCves.bind(ctrl)));

  return router;
}
