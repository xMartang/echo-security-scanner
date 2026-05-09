import { jest } from '@jest/globals';
import type { Queue, Job } from 'bullmq';
import type { SchedulerTickJobData } from '@/types/job-payload.js';

// Must mock @/queue/queue.js BEFORE any import that transitively loads it.
const mockAddBulkSingleton = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
jest.unstable_mockModule('@/queue/queue.js', () => ({
  scanQueue: { addBulk: mockAddBulkSingleton },
  schedulerQueue: {},
  connection: {},
}));

// Dynamic imports after mock is in place
const { buildScanJobs, enqueueScanJobs, processSchedulerTick } =
  await import('@/queue/jobs/scheduler-tick.job.js');
const { IMAGES } = await import('@/config/images.js');

// ── buildScanJobs (pure function — no mocks needed) ───────────────────────────

describe('buildScanJobs', () => {
  const TRIGGERED_AT = '2026-05-10T00:00:00.000Z';

  it('returns one job per image in IMAGES', () => {
    expect(buildScanJobs(TRIGGERED_AT)).toHaveLength(IMAGES.length);
  });

  it('every job has name "scan-image"', () => {
    for (const job of buildScanJobs(TRIGGERED_AT)) {
      expect(job.name).toBe('scan-image');
    }
  });

  it('jobId uses scan__name__tag format (no colons — BullMQ v5 restriction)', () => {
    for (const job of buildScanJobs(TRIGGERED_AT)) {
      const expected = `scan__${job.data.imageName}__${job.data.imageTag}`;
      expect(job.opts.jobId).toBe(expected);
    }
  });

  it('all jobIds are unique', () => {
    const ids = buildScanJobs(TRIGGERED_AT).map((j) => j.opts.jobId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each job carries imageName and imageTag from IMAGES', () => {
    const pairs = buildScanJobs(TRIGGERED_AT).map((j) => `${j.data.imageName}:${j.data.imageTag}`);
    const expected = IMAGES.map((i) => `${i.name}:${i.tag}`);
    expect(pairs).toEqual(expected);
  });
});

// ── enqueueScanJobs (injectable queue — no singleton used) ───────────────────

describe('enqueueScanJobs', () => {
  it('calls queue.addBulk with the correct number of jobs', async () => {
    const mockAddBulk = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
    const mockQueue = { addBulk: mockAddBulk } as unknown as Queue;
    const triggeredAt = '2026-05-10T00:00:00.000Z';

    await enqueueScanJobs(mockQueue, triggeredAt);

    expect(mockAddBulk).toHaveBeenCalledTimes(1);
    const [jobs] = (mockAddBulk.mock.calls[0] as unknown) as [unknown[]];
    expect(jobs).toHaveLength(IMAGES.length);
  });
});

// ── processSchedulerTick (uses module-level scanQueue via singleton mock) ─────

describe('processSchedulerTick', () => {
  beforeEach(() => mockAddBulkSingleton.mockClear());

  it('enqueues IMAGES.length jobs using the job triggeredAt timestamp', async () => {
    const triggeredAt = '2026-05-10T12:00:00.000Z';
    const fakeJob = { data: { triggeredAt } } as Job<SchedulerTickJobData>;

    await processSchedulerTick(fakeJob);

    expect(mockAddBulkSingleton).toHaveBeenCalledTimes(1);
    const [jobs] = (mockAddBulkSingleton.mock.calls[0] as unknown) as [
      Array<{ opts: { jobId: string } }>,
    ];
    expect(jobs).toHaveLength(IMAGES.length);
    expect(jobs.every((j) => j.opts.jobId.startsWith('scan__'))).toBe(true);
  });
});
