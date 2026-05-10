## Code Review: Step 1: Normalized schema

### Verdict: REVISE

### Summary
The previous raw-text leakage issue has been fixed: `rawTextHash` is now a SHA-256 digest and repair keeps the fallback hash. `npm run build` passes, but the repair path still allows an LLM candidate to replace the deterministic job URL with any syntactically safe Upwork job URL, which weakens the direct-link guardrail this step is meant to establish.

### Issues Found
1. **[src/normalization.ts:176] [important]** — `normalizeJob()` accepts `input.job.url` whenever it is non-empty, and the repair guard at lines 178-181 only rejects URLs that fail the Upwork regex. A hallucinated but valid-looking URL for a different Upwork job would survive repair and then be emitted by `normalizedPacketToJobPosting()` at line 224. Because the task requires deterministic validation/guardrails to remain authoritative and Step 1 specifically promises preserved guarded fallback fields, repair should keep `fallback.job.url` unless the candidate exactly matches the deterministic direct link/job id (or otherwise prove equivalence), and should warn when it discards an LLM-provided URL.

### Pattern Violations
- None found.

### Test Gaps
- No targeted assertion exists for the direct-link guardrail: repair should reject a candidate packet whose `job.url` is a different but regex-valid Upwork URL and preserve `fallback.job.url`.

### Suggestions
- Quality checks: no configured `typecheck`/`lint`/`format:check` command was present in `.pi/taskplane-config.json` or `package.json`; I ran the task-targeted `npm run build`, and it passed.
