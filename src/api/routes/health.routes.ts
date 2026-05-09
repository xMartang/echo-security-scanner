import { Router } from 'express';
import { asyncHandler } from '@/api/middleware/async-handler.js';
import { createHealthController } from '@/api/controllers/health.controller.js';
import type { HealthService } from '@/services/health.service.js';

export function createHealthRouter(healthService: HealthService): Router {
  const router = Router();
  const ctrl = createHealthController(healthService);

  router.get('/', asyncHandler(ctrl.getHealth.bind(ctrl)));

  return router;
}
