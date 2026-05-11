# Autonomous Upwork Agent V3 Implementation Plan

## Context

V3 shifts the product from terminal/copy-paste workflows to a Slack-controlled autonomous assistant. Sales users should not paste job descriptions or copy proposals into Upwork. The agent should discover/capture jobs through the browser, score them, draft a proposal packet, support Slack review/revision/approval, prepare the Upwork application draft in a persistent browser session, and stop before final submit for human review.

Safety boundaries remain non-negotiable:

- Never submit proposals or click final Submit/Send Proposal.
- Never automate Upwork login, 2FA, CAPTCHA, Cloudflare, or verification challenges.
- Pause and alert once if browser session needs manual attention.
- Use visible browser for live browser actions.
- Keep `stopBeforeSubmit=true` enforced in code.
- Process one live browser action at a time.
- Use slow discovery cadence with 8–14 minute jitter and no retry loops after challenges.

Current repo note: the working tree currently contains local V2/V3-prep changes around browser session state, queue retry, health, scheduler, Playwright config, and one fresh manual job. Before implementation begins, either commit/stash these changes or confirm they are the intended baseline.

## Approach

Build V3 in thin vertical slices that can be tested end-to-end without enabling final submit. Start with Slack Socket Mode command center because it removes terminal dependency and becomes the control plane for all later browser/search workflows. Then add browser job capture from URL, then packet/action UX, then browser-fill refinement and revisions/refill, then scheduled discovery, then VM hardening.

The implementation should reuse the existing scoring/proposal/proof/Connects/browser queue/scheduler foundation instead of replacing it. New modules should mainly orchestrate these existing pieces and add Slack inbound state/thread tracking.

## Workstreams

### 1. Slack Socket Mode command center

**Goal:** Sales team controls everything from Slack, no terminal.

**Capabilities**

- Receive Slack messages, slash commands, button/action payloads, and thread replies via Socket Mode.
- Parse Upwork URLs in messages and enqueue browser job capture.
- Support intents/buttons:
  - capture URL
  - approve
  - reject
  - revise
  - prepare browser draft
  - retry paused browser action
  - mark submitted / mark replied
  - status/readiness
- Keep each opportunity in a Slack thread.
- Persist Slack channel/thread/message IDs so updates land in the same thread.

**Recommended files/modules**

- Add `src/slackSocket.ts` or `src/slackApp.ts`.
- Add `src/slackActions.ts` for interactive action routing.
- Extend `src/slackConversation.ts` for V3 intents and URL parsing.
- Extend `src/db.ts` with Slack thread/message mapping table.
- Extend `src/config.ts` for `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, Socket Mode flags, allowed channel IDs.
- `package.json`: add `slack:socket` script and dependencies if needed (`@slack/bolt`).

**Reuse**

- `src/slackConversation.ts` intent parser/revision handling.
- `src/slack.ts` block formatting and webhook send patterns, but interactive Slack should use Web API rather than only incoming webhook.
- `src/db.ts` application status/event helpers.
- `src/browserQueue.ts` retry/enqueue logic.

### 2. Browser job capture from URL

**Goal:** Given a Slack-posted Upwork URL, the agent opens the job in persistent browser, extracts details, creates/updates job record, scores, drafts, and posts packet.

**Capabilities**

- Validate URL is Upwork job URL.
- Open visible or controlled persistent browser context.
- Detect login/security/challenge and trigger manual-attention state.
- Extract title, description, skills, client details, connects, proposal count, job type, budget/rate, duration, screening questions where visible.
- Normalize into `JobPosting`/opportunity packet.
- Upsert into `seen_jobs`; generate application draft.
- Include Upwork job URL in every proposal packet and draft context.

**Recommended files/modules**

- Add `src/browserJobCapture.ts`.
- Extend `src/browserQueue.ts`/types with `capture_job_from_url` action.
- Extend `src/types.ts` for captured job details/questions.
- Extend `src/db.ts` with fields/table for application questions if needed.
- Potentially reuse/refactor parser in `src/jobCapture.ts` for browser page text.

**Reuse**

- `src/jobCapture.ts` parse logic for pasted detail text; adapt to browser text.
- `src/normalization.ts` deterministic/LLM normalization.
- `src/filter.ts`, `src/scoring.ts`, `src/agent.ts` for scoring/proposal.
- `src/dedupe.ts` and `isJobFingerprintSeen` for duplicate handling.
- `src/browserSession.ts` challenge state.

### 3. Slack packet V3

**Goal:** One Slack packet/thread is the opportunity control surface.

**Packet contents**

- Upwork job URL prominently.
- Fit score and score components.
- Reasons and risks.
- Connects plan.
- Proposal draft.
- Application questions and proposed answers.
- Proof/attachment recommendations.
- Browser draft status/action ID.
- Buttons: Approve, Reject, Revise, Prepare Draft, Retry, Mark Submitted.

**Recommended files/modules**

- Extend `src/slack.ts` block builder or add `src/slackPacketV3.ts`.
- Add/update DB Slack thread mapping.
- Extend `src/types.ts` for packet state and button action IDs.

**Reuse**

- `buildJobBlocks` and proposal packet sections in `src/slack.ts`.
- `getScoredJobForSlackPreview` in `src/db.ts`.
- Existing application draft/proposal quality fields.

### 4. Challenge-aware session recovery

**Goal:** Browser automation pauses cleanly without spamming Steve.

**Capabilities**

- Durable browser session state: `healthy`, `manual_attention_required`, `cooling_down`, `disabled_until_manual_retry`, `browser_session_unhealthy`.
- On challenge/sign-in/blocked page:
  - mark manual attention required
  - pause current action
  - stop further browser worker/search processing
  - store URL/title/job/action/reason
  - send one Slack alert with cooldown
  - show retry command/button
- Alert cooldown default 45–60 minutes.
- Too-many-challenges guard: more than 2 in 60 minutes marks session unhealthy.

**Recommended files/modules**

- Continue/complete `src/browserSession.ts`.
- Integrate with `src/browserWorker.ts`, `src/browserSearch.ts`, `src/scheduler.ts`, `src/health.ts`.
- Add Slack interactive retry button through Socket Mode.

**Reuse**

- Current `recordBrowserManualAttention`, `getBrowserSessionStatus`, retry command groundwork.
- Existing `health_alerts` table and `sendHealthAlert`/`sendSlackMessage` patterns.

### 5. Browser-fill v1

**Goal:** Prepare the Upwork application page without final submit.

**Capabilities**

- Open application URL from job URL.
- Verify `stopBeforeSubmit=true`; fail closed otherwise.
- Fill cover letter.
- Fill screening answers based on captured questions/answers.
- Fill hourly rate/bid if known and safe.
- Recommend or attach safe portfolio items.
- Select highlights where safely identifiable.
- If any required field is not confidently filled, pause and report.
- Keep page open for human review when possible.
- Send Slack `draft ready for review` alert with filled/missing fields.

**Recommended files/modules**

- Refine `src/browserWorker.ts` field selectors and diagnostics.
- Extend `src/browserApply.ts` plan to include explicit screening answer mappings and attachment safety decisions.
- Extend `src/types.ts` for `BrowserApplyQuestionAnswer` and fill result details.
- Possibly add `src/browserSelectors.ts` for testable selector strategies.

**Reuse**

- `buildBrowserApplyPlan` in `src/browserApply.ts`.
- Existing queue action `prepare_application_review`.
- Existing diagnostics/artifacts in `src/browserWorker.ts`.
- Portfolio safety from `profile/portfolio.json` and attachment guardrails.

### 6. Slack revision to proposal/browser refill

**Goal:** Slack thread revisions update the stored proposal and prepared browser draft.

**Capabilities**

- User replies in thread: “make this less senior”, “mention EMAIL FLOW”, etc.
- LLM revises proposal while preserving facts/safety rules.
- Packet updates in same Slack thread.
- If browser draft already prepared, enqueue a `refill_application_review` or rerun prepare action to update fields.
- Keep final submit untouched.

**Recommended files/modules**

- Extend `src/slackConversation.ts` revision intents to thread-aware context.
- Add `src/slackThreadState.ts` or DB helpers for thread-to-job mapping.
- Extend `src/browserQueue.ts` with refill/reprepare semantics.
- Extend `src/browserWorker.ts` to clear/refill known fields safely.

**Reuse**

- `applyApplicationRevision` and `recordApplicationRevisionRequest` in `src/db.ts`.
- `OpenAiCompatibleProvider` in `src/llm/provider.ts`.
- Existing Slack preview resend path.

### 7. Safe job discovery

**Goal:** Agent discovers opportunities automatically without aggressive polling.

**Capabilities**

- Saved search / best-match pages in persistent browser.
- 8–14 minute jittered cadence.
- No overlapping browser search runs.
- Dedupe exact/near duplicates.
- Capture qualifying job pages.
- Score and post Slack packets above threshold.
- Pause immediately when browser session needs manual attention.

**Recommended files/modules**

- Extend `src/browserSearch.ts`.
- Extend `src/scheduler.ts` for jittered per-job scheduling instead of fixed shared interval for browser tasks.
- Use/extend `src/dedupe.ts`.
- Add search run lock/state if needed.
- Config in `src/config.ts` and `.env.example`.

**Reuse**

- Existing `BrowserSearchConfig`, URL normalization, basic extraction in `src/browserSearch.ts`.
- Existing scheduler no-overlap guard (`runningJobs` set).
- `isJobSeen`, `isJobFingerprintSeen`, `markJobSeen` in `src/db.ts`.

### 8. VM deployment readiness

**Goal:** Run V3 on a VM/cloud host with persistent browser and Slack controls.

**Capabilities**

- Persistent Chrome profile volume.
- noVNC/remote browser access for manual Upwork login/challenges.
- Process supervision for scheduler, Slack Socket Mode app, and worker.
- Health checks/heartbeats.
- Env documentation and safe defaults.
- Manual Upwork login once; pause and alert if session expires.

**Recommended files/modules**

- Update `docs/DEPLOYMENT.md`.
- Add `docker-compose.yml` or process manager docs if not present.
- Add `docs/V3_OPERATIONS.md` runbook.
- Extend `src/health.ts` and readiness output.

**Reuse**

- Existing scheduler/health/heartbeat foundation.
- Existing deployment docs.
- Browser session state/readiness commands.

## Recommended Order

1. **Slack Socket Mode command center MVP** — removes terminal dependency and creates V3 control plane.
2. **Browser job capture from Slack URL** — removes pasted job descriptions.
3. **Slack packet V3 with buttons/thread state** — turns packets into actionable workflow.
4. **Challenge-aware recovery hardening** — finalize anti-spam/manual recovery UX before broader browser usage.
5. **Browser-fill v1 selector/diagnostic improvements** — removes copy proposal into Upwork.
6. **Slack revision/refill loop** — supports real sales review cycles.
7. **Safe scheduled discovery** — turn on autonomous discovery after manual URL flow is stable.
8. **VM deployment readiness** — productionize once browser/session behavior is understood.

## Parallelization

Can be built in parallel after Slack command center contracts are defined:

- Slack packet V3 UI and DB thread mapping.
- Browser job capture extraction/parsing.
- Browser-fill selector improvements.
- VM deployment docs/runbook.

Should not be built in parallel without shared contracts:

- Slack revision/refill depends on Slack thread mapping and browser-fill plan schema.
- Scheduled discovery should wait for challenge-aware guardrails and browser capture stability.

## Risks / Blockers

- Upwork challenge/Cloudflare frequency may limit local browser automation. Mitigation: persistent VM browser, slow cadence, manual recovery, no challenge bypass.
- Selectors may be unstable across Upwork page variants. Mitigation: artifact-driven selector tests, fail-closed, report missing fields.
- Slack Socket Mode requires a Slack app, bot token, app token, event subscriptions, and interactive component configuration.
- Incoming webhooks are insufficient for buttons/threads; Web API/Bolt will be needed.
- Application questions may appear only after clicking Apply or after profile/rate steps; browser capture/fill must support multi-step pages without final submit.
- Existing DB schema is compact; V3 may need new tables for Slack threads, captured questions, browser session events, and packet states.
- Current working tree is not clean; confirm baseline before coding.

## Estimated First Feature to Implement

**First feature:** Slack Socket Mode command center MVP for URL intake and existing action control.

Why first:

- Directly addresses “No terminal use for sales team.”
- Provides the control plane for capture, approval, retry, and revision.
- Can initially reuse existing manual/queue/scoring paths while browser capture is added next.
- Enables interactive retry for challenge recovery.

## First Feature Acceptance Criteria

Slack Socket Mode MVP is complete when:

- A Slack app can run locally/VM via `npm run slack:socket`.
- Posting an Upwork job URL in an allowed channel/thread creates a tracked Slack thread and queues a browser capture action, without requiring terminal input.
- Slack command/button actions work in-thread for:
  - status
  - approve
  - reject
  - revise text instruction
  - prepare browser draft
  - retry paused browser action
  - mark submitted
- All actions write durable application events in DB.
- Replies are posted to the same Slack thread, not as unrelated channel messages.
- If browser session is blocked, Slack shows one manual-attention message with retry button/command and suppresses repeats during cooldown.
- No code path can submit an Upwork proposal; final submit remains impossible in V3.
- `npm run build` passes.
- Existing commands (`browser:readiness`, `browser:list`, `health`) continue to work.

## Verification Plan

For each slice:

- Run `npm run build`.
- Run targeted CLI dry-runs/readiness commands.
- Use dry-run browser worker/search unless explicitly approved for live visible browser testing.
- Use mocked Slack events for parser/action unit tests where possible.
- For live Slack Socket Mode, test in a private channel with a fake Upwork URL first, then a real URL capture with browser dry-run.
- For any live browser action, keep `BROWSER_HEADLESS=false`, `BROWSER_LIVE_ACTION_LIMIT=1`, and `stopBeforeSubmit=true`.
