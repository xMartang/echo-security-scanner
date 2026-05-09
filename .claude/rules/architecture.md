# Architectural Rules

## Trivy Client/Server Strategy
- **Mode:** NEVER run Trivy in standalone mode. Always use the `--server` flag pointing to the `trivy-server` container.
- **Command:** `trivy image --server http://trivy-server:8080 --format json [IMAGE]`
- **Failures:** Catch `execa` errors. If Trivy fails (e.g. image not found), update the `Image` status to `FAILED` and log the error. Do not crash the worker.

## Database Schema

### Entities and Relationships

```
Image ──────────────── ImagePackage ──────────────── Package
(name, tag,            (join table)                  (name)
 status, lastScannedAt)                                │
      │                                                │ one-to-many
      │                                          Vulnerability
      │                                    (cveId, severity,
      └──────── ImageVulnerability ─────── description,
                (join table:               installedVersion,
                 installedVersion,         fixedVersion,
                 fixedVersion)             packageId FK)
```

### Relationships
- **Image ↔ Package:** Many-to-many via `ImagePackage` join table. An image ships many packages; a package appears in many images.
- **Package → Vulnerability:** One-to-many. A package can have multiple CVEs, but each CVE belongs to exactly one package (`packageId` FK on `Vulnerability`).
- **Image ↔ Vulnerability:** Many-to-many via `ImageVulnerability` join table. This join table carries `installedVersion` and `fixedVersion` because the same CVE may manifest with different version details per image.

### Idempotency
When a scan finishes, persist results without duplicating data:
1. `upsert` each `Package` by name.
2. `upsert` each `Vulnerability` by `cveId`, connecting it to its `Package`.
3. `upsert` each `ImagePackage` link.
4. `upsert` each `ImageVulnerability` link (update `installedVersion`/`fixedVersion` if changed).
5. Update the `Image` `status` to `SUCCESS` and set `lastScannedAt = now()`.

Never delete and re-insert scan results; always upsert to preserve history and avoid FK violations mid-transaction.

## Dynamic Concurrency BullMQ Scaling (Safety-First)
- **Formula:** `Math.min(imageCount, Math.max(1, Math.floor(os.availableParallelism() / 2)))`
- **Logic:**
  1. Use half of the available CPU cores to keep the system responsive for API requests and DB operations.
  2. Never exceed the actual number of tasks (images) in the batch.
  3. Minimum of 1 worker to ensure progress is always made.
- **Reasoning:** Trivy scans are CPU-intensive; this prevents CPU starvation of the main Express thread and the Postgres/Redis containers.