## Code Review: Step 1: Slack packet structure improvements

### Verdict: REVISE

### Summary
The packet content/order is substantially improved and `npm run build` passes. However, the implementation still violates Slack's total block-count limit in the existing multi-job notification path, so normal cycles with more than three jobs and generated drafts can fail to send instead of delivering the polished V0 packet.

### Issues Found
1. **[src/slack.ts:365] [important]** — The batched notification path appends `buildJobBlocks()` for up to 10 jobs, but each drafted job now emits about 14 blocks; Slack messages are limited to 50 blocks. A cycle with 4+ drafted jobs can exceed the limit (2 header blocks + 4×14 = 58), causing webhook sends to fail/queue and breaking the requirement to preserve existing notifications while handling Slack block limits. Fix by enforcing a message-level block budget: send fewer full proposal packets per message, split across multiple webhook messages, or use a compact summary block for batched jobs and reserve the full packet for individual/preview sends.

### Pattern Violations
- None beyond the block-limit issue above.

### Test Gaps
- Add a lightweight assertion/inspection for the `sorted.length > 3` path to verify generated Slack payloads stay within Slack's 50-block message limit.

### Suggestions
- The project has no configured `typecheck`, `lint`, or `format:check` command in `.pi/taskplane-config.json` or `package.json`; I ran the task-required `npm run build`, and it passed.
