## Code Review: Step 1: Conversation intent model

### Verdict: APPROVE

### Summary
The Step 1 changes add the requested intent types, deterministic parser, and local CLI entry point without introducing Slack credential requirements. I found no blocking behavioral issues; `npm run build` passes, and representative local CLI parses for approve/revise work. No configured typecheck/lint/format-check commands were available under the review policy (`build` is configured but not as a matching static-check key), so I additionally ran the project build for this step requirement.

### Issues Found
None.

### Pattern Violations
- None.

### Test Gaps
- Parser behavior is currently only manually exercised via the CLI; later work would benefit from unit coverage for synonyms, missing job IDs, application ID aliases, and instruction extraction edge cases.

### Suggestions
- Consider avoiding the `src/db.ts` import in `src/slackConversation.ts` for the parser-only CLI, since it opens/migrates the SQLite DB even though parsing does not need persistence.
- Consider whether phrases like “send to apply queue” should classify as `enqueue_browser_apply` rather than `approve`, depending on the intended distinction in later steps.
