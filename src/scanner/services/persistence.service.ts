import type { PrismaClient } from '@prisma/client';
import { ScanStatus } from '@prisma/client';
import type { ScanResult } from '@/scanner/types/scan-result.js';
import { prisma } from '@/common/db/client.js';

/**
 * Persist a completed Trivy scan result atomically.
 *
 * All upserts run in a single interactive $transaction.  Steps execute in
 * deterministic order (packages by name ASC, CVEs by cveId ASC, join rows
 * by (cveId, packageId) ASC) to minimise Postgres row-level deadlock risk
 * when multiple BullMQ workers run concurrently.
 *
 * The Image.status = SUCCESS update is part of the same transaction, so
 * it's impossible for a crash to leave new CVE rows with a stale status.
 */
export async function persistScanResults(
  imageName: string,
  imageTag: string,
  result: ScanResult,
  db: PrismaClient = prisma,
): Promise<void> {
  // Sort before entering the transaction for deterministic lock ordering.
  const sortedPackages = [...result.packages].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const sortedVulns = [...result.vulnerabilities].sort((a, b) => {
    const cveIdOrder = a.cveId.localeCompare(b.cveId);
    return cveIdOrder !== 0 ? cveIdOrder : a.packageName.localeCompare(b.packageName);
  });

  await db.$transaction(async (trx) => {
    // 1. Upsert Image — establishes the FK anchor for all join tables.
    const image = await trx.image.upsert({
      where: { name_tag: { name: imageName, tag: imageTag } },
      create: { name: imageName, tag: imageTag },
      update: {},
    });

    // 2. Upsert Packages (sorted by name).
    const packageIdByName = new Map<string, number>(); // package name → db id
    for (const pkg of sortedPackages) {
      const savedPackage = await trx.package.upsert({
        where: { name: pkg.name },
        create: { name: pkg.name },
        update: {},
      });
      packageIdByName.set(pkg.name, savedPackage.id);
    }

    // 3. Upsert CVEs (sorted by cveId; update severity/description on each run
    //    in case Trivy revises them in a subsequent database update).
    const cveDbIdByCveId = new Map<string, number>(); // cve string id → db row id
    for (const vulnerability of sortedVulns) {
      if (cveDbIdByCveId.has(vulnerability.cveId)) continue; // deduplicate same CVE across packages
      const savedCve = await trx.cve.upsert({
        where: { cveId: vulnerability.cveId },
        create: {
          cveId: vulnerability.cveId,
          severity: vulnerability.severity,
          description: vulnerability.description,
        },
        update: {
          severity: vulnerability.severity,
          description: vulnerability.description,
        },
      });
      cveDbIdByCveId.set(vulnerability.cveId, savedCve.id);
    }

    // 4. Upsert ImagePackage join rows.
    for (const pkg of sortedPackages) {
      const packageId = packageIdByName.get(pkg.name);
      if (packageId === undefined) continue;
      await trx.imagePackage.upsert({
        where: { imageId_packageId: { imageId: image.id, packageId } },
        create: { imageId: image.id, packageId },
        update: {},
      });
    }

    // 5. Upsert ImageVulnerability join rows (sorted by (cveId, packageId)).
    const sortedImageVulnKeys = sortedVulns
      .map((vulnerability) => ({
        vulnerability,
        cveDbId: cveDbIdByCveId.get(vulnerability.cveId),
        packageDbId: packageIdByName.get(vulnerability.packageName),
      }))
      .filter(
        (entry): entry is { vulnerability: typeof sortedVulns[number]; cveDbId: number; packageDbId: number } =>
          entry.cveDbId !== undefined && entry.packageDbId !== undefined,
      )
      .sort((a, b) => a.cveDbId - b.cveDbId || a.packageDbId - b.packageDbId);

    for (const { vulnerability, cveDbId, packageDbId } of sortedImageVulnKeys) {
      await trx.imageVulnerability.upsert({
        where: {
          imageId_cveId_packageId: { imageId: image.id, cveId: cveDbId, packageId: packageDbId },
        },
        create: {
          imageId: image.id,
          cveId: cveDbId,
          packageId: packageDbId,
          installedVersion: vulnerability.installedVersion,
          fixedVersion: vulnerability.fixedVersion,
        },
        update: {
          installedVersion: vulnerability.installedVersion,
          fixedVersion: vulnerability.fixedVersion,
        },
      });
    }

    // 6. Mark Image SUCCESS — same transaction, so atomically committed with all upserts.
    await trx.image.update({
      where: { id: image.id },
      data: {
        status: ScanStatus.SUCCESS,
        lastScannedAt: new Date(),
        lastError: null,
      },
    });
  });
}
