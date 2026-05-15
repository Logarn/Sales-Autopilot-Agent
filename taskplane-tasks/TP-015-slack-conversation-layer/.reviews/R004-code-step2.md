## Code Review: Step 2: Draft revision/update flow

### Verdict: REVISE

### Summary
The DB migration/audit pieces compile and the local command now records revision requests safely for missing-LLM fallback. However, the configured-LLM path never actually applies a revision to the stored proposal, and the Slack preview resend therefore shows the unchanged draft while advertising it as revised. I ran `npm run build`, which passed; no typecheck/lint/format-check commands were declared under the configured review keys.

### Issues Found
1. **[src/slackConversation.ts:107] [important]** — The LLM-available branch does not use the LLM or update `applications.proposal_text`; it only appends a note saying a hook is available. Step 2 explicitly requires applying the revision with LLM when available, falling back to storing the request when not. Fix by invoking the existing LLM provider (or equivalent draft-regeneration service) when available, persist the revised proposal text/version/audit event, and only use `recordApplicationRevisionRequest` as the disabled/unavailable fallback.
2. **[src/db.ts:584] [important]** — Revision handling increments `proposal_version` without changing `proposal_text`, and `maybeSendRevisionPreview` then rebuilds Slack blocks from the unchanged stored draft. This creates a misleading “revised proposal packet ready” Slack message containing the old proposal. Fix by separating pending revision requests from applied proposal versions, or by updating `proposal_text` in the same transaction before incrementing the version and resending the preview.

### Pattern Violations
- None beyond the behavioral issues above.

### Test Gaps
- No automated coverage was added for `handleSlackConversationCommand` covering LLM-available success, LLM-unavailable fallback, missing draft, and Slack preview resend behavior.

### Suggestions
- Consider including the pending revision instruction in fallback Slack output if no revised proposal text is available yet, so reviewers can see what was requested.
