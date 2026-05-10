import type { Request, Response, NextFunction } from 'express';
import type { Severity } from '@prisma/client';
import type { ImageRepository } from '@/common/db/repositories/image.repository.js';
import type { CveRepository } from '@/common/db/repositories/cve.repository.js';

export function createImagesController(imageRepo: ImageRepository, cveRepo: CveRepository) {
  return {
    /** GET /api/images -- all scanned images with CVE summary by severity. */
    async listImages(_req: Request, res: Response, _next: NextFunction): Promise<void> {
      const images = await imageRepo.listWithSeveritySummary();
      res.json({ data: images });
    },

    /** GET /api/images/:name/:tag/cves -- CVEs for a specific image; optional ?severity filter. */
    async listImageCves(req: Request, res: Response, _next: NextFunction): Promise<void> {
      const { name, tag } = req.params;
      const severity = req.query.severity as Severity | undefined;
      const cves = await cveRepo.findByImage(name, tag, severity);
      res.json({ data: cves });
    },
  };
}
