## Code Review: Step 1: Normalized schema

### Verdict: APPROVE

### Summary
The normalized packet schema covers the required opportunity sections, and the repair path now preserves deterministic guardrails for raw-text hashing, direct job URLs, and connects. `npm run build` passes; no configured `typecheck`/`lint`/`format:check` commands were present under the review policy names.

### Issues Found
None.

### Pattern Violations
- None found.

### Test Gaps
- No automated tests currently cover the normalization repair edge cases, especially alternate LLM URLs and unsafe Upwork `/jobs/...` URLs. This is not blocking for this schema step, but should be added when the normalization pipeline gets tests.

### Suggestions
- Consider preserving the distinction between unknown connects and zero connects in future steps; the current deterministic fallback ultimately maps unknown connects to `0` via the existing `JobPosting` shape.
