## Code Review: Step 1: Normalized schema

### Verdict: REVISE

### Summary
The prior findings are mostly addressed: `rawTextHash` is now a SHA-256 digest, repair preserves the deterministic URL, and `npm run build` passes. However, the direct-link safety predicate is still too broad, so non-job Upwork `/jobs/...` URLs can be treated as safe and allowed through validation.

### Issues Found
1. **[src/normalization.ts:13] [important]** — `SAFE_UPWORK_JOB_URL` accepts any `https://upwork.com/jobs/...` path, including non-direct URLs such as `https://www.upwork.com/jobs/search?sort=recency` or `https://www.upwork.com/jobs/foo`. Because `repairNormalizedOpportunityPacket()` relies on this predicate to decide whether the deterministic fallback URL is safe, a capture with a search/listing URL can be marked valid even though Step 1 requires rejecting unsafe/missing direct-link data. Tighten the guard to require Upwork's direct job identifier pattern (for example a `/jobs/...~<jobId>` URL, aligned with `deriveJobId()`), or otherwise parse and verify that a concrete job id is present before returning `valid: true`.

### Pattern Violations
- None found.

### Test Gaps
- Add a targeted direct-link guardrail case showing that Upwork `/jobs/search?...` or `/jobs/foo` is rejected while a real `/jobs/...~<id>` direct job URL is accepted.

### Suggestions
- Quality checks: no configured `typecheck`/`lint`/`format:check` command was present in `.pi/taskplane-config.json` or `package.json`; I ran the task-targeted `npm run build`, and it passed.
