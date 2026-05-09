import type { PrismaClient } from '@prisma/client';
import { ScanStatus } from '@prisma/client';
import type { ScanResult } from '@/types/scan-result.js';
import { prisma } from '@/db/client.js';

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
    const c = a.cveId.localeCompare(b.cveId);
    return c !== 0 ? c : a.packageName.localeCompare(b.packageName);
  });

  await db.$transaction(async (tx) => {
    // 1. Upsert Image — establishes the FK anchor for all join tables.
    const image = await tx.image.upsert({
      where: { name_tag: { name: imageName, tag: imageTag } },
      create: { name: imageName, tag: imageTag },
      update: {},
    });

    // 2. Upsert Packages (sorted by name).
    const pkgMap = new Map<string, number>(); // name → id
    for (const pkg of sortedPackages) {
      const p = await tx.package.upsert({
        where: { name: pkg.name },
        create: { name: pkg.name },
        update: {},
      });
      pkgMap.set(pkg.name, p.id);
    }

    // 3. Upsert CVEs (sorted by cveId; update severity/description on each run
    //    in case Trivy revises them in a subsequent database update).
    const cveMap = new Map<string, number>(); // cveId string → db id
    for (const vuln of sortedVulns) {
      if (cveMap.has(vuln.cveId)) continue; // deduplicate same CVE across packages
      const c = await tx.cve.upsert({
        where: { cveId: vuln.cveId },
        create: {
          cveId: vuln.cveId,
          severity: vuln.severity,
          description: vuln.description,
        },
        update: {
          severity: vuln.severity,
          description: vuln.description,
        },
      });
      cveMap.set(vuln.cveId, c.id);
    }

    // 4. Upsert ImagePackage join rows.
    for (const pkg of sortedPackages) {
      const packageId = pkgMap.get(pkg.name);
      if (packageId === undefined) continue;
      await tx.imagePackage.upsert({
        where: { imageId_packageId: { imageId: image.id, packageId } },
        create: { imageId: image.id, packageId },
        update: {},
      });
    }

    // 5. Upsert ImageVulnerability join rows (sorted by (cveId, packageId)).
    const sortedIvKeys = sortedVulns
      .map((v) => ({ vuln: v, cveDbId: cveMap.get(v.cveId), pkgDbId: pkgMap.get(v.packageName) }))
      .filter((x): x is { vuln: typeof sortedVulns[number]; cveDbId: number; pkgDbId: number } =>
        x.cveDbId !== undefined && x.pkgDbId !== undefined,
      )
      .sort((a, b) => a.cveDbId - b.cveDbId || a.pkgDbId - b.pkgDbId);

    for (const { vuln, cveDbId, pkgDbId } of sortedIvKeys) {
      await tx.imageVulnerability.upsert({
        where: {
          imageId_cveId_packageId: { imageId: image.id, cveId: cveDbId, packageId: pkgDbId },
        },
        create: {
          imageId: image.id,
          cveId: cveDbId,
          packageId: pkgDbId,
          installedVersion: vuln.installedVersion,
          fixedVersion: vuln.fixedVersion,
        },
        update: {
          installedVersion: vuln.installedVersion,
          fixedVersion: vuln.fixedVersion,
        },
      });
    }

    // 6. Mark Image SUCCESS — same transaction, so atomically committed with all upserts.
    await tx.image.update({
      where: { id: image.id },
      data: {
        status: ScanStatus.SUCCESS,
        lastScannedAt: new Date(),
        lastError: null,
      },
    });
  });
}
