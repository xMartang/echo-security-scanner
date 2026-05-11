# Echo Security Scanner

A background service that periodically scans 10 fixed container images for CVE vulnerabilities using [Trivy](https://github.com/aquasecurity/trivy), persists results in PostgreSQL via Prisma, and exposes a REST API built with Express.

---

## Architecture overview

```
+------------------+                   +------------------+
|   Express API    |                   |  Trivy server    |
|     :3000        |                   |     :8080        |
+--------+---------+                   +--------^---------+
         |                                      |
         | (read)                               |
         v                            +---------+---------+
   PostgreSQL :5432 <--- (write) ---  |  BullMQ service  |
                                      |  (scan + cleanup) |
                        Redis :6379 --+                   |
                                      +-------------------+
```

The system is split into two independently deployable services:

- **API service** (`src/api/`): serves the REST endpoints with read-only DB queries. Has no knowledge of Redis, BullMQ, or Trivy.
- **BullMQ service** (`src/bullmq/`): general-purpose task runner. Currently runs two tasks:
  - **Trivy scanner** (`tasks/scanners/trivy/`): scans images on a configurable interval; each image is a separate sandboxed job. Writes results to PostgreSQL.
  - **Stale-vuln-cleanup job** (`tasks/stale-vuln-cleanup/`): runs weekly and hard-deletes `ImageVulnerability` rows older than 30 days (see [CVE staleness](#cve-staleness) below).
- **Trivy server**: runs in server mode and holds the vuln database. The BullMQ worker runs the trivy client (`trivy image --server`); the client still needs to read the target image locally to extract its package list, so the host docker socket is mounted into the bullmq container too (see [Security trade-offs](#security-trade-offs)).
- **PostgreSQL** + **Prisma**: stores images, CVEs, packages, and join tables. The database is the only contract between API and BullMQ.
- **Redis**: BullMQ job queue and scheduler backend (BullMQ service only).

---

## Database schema

```mermaid
erDiagram
    Image {
        int id PK
        string name
        string tag
        ScanStatus status
        datetime lastScannedAt
        string lastError
    }
    Package {
        int id PK
        string name
    }
    Cve {
        int id PK
        string cveId
        Severity severity
        string description
    }
    ImagePackage {
        int imageId FK
        int packageId FK
    }
    ImageVulnerability {
        int imageId FK
        int cveId FK
        int packageId FK
        string installedVersion
        string fixedVersion
        datetime firstSeenAt
        datetime lastSeenAt
    }

    Image ||--o{ ImagePackage : "contains"
    Package ||--o{ ImagePackage : "found in"
    Image ||--o{ ImageVulnerability : "has"
    Cve ||--o{ ImageVulnerability : "affects"
    Package ||--o{ ImageVulnerability : "via"
```

`firstSeenAt` and `lastSeenAt` on `ImageVulnerability` drive the staleness filter — see [CVE staleness](#cve-staleness).

---

## Prerequisites

| Tool | Min version | Install |
|---|---|---|
| Docker + Docker Compose | 29.x | [docker.com](https://docker.com) |
| Node.js | 24.x | [nodejs.org](https://nodejs.org) or `fnm install 24` |
| pnpm | 11.x | `npm install -g pnpm` |

---

## Quick start

### 1. Clone and prepare

```bash
git clone <repo>
cd echo-security-scanner

# Copy and review environment defaults
cp .env.example .env
```

### 2. Start the full stack

```bash
docker compose up --build -d
```

> **First run:** Trivy downloads its vulnerability database (~several hundred MB) before becoming healthy.
> The `bullmq` service waits until Trivy is ready (`start_period: 5m`).
> Subsequent starts reuse the `trivy_cache` volume and are fast (~seconds).

### 3. Verify all five services are healthy

```bash
docker compose ps
```

Expected — all five STATUS values should show `(healthy)`:

```
NAME       STATUS
api        Up ... (healthy)
bullmq     Up ... (healthy)
postgres   Up ... (healthy)
redis      Up ... (healthy)
trivy      Up ... (healthy)
```

### 4. Wait for the first scan batch

The BullMQ service enqueues all 10 images on startup via the scheduler tick. Each scan takes 10-60 s depending on Trivy's cache state.

```bash
# Poll until at least one image shows SUCCESS
watch -n 5 'curl -s http://localhost:3000/api/images | jq "[.data[] | {name,tag,status}]"'
```

---

## Optional: pre-pull scan target images

Trivy's client/server split means the **client** (bullmq) downloads each image locally and extracts its package list, then sends only the package list to the server for CVE lookup. If the image is not already in the host Docker daemon, trivy falls back to pulling it from Docker Hub.

This is fine for a one-off run, but if the scheduler ticks many times before the images are cached you can hit Docker Hub's unauthenticated rate limit (100 req / 6 h per IP), after which scans fail with `TOOMANYREQUESTS` until the window resets.

You can avoid this by pre-pulling every target image into the host daemon once:

```bash
bash scripts/pull-scan-images.sh
```

Run this any time you change `src/bullmq/tasks/scanners/images.ts`. Images already present are skipped, so re-running is safe and cheap.

---

## API endpoints

All responses use the envelope `{ data: T }` on success and `{ error: { message, code? } }` on failure.

### `GET /health`

Overall health of the API, including DB connectivity and scanner staleness (time since last successful scan).

```bash
curl -s http://localhost:3000/health | jq
```

```json
{
  "data": {
    "db": "ok",
    "scanner": {
      "status": "ok",
      "lastScannedAt": "2026-05-11T02:52:23.700Z",
      "staleThresholdMs": 300000
    },
    "status": "ok"
  }
}
```

- `db`: result of a lightweight DB ping.
- `scanner.status`: `"ok"` if at least one image has been scanned within `staleThresholdMs`, `"stale"` otherwise.
- `scanner.lastScannedAt`: timestamp of the most recent successful scan across all images.
- `status`: overall status (`"ok"` only if both `db` and `scanner.status` are `"ok"`).

Returns **200** if healthy, **503** if degraded.

---

### `GET /api/images`

All scanned images with CVE counts grouped by severity.

```bash
curl -s http://localhost:3000/api/images | jq '.data[0]'
```

```json
{
  "id": 3,
  "name": "nginx",
  "tag": "1.19",
  "status": "SUCCESS",
  "lastScannedAt": "2026-05-11T02:55:22.970Z",
  "lastError": null,
  "createdAt": "2026-05-11T00:01:22.450Z",
  "updatedAt": "2026-05-11T02:55:24.858Z",
  "cveCountBySeverity": {
    "CRITICAL": 42,
    "HIGH": 149,
    "MEDIUM": 193,
    "LOW": 31,
    "UNKNOWN": 9,
    "total": 424
  }
}
```

CVE counts reflect only **currently active** vulnerabilities (see [CVE staleness](#cve-staleness)).

---

### `GET /api/images/:name/:tag/cves`

CVEs found in a specific image. Optional `?severity=` filter.

```bash
# All CVEs for nginx:1.19
curl -s "http://localhost:3000/api/images/nginx/1.19/cves" | jq '.data | length'

# Only CRITICAL CVEs
curl -s "http://localhost:3000/api/images/nginx/1.19/cves?severity=CRITICAL" | jq '.data[0]'
```

```json
{
  "cveId": "CVE-2018-25009",
  "severity": "CRITICAL",
  "description": "libwebp: out-of-bounds read in WebPMuxCreateInternal",
  "packageName": "libwebp6",
  "installedVersion": "0.6.1-2",
  "fixedVersion": "0.6.1-2+deb10u1",
  "firstSeenAt": "2026-05-11T00:03:07.637Z",
  "lastSeenAt": "2026-05-11T02:55:22.970Z"
}
```

- `firstSeenAt`: first scan that detected this CVE on this image.
- `lastSeenAt`: most recent scan that confirmed it. Patched CVEs are filtered out via `lastSeenAt >= image.lastScannedAt`.

Valid `severity` values: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`.

Returns **404** if the image has never been scanned. Returns **400** for invalid severity.

---

### `GET /api/cves`

All unique CVEs that are currently active on at least one image. Optional `?severity=` filter.

```bash
curl -s "http://localhost:3000/api/cves?severity=CRITICAL" | jq '.data[0]'
```

```json
{
  "id": 927,
  "cveId": "CVE-2018-25009",
  "severity": "CRITICAL",
  "description": "libwebp: out-of-bounds read in WebPMuxCreateInternal"
}
```

---

### `GET /api/cves/:cveId/images`

All images currently affected by a specific CVE, with the installed and fixed version per image.

```bash
curl -s "http://localhost:3000/api/cves/CVE-2018-25009/images" | jq '.data[0]'
```

```json
{
  "image": {
    "id": 3,
    "name": "nginx",
    "tag": "1.19",
    "status": "SUCCESS",
    "lastScannedAt": "2026-05-11T02:55:22.970Z",
    "lastError": null,
    "createdAt": "2026-05-11T00:01:22.450Z",
    "updatedAt": "2026-05-11T02:55:24.858Z"
  },
  "packageName": "libwebp6",
  "installedVersion": "0.6.1-2",
  "fixedVersion": "0.6.1-2+deb10u1"
}
```

Returns an empty array if the CVE exists in the database but no image currently has it active (e.g. it was patched in every image since the last scan).

---

## Log tailing

Each service writes logs to its own subfolder under `./logs/`. Level files receive that level **and above**:

| File | Contents |
|---|---|
| `logs/api/api.debug.log` | All API log records (debug+) -- current file |
| `logs/api/api.debug.log.1` | Previous rotated file (older = higher number) |
| `logs/api/api.info.log` | Info, warn, error, fatal |
| `logs/api/api.error.log` | Error and fatal only |
| `logs/bullmq/bullmq.debug.log` | BullMQ main process: scheduler ticks, stale-vuln-cleanup job, startup/shutdown |
| `logs/bullmq/trivy-scanner.debug.log` | Sandboxed scan processors: per-image scan results, ingestion steps |
| `logs/postgres/postgres-YYYY-MM-DD.log` | Postgres server logs |
| `logs/redis/redis.log` | Redis server logs |
| `logs/trivy/trivy.log` | Trivy server logs |

```bash
# Stream info logs from the API (no suffix = current file)
tail -f logs/api/api.info.log | jq

# Stream all BullMQ records (scheduler ticks, stale-vuln-cleanup, startup)
tail -f logs/bullmq/bullmq.debug.log | jq .msg

# Stream per-image scan progress and results
tail -f logs/bullmq/trivy-scanner.debug.log | jq '{image: .image, msg: .msg}'

# Infrastructure logs
tail -f logs/redis/redis.log
tail -f logs/trivy/trivy.log

# Or via Docker
docker compose logs -f redis
docker compose logs -f trivy
```

Timestamps are ISO-8601 strings (`"time":"2026-05-10T12:00:00.000Z"`).

---

## Running tests

### Unit tests -- no Docker required

```bash
pnpm install
pnpm test --testPathPattern="unit"
```

### Integration tests -- requires Docker (testcontainers)

```bash
pnpm test --testPathPattern="integration"
```

### Full suite

```bash
pnpm test
```

Tests run sequentially (`--runInBand`) to avoid resource contention between multiple testcontainers instances.

### CI on pull requests

The same suite (`pnpm lint && pnpm typecheck && pnpm test`) runs in GitHub Actions on PRs, but **only when the PR carries the `RUN_CI` label**. This keeps CI minutes off draft / WIP PRs.

To trigger the workflow, add the `RUN_CI` label to your PR — the run kicks off immediately. Subsequent pushes to the same PR re-run the workflow automatically as long as the label is still attached.

Branch protection on `main` requires the `test` check to pass, so a PR with no `RUN_CI` label (or a failing check) cannot be merged.

---

## Development

```bash
# Start only infrastructure
docker compose up postgres redis trivy-server -d

# API in watch mode (auto-reloads on save)
pnpm dev

# BullMQ worker in watch mode
pnpm dev:worker
```

> **Local dev:** update `DATABASE_URL`, `REDIS_URL`, and `TRIVY_SERVER_URL` in `.env` to use `localhost` instead of the Docker container hostnames.

---

## Stopping

```bash
# Stop and preserve data volumes
docker compose down

# Stop and remove all data
docker compose down -v
```

---

## Rule deviations

| Rule file | Original | Deviation | Reason |
|---|---|---|---|
| `architecture.md` | `cveId @unique`, single `packageId` FK on Vulnerability | Normalized: `Cve(cveId @unique)` + `Package` + `ImageVulnerability(imageId, cveId, packageId)` | Same CVE can affect multiple packages -- original schema causes upsert collisions on real Trivy output |
| `performance.md` | Worker Thread if `JSON.parse` > 100ms | `stream-json` streaming always | Streaming bounds memory and never blocks the event loop; Worker Thread overhead unjustified |
| Compose service name | `worker` | Renamed `bullmq` | "worker" overloaded with BullMQ `Worker` class and Node.js Worker Threads |

---

## Security trade-offs

### Docker socket mounted on the bullmq container

`docker-compose.yml` mounts `/var/run/docker.sock` into the `bullmq` container with `group_add: ["0"]` so the non-root `nodeapp` user can talk to the host Docker daemon. This is required because the Trivy client (running inside `bullmq`) inspects each target image locally to extract its package list before sending the list to the trivy server.

The trade-off: anything that can talk to the docker socket can effectively run as root on the host (start privileged containers, mount host paths, etc.). For a local dev / take-home setup this is acceptable; for production you would normally either:

- pre-build images and ship them via a private registry that trivy server can fetch directly, removing the need for the client to inspect images, or
- use a rootless docker context, or
- isolate scanning in a dedicated VM / namespace.

If you do not need local image caching, you can remove both the socket mount and `group_add: ["0"]` from the `bullmq` service; trivy will then pull every target image from Docker Hub on every scan tick and hit the unauthenticated rate limit (100 req / 6 h).

---

## CVE staleness

The scanner uses an upsert-only persistence approach -- it never deletes CVE records. Instead, every scan updates `ImageVulnerability.lastSeenAt` to `now()` for each CVE it finds. The same timestamp is also written to `Image.lastScannedAt` at the end of the scan.

**API filtering:** all vulnerability queries apply the filter `lastSeenAt >= lastScannedAt`. This means:
- CVEs confirmed by the latest scan: `lastSeenAt === lastScannedAt` -> **included**
- CVEs no longer found (patched, withdrawn, reclassified): `lastSeenAt < lastScannedAt` -> **excluded**

Stale rows are preserved in the database as audit data -- `firstSeenAt` records when a CVE was first detected, and `lastSeenAt` records when it was last confirmed. This is useful for understanding exposure windows.

**Weekly stale-vuln-cleanup job:** a separate BullMQ repeatable job runs every 7 days and hard-deletes `ImageVulnerability` rows where `lastSeenAt < now() - 30 days`. This is purely operational -- preventing unbounded table growth. It does NOT affect the staleness logic above. Only `ImageVulnerability` rows are deleted; `Cve` and `Package` rows (reference data) are never touched.

---

## Adding a new task or scanner

Tasks live under `src/bullmq/tasks/`. Each task module exports a `TaskConfig` (see `src/bullmq/tasks/task.types.ts`).

**To add a new scanner** (e.g. Grype):
1. Create `src/bullmq/tasks/scanners/grype/` alongside `trivy/`
2. Implement `scan-image.job.ts`, `scanner.service.ts`, `scheduler-tick.job.ts` following the Trivy pattern
3. Export a `TaskConfig` from `index.ts`
4. Import it in `src/bullmq/services/scheduler.service.ts` and add a `upsertJobScheduler` + `Worker` registration

**To add an unrelated background task** (e.g. report generation):
1. Create `src/bullmq/tasks/<name>/` alongside `stale-vuln-cleanup/`
2. Implement the processor function
3. Export a `TaskConfig` from `index.ts`
4. Register it in `scheduler.service.ts`

The scheduler does NOT auto-discover tasks -- adding a new task requires one import in `scheduler.service.ts`.

---

## Notable implementation decisions

- **Sandboxed BullMQ processors**: each scan job forks a child process. Crash-isolates Trivy and stream-json failures at the cost of one extra process per concurrent job.
- **Unique jobIds with wall-clock timestamp** (`scan__nginx__1.19__<ts>`): BullMQ v5 forbids `:` in custom jobIds. The timestamp is captured at tick invocation time (not stored in the scheduler template) so each batch produces distinct jobIds, preventing BullMQ from deduplicating new jobs against completed ones.
- **Sequential test execution** (`--runInBand`): three integration test suites each start testcontainers (Postgres and/or Redis). Parallel execution exhausts resources on typical dev machines.
- **Cumulative log routing**: `debug.log` receives all levels; `info.log` receives info and above; `error.log` receives error and fatal only -- so operators can grep debug.log for the full picture or error.log for just failures.
- **Separate log files per process type**: the main BullMQ process writes to `bullmq.*.log`; sandboxed scan processors write to `trivy-scanner.*.log`. This avoids concurrent multi-process writes to the same rotating log file.
- **`prisma` in production deps**: `prisma migrate deploy` runs on API startup so the CLI must be present in the production image.
