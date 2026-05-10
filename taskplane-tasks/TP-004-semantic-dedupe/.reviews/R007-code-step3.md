## Code Review: Step 3: Persist fingerprints for seen jobs

### Verdict: APPROVE

### Summary
The implementation adds a backward-compatible nullable `seen_jobs.fingerprint` column, indexes it, stores newly seen job fingerprints, and checks stored fingerprints before scoring/notifying future jobs. I ran `npm run build` successfully; no configured typecheck/lint/format-check commands matching the reviewer quality-check keys were present.

### Issues Found
None.

### Pattern Violations
- None.

### Test Gaps
- No blocking gaps for this step. The final verification step should still cover the end-to-end build/test status as planned.

### Suggestions
- `rowToJobPosting` reconstructs `sourceQuery` as `"seen_jobs"` (`src/db.ts:333`), so fallback similarity comparisons lose the original source-query signal and become slightly stricter than same-source comparisons. Exact fingerprint matches still work; consider persisting/reconstructing the original source query in a future enhancement if near-repost suppression proves too conservative.
