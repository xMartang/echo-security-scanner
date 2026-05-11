import { jest } from '@jest/globals';
import type { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

// Mock connection and queues BEFORE any transitive import loads them.
jest.unstable_mockModule('@/bullmq/connection.js', () => ({ connection: {} }));
jest.unstable_mockModule('@/bullmq/tasks/scanners/trivy/queues.js', () => ({
  scanQueue: {},
  schedulerQueue: {},
}));

// Mock BullMQ Worker so no Redis connection is attempted.
const mockWorkerClose = jest.fn<() => Promise<void>>().mockImplementation(() => Promise.resolve());
const MockWorker = jest.fn<() => Partial<Worker>>(() => ({ close: mockWorkerClose }));
const mockInternalQueueUpsert = jest.fn<() => Promise<unknown>>().mockResolvedValue({});
jest.unstable_mockModule('bullmq', () => ({
  Worker: MockWorker,
  Queue: jest.fn(() => ({ upsertJobScheduler: mockInternalQueueUpsert })),
}));

// Dynamic imports AFTER mocks are in place.
const { setupScheduler } = await import('@/bullmq/services/scheduler.service.js');


describe('setupScheduler', () => {
  let mockUpsertJobScheduler: ReturnType<typeof jest.fn<() => Promise<unknown>>>;
  let mockSchedulerQueue: Queue;
  let mockConnection: Redis;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsertJobScheduler = jest.fn<() => Promise<unknown>>().mockResolvedValue({});
    mockSchedulerQueue = { upsertJobScheduler: mockUpsertJobScheduler } as unknown as Queue;
    mockConnection = {} as Redis;
  });

  it('registers a repeatable job scheduler on the scheduler queue', async () => {
    await setupScheduler(mockSchedulerQueue, mockConnection);
    expect(mockUpsertJobScheduler).toHaveBeenCalledTimes(1);
    const [name, intervalOpts] = (mockUpsertJobScheduler.mock.calls[0] as unknown) as [
      string,
      { every: number },
    ];
    expect(name).toBe('scan-all-images');
    expect(typeof intervalOpts.every).toBe('number');
  });

  it('creates a BullMQ Worker for the image-scheduler queue', async () => {
    await setupScheduler(mockSchedulerQueue, mockConnection);
    expect(MockWorker).toHaveBeenCalledWith(
      'image-scheduler',
      expect.any(Function) as unknown,
      expect.any(Object) as unknown,
    );
  });
});
