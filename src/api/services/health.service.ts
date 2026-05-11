import type { PrismaClient } from '@prisma/client';

export type DbStatus = 'ok' | 'error';
export type ScannerStatus = 'ok' | 'stale' | 'never_scanned';

export type ScannerHealth = {
  status: ScannerStatus;
  lastScannedAt: string | null;
  staleThresholdMs: number;
};

export type HealthCheckResult = {
  db: DbStatus;
  scanner?: ScannerHealth;
  status: 'ok' | 'degraded';
};

type HealthServiceDeps = {
  db: PrismaClient;
  /** Check scanner staleness. Omit or set undefined to skip scanner check. */
  scannerStalenessThresholdMs?: number;
};

async function checkDb(db: PrismaClient): Promise<DbStatus> {
  try {
    await db.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkScannerStaleness(
  db: PrismaClient,
  thresholdMs: number,
): Promise<ScannerHealth> {
  const latest = await db.image.findFirst({
    where: { lastScannedAt: { not: null } },
    orderBy: { lastScannedAt: 'desc' },
    select: { lastScannedAt: true },
  });

  if (!latest?.lastScannedAt) {
    return { status: 'never_scanned', lastScannedAt: null, staleThresholdMs: thresholdMs };
  }

  const ageMs = Date.now() - latest.lastScannedAt.getTime();
  const status: ScannerStatus = ageMs > thresholdMs ? 'stale' : 'ok';
  return {
    status,
    lastScannedAt: latest.lastScannedAt.toISOString(),
    staleThresholdMs: thresholdMs,
  };
}

export function createHealthService(deps: HealthServiceDeps) {
  return {
    async check(): Promise<HealthCheckResult> {
      const db = await checkDb(deps.db);
      const status: HealthCheckResult['status'] = db === 'ok' ? 'ok' : 'degraded';

      if (deps.scannerStalenessThresholdMs === undefined) {
        return { db, status };
      }

      const scanner = await checkScannerStaleness(
        deps.db,
        deps.scannerStalenessThresholdMs,
      );
      return { db, scanner, status };
    },
  };
}

export type HealthService = ReturnType<typeof createHealthService>;
