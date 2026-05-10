import { jest } from '@jest/globals';
import type { Queue, Job } from 'bullmq';
import type { SchedulerTickJobData } from '@/scanner/types/job-payload.js';

// Must mock @/scanner/queue.js BEFORE any import that transitively loads it.
const mockAddBulkSingleton = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
const mockGetJobsSingleton = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
jest.unstable_mockModule('@/scanner/queue.js', () => ({
  scanQueue: { addBulk: mockAddBulkSingleton, getJobs: mockGetJobsSingleton },
  schedulerQueue: {},
  connection: {},
}));

// Dynamic imports after mock is in place
const { buildScanJobs, enqueueScanJobs, processSchedulerTick } =
  await import('@/scanner/jobs/scheduler-tick.job.js');
const { IMAGES } = await import('@/scanner/config/images.js');

// ── buildScanJobs (pure function — no mocks needed) ───────────────────────────

describe('buildScanJobs', () => {
  const TRIGGERED_AT = '2026-05-10T00:00:00.000Z';

  it('returns one job per image passed', () => {
    expect(buildScanJobs(IMAGES, TRIGGERED_AT)).toHaveLength(IMAGES.length);
  });

  it('every job has name "scan-image"', () => {
    for (const job of buildScanJobs(IMAGES, TRIGGERED_AT)) {
      expect(job.name).toBe('scan-image');
    }
  });

  it('jobId encodes imageName, imageTag, and triggeredAt (no colons — BullMQ v5)', () => {
    for (const job of buildScanJobs(IMAGES, TRIGGERED_AT)) {
      const expected = `scan__${job.data.imageName}__${job.data.imageTag}__${TRIGGERED_AT}`;
      expect(job.opts.jobId).toBe(expected);
    }
  });

  it('all jobIds are unique', () => {
    const ids = buildScanJobs(IMAGES, TRIGGERED_AT).map((j) => j.opts.jobId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each job carries imageName and imageTag', () => {
    const pairs = buildScanJobs(IMAGES, TRIGGERED_AT).map((j) => `${j.data.imageName}:${j.data.imageTag}`);
    const expected = IMAGES.map((i) => `${i.name}:${i.tag}`);
    expect(pairs).toEqual(expected);
  });

  it('uses removeOnComplete count:100 (not 0) for native BullMQ history', () => {
    const jobs = buildScanJobs(IMAGES, TRIGGERED_AT);
    for (const job of jobs) {
      expect(job.opts.removeOnComplete).toEqual({ count: 100 });
    }
  });
});

// ── enqueueScanJobs (injectable queue — dedup via getJobs) ────────────────────

describe('enqueueScanJobs', () => {
  it('enqueues all images when none are in-flight', async () => {
    const mockAddBulk = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
    const mockGetJobs = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
    const mockQueue = { addBulk: mockAddBulk, getJobs: mockGetJobs } as unknown as Queue;

    await enqueueScanJobs(mockQueue, '2026-05-10T00:00:00.000Z');

    expect(mockAddBulk).toHaveBeenCalledTimes(1);
    const [jobs] = (mockAddBulk.mock.calls[0] as unknown) as [unknown[]];
    expect(jobs).toHaveLength(IMAGES.length);
  });

  it('skips images already waiting or active', async () => {
    const mockAddBulk = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
    // Simulate nginx:1.19 already in flight
    const mockGetJobs = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([
      { name: 'scan-image', data: { imageName: 'nginx', imageTag: '1.19' } },
    ]);
    const mockQueue = { addBulk: mockAddBulk, getJobs: mockGetJobs } as unknown as Queue;

    await enqueueScanJobs(mockQueue, '2026-05-10T00:00:00.000Z');

    const [jobs] = (mockAddBulk.mock.calls[0] as unknown) as [Array<{ data: { imageName: string; imageTag: string } }>];
    expect(jobs.some(j => j.data.imageName === 'nginx' && j.data.imageTag === '1.19')).toBe(false);
    expect(jobs).toHaveLength(IMAGES.length - 1);
  });

  it('does not call addBulk when all images are already in-flight', async () => {
    const mockAddBulk = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
    const inFlightAll = IMAGES.map(img => ({
      name: 'scan-image',
      data: { imageName: img.name, imageTag: img.tag },
    }));
    const mockGetJobs = jest.fn<() => Promise<unknown[]>>().mockResolvedValue(inFlightAll);
    const mockQueue = { addBulk: mockAddBulk, getJobs: mockGetJobs } as unknown as Queue;

    await enqueueScanJobs(mockQueue, '2026-05-10T00:00:00.000Z');

    expect(mockAddBulk).not.toHaveBeenCalled();
  });
});

// ── processSchedulerTick (uses module-level scanQueue via singleton mock) ─────

describe('processSchedulerTick', () => {
  beforeEach(() => {
    mockAddBulkSingleton.mockClear();
    mockGetJobsSingleton.mockResolvedValue([]);
  });

  it('enqueues jobs using the job triggeredAt timestamp', async () => {
    const triggeredAt = '2026-05-10T12:00:00.000Z';
    const fakeJob = { data: { triggeredAt } } as Job<SchedulerTickJobData>;

    await processSchedulerTick(fakeJob);

    expect(mockAddBulkSingleton).toHaveBeenCalledTimes(1);
    const [jobs] = (mockAddBulkSingleton.mock.calls[0] as unknown) as [
      Array<{ opts: { jobId: string } }>,
    ];
    expect(jobs).toHaveLength(IMAGES.length);
    expect(jobs.every((j) => j.opts.jobId.includes(triggeredAt))).toBe(true);
  });
});
