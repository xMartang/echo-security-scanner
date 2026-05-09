import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/db/client.js';

export function createPackageRepository(db: PrismaClient) {
  return {
    /** Ensure package row exists; returns the row (with id). */
    async upsertPackage(name: string) {
      return db.package.upsert({
        where: { name },
        create: { name },
        update: {},
      });
    },
  };
}

export const packageRepository = createPackageRepository(prisma);
export type PackageRepository = ReturnType<typeof createPackageRepository>;
