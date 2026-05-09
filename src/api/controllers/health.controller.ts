import type { Request, Response, NextFunction } from 'express';
import type { HealthService } from '@/services/health.service.js';

export function createHealthController(healthService: HealthService) {
  return {
    async getHealth(_req: Request, res: Response, _next: NextFunction): Promise<void> {
      const result = await healthService.check();
      res.status(result.status === 'ok' ? 200 : 503).json({ data: result });
    },
  };
}
