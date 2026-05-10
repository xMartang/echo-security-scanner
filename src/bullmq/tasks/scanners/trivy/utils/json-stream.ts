import { createRequire } from 'node:module';
import type { Readable, Transform } from 'node:stream';
import type { Severity } from '@prisma/client';
import type { ScanResult, ScanResultPackage, ScanResultVulnerability } from '@/bullmq/tasks/scanners/trivy/types/scan-result.js';

// CJS interop â€” stream-json does not ship ESM exports.
const require = createRequire(import.meta.url);
const { parser: createParser } = require('stream-json') as { parser: () => Transform };
const { pick: createPick } = require('stream-json/filters/Pick') as {
  pick: (opts: { filter: RegExp }) => Transform;
};
const { streamArray: createStreamArray } = require('stream-json/streamers/StreamArray') as {
  streamArray: () => Transform;
};

// Raw Trivy output types (not exported â€” only used inside this module)
type TrivyPackage = { Name: string; Version?: string };
type TrivyVulnerability = {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Severity: string;
  Title?: string;
  Description?: string;
};
type TrivyResult = {
  Target: string;
  Class?: string;
  Type?: string;
  Packages?: TrivyPackage[];
  Vulnerabilities?: TrivyVulnerability[];
};

const KNOWN_SEVERITIES = new Set<string>(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);

function normalizeSeverity(raw: string | undefined): Severity {
  const upper = raw?.toUpperCase() ?? '';
  return KNOWN_SEVERITIES.has(upper) ? (upper as Severity) : 'UNKNOWN';
}

/**
 * Streams and parses Trivy JSON output into a flat ScanResult.
 *
 * Trivy emits a single JSON object:
 *   { SchemaVersion, ArtifactName, Results: [{ Target, Packages?, Vulnerabilities? }] }
 *
 * The Results array can contain multiple targets (OS packages, Go binaries,
 * npm packages, etc.). This function accumulates packages and vulnerabilities
 * across all Result objects without buffering the full output.
 *
 * Pipeline: source â†’ parser() â†’ pick(/^Results$/) â†’ streamArray()
 */
export async function parseTrivyOutput(source: Readable): Promise<ScanResult> {
  const packages: ScanResultPackage[] = [];
  const vulnerabilities: ScanResultVulnerability[] = [];

  const jsonParser = createParser();
  const pickFilter = createPick({ filter: /^Results$/ });
  const arrayStream = createStreamArray();

  // Propagate errors through the pipeline â€” .pipe() does not forward errors.
  const destroyDownstream = (err: Error) => {
    pickFilter.destroy(err);
    arrayStream.destroy(err);
  };
  source.on('error', (err: Error) => {
    jsonParser.destroy(err);
    destroyDownstream(err);
  });
  jsonParser.on('error', destroyDownstream);
  pickFilter.on('error', (err: Error) => arrayStream.destroy(err));

  source.pipe(jsonParser).pipe(pickFilter).pipe(arrayStream);

  for await (const item of arrayStream as AsyncIterable<{ key: number; value: TrivyResult }>) {
    const trivyResult = item.value;

    for (const pkg of trivyResult.Packages ?? []) {
      if (pkg.Name) packages.push({ name: pkg.Name });
    }

    for (const vuln of trivyResult.Vulnerabilities ?? []) {
      vulnerabilities.push({
        cveId: vuln.VulnerabilityID,
        severity: normalizeSeverity(vuln.Severity),
        description: vuln.Title ?? vuln.Description,
        packageName: vuln.PkgName,
        installedVersion: vuln.InstalledVersion,
        fixedVersion: vuln.FixedVersion,
      });
    }
  }

  return { packages, vulnerabilities };
}
