# Docker Orchestration Rules

## Services
The compose stack has two application services built from separate Dockerfiles:

- **`api`** — built from `src/api/Dockerfile`. Contains only the Express app; no Trivy binary.
- **`bullmq`** — built from `src/bullmq/Dockerfile`. Contains BullMQ worker + Trivy client. Previously named `scanner`.

## Service Connectivity
- **trivy-server:** Must expose port 8080 to the internal Docker network.
- **bullmq:** Must wait for `trivy-server` to be healthy before starting scans.

## The Docker Socket Strategy
- **Option A (Shared Socket):** Mount `/var/run/docker.sock` to **both** the Scanner and the Trivy Server. This allows the Server to pull and scan images directly from the host's daemon.
- **Permissions:** Ensure the containers run as a user with access to the socket (often `root` for home assignments, but acknowledge the security trade-off in the README).
- The **API container does not need** the Docker socket.