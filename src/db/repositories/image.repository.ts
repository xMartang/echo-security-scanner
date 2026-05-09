import type { PrismaClient } from '@prisma/client';
import { ScanStatus } from '@prisma/client';
import { prisma } from '@/db/client.js';

export function createImageRepository(db: PrismaClient) {
  return {
    /** Ensure image row exists; returns the row (with id). */
    async upsertImage(name: string, tag: string) {
      return db.image.upsert({
        where: { name_tag: { name, tag } },
        create: { name, tag },
        update: {},
      });
    },

    async markScanning(id: number): Promise<void> {
      await db.image.update({
        where: { id },
        data: { status: ScanStatus.SCANNING, lastError: null },
      });
    },

    async markFailed(id: number, error: string): Promise<void> {
      await db.image.update({
        where: { id },
        data: { status: ScanStatus.FAILED, lastError: error },
      });
    },

    /**
     * On worker startup: any row stuck in SCANNING means the previous process
     * crashed mid-scan. Reset to PENDING so the next scheduler tick re-queues it.
     * Returns the count of rows reset.
     */
    async resetStuckScanning(): Promise<number> {
      const result = await db.image.updateMany({
        where: { status: ScanStatus.SCANNING },
        data: {
          status: ScanStatus.PENDING,
          lastError: 'recovered from stuck scanning state',
        },
      });
      return result.count;
    },

    /** GET /api/images — images with CVE counts grouped by severity. */
    async listWithSeveritySummary() {
      const images = await db.image.findMany({
        include: {
          vulnerabilities: {
            include: { cve: { select: { severity: true } } },
          },
        },
        orderBy: [{ name: 'asc' }, { tag: 'asc' }],
      });

      return images.map((img) => {
        const counts: Record<string, number> = {
          CRITICAL: 0,
          HIGH: 0,
          MEDIUM: 0,
          LOW: 0,
          UNKNOWN: 0,
        };
        for (const iv of img.vulnerabilities) counts[iv.cve.severity]++;
        const { vulnerabilities: _, ...rest } = img;
        return { ...rest, cveCountBySeverity: { ...counts, total: img.vulnerabilities.length } };
      });
    },

    /** GET /api/cves/:cveId/images — all images affected by a given CVE string. */
    async findByCveId(cveIdStr: string) {
      const cve = await db.cve.findUnique({ where: { cveId: cveIdStr } });
      if (!cve) return [];

      const ivs = await db.imageVulnerability.findMany({
        where: { cveId: cve.id },
        include: { image: true, package: true },
        orderBy: [{ image: { name: 'asc' } }, { image: { tag: 'asc' } }],
      });

      return ivs.map((iv) => ({
        image: iv.image,
        packageName: iv.package.name,
        installedVersion: iv.installedVersion,
        fixedVersion: iv.fixedVersion,
      }));
    },
  };
}

// Default singleton-backed instance used throughout the application.
export const imageRepository = createImageRepository(prisma);
export type ImageRepository = ReturnType<typeof createImageRepository>;
