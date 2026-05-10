## Plan Review: Step 1: Parser module and types

### Verdict: REVISE

### Summary
I could not find an implementation plan for Step 1 in the review request, STATUS.md, or the task folder. The task requirements are clear, but without the worker's proposed approach I cannot verify that the parser module and types will cover the required extraction surface, conservative fallbacks, and build verification.

### Issues Found
1. **[Severity: important]** — No Step 1 plan was provided to review. Please provide a plan describing the intended parser inputs/outputs, the fields and fallbacks to support, how URL/job ID handling will be represented for later CLI integration, and the targeted build check.

### Missing Items
- Plan for `src/jobCapture.ts` public types/API and how it will remain pure/testable.
- Plan for extracting all required fields from pasted Upwork job-detail text, including client/activity fields when present and conservative missing-field behavior.
- Plan for validating the parser against the beauty-brand-style pasted example and running `npm run build`.

### Suggestions
- Consider aligning output types with the existing manual job shape in `src/manual.ts` / `src/sources/manualSource.ts` so Step 2 can add create/update behavior without reshaping parsed data.
