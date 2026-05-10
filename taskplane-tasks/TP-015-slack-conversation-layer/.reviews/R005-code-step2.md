## Code Review: Step 2: Draft revision/update flow

### Verdict: REVISE

### Summary
The LLM-success path now applies revised proposal text before resending the Slack preview, which addresses the main R004 behavior. `npm run build` passes; no configured typecheck/lint/format-check commands were declared under the review command keys, so no additional static checks were run. One R004 versioning/audit concern remains: pending fallback requests still advance `proposal_version` even though the stored proposal text is unchanged.

### Issues Found
1. **[src/db.ts:790] [important]** — `recordApplicationRevisionRequest` still increments `proposal_version` and records a `v${nextVersion}` audit note for a pending request that does not update `proposal_text`. This means an LLM-unavailable revision can make the database/audit trail claim the current proposal is v2 while the actual proposal is still v1, and the next applied revision becomes v3 even though it is the first changed proposal. Fix by leaving `proposal_version` unchanged for pending requests (or introducing a separate pending request counter/status) and only incrementing proposal version inside `applyApplicationRevision` when `proposal_text` is actually replaced.

### Pattern Violations
- None.

### Test Gaps
- No automated coverage was added for the revision handler's LLM-success, LLM-unavailable fallback, missing-draft, or Slack-preview resend paths.

### Suggestions
- Consider including the current proposal version in `handleSlackConversationCommand` responses once pending requests no longer advance it, so local CLI output is clearer.
