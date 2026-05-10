## Plan Review: Step 3: Health checks and Slack alerts

### Verdict: REVISE

### Summary
The Step 3 plan covers the core health report, stale-worker Slack alerting, spam avoidance, and build validation. However, it omits a required alert class from PROMPT.md: Slack alerts for auth-required/browser-required states, which are distinct from stale heartbeat detection and already surface through paused browser actions/detected browser states.

### Issues Found
1. **[Severity: important]** — The plan only calls out a stale-worker Slack alert helper and does not cover the required auth-required/browser-required alert states from PROMPT.md. Add an outcome to detect/report paused browser actions or browser-worker errors indicating login/two-factor/captcha/browser-unavailable/dry-run-required states, and route those through the conservative Slack alert path.

### Missing Items
- Explicit coverage for auth-required/browser-required health findings and Slack alerts, not just stale workers.

### Suggestions
- Reuse the heartbeat/status report data model where possible so the health command and scheduled health-check job produce consistent output.
