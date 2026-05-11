/**
 * Pre-pulls every scan target image into the local Docker daemon so Trivy's
 * client can find them without hitting Docker Hub on each scan tick.
 *
 * Run once before `docker compose up` (or any time the image list changes):
 *   pnpm pull-images
 *
 * Images already present are skipped (no Docker Hub traffic).
 * The image list is the single source of truth in src/bullmq/tasks/scanners/images.ts.
 */

import { execFileSync } from 'node:child_process';
import { IMAGES } from '../src/bullmq/tasks/scanners/images.js';

for (const { name, tag } of IMAGES) {
  const ref = `${name}:${tag}`;

  // Check if image is already in the local daemon before hitting Docker Hub.
  try {
    execFileSync('docker', ['image', 'inspect', ref], { stdio: 'ignore' });
    console.log(`${ref}  already present, skipping`);
    continue;
  } catch {
    // not present — fall through to pull
  }

  console.log(`pulling ${ref} ...`);
  execFileSync('docker', ['pull', ref], { stdio: 'inherit' });
}

console.log('done');
