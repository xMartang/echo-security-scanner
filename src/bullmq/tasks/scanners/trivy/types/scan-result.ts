import type { Severity } from '@prisma/client';

export type ScanResultPackage = {
  name: string;
};

export type ScanResultVulnerability = {
  cveId: string;
  severity: Severity;
  description?: string;
  packageName: string;
  installedVersion: string;
  fixedVersion?: string;
};

export type ScanResult = {
  packages: ScanResultPackage[];
  vulnerabilities: ScanResultVulnerability[];
};
