// TEMPORARY STUB — will be replaced in Task 5
import type { PrismaClient } from '@prisma/client';

export type ComponentStatus = 'ok' | 'error';

export type HealthCheckResult = {
  db: ComponentStatus;
  status: 'ok' | 'degraded';
};

type HealthServiceDeps = {
  db: PrismaClient;
};

export function createHealthService(_deps: HealthServiceDeps) {
  return {
    check(): Promise<HealthCheckResult> {
      return Promise.resolve({ db: 'ok', status: 'ok' });
    },
  };
}

export type HealthService = ReturnType<typeof createHealthService>;
