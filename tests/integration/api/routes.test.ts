/**
 * Integration tests for /health, /api/images, and /api/cves routes.
 * Uses testcontainers Postgres with real migrations + seeded data.
 * Redis and Trivy are mocked -- no extra containers needed.
 */

import { jest } from '@jest/globals';
import type { StartedTestContainer } from 'testcontainers';
import { GenericContainer } from 'testcontainers';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import pino from 'pino';
import { createApp } from '@/api/app.js';
import { ingestScanResults } from '@/bullmq/tasks/scanners/trivy/scan-ingestion.service.js';
import type { ScanResult } from '@/bullmq/tasks/scanners/trivy/types/scan-result.js';

jest.setTimeout(180_000);

const require = createRequire(import.meta.url);
const prismaCLI: string = require.resolve('prisma/build/index.js');
const silentLogger = pino({ level: 'silent' });
let container: StartedTestContainer;
let testDb: PrismaClient;
let app: ReturnType<typeof createApp>;

const NGINX_SCAN: ScanResult = {
  packages: [{ name: 'openssl' }, { name: 'libssl' }],
  vulnerabilities: [
    { cveId: 'CVE-2023-1001', severity: 'CRITICAL', description: 'Critical OpenSSL', packageName: 'openssl', installedVersion: '1.1.1k', fixedVersion: '1.1.1l' },
    { cveId: 'CVE-2023-1002', severity: 'HIGH', packageName: 'libssl', installedVersion: '1.1.1k' },
  ],
};
const REDIS_SCAN: ScanResult = {
  packages: [{ name: 'openssl' }],
  vulnerabilities: [
    { cveId: 'CVE-2023-1001', severity: 'CRITICAL', description: 'Critical OpenSSL', packageName: 'openssl', installedVersion: '6.0.1' },
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

  await ingestScanResults('nginx', '1.19', NGINX_SCAN, testDb);
  await ingestScanResults('redis', '6.0', REDIS_SCAN, testDb);

  app = createApp({ logger: silentLogger, db: testDb });
}, 180_000);

afterAll(async () => {
  await testDb?.$disconnect();
  await container?.stop();
});

// Typed helper -- supertest body is `any` but we want type safety in assertions.
type ApiData<T> = { data: T };

// "-- /health "------------------------------------------------------------------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns { data: { db, status } }', async () => {
    const res = await request(app).get('/health');
    const body = res.body as ApiData<{ db: string; status: string }>;
    expect(['200', '503']).toContain(String(res.status));
    expect(body.data).toHaveProperty('db');
    expect(body.data).toHaveProperty('status');
  });

  it('reports db as ok (real container)', async () => {
    const res = await request(app).get('/health');
    const body = res.body as ApiData<{ db: string }>;
    expect(body.data.db).toBe('ok');
  });
});

// "-- /api/images "----------------------------------------------------------------------------------------------------------------------------

describe('GET /api/images', () => {
  it('returns all scanned images wrapped in { data }', async () => {
    const res = await request(app).get('/api/images');
    const body = res.body as ApiData<unknown[]>;
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
  });

  it('includes cveCountBySeverity on each image', async () => {
    const res = await request(app).get('/api/images');
    const body = res.body as ApiData<Array<{ name: string; cveCountBySeverity: Record<string, number> }>>;
    const nginx = body.data.find((i) => i.name === 'nginx');
    expect(nginx?.cveCountBySeverity).toMatchObject({ CRITICAL: 1, HIGH: 1, total: 2 });
  });
});

// "-- /api/images/:name/:tag/cves "--------------------------------------------------------------------------------------------

describe('GET /api/images/:name/:tag/cves', () => {
  it('returns CVEs for a known image', async () => {
    const res = await request(app).get('/api/images/nginx/1.19/cves');
    const body = res.body as ApiData<unknown[]>;
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
  });

  it('filters by severity', async () => {
    const res = await request(app).get('/api/images/nginx/1.19/cves?severity=CRITICAL');
    const body = res.body as ApiData<Array<{ severity: string }>>;
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.severity).toBe('CRITICAL');
  });

  it('returns 400 on invalid severity', async () => {
    const res = await request(app).get('/api/images/nginx/1.19/cves?severity=NEGLIGIBLE');
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for unknown image', async () => {
    const res = await request(app).get('/api/images/unknown/latest/cves');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

// "-- /api/cves "--------------------------------------------------------------------------------------------------------------------------------

describe('GET /api/cves', () => {
  it('returns all distinct CVEs', async () => {
    const res = await request(app).get('/api/cves');
    const body = res.body as ApiData<unknown[]>;
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
  });

  it('filters by severity', async () => {
    const res = await request(app).get('/api/cves?severity=HIGH');
    const body = res.body as ApiData<Array<{ cveId: string }>>;
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.cveId).toBe('CVE-2023-1002');
  });

  it('returns 400 for invalid severity', async () => {
    const res = await request(app).get('/api/cves?severity=bad');
    expect(res.status).toBe(400);
  });
});

// "-- /api/cves/:cveId/images "----------------------------------------------------------------------------------------------------

describe('GET /api/cves/:cveId/images', () => {
  it('returns all images affected by a CVE', async () => {
    const res = await request(app).get('/api/cves/CVE-2023-1001/images');
    const body = res.body as ApiData<unknown[]>;
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2); // nginx + redis both have this CVE
  });

  it('returns empty array for unknown CVE', async () => {
    const res = await request(app).get('/api/cves/CVE-9999-9999/images');
    const body = res.body as ApiData<unknown[]>;
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(0);
  });
});
