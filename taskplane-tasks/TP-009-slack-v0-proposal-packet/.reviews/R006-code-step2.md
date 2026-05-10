## Code Review: Step 2: Slack preview/test command

### Verdict: REVISE

### Summary
The preview command covers the basic sample/job-id paths and the explicit no-webhook check is clear without exposing the secret. `npm run build` passes; there are no configured typecheck/lint/format-check commands under the reviewer rules, so I used the task's build command as an additional sanity check. One behavior needs fixing before approval: failed preview sends currently enter the normal Slack retry queue.

### Issues Found
1. **[src/slackPreview.ts:116 / src/slack.ts:317] [important]** — `runSlackPreview` sends through `sendSlackMessage`, whose failure path always logs “queueing payload” and persists the payload to `slack_queue`. That means an invalid webhook, Slack outage, or network failure while running `npm run slack:preview -- --sample` can enqueue a synthetic/manual-test packet that may be delivered later by production queue flushing. Fix by adding a non-queueing send path/option for previews (while preserving existing production notification queueing), and fail the preview command clearly on send errors.

### Pattern Violations
- Preview/test sends are coupled to the production Slack retry queue; test payloads should not be persisted for later delivery.

### Test Gaps
- Add/perform a targeted check that a preview send failure with a configured-but-bad webhook exits non-zero and does not insert a row into `slack_queue`.

### Suggestions
- Treat `--job-id` without a value as a usage error instead of silently falling back to `--sample` mode.
