import { jest } from '@jest/globals';
import type { PrismaClient } from '@prisma/client';
import { ScanStatus } from '@prisma/client';
import { createImageRepository } from '@/db/repositories/image.repository.js';

describe('imageRepository.resetStuckScanning', () => {
  it('resets SCANNING rows to PENDING and returns count', async () => {
    const mockUpdateMany = jest
      .fn<() => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 3 });
    const mockDb = { image: { updateMany: mockUpdateMany } } as unknown as PrismaClient;

    const repo = createImageRepository(mockDb);
    const count = await repo.resetStuckScanning();

    expect(count).toBe(3);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { status: ScanStatus.SCANNING },
      data: {
        status: ScanStatus.PENDING,
        lastError: 'recovered from stuck scanning state',
      },
    });
  });

  it('returns 0 when no rows are stuck', async () => {
    const mockDb = {
      image: {
        updateMany: jest
          .fn<() => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaClient;

    const count = await createImageRepository(mockDb).resetStuckScanning();
    expect(count).toBe(0);
  });
});
