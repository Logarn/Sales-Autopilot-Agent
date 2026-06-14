# Slack Workflow Status Truth + Draft Revision Feedback

Date: 2026-06-14
Branch: `fix/slack-draft-feedback-status-truth`
PR: https://github.com/Logarn/upwork-autonomous-agent/pull/88
Base: `origin/main` at PR #87 deployment lineage

## Summary

Implemented a narrow follow-up for the live PR #87 retest failure where Slack status mixed internal capture reconciliation with user-facing workflow state, repeated draft requests created `slack_preview_vN` spam, negative feedback such as "I don't like the draft" was treated as status or prep approval instead of draft rejection, and `retry capture` after a completed capture reposted the same draft instead of explaining that the draft should be revised or regenerated.

This PR does not deploy anything, does not start the lead engine, does not run browser prep, and does not change final-submit behavior.

## Root Cause

1. `deriveCaptureState()` trusted the latest cancelled/failed capture action before considering that a completed capture and draft already existed for the same canonical job.
2. `buildThreadWorkflowStatusReply()` surfaced internal reconciliation text like "Stale duplicate capture replaced by Slack thread ownership reconciliation" in normal Slack replies.
3. `buildDraftPreviewFromSlackThread()` recorded a new `slack_preview` proposal version every time Steve asked for the draft, even when the draft had not changed.
4. The active CTA approval path could treat rejection language containing prep terms as permission to queue safe browser prep.
5. Draft quality checks banned `just adding noise`, but did not ban internal section labels like `Relevant background:` or `To answer the application notes directly:`.
6. The older voice CTA could still punt to "Send me the store URL..." instead of using the available job context first.

## Files Changed

- `src/slackWorkflowContext.ts`
  - Added draft-rejection detection and internal reconciliation detection.
  - Treats stale duplicate capture cancellation as `done from existing capture` when a completed job/draft exists.
  - Hides internal reconciliation blockers from normal Slack status.
  - Shows rejected drafts as `Draft: needs revision` and blocks prep.

- `src/slackConversationPlanner.ts`
  - Adds `mark_draft_rejected` action.
  - Routes "I don't like the draft", "generic", "not researched", "not in my voice", "rewrite this", "make it better", "this sounds weak", "I don't like this angle", and "do not prep" style messages to revision feedback.
  - Blocks `prep it` when the current draft is rejected.

- `src/slackSocket.ts`
  - Adds deterministic draft rejection handling before active CTA approval.
  - Records rejected draft state in the existing workflow promise ledger.
  - Blocks `queuePrepareDraftFromSlackThread()` when the draft is rejected.
  - Dedupes repeated draft preview requests and stops creating repeated `slack_preview_vN` versions.
  - Normal draft previews no longer expose internal `slack_preview_vN` labels.
  - Changes `retry capture` with completed capture + draft to explain recapture is unnecessary and recommend draft revision/regeneration instead of reposting the draft.

- `src/agent.ts`
  - Rewrites structured client-request answers so internal labels do not leak into proposal copy.
  - Ignores old voice-artifact `store URL` preferred CTAs and uses a job-context-first diagnostic CTA instead.

- `src/skills/proposalCopywritingSkill.ts`
  - Adds `internal_scaffold_labels` critical quality-gate issue.
  - Rejects `Relevant background:`, `To answer the application notes directly:`, `Relevant examples:`, `Additional relevant example:`, `Relevant proof:`, `Approach:`, and `Credentials:` in final cover letters.
  - Adds `store_url_punt_cta` so drafts that punt to "Send me the store URL" are blocked before prep.

- `src/slackConversationPlanner.test.ts`
  - Adds regression tests for reused-capture status truth, negative draft feedback, do-not-prep rejection, and rejected-draft prep blocking.

- `src/slackSocket.test.ts`
  - Adds regression tests for draft preview dedupe and rejected-draft browser-prep blocking.
  - Adds regression coverage for `retry capture` after completed capture + draft so it does not repost the draft body.

- `src/skillRuntime.test.ts`
  - Adds quality-gate coverage for internal scaffold labels and store-URL punt CTAs.

## Workflow Status Truth Changes

Normal Slack status now says the human-readable truth:

- completed capture reused -> `Capture: done from existing capture`
- draft exists but rejected -> `Draft: needs revision`
- proof plan ready remains visible
- prep remains `blocked` until revision/approval
- internal reconciliation details stay out of normal status

Debug paths can still expose technical details when explicitly requested.

## Draft Feedback And Revision Behavior

The following inputs now route to draft rejection/revision handling:

- `I don't like the draft`
- `this is bad`
- `rewrite this`
- `make it better`
- `too generic`
- `this sounds weak`
- `make it more human`
- `not good enough`
- `I don't like this angle`
- `The CV is generic, does not sound researched, and is not in my voice`
- `Stop. Do not prep this draft. I do not approve this version. Wait.`

Expected Slack response:

> Got it — I won’t prep this version. What should I change? I can rewrite it with a sharper customer pain angle, less generic proof, and a more human opener.

After rejection, `prep it` returns a blocker instead of queuing `prepare_application_review`.

## Draft Preview Dedupe

Repeated draft requests now behave as follows:

- First draft preview posts the current draft.
- Repeated `Draft` / `send me the draft` requests do not create a new `slack_preview_vN` version if the text has not changed.
- Repeated requests reply with a short pointer that the current draft was already posted above.
- A new preview version can still be created after an actual revised/generated draft changes the latest proposal version.

## Retry Capture Behavior

When capture is already complete and a draft exists, `retry capture` now replies with the operational truth:

> Capture is already complete. If the issue is the draft, I should regenerate or revise the draft, not recapture the listing. I already posted the current draft above; tell me what to change or say "regenerate draft".

It does not repost the same draft body.

## Draft Quality Gates Added

New critical gate: `internal_scaffold_labels`.

It fails final cover letters containing internal planning labels or stitched answer sections:

- `Relevant background:`
- `To answer the application notes directly:`
- `Relevant examples:`
- `Additional relevant example:`
- `Relevant proof:`
- `Approach:`
- `Credentials:`

Existing gate for `just adding noise` remains active.

New critical gate: `store_url_punt_cta`.

It fails final cover letters that punt to `Send me the store URL...` instead of using available job context first.

## Tests Run

Commands run successfully:

```bash
npm run build
npm run validate:promotion
npm run test:slack-socket
npx tsx src/slackConversationPlanner.test.ts
npx tsx src/skillRuntime.test.ts
git diff --check
```

Focused scan run:

```bash
rg -n "final submit|submitButton|click\\(|captcha|2fa|passkey|secret|token|SLACK_BOT_TOKEN|OPENAI_API_KEY|APIFY_API_TOKEN" \
  src/slackWorkflowContext.ts src/slackConversationPlanner.ts src/slackSocket.ts \
  src/agent.ts src/skills/proposalCopywritingSkill.ts \
  src/slackSocket.test.ts src/slackConversationPlanner.test.ts src/skillRuntime.test.ts
```

Findings:

- No new final-submit automation path was added.
- Existing final-submit manual reminders remain.
- Token references are existing config/test redaction paths.
- No CAPTCHA/security/login/passkey/2FA bypass logic was added.

Live retest result:

- Not run for PR #88 yet. This branch is not deployed. Retest should happen only after review, merge, deploy of merged `origin/main`, and Slack socket restart on production.

## Known Notes

- `npm run validate:promotion` and Slack socket tests emit expected local test warnings when `SLACK_CHANNEL_WEBHOOK_URL` is intentionally not configured in the test harness.
- No production retest has been run for PR #88 yet.
- PR #88 should be reviewed and merged before resuming the PR #87 capture ownership retest or reviewing PR #86.

## Safety Scan

- Lead engine not started.
- Browser prep not run.
- No production services touched.
- PR #24 not touched.
- Final submit remains manual.
- No direct production DB/action queue injection performed.

## Can PR #87 Retest Resume?

Not until PR #88 is reviewed, merged, deployed to production, and Slack socket is restarted on merged `origin/main`.

After that, resume the PR #87 capture ownership retest with the same real Slack flow and verify:

1. Reused capture status is human-readable.
2. Repeated draft requests do not spam versions.
3. Negative draft feedback blocks prep.
4. `retry capture` on completed capture + draft recommends revision/regeneration instead of reposting the draft.
5. `send it` still refuses final submit.

## PR #86 Review Gate

It is not safe to review or merge PR #86 as the next production move until PR #88 is reviewed, merged, deployed, and live-retested. PR #86 improves apply-page analysis, but it does not fix Slack draft feedback/state truth by itself.
