## Plan Review: Step 2: Scheduler loop

### Verdict: REVISE

### Summary
The available Step 2 plan covers the broad deliverables: scheduler module, pipeline/browser/health jobs, npm script, and build validation. However, it does not explicitly cover the key scheduler correctness requirement from PROMPT.md: configured 5–10 minute execution without overlapping long-running jobs or preventing graceful shutdown.

### Issues Found
1. **[Severity: important]** — The plan should explicitly address shutdown/non-overlap behavior for the scheduler loop. This is central to the step requirement (“without blocking shutdown”) and is easy to regress with timer/cron callbacks that keep running while `SIGINT`/`SIGTERM` closes the DB. Add an outcome covering graceful stop semantics, e.g. no new jobs start after shutdown begins, in-flight jobs are awaited or safely abandoned before `closeDb()`, and repeated ticks do not start overlapping copies of the same job.

### Missing Items
- Explicit scheduler interval/config outcome: ensure the scheduler runs on a configurable cadence in the required 5–10 minute range (or validates/normalizes the configured value) rather than relying on an unspecified default.
- Explicit browser-worker gating outcome: browser queue processing should only run when `BROWSER_WORKER_ENABLED` is enabled, matching the task requirement.

### Suggestions
- Consider recording scheduler job starts/success/failure through the Step 1 heartbeat helper so Step 3 health reporting can consume real heartbeat data without rework.
