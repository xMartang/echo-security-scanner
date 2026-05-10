/**
 * Contract every task module under tasks/ must satisfy.
 *
 * YAGNI: the scheduler does not auto-discover tasks. Adding a new task requires:
 *   1. Create a module under tasks/ that exports a TaskConfig
 *   2. Import it in scheduler.service.ts and wire it up
 *
 * A new scanner drops in under tasks/scanners/<name>/ as a sibling to trivy/.
 * An unrelated background task drops in under tasks/<name>/ as a sibling to scanners/.
 */
export interface TaskConfig {
  /** Unique BullMQ queue name for this task's jobs. */
  queueName: string;
  /** Absolute path to compiled sandboxed processor (.js). undefined = in-process. */
  processorFilePath?: string;
  /** Max concurrent executions. */
  concurrency: number;
  /** Recurring schedule. undefined = ad-hoc / enqueued externally. */
  schedule?: {
    jobSchedulerId: string; // stable ID for upsertJobScheduler
    everyMs: number;
  };
}
