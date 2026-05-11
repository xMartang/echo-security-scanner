import { execa } from 'execa';
import type { Readable } from 'node:stream';
import { env } from '@/bullmq/config/env.js';
import { createLogger } from '@/common/utils/log/logger.js';
import { ScanFailedError } from '@/common/utils/errors.js';
import { LOGGER_SERVICE_NAME } from '@/bullmq/tasks/scanners/trivy/consts.js';
import { parseTrivyOutput } from '@/bullmq/tasks/scanners/trivy/utils/json-stream.js';
import type { ScanResult } from '@/bullmq/tasks/scanners/trivy/types/scan-result.js';

const logger = createLogger({
  serviceName: LOGGER_SERVICE_NAME,
  dir: env.LOG_DIR,
  level: env.LOG_LEVEL,
});

export type ScanOutput = {
  result: ScanResult;
  /** Raw stderr from the trivy process -- may contain warnings even on success. */
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
  const args = ['image', '--server', env.TRIVY_SERVER_URL, '--scanners', 'vuln', '--format', 'json', '--quiet', imageRef];

  logger.debug({ cmd: `trivy ${args.join(' ')}` }, 'executing trivy scan');

  const trivyProcess = execa('trivy', args, { stdout: 'pipe', stderr: 'pipe' });

  // Buffer stderr independently so it survives even if the parse promise rejects first.
  // Without this, Promise.all races: parse error fires → catch runs → trivyProcess.stderr
  // never resolves → real Trivy error message is permanently lost.
  let stderrBuffer = '';
  trivyProcess.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString('utf8');
  });

  try {
    // Parse stdout while the process is still running.
    // Promise.all ensures we await both the parse and the process exit.
    if (!trivyProcess.stdout) throw new Error('trivy process has no stdout pipe');
    const resultPromise = parseScanOutputStream(trivyProcess.stdout);
    const [scanResult, processExecution] = await Promise.all([resultPromise, trivyProcess]);

    logger.debug(
      {
        image: imageRef,
        packages: scanResult.packages.length,
        vulnerabilities: scanResult.vulnerabilities.length,
        exitCode: processExecution.exitCode,
      },
      'trivy scan completed',
    );

    return { result: scanResult, stderr: processExecution.stderr ?? '' };
  } catch (err) {
    if (stderrBuffer) {
      logger.error({ image: imageRef, trivyStderr: stderrBuffer }, 'trivy stderr on failure');
    }
    throw new ScanFailedError(
      imageName,
      imageTag,
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}
