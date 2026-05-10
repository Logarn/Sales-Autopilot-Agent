## Code Review: Step 3: Queue/scheduler integration

### Verdict: APPROVE

### Summary
The Step 3 changes add the browser-search npm/prod commands, wire an optional `browser-search` scheduler job behind `BROWSER_SEARCH_ENABLED`, and persist structured heartbeat metadata for CLI and scheduled runs. Existing pipeline/RSS/Apify execution remains independent because scheduler job failures are isolated in `runJob`, and `npm run build` passes. No configured typecheck/lint/format-check commands were present in `.pi/taskplane-config.json` or `package.json`; I also ran the build as the task's stated verification.

### Issues Found
None.

### Pattern Violations
- None.

### Test Gaps
- None blocking for this step.

### Suggestions
- Consider marking the scheduler heartbeat as `error` when `runBrowserSearch()` returns `summary.errors`, matching the CLI behavior and making operational status more visible than metadata alone.
- If `BROWSER_SEARCH_INTERVAL_MS` is intended to be independently configurable from `SCHEDULER_INTERVAL_MS`, consider adding per-job interval gating in a later scheduler refinement.
