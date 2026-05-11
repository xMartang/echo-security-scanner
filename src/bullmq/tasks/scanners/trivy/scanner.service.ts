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

  const trivyProcess = execa('trivy', args, {
    stdout: 'pipe',
    stderr: 'pipe',
    // Don't let execa throw on non-zero exit -- we handle it explicitly below
    // so the trivy error (in stderr) wins over the stream-json "expected a value"
    // parse error that fires when stdout is empty.
    reject: false,
  });

  // Buffer stderr independently so it survives even if the parse promise rejects.
  // The listener attaches synchronously after spawn, before any await.
  let stderrBuffer = '';
  trivyProcess.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString('utf8');
  });

  if (!trivyProcess.stdout) {
    throw new ScanFailedError(imageName, imageTag, new Error('trivy process has no stdout pipe'));
  }

  // Run parse + process to completion regardless of which fails first.
  // allSettled means a parse rejection (empty stdout) does NOT short-circuit
  // away from the real trivy exit code / stderr.
  const [parseSettled, processExecution] = await Promise.allSettled([
    parseScanOutputStream(trivyProcess.stdout),
    trivyProcess,
  ]);

  const exitCode = processExecution.status === 'fulfilled' ? processExecution.value.exitCode : null;

  // Trivy itself failed (non-zero exit). The stream-json parse error -- if any --
  // is a downstream symptom of empty stdout; surface the trivy error instead.
  if (exitCode !== 0) {
    logger.error(
      { image: imageRef, exitCode, trivyStderr: stderrBuffer },
      'trivy scan failed',
    );
    throw new ScanFailedError(
      imageName,
      imageTag,
      new Error(stderrBuffer.trim() || `trivy exited with code ${exitCode ?? 'unknown'}`),
    );
  }

  // Trivy exited 0 but the parser failed -- a real bug in our parser or in
  // trivy's output schema. Surface it as-is.
  if (parseSettled.status === 'rejected') {
    logger.error(
      { image: imageRef, trivyStderr: stderrBuffer },
      'trivy exited 0 but parser failed',
    );
    throw new ScanFailedError(
      imageName,
      imageTag,
      parseSettled.reason instanceof Error ? parseSettled.reason : new Error(String(parseSettled.reason)),
    );
  }

  const scanResult = parseSettled.value;
  logger.debug(
    {
      image: imageRef,
      packages: scanResult.packages.length,
      vulnerabilities: scanResult.vulnerabilities.length,
      exitCode,
    },
    'trivy scan completed',
  );

  return { result: scanResult, stderr: stderrBuffer };
}
