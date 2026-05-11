import type { PrismaClient } from '@prisma/client';
import { createHealthService } from '@/api/services/health.service.js';

function makeMockDb(healthy: boolean): PrismaClient {
  return {
    $queryRaw: healthy
      ? () => Promise.resolve([{ '?column?': 1 }])
      : () => Promise.reject(new Error('connection refused')),
    image: {
      findFirst: () => Promise.resolve(null),
    },
  } as unknown as PrismaClient;
}

describe('createHealthService', () => {
  it('reports ok when DB is healthy (no staleness check)', async () => {
    const service = createHealthService({ db: makeMockDb(true) });
    const result = await service.check();
    expect(result.db).toBe('ok');
    expect(result.status).toBe('ok');
    expect(result.scanner).toBeUndefined();
  });

  it('reports degraded when DB query fails', async () => {
    const service = createHealthService({ db: makeMockDb(false) });
    const result = await service.check();
    expect(result.db).toBe('error');
    expect(result.status).toBe('degraded');
  });

  it('reports never_scanned when no images have been scanned', async () => {
    const mockDb = {
      $queryRaw: () => Promise.resolve([]),
      image: { findFirst: () => Promise.resolve(null) },
    } as unknown as PrismaClient;

    const service = createHealthService({
      db: mockDb,
      scannerStalenessThresholdMs: 1_800_000,
    });
    const result = await service.check();
    expect(result.scanner?.status).toBe('never_scanned');
    expect(result.scanner?.lastScannedAt).toBeNull();
  });

  it('reports stale when last scan exceeds threshold', async () => {
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    const mockDb = {
      $queryRaw: () => Promise.resolve([]),
      image: {
        findFirst: () => Promise.resolve({ lastScannedAt: oldDate }),
      },
    } as unknown as PrismaClient;

    const service = createHealthService({
      db: mockDb,
      scannerStalenessThresholdMs: 30 * 60 * 1000, // 30 min threshold
    });
    const result = await service.check();
    expect(result.scanner?.status).toBe('stale');
    expect(result.scanner?.lastScannedAt).toBe(oldDate.toISOString());
  });

  it('reports ok when last scan is within threshold', async () => {
    const recentDate = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    const mockDb = {
      $queryRaw: () => Promise.resolve([]),
      image: {
        findFirst: () => Promise.resolve({ lastScannedAt: recentDate }),
      },
    } as unknown as PrismaClient;

    const service = createHealthService({
      db: mockDb,
      scannerStalenessThresholdMs: 30 * 60 * 1000,
    });
    const result = await service.check();
    expect(result.scanner?.status).toBe('ok');
  });
});
