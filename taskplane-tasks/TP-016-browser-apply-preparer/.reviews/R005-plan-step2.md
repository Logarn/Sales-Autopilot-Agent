## Plan Review: Step 2: Browser apply worker path

### Verdict: REVISE

### Summary
The plan covers the core worker path, validation-before-browser guardrails, security-state pausing, and no-submit behavior. However, it has a blocking artifact/privacy ambiguity: it says dry-run should log/save the full fill plan, while this step requires minimized diagnostics only.

### Issues Found
1. **[Severity: important]** — Proposed change #1 says dry-run should “log/save the fill plan,” but `BrowserApplyFillPlan` contains the full cover letter and attachment file paths. This conflicts with the Step 2 requirement to save minimized diagnostics only. Revise the plan so Step 2 artifacts/status store only minimized metadata (action id, job id, URL, state, attempted/skipped field names or counts, validation issue codes, stop-before-submit), not the full proposal text or attachment paths. Full dry-run preview output can be handled in Step 3 if required.
2. **[Severity: important]** — The enabled-mode fill plan only names cover letter, rate, and Connects/boost helpers, but the task mission also includes allowed highlights/attachments “where practical.” Revise the plan to either safely attempt those using allowed plan instructions when selectors/file inputs are clearly available, or explicitly record them as skipped/manual with minimized diagnostics. They should not be silently ignored.

### Missing Items
- A clear statement that supplied `payload.applyPlan` is treated as untrusted/stale enough to re-check blocking validation errors before browser navigation, especially when it contains `validationIssues` with `severity: "error"`.

### Suggestions
- Consider making dry-run artifacts store lengths/hashes/counts for sensitive fields rather than values, so operators can debug without leaking proposal content.
