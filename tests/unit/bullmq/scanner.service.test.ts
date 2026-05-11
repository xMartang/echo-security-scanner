import { jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures');

// "-- Mock execa at module scope so scanner.service.ts picks it up on import "--
const mockExeca = jest.fn<() => object>();
jest.unstable_mockModule('execa', () => ({ execa: mockExeca }));

// Dynamic import AFTER the mock is registered
const { scan, parseScanOutputStream } = await import('@/bullmq/tasks/scanners/trivy/scanner.service.js');

// "-- parseScanOutputStream (no execa needed) "------------------------------------------------------------------

describe('parseScanOutputStream', () => {
  it('parses fixture JSON from a readable stream', async () => {
    const json = await readFile(join(fixturesDir, 'trivy-sample.json'), 'utf-8');
    const result = await parseScanOutputStream(Readable.from([json]));
    expect(result.packages).toHaveLength(3);
    expect(result.vulnerabilities).toHaveLength(3);
  });
});

// "-- scan "----------------------------------------------------------------------------------------------------------------------------------------

describe('scan', () => {
  beforeEach(() => mockExeca.mockReset());

  it('returns ScanOutput on successful trivy exit', async () => {
    const json = await readFile(join(fixturesDir, 'trivy-sample.json'), 'utf-8');
    const mockStdout = Readable.from([json]);
    const mockStderr = Readable.from(['some warning']);
    const fakeProcess = Object.assign(
      Promise.resolve({ exitCode: 0, stderr: 'some warning' }),
      { stdout: mockStdout, stderr: mockStderr },
    );
    mockExeca.mockReturnValue(fakeProcess);

    const output = await scan('nginx', '1.19');
    expect(output.result.vulnerabilities).toHaveLength(3);
    expect(output.stderr).toBe('some warning');
  });

  it('throws ScanFailedError when trivy exits non-zero (rate limit / image not found)', async () => {
    // Simulates the TOOMANYREQUESTS path: trivy writes a FATAL to stderr and
    // closes stdout empty. The parse promise rejects with "expected a value",
    // but our scan() should surface the stderr error, not the parser noise.
    const fatalMessage = '2026-05-11T00:00:00Z\tFATAL\tFatal error\tTOOMANYREQUESTS';
    const emptyStdout = new Readable({ read() { this.push(null); } });
    const mockStderr = Readable.from([fatalMessage]);
    const failedProcess = Object.assign(
      Promise.resolve({ exitCode: 1, stderr: fatalMessage }),
      { stdout: emptyStdout, stderr: mockStderr },
    );
    mockExeca.mockReturnValue(failedProcess);

    await expect(scan('nonexistent', 'badtag')).rejects.toMatchObject({
      name: 'ScanFailedError',
      cause: expect.objectContaining({ message: expect.stringContaining('TOOMANYREQUESTS') as unknown }) as unknown,
    });
  });
});
