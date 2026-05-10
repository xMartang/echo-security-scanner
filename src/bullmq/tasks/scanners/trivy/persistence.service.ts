// KNOWN LIMITATION (multi-scanner scheduling): lastSeenAt filtering works correctly
// with multiple scanners — any scanner confirming a CVE updates lastSeenAt, keeping
// it visible. A CVE is only stale when NO scanner has confirmed it since the last
// scan cycle, which is the correct behaviour regardless of scanner count.
//
// The one gap: if scanners run on different schedules (e.g. Trivy every 15 min,
// Grype every hour), Image.lastScannedAt becomes ambiguous as a staleness threshold.
// If this becomes a requirement, consider adding a ScanRun table:
//   (imageId, scannerName, startedAt, completedAt, status)
// and filtering per: lastSeenAt >= MAX(ScanRun.completedAt) across all scanners
// for that image, so each scanner's cadence is accounted for independently.

import type { PrismaClient } from '@prisma/client';
import { ScanStatus } from '@prisma/client';
import type { ScanResult } from '@/bullmq/tasks/scanners/trivy/types/scan-result.js';
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
  // Captured once so lastSeenAt (step 5) and lastScannedAt (step 6) are identical.
  // This makes the staleness filter (lastSeenAt >= lastScannedAt) exact: CVEs confirmed
  // by this scan have lastSeenAt === lastScannedAt; unconfirmed CVEs have an older
  // lastSeenAt and are automatically excluded from API responses.
  const scanCompletedAt = new Date();

  // Sort before entering the transaction for deterministic lock ordering.
  const sortedPackages = [...result.packages].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const sortedVulns = [...result.vulnerabilities].sort((a, b) => {
    const cveIdOrder = a.cveId.localeCompare(b.cveId);
    return cveIdOrder !== 0 ? cveIdOrder : a.packageName.localeCompare(b.packageName);
  });

  await db.$transaction(async (trx) => {
    // 1. Upsert Image â€” establishes the FK anchor for all join tables.
    const image = await trx.image.upsert({
      where: { name_tag: { name: imageName, tag: imageTag } },
      create: { name: imageName, tag: imageTag },
      update: {},
    });

    // 2. Upsert Packages (sorted by name).
    const packageIdByName = new Map<string, number>(); // package name â†’ db id
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
    const cveDbIdByCveId = new Map<string, number>(); // cve string id â†’ db row id
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
          firstSeenAt: scanCompletedAt,
          lastSeenAt: scanCompletedAt,
        },
        update: {
          installedVersion: vulnerability.installedVersion,
          fixedVersion: vulnerability.fixedVersion,
          // lastSeenAt always updated when CVE is confirmed by this scan.
          // firstSeenAt is intentionally NOT updated — it records the original detection time.
          lastSeenAt: scanCompletedAt,
        },
      });
    }

    // 6. Mark Image SUCCESS — same transaction, so atomically committed with all upserts.
    // lastScannedAt = scanCompletedAt so it exactly matches lastSeenAt set above,
    // making the staleness filter (lastSeenAt >= lastScannedAt) precise.
    await trx.image.update({
      where: { id: image.id },
      data: {
        status: ScanStatus.SUCCESS,
        lastScannedAt: scanCompletedAt,
        lastError: null,
      },
    });
  });
}
