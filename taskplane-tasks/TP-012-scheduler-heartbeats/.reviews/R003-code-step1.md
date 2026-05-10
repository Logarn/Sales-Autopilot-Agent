## Code Review: Step 1: Heartbeat schema and helpers

### Verdict: APPROVE

### Summary
The Step 1 implementation satisfies the approved plan: it adds an idempotently-created `worker_heartbeats` table with the required fields and exposes write/read/list/stale helpers via `src/heartbeat.ts`. I ran `npm run build` successfully; the project does not declare separate review-targeted `typecheck`, `lint`, or `format:check` commands in the taskplane config/package scripts.

### Issues Found
None.

### Pattern Violations
- None found.

### Test Gaps
- No automated heartbeat helper tests were added, so future changes could regress counter increments, metadata parsing defaults, or stale-boundary behavior. This is not blocking for this step because the task only required targeted build validation.

### Suggestions
- Consider documenting in the later scheduler step whether `runCount` is meant to increment per heartbeat write or per completed scheduler run, since the current helper increments on every status update (`starting`, `running`, `success`, or `error`).
