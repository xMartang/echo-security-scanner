import { Router } from 'express';
import { asyncHandler } from '@/api/middleware/async-handler.js';
import { createHealthController } from '@/api/controllers/health.controller.js';
import type { HealthService } from '@/api/services/health.service.js';

export function createHealthRouter(healthService: HealthService): Router {
  const router = Router();
  const ctrl = createHealthController(healthService);

  // GET /api/health
  router.get('/', asyncHandler(ctrl.getHealth.bind(ctrl)));

  return router;
}
