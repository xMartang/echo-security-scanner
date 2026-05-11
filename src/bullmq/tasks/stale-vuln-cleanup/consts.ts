/**
 * Constants shared across the stale-vuln-cleanup task module and any caller
 * outside this directory that needs to refer to the same BullMQ identifiers.
 */

/** BullMQ queue that holds the recurring stale-vulnerability-cleanup job. */
export const STALE_VULN_CLEANUP_QUEUE_NAME = 'stale-vuln-cleanup';

/** BullMQ job name + scheduler ID for the prune-stale-vulnerabilities cron job. */
export const PRUNE_JOB_NAME = 'prune-stale-vulnerabilities';

/** Milliseconds in a day -- used for retention math and the weekly schedule. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
