import type { PrismaClient, Severity } from '@prisma/client';
import { prisma } from '@/common/db/client.js';
import { ImageNotFoundError } from '@/common/utils/errors.js';

export function createCveRepository(db: PrismaClient) {
  return {
    /**
     * GET /api/images/:name/:tag/cves
     * Returns CVEs confirmed by the most recent scan of the given image.
     * CVEs not seen in the latest scan (lastSeenAt < lastScannedAt) are excluded --
     * they are preserved in the DB as audit data but are no longer active.
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
          // Only vulnerabilities confirmed by the latest scan.
          // If lastScannedAt is null the image has never completed a scan -- return nothing.
          lastSeenAt: { gte: image.lastScannedAt ?? new Date(0) },
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
        firstSeenAt: iv.firstSeenAt,
        lastSeenAt: iv.lastSeenAt,
      }));
    },

    /**
     * GET /api/cves -- distinct CVEs active in at least one image's latest scan.
     * CVEs that were not confirmed by any image's most recent scan are excluded.
     */
    async listDistinct(severity?: Severity) {
      const cves = await db.cve.findMany({
        where: severity ? { severity } : undefined,
        orderBy: [{ severity: 'asc' }, { cveId: 'asc' }],
        include: {
          vulnerabilities: {
            include: {
              image: { select: { lastScannedAt: true } },
            },
          },
        },
      });

      // Post-filter: keep only CVEs with at least one active (current-scan) vulnerability.
      return cves
        .filter((cve) =>
          cve.vulnerabilities.some(
            (iv) =>
              iv.image.lastScannedAt !== null &&
              iv.lastSeenAt >= iv.image.lastScannedAt,
          ),
        )
        .map(({ vulnerabilities: _, ...rest }) => rest);
    },
  };
}

export const cveRepository = createCveRepository(prisma);
export type CveRepository = ReturnType<typeof createCveRepository>;
