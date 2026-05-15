## Code Review: Step 1: Add fingerprinting utilities

### Verdict: APPROVE

### Summary
The new `src/dedupe.ts` provides deterministic normalization, tokenization, fingerprint construction, similarity scoring, and helper selection logic using the required stable job fields without adding embedding/vector dependencies. `npm run build` passes; there are no configured `typecheck`, `lint`, or `format:check` commands in `.pi/taskplane-config.json` or `package.json`, so no additional quality checks were run.

### Issues Found
None.

### Pattern Violations
- None.

### Test Gaps
- No automated coverage was added for normalization/fingerprint stability or near-duplicate thresholds. This is not blocking for the current step, but Step 5 should include representative exact, near, and distinct job examples.

### Suggestions
- In `dedupeJobsBySimilarity`, exact ID duplicates are counted and skipped before `chooseStrongerJob` can run. When Step 2 integrates this, consider replacing the kept exact-ID candidate with `chooseStrongerJob(...)` too, so exact duplicates also honor the task's strongest/latest requirement.
- Consider adding common title filler words such as `need`/`needed` to the stop-word list or relaxing the hard title gate if real reposts are missed by small title wording changes.
