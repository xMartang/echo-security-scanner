# Docker Orchestration Rules

## Service Connectivity
- **trivy-server:** Must expose port 8080 to the internal Docker network.
- **worker:** Must wait for `trivy-server` to be healthy before starting scans.

## The Docker Socket Strategy
- **Option A (Shared Socket):** Mount `/var/run/docker.sock` to **both** the Worker and the Trivy Server. This allows the Server to pull and scan images directly from the host's daemon.
- **Permissions:** Ensure the containers run as a user with access to the socket (often `root` for home assignments, but acknowledge the security trade-off in the README).