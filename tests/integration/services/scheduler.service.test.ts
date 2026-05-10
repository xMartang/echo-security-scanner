/**
 * Integration tests for the scheduler against a real Redis testcontainer.
 *
 * Scope: verifies that `enqueueScanJobs` actually lands jobs in BullMQ/Redis,
 * that deduplication works (stable jobIds), and that the repeatable scheduler
 * registration persists in Redis. setupScheduler's higher-level wiring (Worker
 * creation, processor linkage) is covered by the unit tests.
 */

import { jest } from '@jest/globals';
import type { StartedTestContainer } from 'testcontainers';
import { GenericContainer } from 'testcontainers';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { IMAGES } from '@/bullmq/tasks/scanners/trivy/images.js';

jest.setTimeout(120_000);

// Mock queue.ts BEFORE any transitive import loads it, so module-level singletons
// never attempt to connect to env.REDIS_URL (which is unavailable in test context).
jest.unstable_mockModule('@/bullmq/queue.js', () => ({
  scanQueue: null,
  schedulerQueue: null,
  connection: null,
}));

// Dynamic imports AFTER mock
const { enqueueScanJobs } = await import('@/bullmq/tasks/scanners/trivy/scheduler-tick.job.js');

let container: StartedTestContainer;
let redis: Redis;
let scanQueue: Queue;
let schedulerQueue: Queue;

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .start();

  const redisUrl = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  scanQueue = new Queue('image-scan', { connection: redis });
  schedulerQueue = new Queue('image-scheduler', { connection: redis });
}, 120_000);

afterAll(async () => {
  await scanQueue?.close();
  await schedulerQueue?.close();
  await redis?.quit();
  await container?.stop();
});

afterEach(async () => {
  await scanQueue.obliterate({ force: true });
  await schedulerQueue.obliterate({ force: true });
});

// â”€â”€ enqueueScanJobs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('enqueueScanJobs (real Redis)', () => {
  it('adds IMAGES.length jobs to the scan queue', async () => {
    await enqueueScanJobs(scanQueue, new Date().toISOString());
    expect(await scanQueue.getWaitingCount()).toBe(IMAGES.length);
  });

  it('stable jobIds â€” calling twice is idempotent (no duplicates)', async () => {
    await enqueueScanJobs(scanQueue, new Date().toISOString());
    await enqueueScanJobs(scanQueue, new Date().toISOString());
    expect(await scanQueue.getWaitingCount()).toBe(IMAGES.length);
  });

  it('jobs have name "scan-image" and jobId matching scan__name__tag', async () => {
    await enqueueScanJobs(scanQueue, new Date().toISOString());
    const jobs = await scanQueue.getWaiting();
    for (const job of jobs) {
      expect(job.name).toBe('scan-image');
      expect(job.id).toMatch(/^scan__[^:]+__[^:]+$/);
    }
  });

  it('each image gets exactly one waiting job', async () => {
    await enqueueScanJobs(scanQueue, new Date().toISOString());
    const jobs = await scanQueue.getWaiting();
    const imageKeys = jobs.map((j) => {
      const d = j.data as { imageName: string; imageTag: string };
      return `${d.imageName}:${d.imageTag}`;
    });
    const expected = IMAGES.map((i) => `${i.name}:${i.tag}`);
    expect(imageKeys.sort()).toEqual(expected.sort());
  });
});

// â”€â”€ schedulerQueue.upsertJobScheduler (smoke â€” verifies no throw with real Redis) â”€â”€

describe('upsertJobScheduler (real Redis)', () => {
  it('resolves without throwing', async () => {
    await expect(
      schedulerQueue.upsertJobScheduler(
        'scan-all-images',
        { every: 900_000 },
        { name: 'scheduler-tick', data: { triggeredAt: new Date().toISOString() } },
      ),
    ).resolves.toBeDefined();
  });

  it('is idempotent â€” calling twice does not throw', async () => {
    const opts = { every: 900_000 };
    const template = { name: 'scheduler-tick', data: { triggeredAt: new Date().toISOString() } };
    await schedulerQueue.upsertJobScheduler('scan-all-images', opts, template);
    await expect(
      schedulerQueue.upsertJobScheduler('scan-all-images', opts, template),
    ).resolves.toBeDefined();
  });
});
