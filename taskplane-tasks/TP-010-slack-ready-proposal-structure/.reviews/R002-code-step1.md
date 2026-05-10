## Code Review: Step 1: Structured proposal draft types

### Verdict: APPROVE

### Summary
The change adds the requested structured proposal draft types with all required section fields and browser-fill notes while keeping the existing `proposalText` field intact. `structuredProposal` is optional on `ApplicationDraft`, which preserves compatibility for existing stored drafts and current generation/storage code. No configured typecheck/lint/format-check commands were present; I ran the step's targeted `npm run build`, and it passed.

### Issues Found
None.

### Pattern Violations
- None.

### Test Gaps
- None for this type-only step.

### Suggestions
- In later steps, consider persisting `structuredProposal` explicitly if Slack previews or browser handoff need to reload it from the DB rather than only using in-memory drafts.
