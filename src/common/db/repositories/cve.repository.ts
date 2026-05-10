import type { PrismaClient, Severity } from '@prisma/client';
import { prisma } from '@/common/db/client.js';
import { ImageNotFoundError } from '@/common/utils/errors.js';

export function createCveRepository(db: PrismaClient) {
  return {
    /**
     * GET /api/images/:name/:tag/cves
     * Returns all CVEs for a specific image with optional severity filter.
     * Throws ImageNotFoundError if the image doesn't exist.
     */
    async findByImage(
      name: string,
      tag: string,
      severity?: Severity,
    ) {
      const image = await db.image.findUnique({ where: { name_tag: { name, tag } } });
      if (!image) throw new ImageNotFoundError(name, tag);

      const ivs = await db.imageVulnerability.findMany({
        where: {
          imageId: image.id,
          ...(severity ? { cve: { severity } } : {}),
        },
        include: { cve: true, package: true },
        orderBy: [
          { cve: { severity: 'asc' } },
          { cve: { cveId: 'asc' } },
        ],
      });

      return ivs.map((iv) => ({
        cveId: iv.cve.cveId,
        severity: iv.cve.severity,
        description: iv.cve.description,
        packageName: iv.package.name,
        installedVersion: iv.installedVersion,
        fixedVersion: iv.fixedVersion,
      }));
    },

    /** GET /api/cves — all unique CVEs with optional severity filter. */
    async listDistinct(severity?: Severity) {
      return db.cve.findMany({
        where: severity ? { severity } : undefined,
        orderBy: [{ severity: 'asc' }, { cveId: 'asc' }],
        include: {
          _count: { select: { vulnerabilities: true } },
        },
      });
    },
  };
}

export const cveRepository = createCveRepository(prisma);
export type CveRepository = ReturnType<typeof createCveRepository>;
