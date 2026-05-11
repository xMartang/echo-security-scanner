#!/usr/bin/env node
/**
 * Optional: pre-pulls every scan target image into the local Docker daemon so
 * Trivy's client can find them without hitting Docker Hub on each scan tick.
 *
 * The stack works without running this -- trivy will pull from Docker Hub on
 * demand -- but doing so risks Docker Hub's unauthenticated rate limit
 * (100 req / 6 h per IP) once the scheduler has run a few cycles.
 *
 * Cross-platform: plain ESM, no build step, no extra deps. Runs anywhere Node
 * 18+ is installed (Linux / macOS / Windows / WSL).
 *
 * Run before `docker compose up`, or any time the image list changes:
 *   node scripts/pull-scan-images.mjs
 *
 * Images already present are skipped (no Docker Hub traffic). Failures on a
 * single image do not abort the loop -- every image is attempted; a summary
 * is printed at the end and the script exits non-zero if any pull failed.
 *
 * The image list is the single source of truth in
 * src/bullmq/tasks/scanners/images.ts.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const imagesFile = join(repoRoot, 'src/bullmq/tasks/scanners/images.ts');

let imagesSource;
try {
  imagesSource = readFileSync(imagesFile, 'utf-8');
} catch (err) {
  console.error(`ERROR: cannot read ${imagesFile}: ${err.message}`);
  process.exit(1);
}

// Extract every `{ name: '<name>', tag: '<tag>' }` literal as <name>:<tag>.
const refRegex = /\{\s*name:\s*'([^']+)'\s*,\s*tag:\s*'([^']+)'\s*\}/g;
const refs = [];
for (const match of imagesSource.matchAll(refRegex)) {
  refs.push(`${match[1]}:${match[2]}`);
}

if (refs.length === 0) {
  console.error(`ERROR: no images parsed from ${imagesFile}`);
  process.exit(1);
}

let pulled = 0;
let skipped = 0;
const failed = [];

for (const ref of refs) {
  // docker image inspect <ref> -- exits 0 if present, non-zero otherwise.
  const inspect = spawnSync('docker', ['image', 'inspect', ref], { stdio: 'ignore' });
  if (inspect.status === 0) {
    console.log(`${ref}  already present, skipping`);
    skipped++;
    continue;
  }

  console.log(`pulling ${ref} ...`);
  const pull = spawnSync('docker', ['pull', ref], { stdio: 'inherit' });
  if (pull.status === 0) {
    pulled++;
  } else {
    console.error(`FAILED ${ref}`);
    failed.push(ref);
  }
}

console.log('');
console.log(`Summary: ${pulled} pulled, ${skipped} skipped, ${failed.length} failed`);

if (failed.length > 0) {
  console.log('');
  console.log('Failed images:');
  for (const ref of failed) console.log(`  - ${ref}`);
  process.exit(1);
}
