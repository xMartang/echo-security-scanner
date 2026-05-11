/**
 * Optional: pre-pulls every scan target image into the local Docker daemon so
 * Trivy's client can find them without hitting Docker Hub on each scan tick.
 *
 * The stack works without running this -- trivy will pull from Docker Hub on
 * demand -- but doing so risks Docker Hub's unauthenticated rate limit
 * (100 req / 6 h per IP) once the scheduler has run a few cycles.
 *
 * Run before `docker compose up`, or any time the image list changes:
 *   pnpm pull-images
 *
 * Images already present are skipped (no Docker Hub traffic).
 * Failures on a single image (bad tag, rate limit, transient network) do not
 * abort the loop -- every image is attempted; a summary is printed at the end
 * and the script exits non-zero if any pull failed.
 *
 * The image list is the single source of truth in src/bullmq/tasks/scanners/images.ts.
 */

import { execFileSync } from 'node:child_process';
import { IMAGES } from '../src/bullmq/tasks/scanners/images.js';

type Outcome = 'pulled' | 'skipped' | 'failed';
const results = new Map<string, { outcome: Outcome; error?: string }>();

for (const { name, tag } of IMAGES) {
  const ref = `${name}:${tag}`;

  // Check if image is already in the local daemon before hitting Docker Hub.
  try {
    execFileSync('docker', ['image', 'inspect', ref], { stdio: 'ignore' });
    console.log(`${ref}  already present, skipping`);
    results.set(ref, { outcome: 'skipped' });
    continue;
  } catch {
    // not present — fall through to pull
  }

  console.log(`pulling ${ref} ...`);
  try {
    execFileSync('docker', ['pull', ref], { stdio: 'inherit' });
    results.set(ref, { outcome: 'pulled' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`FAILED ${ref}: ${message}`);
    results.set(ref, { outcome: 'failed', error: message });
  }
}

// Summary
const counts = { pulled: 0, skipped: 0, failed: 0 };
for (const { outcome } of results.values()) counts[outcome]++;

console.log('');
console.log(`Summary: ${counts.pulled} pulled, ${counts.skipped} skipped, ${counts.failed} failed`);

if (counts.failed > 0) {
  console.log('');
  console.log('Failed images:');
  for (const [ref, { outcome }] of results) {
    if (outcome === 'failed') console.log(`  - ${ref}`);
  }
  process.exit(1);
}
