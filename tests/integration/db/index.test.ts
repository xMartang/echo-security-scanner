/**
 * Integration tests: repositories + persistence service against a real Postgres.
 *
 * Requires Docker to be running. Starts a postgres:16-alpine container,
 * applies migrations, runs all tests, then shuts down.
 */

import { jest } from '@jest/globals';
import type { StartedTestContainer } from 'testcontainers';
import { GenericContainer } from 'testcontainers';
import { PrismaClient, ScanStatus } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { createImageRepository } from '@/common/db/repositories/image.repository.js';
import { ingestScanResults } from '@/bullmq/tasks/scanners/trivy/scan-ingestion.service.js';
import type { ScanResult } from '@/bullmq/tasks/scanners/trivy/types/scan-result.js';

// 3 minutes -- container pull + start can be slow on first run.
jest.setTimeout(180_000);

const require = createRequire(import.meta.url);
const prismaCLI: string = require.resolve('prisma/build/index.js');

let container: StartedTestContainer;
let testDb: PrismaClient;

// "-- helpers "----------------------------------------------------------------------------------------------------------------------------------

async function countAll() {
  const [images, pkgs, cves, imgPkgs, imgVulns] = await Promise.all([
    testDb.image.count(),
    testDb.package.count(),
    testDb.cve.count(),
    testDb.imagePackage.count(),
    testDb.imageVulnerability.count(),
  ]);
  return { images, pkgs, cves, imgPkgs, imgVulns };
}

// "-- lifecycle "--------------------------------------------------------------------------------------------------------------------------------

beforeAll(async () => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'testdb',
    })
    .withExposedPorts(5432)
    .start();

  const url = `postgresql://test:test@${container.getHost()}:${container.getMappedPort(5432)}/testdb`;

  execFileSync(process.execPath, [prismaCLI, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  testDb = new PrismaClient({ datasources: { db: { url } } });
  await testDb.$connect();
}, 180_000);

afterAll(async () => {
  await testDb?.$disconnect();
  await container?.stop();
});

afterEach(async () => {
  // Guard: beforeAll may have failed (e.g. Docker unavailable)
  if (!testDb) return;
  // Delete in dependency order (FK parent last)
  await testDb.imageVulnerability.deleteMany();
  await testDb.imagePackage.deleteMany();
  await testDb.image.deleteMany();
  await testDb.cve.deleteMany();
  await testDb.package.deleteMany();
});

// "-- fixtures "----------------------------------------------------------------------------------------------------------------------------------

const SCAN_RESULT: ScanResult = {
  packages: [{ name: 'openssl' }, { name: 'libssl' }],
  vulnerabilities: [
    {
      cveId: 'CVE-2023-0001',
      severity: 'CRITICAL',
      description: 'A critical openssl bug',
      packageName: 'openssl',
      installedVersion: '1.1.1k',
      fixedVersion: '1.1.1l',
    },
    {
      cveId: 'CVE-2023-0002',
      severity: 'HIGH',
      packageName: 'libssl',
      installedVersion: '1.1.1k',
    },
  ],
};

// "-- imageRepository "--------------------------------------------------------------------------------------------------------------------

describe('imageRepository', () => {
  let repo: ReturnType<typeof createImageRepository>;

  beforeEach(() => {
    repo = createImageRepository(testDb);
  });

  it('upsertImage creates a new image', async () => {
    const img = await repo.upsertImage('nginx', '1.19');
    expect(img.name).toBe('nginx');
    expect(img.tag).toBe('1.19');
    expect(img.status).toBe(ScanStatus.PENDING);
  });

  it('upsertImage is idempotent (no duplicate rows)', async () => {
    await repo.upsertImage('nginx', '1.19');
    await repo.upsertImage('nginx', '1.19');
    expect(await testDb.image.count()).toBe(1);
  });

  it('markScanning transitions status correctly', async () => {
    const img = await repo.upsertImage('nginx', '1.19');
    await repo.markScanning(img.id);
    const updated = await testDb.image.findUniqueOrThrow({ where: { id: img.id } });
    expect(updated.status).toBe(ScanStatus.SCANNING);
    expect(updated.lastError).toBeNull();
  });

  it('markFailed sets FAILED status and records error message', async () => {
    const img = await repo.upsertImage('nginx', '1.19');
    await repo.markFailed(img.id, 'trivy timeout');
    const updated = await testDb.image.findUniqueOrThrow({ where: { id: img.id } });
    expect(updated.status).toBe(ScanStatus.FAILED);
    expect(updated.lastError).toBe('trivy timeout');
  });

  it('markStuckScanningAsFailed marks SCANNING -> FAILED', async () => {
    const a = await repo.upsertImage('nginx', '1.19');
    const b = await repo.upsertImage('redis', '6.0');
    await testDb.image.updateMany({
      where: { id: { in: [a.id, b.id] } },
      data: { status: ScanStatus.SCANNING },
    });
    await repo.upsertImage('alpine', '3.12'); // PENDING -- should be untouched

    const count = await repo.markStuckScanningAsFailed();
    expect(count).toBe(2);

    const rows = await testDb.image.findMany({ orderBy: { name: 'asc' } });
    const [alpine, nginx, redis] = rows;
    expect(alpine?.status).toBe(ScanStatus.PENDING); // alpine -- always PENDING
    expect(nginx?.status).toBe(ScanStatus.FAILED);   // nginx -- was SCANNING
    expect(nginx?.lastError).toBe('Container exited abruptly while scanning; marked as FAILED.');
    expect(redis?.status).toBe(ScanStatus.FAILED);   // redis -- was SCANNING
  });

  it('markStuckScanningAsFailed returns 0 when nothing is stuck', async () => {
    await repo.upsertImage('nginx', '1.19');
    const count = await repo.markStuckScanningAsFailed();
    expect(count).toBe(0);
  });
});

// "-- ingestScanResults "--------------------------------------------------------------------------------------------------------------

describe('ingestScanResults', () => {
  it('creates all expected rows on first scan', async () => {
    await ingestScanResults('nginx', '1.19', SCAN_RESULT, testDb);

    const counts = await countAll();
    expect(counts.images).toBe(1);
    expect(counts.pkgs).toBe(2);
    expect(counts.cves).toBe(2);
    expect(counts.imgPkgs).toBe(2);
    expect(counts.imgVulns).toBe(2);
  });

  it('marks image as SUCCESS after persist', async () => {
    await ingestScanResults('nginx', '1.19', SCAN_RESULT, testDb);
    const img = await testDb.image.findFirstOrThrow({ where: { name: 'nginx', tag: '1.19' } });
    expect(img.status).toBe(ScanStatus.SUCCESS);
    expect(img.lastScannedAt).not.toBeNull();
    expect(img.lastError).toBeNull();
  });

  it('is idempotent -- second scan does not grow row counts', async () => {
    await ingestScanResults('nginx', '1.19', SCAN_RESULT, testDb);
    const after1 = await countAll();

    await ingestScanResults('nginx', '1.19', SCAN_RESULT, testDb);
    const after2 = await countAll();

    expect(after2).toStrictEqual(after1);
  });

  it('two different images share Package and Cve rows', async () => {
    await ingestScanResults('nginx', '1.19', SCAN_RESULT, testDb);
    await ingestScanResults('redis', '6.0', SCAN_RESULT, testDb);

    const counts = await countAll();
    // Packages and CVEs are deduplicated across images
    expect(counts.pkgs).toBe(2);
    expect(counts.cves).toBe(2);
    // But each image gets its own join rows
    expect(counts.images).toBe(2);
    expect(counts.imgPkgs).toBe(4);
    expect(counts.imgVulns).toBe(4);
  });

  it('updates installedVersion on subsequent scan if changed', async () => {
    await ingestScanResults('nginx', '1.19', SCAN_RESULT, testDb);

    const updatedResult: ScanResult = {
      ...SCAN_RESULT,
      vulnerabilities: SCAN_RESULT.vulnerabilities.map((v) =>
        v.cveId === 'CVE-2023-0001'
          ? { ...v, installedVersion: '1.1.1m' }
          : v,
      ),
    };
    await ingestScanResults('nginx', '1.19', updatedResult, testDb);

    const iv = await testDb.imageVulnerability.findFirst({
      where: { cve: { cveId: 'CVE-2023-0001' } },
    });
    expect(iv?.installedVersion).toBe('1.1.1m');
  });
});
