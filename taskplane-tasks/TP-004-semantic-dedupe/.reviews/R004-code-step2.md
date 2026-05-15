## Code Review: Step 2: Integrate dedupe into fetch pipeline

### Verdict: REVISE

### Summary
The fetch pipeline now calls the semantic dedupe utility and preserves the existing failed-feed fallback behavior. `npm run build` passes. However, exact-ID duplicates are currently discarded before the strongest/latest selection heuristic is applied, so Step 2's deterministic candidate-retention requirement is not met for exact duplicates.

### Issues Found
1. **[src/dedupe.ts:127] [important]** — `dedupeJobsBySimilarity` increments `exactDuplicates` and `continue`s when a repeated `job.id` is seen, which keeps whichever duplicate appeared first rather than the strongest/latest candidate. Step 2 requires keeping the strongest/latest duplicate candidate deterministically; fix by exact-collapsing through a `Map<id, JobPosting>` that replaces the stored entry with `chooseStrongerJob(existing, job)`, then run near-duplicate matching over those exact-collapsed jobs.

### Pattern Violations
- None.

### Test Gaps
- Add/adjust coverage for two jobs with the same `id` where the later duplicate has a newer `postedAt` or richer fields; the deduped output should retain that stronger/latest job while still counting one exact duplicate.

### Suggestions
- The current source log is input counts by `sourceQuery`, not actual dedupe removals by source. If the checkbox is intended as operational observability, consider logging before/after counts or removed duplicate counts per source as well.
