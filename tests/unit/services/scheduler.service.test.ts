import { jest } from '@jest/globals';
import type { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

// Mock queue.ts BEFORE any transitive import loads it.
jest.unstable_mockModule('@/queue/queue.js', () => ({
  scanQueue: {},
  schedulerQueue: {},
  connection: {},
}));

// Mock BullMQ Worker so no Redis connection is attempted.
const mockWorkerClose = jest.fn<() => Promise<void>>().mockImplementation(() => Promise.resolve());
const MockWorker = jest.fn<() => Partial<Worker>>(() => ({ close: mockWorkerClose }));
jest.unstable_mockModule('bullmq', () => ({
  Worker: MockWorker,
  Queue: jest.fn(),
}));

// Dynamic imports AFTER mocks are in place.
const { setupScheduler } = await import('@/services/scheduler.service.js');
const { IMAGES } = await import('@/config/images.js');


describe('setupScheduler', () => {
  let mockAddBulk: ReturnType<typeof jest.fn<() => Promise<unknown[]>>>;
  let mockUpsertJobScheduler: ReturnType<typeof jest.fn<() => Promise<unknown>>>;
  let mockScanQueue: Queue;
  let mockSchedulerQueue: Queue;
  let mockConnection: Redis;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAddBulk = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
    mockUpsertJobScheduler = jest.fn<() => Promise<unknown>>().mockResolvedValue({});
    mockScanQueue = { addBulk: mockAddBulk } as unknown as Queue;
    mockSchedulerQueue = { upsertJobScheduler: mockUpsertJobScheduler } as unknown as Queue;
    mockConnection = {} as Redis;
  });

  it('registers a repeatable job scheduler on the scheduler queue', async () => {
    await setupScheduler(mockSchedulerQueue, mockScanQueue, mockConnection);
    expect(mockUpsertJobScheduler).toHaveBeenCalledTimes(1);
    const [name, intervalOpts] = (mockUpsertJobScheduler.mock.calls[0] as unknown) as [
      string,
      { every: number },
    ];
    expect(name).toBe('scan-all-images');
    expect(typeof intervalOpts.every).toBe('number');
  });

  it('performs immediate fan-out: enqueues IMAGES.length scan jobs on startup', async () => {
    await setupScheduler(mockSchedulerQueue, mockScanQueue, mockConnection);
    expect(mockAddBulk).toHaveBeenCalledTimes(1);
    const [jobs] = (mockAddBulk.mock.calls[0] as unknown) as [unknown[]];
    expect(jobs).toHaveLength(IMAGES.length);
  });

  it('immediate fan-out jobs have name "scan-image"', async () => {
    await setupScheduler(mockSchedulerQueue, mockScanQueue, mockConnection);
    const [jobs] = (mockAddBulk.mock.calls[0] as unknown) as [Array<{ name: string }>];
    expect(jobs.every((j) => j.name === 'scan-image')).toBe(true);
  });

  it('immediate fan-out jobIds use scan__name__tag format (no colons)', async () => {
    await setupScheduler(mockSchedulerQueue, mockScanQueue, mockConnection);
    const [jobs] = (mockAddBulk.mock.calls[0] as unknown) as [Array<{ opts: { jobId: string } }>];
    expect(jobs.every((j) => /^scan__[^:]+__[^:]+$/.test(j.opts.jobId))).toBe(true);
  });

  it('creates a BullMQ Worker for the image-scheduler queue', async () => {
    await setupScheduler(mockSchedulerQueue, mockScanQueue, mockConnection);
    expect(MockWorker).toHaveBeenCalledWith(
      'image-scheduler',
      expect.any(Function) as unknown,
      expect.any(Object) as unknown,
    );
  });
});
