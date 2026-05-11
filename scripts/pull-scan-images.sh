#!/usr/bin/env bash
#
# Optional: pre-pulls every scan target image into the local Docker daemon so
# Trivy's client can find them without hitting Docker Hub on each scan tick.
#
# The stack works without running this -- trivy will pull from Docker Hub on
# demand -- but doing so risks Docker Hub's unauthenticated rate limit
# (100 req / 6 h per IP) once the scheduler has run a few cycles.
#
# Run before `docker compose up`, or any time the image list changes:
#   bash scripts/pull-scan-images.sh
#
# Images already present are skipped (no Docker Hub traffic). Failures on a
# single image do not abort the loop -- every image is attempted; a summary is
# printed at the end and the script exits non-zero if any pull failed.
#
# The image list is the single source of truth in
# src/bullmq/tasks/scanners/images.ts.

set -uo pipefail

# Resolve repo root from the script's location -- works regardless of CWD.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGES_FILE="$REPO_ROOT/src/bullmq/tasks/scanners/images.ts"

if [[ ! -f "$IMAGES_FILE" ]]; then
  echo "ERROR: $IMAGES_FILE not found" >&2
  exit 1
fi

# Extract `{ name: '<name>', tag: '<tag>' }` lines as `<name>:<tag>` refs.
mapfile -t refs < <(
  grep -oE "\{ name: '[^']+', tag: '[^']+' \}" "$IMAGES_FILE" \
    | sed -E "s/\{ name: '([^']+)', tag: '([^']+)' \}/\1:\2/"
)

if [[ ${#refs[@]} -eq 0 ]]; then
  echo "ERROR: no images parsed from $IMAGES_FILE" >&2
  exit 1
fi

pulled=0
skipped=0
failed=0
failed_refs=()

for ref in "${refs[@]}"; do
  if docker image inspect "$ref" > /dev/null 2>&1; then
    echo "$ref  already present, skipping"
    skipped=$((skipped + 1))
    continue
  fi

  echo "pulling $ref ..."
  if docker pull "$ref"; then
    pulled=$((pulled + 1))
  else
    echo "FAILED $ref" >&2
    failed=$((failed + 1))
    failed_refs+=("$ref")
  fi
done

echo ""
echo "Summary: $pulled pulled, $skipped skipped, $failed failed"

if (( failed > 0 )); then
  echo ""
  echo "Failed images:"
  for ref in "${failed_refs[@]}"; do
    echo "  - $ref"
  done
  exit 1
fi
