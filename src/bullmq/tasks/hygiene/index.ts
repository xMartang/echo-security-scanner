import type { TaskConfig } from '@/bullmq/tasks/task.types.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * TaskConfig for the weekly storage hygiene job.
 *
 * Runs once per week and hard-deletes ImageVulnerability rows older than 30 days.
 * This is NOT staleness logic -- the API already excludes stale CVEs via the
 * lastSeenAt >= lastScannedAt filter. This job is purely operational: preventing
 * unbounded table growth over months of continuous scanning.
 */
export const hygieneTaskConfig: TaskConfig = {
  queueName: 'hygiene',
  // In-process processor -- no sandboxed child process needed for a simple DB delete.
  processorFilePath: undefined,
  concurrency: 1,
  schedule: {
    jobSchedulerId: 'prune-stale-vulnerabilities',
    everyMs: SEVEN_DAYS_MS,
  },
};
