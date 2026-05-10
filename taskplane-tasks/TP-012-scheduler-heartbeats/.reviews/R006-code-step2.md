## Code Review: Step 2: Scheduler loop

### Verdict: REVISE

### Summary
The scheduler module covers the intended jobs, heartbeats, browser-worker gating, and `npm run build` passes. However, the production scheduler timer is unref'd, so `npm run scheduler` can exit after the initial tick instead of continuing to run every 5–10 minutes, which breaks the core scheduler-loop requirement. No typecheck/lint/format-check commands were configured in taskplane or package scripts; I ran the task's build command and it passed.

### Issues Found
1. **[src/scheduler.ts:81-84] [important]** — `timer.unref?.()` means the interval timeout will not keep the Node process alive. Since `startScheduler()` resolves after scheduling the next tick and the CLI entrypoint does not await a never-ending promise, `node dist/scheduler.js` can terminate once startup and the initial tick complete, so it will not autonomously run every 5–10 minutes. Fix by keeping the scheduler timer referenced in CLI mode (remove `unref()`), or have the entrypoint await a lifecycle promise that remains pending until `stopScheduler()` is called while still clearing the timer on shutdown.

### Pattern Violations
- None beyond the blocking lifecycle issue above.

### Test Gaps
- Add/perform a lightweight scheduler lifecycle check that verifies scheduler mode remains alive after the first tick and schedules a subsequent tick, ideally with a shortened interval in a controlled test/harness.

### Suggestions
- Consider calling `validateRequiredConfig()` from scheduler mode as the worker mode does, so missing required runtime configuration fails fast before entering the loop.
