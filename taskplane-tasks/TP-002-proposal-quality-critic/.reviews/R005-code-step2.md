## Code Review: Step 2: Integrate critic into proposal drafts and Slack

### Verdict: APPROVE

### Summary
The implementation attaches deterministic proposal quality output to newly generated drafts and displays the score, top issues, and positive signals in Slack job packets. Optional/missing profile fields used by draft generation are guarded, and `npm run build` passes.

### Issues Found
None.

### Pattern Violations
- None.

### Test Gaps
- No automated coverage was added for Slack rendering of the proposal quality section or for draft generation with partially missing profile fields; current behavior was reviewed statically and by build/typecheck only.

### Suggestions
- Consider persisting `proposalQuality` in the applications table in a later step if historical draft review/reporting should include critic output after the Slack message is sent.
