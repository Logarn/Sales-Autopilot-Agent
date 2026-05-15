## Plan Review: Step 3: Persist fingerprints for seen jobs

### Verdict: APPROVE

### Summary
The plan covers the required Step 3 outcomes: adding a backward-compatible nullable `seen_jobs.fingerprint` migration, persisting fingerprints when jobs are marked seen, and using those stored fingerprints to suppress repost notifications. This aligns with the existing migration style in `src/db.ts` and the task’s conservative deterministic dedupe requirements.

### Issues Found
None.

### Missing Items
- None.

### Suggestions
- When implementing the “use stored fingerprints” item, expect a small call-site/API adjustment outside `db.ts` may be needed so the pipeline can check a candidate job’s computed fingerprint before scoring/notifying; the outcome is already covered by the plan.
