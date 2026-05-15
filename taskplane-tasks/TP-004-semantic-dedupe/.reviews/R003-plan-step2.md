## Plan Review: Step 2: Integrate dedupe into fetch pipeline

### Verdict: APPROVE

### Summary
The Step 2 plan covers the required outcomes: replacing exact-ID-only fetch dedupe with exact ID plus conservative near-duplicate similarity, deterministic strongest/latest selection, and observable dedupe counts. It also correctly leaves persisted seen-job fingerprint suppression to Step 3, so this step remains appropriately scoped to same-batch fetch results.

### Issues Found
None.

### Missing Items
- None.

### Suggestions
- Preserve the existing failed-source behavior in `fetchAllFeeds`, especially the single-source fallback that expands one failed source into `SEARCH_QUERIES`.
- When logging counts by source, make sure the source dimension is stable despite jobs being flattened after source fetches; `sourceName` and/or `sourceQuery` are both reasonable as long as the log makes the distinction clear.
