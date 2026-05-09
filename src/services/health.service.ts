import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

export type ComponentStatus = 'ok' | 'error';

export type HealthCheckResult = {
  db: ComponentStatus;
  redis: ComponentStatus;
  trivy: ComponentStatus;
  status: 'ok' | 'degraded';
};

type HealthServiceDeps = {
  db: PrismaClient;
  redis: Redis;
  trivyUrl: string;
};

async function checkDb(db: PrismaClient): Promise<ComponentStatus> {
  try {
    await db.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkRedis(redis: Redis): Promise<ComponentStatus> {
  try {
    await redis.ping();
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkTrivy(trivyUrl: string): Promise<ComponentStatus> {
  try {
    const response = await fetch(`${trivyUrl}/healthz`, {
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

export function createHealthService(deps: HealthServiceDeps) {
  return {
    async check(): Promise<HealthCheckResult> {
      const [db, redis, trivy] = await Promise.all([
        checkDb(deps.db),
        checkRedis(deps.redis),
        checkTrivy(deps.trivyUrl),
      ]);

      const status: HealthCheckResult['status'] =
        db === 'ok' && redis === 'ok' && trivy === 'ok' ? 'ok' : 'degraded';

      return { db, redis, trivy, status };
    },
  };
}

export type HealthService = ReturnType<typeof createHealthService>;
