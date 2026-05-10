## Plan Review: Step 3: Normalization pipeline

### Verdict: REVISE

### Summary
No actual Step 3 implementation plan was included in the review request or recorded in `STATUS.md`; only the high-level task checkboxes are present. I can confirm the step needs to bridge the completed schema/provider work into the scoring/proposal/Slack path and add a testable CLI, but there is not enough planned detail to assess whether fallback behavior, guardrails, and downstream compatibility will be preserved.

### Issues Found
1. **[Severity: important]** — The plan is missing. Please provide an outcome-level Step 3 plan that covers how raw capture text will be normalized through the optional LLM provider, how failures/no-key cases fall back to `buildDeterministicOpportunityPacket`, how repaired packets are converted back into existing `JobPosting`/downstream structures, and how the new CLI command will read a capture file and print safe JSON.

### Missing Items
- Fallback/error behavior for disabled provider, missing key, invalid JSON, provider errors, and invalid repaired packets.
- Integration outcome for feeding existing scoring/proposal/Slack paths without letting LLM output override deterministic connects or unsafe direct-link guardrails.
- CLI behavior expectations: input file path, optional URL/source metadata if needed, JSON output shape, and no secret/raw-key logging.
- Targeted verification intent for build plus no-key fallback CLI execution.

### Suggestions
- Keep the plan focused on outcomes rather than function-by-function edits; the current Step 3 checklist is a good skeleton, but it needs the risk/edge-case handling above before implementation starts.
