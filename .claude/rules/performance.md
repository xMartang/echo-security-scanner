# Performance & The Event Loop

## The Event Loop Guard
- **CLI Calls:** Use `execa` (Promise-based `child_process`) to run the Trivy CLI. This is I/O-bound and won't block the loop.
- **JSON Parsing:** Trivy JSON output can be huge. If parsing `JSON.parse(result.stdout)` takes >100ms, use a Worker Thread for the parsing logic to keep the main thread responsive for other BullMQ jobs.

## BullMQ Flow
- Create a `SchedulerService` that adds 10 individual jobs to the queue every 15 minutes.
- Do not process all 10 images in one single job; treat each image as its own unit of work.