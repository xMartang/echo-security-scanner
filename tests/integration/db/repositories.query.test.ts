/**
 * Integration tests for imageRepository and cveRepository query methods.
 * These are tested indirectly by the API route tests, but direct tests
 * catch regressions at the data layer before they surface as HTTP failures.
 */

import { jest } from '@jest/globals';
import type { StartedTestContainer } from 'testcontainers';
import { GenericContainer } from 'testcontainers';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createImageRepository } from '@/common/db/repositories/image.repository.js';
import { createCveRepository } from '@/common/db/repositories/cve.repository.js';
import { ingestScanResults } from '@/bullmq/tasks/scanners/trivy/scan-ingestion.service.js';
import type { ScanResult } from '@/bullmq/tasks/scanners/trivy/types/scan-result.js';

jest.setTimeout(180_000);

const require = createRequire(import.meta.url);
const prismaCLI: string = require.resolve('prisma/build/index.js');

let container: StartedTestContainer;
let testDb: PrismaClient;
let imageRepo: ReturnType<typeof createImageRepository>;
let cveRepo: ReturnType<typeof createCveRepository>;

const NGINX_SCAN: ScanResult = {
  packages: [{ name: 'openssl' }, { name: 'libssl' }],
  vulnerabilities: [
    { cveId: 'CVE-2023-A001', severity: 'CRITICAL', description: 'Critical bug', packageName: 'openssl', installedVersion: '1.1.1k', fixedVersion: '1.1.1l' },
    { cveId: 'CVE-2023-A002', severity: 'HIGH', packageName: 'libssl', installedVersion: '1.1.1k' },
    { cveId: 'CVE-2023-A003', severity: 'MEDIUM', packageName: 'openssl', installedVersion: '1.1.1k' },
  ],
};

const REDIS_SCAN: ScanResult = {
  packages: [{ name: 'openssl' }],
  vulnerabilities: [
    { cveId: 'CVE-2023-A001', severity: 'CRITICAL', description: 'Critical bug', packageName: 'openssl', installedVersion: '6.0.1' },
  ],
};

beforeAll(async () => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'testdb' })
    .withExposedPorts(5432)
    .start();

  const dbUrl = `postgresql://test:test@${container.getHost()}:${container.getMappedPort(5432)}/testdb`;
  execFileSync(process.execPath, [prismaCLI, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'pipe',
  });

  testDb = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  await testDb.$connect();
  imageRepo = createImageRepository(testDb);
  cveRepo = createCveRepository(testDb);

  // Seed once for all tests in this file
  await ingestScanResults('nginx', '1.19', NGINX_SCAN, testDb);
  await ingestScanResults('redis', '6.0', REDIS_SCAN, testDb);
}, 180_000);

afterAll(async () => {
  await testDb?.$disconnect();
  await container?.stop();
});

// "-- imageRepository.listWithSeveritySummary "--------------------------------------------------------------------

describe('imageRepository.listWithSeveritySummary', () => {
  it('returns all scanned images', async () => {
    const images = await imageRepo.listWithSeveritySummary();
    expect(images).toHaveLength(2);
  });

  it('includes cveCountBySeverity for each image', async () => {
    const images = await imageRepo.listWithSeveritySummary();
    for (const img of images) {
      expect(img).toHaveProperty('cveCountBySeverity');
      expect(img.cveCountBySeverity).toHaveProperty('total');
    }
  });

  it('counts nginx CVEs correctly per severity', async () => {
    const images = await imageRepo.listWithSeveritySummary();
    const nginx = images.find((i) => i.name === 'nginx');
    expect(nginx?.cveCountBySeverity).toMatchObject({
      CRITICAL: 1,
      HIGH: 1,
      MEDIUM: 1,
      total: 3,
    });
  });

  it('orders results by name ASC then tag ASC', async () => {
    const images = await imageRepo.listWithSeveritySummary();
    const names = images.map((i) => i.name);
    expect(names).toEqual([...names].sort());
  });
});

// "-- imageRepository.findByCveId "--------------------------------------------------------------------------------------------

describe('imageRepository.findByCveId', () => {
  it('returns all images affected by a CVE string ID', async () => {
    const result = await imageRepo.findByCveId('CVE-2023-A001');
    // Both nginx and redis have CVE-2023-A001
    expect(result).toHaveLength(2);
  });

  it('result includes image, packageName, installedVersion', async () => {
    const result = await imageRepo.findByCveId('CVE-2023-A001');
    for (const row of result) {
      expect(row).toHaveProperty('image');
      expect(row).toHaveProperty('packageName');
      expect(row).toHaveProperty('installedVersion');
    }
  });

  it('returns empty array for unknown CVE', async () => {
    const result = await imageRepo.findByCveId('CVE-9999-9999');
    expect(result).toHaveLength(0);
  });

  it('returns only images that actually have the CVE', async () => {
    // CVE-2023-A002 is only in nginx
    const result = await imageRepo.findByCveId('CVE-2023-A002');
    expect(result).toHaveLength(1);
    expect(result[0]?.image.name).toBe('nginx');
  });
});

// "-- cveRepository.findByImage "------------------------------------------------------------------------------------------------

describe('cveRepository.findByImage', () => {
  it('returns all CVEs for a known image', async () => {
    const cves = await cveRepo.findByImage('nginx', '1.19');
    expect(cves).toHaveLength(3);
  });

  it('each result has cveId, severity, packageName, installedVersion', async () => {
    const cves = await cveRepo.findByImage('nginx', '1.19');
    for (const cve of cves) {
      expect(cve).toHaveProperty('cveId');
      expect(cve).toHaveProperty('severity');
      expect(cve).toHaveProperty('packageName');
      expect(cve).toHaveProperty('installedVersion');
    }
  });

  it('filters by severity when provided', async () => {
    const cves = await cveRepo.findByImage('nginx', '1.19', 'CRITICAL');
    expect(cves).toHaveLength(1);
    expect(cves[0]?.severity).toBe('CRITICAL');
  });

  it('returns empty array when severity filter matches nothing', async () => {
    const cves = await cveRepo.findByImage('nginx', '1.19', 'LOW');
    expect(cves).toHaveLength(0);
  });

  it('throws ImageNotFoundError for unknown image', async () => {
    const { ImageNotFoundError } = await import('@/common/utils/errors.js');
    await expect(cveRepo.findByImage('ghost', 'latest')).rejects.toBeInstanceOf(ImageNotFoundError);
  });
});

// "-- cveRepository.listDistinct "----------------------------------------------------------------------------------------------

describe('cveRepository.listDistinct', () => {
  it('returns distinct CVEs across all images', async () => {
    const cves = await cveRepo.listDistinct();
    // CVE-A001 shared by nginx+redis, CVE-A002, CVE-A003 -- 3 distinct CVEs
    expect(cves).toHaveLength(3);
  });

  it('each result has cveId and severity', async () => {
    const cves = await cveRepo.listDistinct();
    for (const cve of cves) {
      expect(cve).toHaveProperty('cveId');
      expect(cve).toHaveProperty('severity');
    }
  });

  it('filters by severity', async () => {
    const cves = await cveRepo.listDistinct('HIGH');
    expect(cves).toHaveLength(1);
    expect(cves[0]?.cveId).toBe('CVE-2023-A002');
  });

  it('returns empty array when severity filter matches nothing', async () => {
    const cves = await cveRepo.listDistinct('LOW');
    expect(cves).toHaveLength(0);
  });

  it('orders by severity then cveId', async () => {
    const cves = await cveRepo.listDistinct();
    const severities = cves.map((c) => c.severity);
    // CRITICAL before HIGH before MEDIUM (Postgres enum sort order)
    expect(severities.indexOf('CRITICAL')).toBeLessThan(severities.indexOf('HIGH'));
  });
});
