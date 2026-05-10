import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { parseTrivyOutput } from '@/scanner/utils/json-stream.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures');

describe('parseTrivyOutput', () => {
  it('parses multi-result Trivy JSON accumulating across all Result objects', async () => {
    const json = await readFile(join(fixturesDir, 'trivy-sample.json'), 'utf-8');
    const result = await parseTrivyOutput(Readable.from([json]));

    // 3 packages across 2 Result objects
    expect(result.packages).toHaveLength(3);
    expect(result.packages.map((p) => p.name)).toEqual(
      expect.arrayContaining(['openssl', 'libssl1.1', 'golang.org/x/net']),
    );

    // 3 vulnerabilities across 2 Result objects
    expect(result.vulnerabilities).toHaveLength(3);
    expect(result.vulnerabilities[0]).toMatchObject({
      cveId: 'CVE-2023-0001',
      severity: 'CRITICAL',
      packageName: 'openssl',
      installedVersion: '1.1.1k-1+deb10u1',
      fixedVersion: '1.1.1l-1+deb10u1',
      description: 'Critical OpenSSL vulnerability',
    });
    expect(result.vulnerabilities[1]).toMatchObject({
      cveId: 'CVE-2023-0002',
      severity: 'HIGH',
      packageName: 'libssl1.1',
      description: 'High severity libssl bug',
    });
  });

  it('returns empty arrays for empty Results', async () => {
    const json = JSON.stringify({ SchemaVersion: 2, Results: [] });
    const result = await parseTrivyOutput(Readable.from([json]));
    expect(result.packages).toHaveLength(0);
    expect(result.vulnerabilities).toHaveLength(0);
  });

  it('handles Result objects that have neither Packages nor Vulnerabilities', async () => {
    const json = JSON.stringify({
      SchemaVersion: 2,
      Results: [{ Target: 'empty-target', Class: 'os-pkgs' }],
    });
    const result = await parseTrivyOutput(Readable.from([json]));
    expect(result.packages).toHaveLength(0);
    expect(result.vulnerabilities).toHaveLength(0);
  });

  it('maps unrecognised severity strings to UNKNOWN', async () => {
    const json = JSON.stringify({
      SchemaVersion: 2,
      Results: [
        {
          Target: 'test',
          Vulnerabilities: [
            {
              VulnerabilityID: 'CVE-2099-9999',
              PkgName: 'test-pkg',
              InstalledVersion: '1.0',
              Severity: 'NEGLIGIBLE',
            },
          ],
        },
      ],
    });
    const result = await parseTrivyOutput(Readable.from([json]));
    expect(result.vulnerabilities[0]?.severity).toBe('UNKNOWN');
  });

  it('uses Title for description when Title is present, Description as fallback', async () => {
    const json = JSON.stringify({
      SchemaVersion: 2,
      Results: [
        {
          Target: 'test',
          Vulnerabilities: [
            {
              VulnerabilityID: 'CVE-A',
              PkgName: 'pkg',
              InstalledVersion: '1.0',
              Severity: 'LOW',
              Title: 'from title',
              Description: 'from description',
            },
            {
              VulnerabilityID: 'CVE-B',
              PkgName: 'pkg',
              InstalledVersion: '1.0',
              Severity: 'LOW',
              Description: 'only description',
            },
          ],
        },
      ],
    });
    const result = await parseTrivyOutput(Readable.from([json]));
    expect(result.vulnerabilities[0]?.description).toBe('from title');
    expect(result.vulnerabilities[1]?.description).toBe('only description');
  });
});
