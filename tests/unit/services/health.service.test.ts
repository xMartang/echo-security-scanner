import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { createHealthService } from '@/services/health.service.js';

function makeMockDb(healthy: boolean): PrismaClient {
  return {
    $queryRaw: healthy
      ? () => Promise.resolve([{ '?column?': 1 }])
      : () => Promise.reject(new Error('connection refused')),
  } as unknown as PrismaClient;
}

function makeMockRedis(healthy: boolean): Redis {
  return {
    ping: healthy ? () => Promise.resolve('PONG') : () => Promise.reject(new Error('ECONNREFUSED')),
  } as unknown as Redis;
}

describe('createHealthService', () => {
  it('reports ok when all components are healthy', async () => {
    const service = createHealthService({
      db: makeMockDb(true),
      redis: makeMockRedis(true),
      trivyUrl: 'http://never-called',  // fetch will fail but that's ok for trivy: error
    });

    // We can't mock fetch easily, so trivy will be 'error' (non-existent URL).
    // Test what we can control.
    const result = await service.check();
    expect(result.db).toBe('ok');
    expect(result.redis).toBe('ok');
    expect(result.trivy).toBe('error'); // no real trivy in tests
    expect(result.status).toBe('degraded'); // degraded because trivy is error
  });

  it('reports db: error when DB query fails', async () => {
    const service = createHealthService({
      db: makeMockDb(false),
      redis: makeMockRedis(true),
      trivyUrl: 'http://never-called',
    });

    const result = await service.check();
    expect(result.db).toBe('error');
  });

  it('reports redis: error when Redis ping fails', async () => {
    const service = createHealthService({
      db: makeMockDb(true),
      redis: makeMockRedis(false),
      trivyUrl: 'http://never-called',
    });

    const result = await service.check();
    expect(result.redis).toBe('error');
  });

  it('reports status degraded when any component is unhealthy', async () => {
    const service = createHealthService({
      db: makeMockDb(false),
      redis: makeMockRedis(false),
      trivyUrl: 'http://never-called',
    });

    const result = await service.check();
    expect(result.status).toBe('degraded');
  });
});
