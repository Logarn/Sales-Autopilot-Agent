## Plan Review: Step 3: Slack/browser readiness

### Verdict: REVISE

### Summary
I can see the Step 3 outcome checklist in STATUS.md, but no implementation plan was included in the review request or task files for this specific planning review. The checklist names the required outcomes, but it does not describe how the worker will ensure Slack displays the structured sections compactly while preserving the final cover-letter text for the critic and browser-fill handoff.

### Issues Found
1. **[Severity: important]** — No Step 3 implementation plan was provided to review. Please add a short plan that covers the Slack packet rendering changes, browser-fill note contents, and the critic input path so the review can confirm the step will meet PROMPT.md's requirements without regressing the Step 1/2 structured draft behavior.

### Missing Items
- Plan should state that Slack rendering uses the structured proposal fields compactly but preserves/falls back to `proposalText` for the approved cover-letter text.
- Plan should state how browser-fill notes will include approved text, profile, rate, attachments/highlights, and Connects plan.
- Plan should state how the proposal critic will continue evaluating the final cover-letter text rather than Slack formatting or notes.

### Suggestions
- Include a quick build check (`npm run build`) in the plan, as required by the step checklist.
