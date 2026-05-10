import type { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { ScanStatus } from '@prisma/client';

/** Maximum rows retained in ScanHistory. Oldest rows are pruned on each insert. */
export const SCAN_HISTORY_MAX_ROWS = 1_000;

export type ScanHistoryInput = {
  imageName: string;
  imageTag: string;
  status: ScanStatus;
  cveCount?: number;
  cveSummary?: Prisma.InputJsonValue;
  errorMessage?: string;
  startedAt: Date;
  completedAt: Date;
};

export function createScanHistoryRepository(db: PrismaClient) {
  return {
    /**
     * Persists one row to ScanHistory and prunes the table to SCAN_HISTORY_MAX_ROWS.
     * Best-effort — callers should .catch() so a history failure never aborts a scan.
     */
    async save(data: ScanHistoryInput): Promise<void> {
      await db.scanHistory.create({ data });

      // Prune oldest rows when the table exceeds the cap.
      const totalCount = await db.scanHistory.count();
      if (totalCount > SCAN_HISTORY_MAX_ROWS) {
        const toDelete = await db.scanHistory.findMany({
          orderBy: { startedAt: 'asc' },
          take: totalCount - SCAN_HISTORY_MAX_ROWS,
          select: { id: true },
        });
        if (toDelete.length > 0) {
          await db.scanHistory.deleteMany({
            where: { id: { in: toDelete.map((r) => r.id) } },
          });
        }
      }
    },
  };
}

export type ScanHistoryRepository = ReturnType<typeof createScanHistoryRepository>;
