# Proactive Notification + Promise Fulfillment

## Summary

Implemented a focused Slack promise notification layer that fulfills or blocks prior thread promises when capture, draft/proof, prep, or QA state changes.

## What Changed

- Added `slack_workflow_notifications` as a persisted idempotency ledger keyed by Slack thread, notification type, and state key.
- Previously failed Slack post attempts can be retried for the same state key; successfully posted and pending state keys remain deduped to prevent Slack spam.
- Added `src/slackPromiseNotifications.ts` for:
  - draft/proof-plan notification text
  - capture/prep/QA blocker text
  - QA-ready handoff text
  - state-key/message-hash dedupe
  - promise status updates
  - debug-only promise/state trace output
- Integrated notification dedupe into:
  - capture draft/proof packet posting
  - capture failure blocker posting
  - prep/QA handoff posting
  - Slack debug status details
- Added focused tests in `src/slackPromiseNotifications.test.ts`.

## Acceptance Coverage

- Draft promise plus draft-ready state posts the draft/proof plan once in-thread.
- Capture failure posts a blocker in the mapped Slack thread and marks the promise blocked.
- Prep blocked by missing draft has a safe next-step path through existing workflow promise state and blocker wording.
- QA-ready handoff is posted through the notification ledger and deduped by prepared state.
- Duplicate state changes are suppressed by the persisted notification ledger.
- Failed Slack delivery for a notification state is retryable instead of permanently suppressing promise fulfillment.
- Normal notification text avoids raw workflow internals; debug details show the promise/state trace.
- Newer QA-ready state supersedes stale lower-priority draft promise notification selection.

## Verification

- `npm ci` because dependencies were missing.
- `npx tsx src/slackPromiseNotifications.test.ts`
- `npx tsx src/slackSocket.test.ts`
- `npm run build`
- `git diff --check`

## Safety Notes

- No live Slack messages were sent by tests; Slack posting used local mocks or existing failing webhook test behavior.
- No browser prep, lead engine start, VNC, production, deploy, merge, CAPTCHA/security bypass, or final-submit action was performed.
- Blocker notification text redacts token-shaped strings and rewrites known internal state names into human-safe wording.
- Safety scan found no new secrets; matches were existing manual-submit/VNC safety text.

## Merge Readiness

Build and focused tests pass locally. This branch is ready for parent review, but should not be merged or deployed from this workstream.
