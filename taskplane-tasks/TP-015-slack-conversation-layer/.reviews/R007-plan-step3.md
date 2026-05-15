## Plan Review: Step 3: Approval/browser queue handoff

### Verdict: REVISE

### Summary
The plan covers the core Step 3 bullets for approve/reject status updates, optional browser queueing, inbound Slack placeholders, and build verification. However, it leaves out the remaining command handoff statuses that are already in the task mission and Step 1 intent model, most notably `mark_applied` and `mark_replied`, and it does not explicitly include handling the standalone `enqueue_browser_apply` intent.

### Issues Found
1. **[Severity: important]** — The plan does not cover implementing the `mark_applied` and `mark_replied` command handlers. The task mission requires Slack commands to “mark applied/replied,” Step 1 already added those intents, and there is no later implementation step dedicated to wiring them to DB status updates. Add this outcome to Step 3 so local conversation handling can update applications to `applied` / `replied` rather than only parse those intents.
2. **[Severity: important]** — The plan only mentions browser queueing as optional after approval, but Step 1 added an explicit `enqueue_browser_apply` intent and the mission includes enqueueing browser actions. Add a plan item to handle the standalone enqueue command as well as the approve-with-enqueue path, using the existing browser queue action conventions and without auto-submitting proposals.

### Missing Items
- Explicit outcome for `mark_applied` / `mark_replied` status command handling.
- Explicit outcome for handling standalone `enqueue_browser_apply` commands, not just approve/reject side effects.

### Suggestions
- Include CLI response expectations for approve/reject/mark/enqueue outcomes, since Step 5 will need local command verification without Slack credentials.
