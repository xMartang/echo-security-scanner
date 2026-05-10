import type { Request, Response, NextFunction } from 'express';
import type { Severity } from '@prisma/client';
import type { ImageRepository } from '@/common/db/repositories/image.repository.js';
import type { CveRepository } from '@/common/db/repositories/cve.repository.js';

export function createCvesController(imageRepo: ImageRepository, cveRepo: CveRepository) {
  return {
    /** GET /api/cves — all unique CVEs across all images; optional ?severity filter. */
    async listCves(req: Request, res: Response, _next: NextFunction): Promise<void> {
      const severity = req.query.severity as Severity | undefined;
      const cves = await cveRepo.listDistinct(severity);
      res.json({ data: cves });
    },

    /** GET /api/cves/:cveId/images — all images affected by a specific CVE string ID. */
    async listImagesByCve(req: Request, res: Response, _next: NextFunction): Promise<void> {
      const { cveId } = req.params;
      const images = await imageRepo.findByCveId(cveId);
      res.json({ data: images });
    },
  };
}
