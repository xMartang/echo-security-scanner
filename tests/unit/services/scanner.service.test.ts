import { jest } from '@jest/globals';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures');

// â”€â”€ Mock execa at module scope so scanner.service.ts picks it up on import â”€â”€
const mockExeca = jest.fn<() => object>();
jest.unstable_mockModule('execa', () => ({ execa: mockExeca }));

// Dynamic import AFTER the mock is registered
const [{ scan, parseScanOutputStream }, { ScanFailedError }] = await Promise.all([
  import('@/bullmq/tasks/scanners/trivy/scanner.service.js'),
  import('@/common/utils/errors.js'),
]);

// â”€â”€ parseScanOutputStream (no execa needed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('parseScanOutputStream', () => {
  it('parses fixture JSON from a readable stream', async () => {
    const json = await readFile(join(fixturesDir, 'trivy-sample.json'), 'utf-8');
    const result = await parseScanOutputStream(Readable.from([json]));
    expect(result.packages).toHaveLength(3);
    expect(result.vulnerabilities).toHaveLength(3);
  });
});

// â”€â”€ scan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('scan', () => {
  beforeEach(() => mockExeca.mockReset());

  it('returns ScanOutput on successful trivy exit', async () => {
    const json = await readFile(join(fixturesDir, 'trivy-sample.json'), 'utf-8');
    const mockStdout = Readable.from([json]);
    const fakeProcess = Object.assign(Promise.resolve({ stderr: 'some warning' }), {
      stdout: mockStdout,
    });
    mockExeca.mockReturnValue(fakeProcess);

    const output = await scan('nginx', '1.19');
    expect(output.result.vulnerabilities).toHaveLength(3);
    expect(output.stderr).toBe('some warning');
  });

  it('throws ScanFailedError when trivy process rejects', async () => {
    const execaError = new Error('exited with code 1: image not found');
    const emptyStdout = new Readable({ read() { this.push(null); } });
    const failedProcess = Object.assign(Promise.reject(execaError), { stdout: emptyStdout });
    // Attach handler so Jest doesn't see an unhandled rejection on the mock value
    failedProcess.catch(() => undefined);
    mockExeca.mockReturnValue(failedProcess);

    await expect(scan('nonexistent', 'badtag')).rejects.toBeInstanceOf(ScanFailedError);
  });
});
