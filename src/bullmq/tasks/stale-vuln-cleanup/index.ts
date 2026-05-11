import type { TaskConfig } from '@/bullmq/tasks/task.types.js';
import { STALE_VULN_CLEANUP_QUEUE_NAME, MS_PER_DAY, PRUNE_JOB_NAME } from '@/bullmq/tasks/stale-vuln-cleanup/consts.js';

export const STALE_VULN_CLEANUP_INTERVAL_MS = 7 * MS_PER_DAY;

/**
 * TaskConfig for the weekly stale-vulnerability-cleanup job.
 *
 * Runs once per week and hard-deletes ImageVulnerability rows older than
 * VULNERABILITY_RETENTION_DAYS days (default 30, configurable via env).
 * This is NOT staleness filtering -- the API already excludes stale CVEs via
 * the lastSeenAt >= lastScannedAt filter. This job is purely operational:
 * preventing unbounded table growth over months of continuous scanning.
 */
export const staleVulnCleanupTaskConfig: TaskConfig = {
  queueName: STALE_VULN_CLEANUP_QUEUE_NAME,
  // In-process processor -- no sandboxed child process needed for a simple DB delete.
  processorFilePath: undefined,
  concurrency: 1,
  schedule: {
    jobSchedulerId: PRUNE_JOB_NAME,
    everyMs: STALE_VULN_CLEANUP_INTERVAL_MS,
  },
};
