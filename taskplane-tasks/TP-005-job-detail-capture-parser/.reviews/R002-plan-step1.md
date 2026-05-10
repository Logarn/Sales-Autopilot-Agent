## Plan Review: Step 1: Parser module and types

### Verdict: APPROVE

### Summary
The revised Step 1 plan addresses the prior R001 gap by defining a pure `src/jobCapture.ts` parser API, typed output, URL/job-ID handling, field coverage, conservative missing-field behavior, and build validation. It aligns well with the existing manual job ingestion shape in `src/sources/manualSource.ts`, which should make Step 2's create/update workflow feasible.

### Issues Found
None.

### Missing Items
- None.

### Suggestions
- When implementing, keep parsed metadata separate from the generated `manualJob` defaults so Step 2 can print accurate “missing/not visible” capture details without confusing them with pipeline-safe fallback values.
