import { execa } from 'execa';
import type { Readable } from 'node:stream';
import { env } from '@/config/env.js';
import { ScanFailedError } from '@/utils/errors.js';
import { parseTrivyOutput } from '@/utils/json-stream.js';
import type { ScanResult } from '@/types/scan-result.js';

export type ScanOutput = {
  result: ScanResult;
  /** Raw stderr from the trivy process — may contain warnings even on success. */
  stderr: string;
};

/**
 * Parses a Trivy JSON output stream into a ScanResult.
 * Exported separately so tests can inject a controlled stream without spawning trivy.
 */
export async function parseScanOutputStream(stream: Readable): Promise<ScanResult> {
  return parseTrivyOutput(stream);
}

/**
 * Runs `trivy image --server <URL> --format json <name>:<tag>` and returns
 * the parsed ScanResult plus raw stderr (callers should log it at debug level).
 *
 * Throws ScanFailedError on any failure: non-zero exit, parse error, or
 * network error reaching the trivy-server.
 */
export async function scan(imageName: string, imageTag: string): Promise<ScanOutput> {
  const imageRef = `${imageName}:${imageTag}`;

  const trivyProcess = execa(
    'trivy',
    ['image', '--server', env.TRIVY_SERVER_URL, '--format', 'json', '--quiet', imageRef],
    { stdout: 'pipe', stderr: 'pipe' },
  );

  try {
    // Parse stdout while the process is still running.
    // Promise.all ensures we await both the parse and the process exit.
    if (!trivyProcess.stdout) throw new Error('trivy process has no stdout pipe');
    const resultPromise = parseScanOutputStream(trivyProcess.stdout);
    const [scanResult, processExecution] = await Promise.all([resultPromise, trivyProcess]);

    return { result: scanResult, stderr: processExecution.stderr ?? '' };
  } catch (err) {
    throw new ScanFailedError(
      imageName,
      imageTag,
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
