## Plan Review: Step 4: Docs and examples

### Verdict: APPROVE

### Summary
The Step 4 plan covers the required documentation outcomes from the prompt: update `README.md`, update `.env.example`, and add a concrete capture-file normalization example. This is sufficient for a docs/examples step, especially because the previously completed implementation already defines the actual CLI and fallback behavior that the docs need to describe.

### Issues Found
None.

### Missing Items
- None blocking.

### Suggestions
- In the README update, include the exact fallback-safe CLI form shown by the implementation, e.g. `npm run normalize:capture -- --file captures/job-detail.txt --url https://www.upwork.com/jobs/...~<job-id>`, and note that it works without an API key by using deterministic parsing.
- In `.env.example`, group the LLM variables as optional and make clear that leaving `LLM_API_KEY` unset must not break local build/test or normalization fallback.
- Briefly mention that scoring, Connects guardrails, direct-link validation, and proposal/Slack behavior remain deterministic authorities rather than being overridden by LLM output.
