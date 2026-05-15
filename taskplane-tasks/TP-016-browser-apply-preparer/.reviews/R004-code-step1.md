## Code Review: Step 1: Apply preparation plan model

### Verdict: APPROVE

### Summary
The R003 blocker is addressed: apply URLs are now derived from the stored Upwork URL and invalid/non-Upwork links fail closed. The Step 1 service produces a serializable fill plan with approval/proposal/link/connects/attachment guardrails and preserves `stopBeforeSubmit: true`; `npm run build` passes. No configured `typecheck`/`lint`/`format:check` command keys were present, so lint/format static checks were not exercised.

### Issues Found
None.

### Pattern Violations
- None found.

### Test Gaps
- There is still no automated coverage for `buildBrowserApplyPlan()` edge cases such as manual job IDs with Upwork URLs, invalid links, private/missing attachments, and Connects clamping/caps. This is not blocking for Step 1, but should be added when the CLI/testing path is introduced.

### Suggestions
- Consider exporting the URL/connects helpers only if future tests need focused unit coverage; otherwise keeping the service API small is fine.
