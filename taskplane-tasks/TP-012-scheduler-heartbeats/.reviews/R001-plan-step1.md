## Plan Review: Step 1: Heartbeat schema and helpers

### Verdict: REVISE

### Summary
The available Step 1 plan is only the three STATUS checkboxes, which are less specific than the task prompt itself. It does not show how the heartbeat schema will satisfy the required fields or how the helper API will support stale-worker detection needed by later health checks and Slack alerts.

### Issues Found
1. **[Severity: important]** — `STATUS.md:20-24` reduces the Step 1 requirements from `PROMPT.md:66-69` to generic “Add heartbeat table” / “Add helper functions.” Revise the plan to explicitly cover the required heartbeat fields (`worker`, `status`, `lastRunAt`, `lastSuccessAt`, run counts, error summary, metadata JSON) and the intended helper outcomes: write/upsert, read/list, and stale-heartbeat query using a configurable threshold.
2. **[Severity: important]** — The plan does not address compatibility and data-shape risks for the new table/helpers. Add a brief outcome covering idempotent table creation/migration in the existing `src/db.ts` pattern, stable timestamp storage, JSON metadata serialization/parsing, and safe defaults when optional error/metadata values are absent.

### Missing Items
- Testing intent beyond “Build passes”: include at least lightweight validation of helper behavior, such as exercising write/read/stale logic against the SQLite DB or documenting why only the build is possible for this step.

### Suggestions
- Consider defining shared TypeScript types for heartbeat status/records in `src/heartbeat.ts` so Step 2 scheduler jobs and Step 3 health reporting use the same contract.
