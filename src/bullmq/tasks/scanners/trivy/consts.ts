/**
 * Constants shared across the trivy scanner task module and any caller outside
 * this directory that needs to refer to the same BullMQ identifiers.
 *
 * Add here only when a value is used by more than one file.
 */

export const LOGGER_SERVICE_NAME = 'trivy-scanner';

/** BullMQ queue that holds per-image scan jobs processed by the trivy worker. */
export const SCAN_QUEUE_NAME = 'image-scan';

/** BullMQ queue that holds the recurring scheduler-tick job (enqueues scans). */
export const SCHEDULER_QUEUE_NAME = 'image-scheduler';

/** Scheduler ID for the upsertJobScheduler call that fans out per-image scans. */
export const SCAN_ALL_IMAGES_JOB_ID = 'scan-all-images';
