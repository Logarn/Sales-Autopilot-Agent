# Upwork Agent — Handoff

## Product vision

Upwork Agent is a Slack-controlled Upwork application assistant, not an RSS notifier and not an uncontrolled auto-apply bot.

The goal is an 80% autonomous workflow:

1. A cloud/VM agent logs into Upwork through a persistent browser session.
2. It searches for relevant jobs every 5–10 minutes.
3. It captures job details and apply-page data.
4. It normalizes messy Upwork data into a structured opportunity packet, optionally using an LLM.
5. It scores the job against Steve's profile, proof, Connects rules, and red flags.
6. It drafts a proposal in Steve's voice.
7. It sends a clean Slack proposal packet.
8. Steve approves, rejects, or asks for edits.
9. After approval, the browser worker prepares the Upwork application.
10. The system stops before final submit unless a future explicit submit-after-approval mode is enabled.
11. Outcomes are tracked so the system learns what gets replies, interviews, and hires.

Core principle:

> Find better jobs, write better proposals, spend Connects intelligently, and keep the human in control where judgment matters.

No web UI is planned. Slack is the preferred control surface.

## Safety and platform guardrails

The agent must not:

- bypass CAPTCHA, Cloudflare, 2FA, passkey prompts, password pages, or security checks
- automate manual-check or CAPTCHA pages
- store plaintext Upwork passwords
- auto-submit proposals without explicit approved mode
- click final Send Proposal / Submit buttons
- spend Connects automatically without an approved future mode
- bid max automatically
- attach private/internal files
- commit `.env`, `.env.local`, API keys, tokens, secrets, browser profile data, screenshots, temp files, or `.pi/taskplane.json`
- commit binary proof/client assets under `profile/attachments/*.pdf` unless explicitly approved
- push directly to `main`
- force-push unless explicitly approved for a recovery operation
- use MCP
- add `browser-use`
- touch Safari
- use OS-level mouse/keyboard automation
- call Playwright `bringToFront()`
- run `browser:worker` live unless explicitly approved
- start the scheduler unless explicitly approved
- touch apply/submit behavior unless explicitly approved

Allowed browser automation is Chrome/CDP/Playwright-style page DOM interaction only, within the existing safety guards.

Preferred browser model:

- run on a VM/cloud host
- use a persistent browser profile/user data directory
- Steve logs into Upwork manually once inside the VM browser
- agent reuses that session
- if login/2FA/CAPTCHA appears, agent pauses and alerts Slack

## Repository state

Repo path:

```txt
/Users/admin/upwork-rss-reader
```

Product has been renamed in code/docs to:

```txt
Upwork Agent
```

Package name:

```txt
upwork-agent
```

Main branch contains the latest integrated work.

Canonical handoff rule:

```txt
HANDOFF.md is the only canonical product/dev handoff.
Do not create or restore TRUE_NORTH.md as a second competing handoff.
If older stashed TRUE_NORTH content is useful, merge it into HANDOFF.md only.
```

Latest clean GitHub release:

```txt
PR #1: Ship autonomous Upwork agent foundation
Merged: 2026-05-16
Merge commit: d085ed16de28ac91f95e9a4c098cc5c1dff2dfac
Local main: synced to origin/main at d085ed1
```

PR #1 was squash-merged after cleanup. It intentionally excludes Pi/taskplane runtime history, `.pi/taskplane.json`, browser profile data, temp/session HTML, screenshots, and binary proof PDFs. The remote release branch was deleted after merge. The local backup branch remains:

```txt
backup/local-main-before-clean-pr
```

A local stash also remains for uncommitted browser/profile-mode WIP that was not included in PR #1:

```txt
stash@{0}: On main: pre-clean-pr-uncommitted-wip
```

Known uncommitted local file usually present:

```txt
.pi/taskplane.json
```

This is Taskplane runtime metadata, not app code.

## Implemented capabilities

### 1. Job sources and ingestion

Implemented source abstraction:

```txt
src/sources/
  apifySource.ts
  manualSource.ts
  types.ts
  index.ts
```

Current sources:

- Apify source
- manual job source
- browser/search foundation
- pasted job detail capture

RSS/Apify are no longer treated as the desired backbone. They are fallbacks.

### 2. Manual job ingestion

Manual jobs live in:

```txt
config/manual-jobs.json
```

Command:

```bash
npm run add:manual-job -- --url <url> --title <title> --description <text>
```

### 3. Job detail capture parser

Implemented:

```txt
src/jobCapture.ts
```

Command:

```bash
npm run capture:job -- --file captures/job-detail.txt --url <upwork-url>
```

Purpose:

- paste Upwork job-detail text into a file
- parse title, description, skills, client data, proposal count, invites, connects, etc.
- create/update manual job entries

Sample:

```txt
captures/job-detail-sample.txt
```

### 4. Apply-screen capture parser

Implemented:

```txt
src/capture.ts
```

Command:

```bash
npm run app:capture -- --job-id <id> --file captures/apply-screen.txt
npm run app:capture -- --job-id <id> --file captures/apply-screen.txt --record
```

Extracts:

- required Connects
- boost Connects
- total Connects
- boost rank
- remaining Connects
- profile used
- hourly rate
- profile highlights
- proposal requirements

### 5. Steve profile, proof, and portfolio system

Profile files:

```txt
profile/profile.json
profile/portfolio.json
profile/connects-rules.json
profile/video-intro-transcript.md
profile/attachments/
```

Stored attachments:

- Truly Beauty - Case Study.pdf
- Lifely.pdf
- Portfolio.pdf
- Screenshot_42.png

Profile includes:

- Steve positioning
- Upwork details
- proof points
- certifications
- testimonials
- voice rules
- banned phrases
- preferred phrases
- video intro language

### 6. Profile knowledge ingestion

Implemented:

```txt
src/knowledge.ts
src/profileKnowledge.ts
profile/knowledge/
```

Knowledge can be added over time without editing core code.

Supported knowledge categories include:

- voice
- proof
- portfolio
- video
- bid rules
- general notes

Commands:

```bash
npm run knowledge:add
npm run knowledge:video
npm run portfolio:upsert
```

Sample knowledge files exist under:

```txt
profile/knowledge/
```

### 7. Structured scoring model

Implemented:

```txt
src/scoring.ts
```

Scoring now includes:

- fit score
- client quality score
- opportunity score
- red flag score
- Connects risk score
- final score
- reasons
- risks

Older keyword scoring was refactored to feed the structured model.

### 8. Proposal generation

Implemented in:

```txt
src/agent.ts
```

Generates application drafts using:

- job context
- Steve profile
- proof points
- portfolio rules
- video transcript language
- knowledge notes
- Connects guardrails

Proposal structure now includes:

- opening
- diagnosis
- proof
- answers to client application questions
- rate/retainer answer
- CTA
- browser-fill notes
- final cover letter

### 9. Proposal critic

Implemented:

```txt
src/critic.ts
```

Checks:

- banned phrases
- generic/weak openings
- AI-sludge language
- proposal length
- CTA strength
- proof relevance
- Steve voice markers

Outputs:

- quality score
- issues
- positive signals

### 10. Proof selector

Portfolio metadata controls proof selection.

Current proof examples:

- Truly Beauty case study for beauty/skincare/DTC
- Lifely for wellness/health/lifestyle/DTC
- Portfolio.pdf as safe general default

Attachment guardrails include sensitivity and never-use rules.

### 11. Connects rules and submission tracking

Connects rules live in:

```txt
profile/connects-rules.json
```

Current rules:

- required Connects hard cap: 50
- ideal boost range: 10–30
- max boost: 50
- never bid max automatically
- require approval above 30
- target top 3 when boosting
- skip if top bid is above 50 by default

Submission tracking records:

- required Connects
- boost Connects
- total Connects
- boost rank
- client spend
- rate
- profile used
- attachments used
- profile highlights used
- submitted proposal text if available

Commands:

```bash
npm run app:apply -- --job-id <id> --required-connects 10 --boost-connects 35 --rank 1 --client-spend 393 --rate 35 --profile "Email Marketing"
npm run app:status -- --job-id <id> --status replied
npm run app:note -- --job-id <id> --note "Client replied"
npm run app:report
npm run app:analytics
```

### 12. Outcome analytics

Implemented in:

```txt
src/applications.ts
```

Reports:

- applications by status
- reply rate
- interview rate
- hire rate
- total Connects spent
- average Connects per applied job
- Connects per reply
- top attachments
- top profile highlights

### 13. Slack webhook proposal packets

Existing Slack Incoming Webhook is used.

No new Slack app is required for V0 outbound messages.

Implemented:

```txt
src/slack.ts
src/slackPreview.ts
```

Command:

```bash
npm run slack:preview -- --job-id <id>
```

Slack packet includes:

- score breakdown
- fit reasons
- risks
- Connects plan
- proof recommendations
- proposal quality
- structured proposal draft
- Upwork link

Important limitation:

- Incoming webhook is one-way.
- True Slack chat/buttons/replies require Slack Events API, Socket Mode, or another inbound mechanism later.

### 14. Slack conversation foundation

Implemented:

```txt
src/slackConversation.ts
```

Local command parser supports intents:

- approve
- reject
- revise
- regenerate
- mark applied
- mark replied
- enqueue browser apply

Command examples:

```bash
npm run slack:conversation -- parse --job-id <id> --text "approve"
npm run slack:conversation -- handle --job-id <id> --text "approve and queue browser apply"
npm run slack:conversation -- handle --job-id <id> --text "revise the opening to mention Truly Beauty earlier"
```

If LLM is configured, revisions can be applied. If not, revision requests are stored.

### 15. Browser queue foundation

Implemented:

```txt
src/browserQueue.ts
src/browserWorker.ts
```

Queue supports browser actions such as:

- open job
- open apply page
- prepare application review

Commands:

```bash
npm run browser:enqueue -- --job-id <id> --action open_job --url <url>
npm run browser:enqueue -- --apply-preview --job-id <id>
npm run browser:enqueue -- --apply-prepare --job-id <id>
npm run browser:list
npm run browser:update -- --id <action-id> --status paused --error "Login required"
npm run browser:worker
```

### 16. Browser search agent foundation

Implemented:

```txt
src/browserSearch.ts
```

Command:

```bash
npm run browser:search -- --dry-run
```

Currently dry-run safe and disabled by default unless configured.

It is intended to become the primary source of jobs:

- persistent VM browser session
- saved/keyword Upwork searches
- 5–10 minute polling
- capture job links and detail text
- enqueue downstream normalization/scoring/proposal packets

### 17. Browser apply preparer

Implemented:

```txt
src/browserApply.ts
```

Command path currently uses browser queue:

```bash
npm run browser:enqueue -- --apply-preview --job-id <id>
npm run browser:enqueue -- --apply-prepare --job-id <id>
```

It builds a safe browser-fill plan:

- source URL
- apply URL
- profile to verify
- rate
- cover letter
- attachments
- highlights
- Connects plan
- validation warnings
- `stopBeforeSubmit: true`

It does not submit proposals.

### 18. Scheduler and heartbeats

Implemented:

```txt
src/scheduler.ts
src/heartbeat.ts
src/health.ts
```

Commands:

```bash
npm run scheduler
npm run scheduler:dev
npm run health
npm run test:health
```

Health records include:

- worker name
- status
- last run
- stale detection
- run counts
- error counts
- metadata

Slack stale-worker alerts exist through the existing webhook path.

### 19. LLM normalization layer

Implemented:

```txt
src/normalization.ts
src/normalizeCli.ts
src/llm/provider.ts
```

Command:

```bash
npm run normalize:capture -- --file captures/job-detail-sample.txt
```

Behavior:

- if LLM is configured, raw data can be normalized through an OpenAI-compatible provider
- if no LLM key exists, deterministic fallback is used
- output is validated and repaired conservatively
- direct Upwork job IDs/links are required for safe normalized links

Env vars include:

```env
LLM_PROVIDER=
LLM_API_KEY=
LLM_MODEL=
LLM_BASE_URL=
```

### 20. Skills registry

Implemented:

```txt
skills/*/SKILL.md
src/skills.ts
```

Commands:

```bash
npm run skills:list
npm run skills:read -- <skill-name>
```

Skills created:

- browser-apply
- connects-governor
- fit-scoring
- heartbeat-monitor
- job-extraction
- llm-normalization
- outcome-tracking
- proof-selector
- proposal-critic
- proposal-writing
- slack-conversation
- slack-packet
- upwork-search

Each skill is intended to be loaded on demand by a future LLM agent rather than loading the entire project context.

### 21. Cloud/VM deployment docs

Implemented:

```txt
docs/DEPLOYMENT.md
```

Covers:

- VM/cloud setup
- Docker/compose
- persistent data volumes
- browser session directory
- secrets/env vars
- scheduler mode
- health checks
- Upwork login/session handling
- Slack webhook setup
- safety notes

## Real job tested/tracked

Job:

```txt
Klaviyo Email Marketing Expert For DTC Beauty Brand
```

Job ID:

```txt
manual:upwork-022053519741553119886
```

Upwork URL:

```txt
https://www.upwork.com/jobs/~022053519741553119886
```

Recorded outcome:

- status: applied
- required Connects: 10
- boost Connects: 35
- total Connects: 45
- rank: 1
- client spend: $393
- rate: $35/hr
- profile: Email Marketing
- attachments: Truly Beauty case study, Portfolio
- profile highlights: Lifely, From $250k to $1.2M

## Useful commands

Build:

```bash
npm run build
```

Analytics:

```bash
npm run app:analytics
npm run app:report
```

Slack preview:

```bash
npm run slack:preview -- --job-id manual:upwork-022053519741553119886
```

Conversation command:

```bash
npm run slack:conversation -- handle --job-id manual:upwork-022053519741553119886 --text "approve and queue browser apply"
```

Browser apply preview:

```bash
npm run browser:enqueue -- --apply-preview --job-id manual:upwork-022053519741553119886
```

Browser queue:

```bash
npm run browser:list
npm run browser:worker
```

Browser search dry run:

```bash
npm run browser:search -- --dry-run
```

Normalize capture:

```bash
npm run normalize:capture -- --file captures/job-detail-sample.txt
```

Health:

```bash
npm run test:health
```

Skills:

```bash
npm run skills:list
npm run skills:read -- proposal-writing
```

## Current known gaps / next work

### 1. Slack inbound is not truly connected yet

Existing webhook can send Slack messages, but it cannot receive replies or button clicks.

Options for true Slack command center:

- Slack Events API
- Slack Socket Mode
- slash command endpoint
- polling workaround

The code now has local conversation parsing and handling, but real Slack inbound wiring still needs setup.

### 2. Browser search is not authenticated/running against real Upwork yet

Browser search foundation exists, but production requires:

- VM/cloud machine
- browser dependencies
- persistent user data dir
- Steve logs into Upwork manually once
- browser search enabled via env
- scheduler running

### 3. Browser apply is preparation-only

The browser apply preparer builds plans and queues review actions.

It does not submit proposals.

That is intentional for V0.

### 4. Need real Slack webhook test

Before VM deployment, run:

```bash
npm run slack:preview -- --job-id manual:upwork-022053519741553119886
```

with `SLACK_CHANNEL_WEBHOOK_URL` configured.

Review Slack packet structure and revise if needed.

### 5. Need OpenAI/LLM key for live normalization/revisions

Without LLM key, deterministic fallback works.

To enable LLM:

```env
LLM_PROVIDER=openai-compatible
LLM_API_KEY=...
LLM_MODEL=...
LLM_BASE_URL=...
```

### 6. Need VM/cloud deployment

Recommended next phase:

1. choose VM provider
2. deploy repo
3. configure `.env`
4. mount persistent volumes for data, profile, captures, browser user data, artifacts
5. run scheduler
6. login to Upwork manually in VM browser
7. test browser search dry-run/real mode
8. test Slack preview
9. test browser apply preparation

## Important philosophy going forward

Do not optimize for proposal volume.

Optimize for:

- high-fit jobs
- early response
- specific proposals
- strong proof selection
- Connects discipline
- Slack approval/edit loop
- outcome feedback

Permanent desired workflow:

```txt
VM browser searches Upwork every 5–10 minutes
→ captures job/apply data
→ LLM normalizes to structured packet
→ deterministic scorer/guardrails validate
→ proposal draft generated and critiqued
→ Slack packet sent
→ Steve approves/revises/rejects in Slack
→ browser worker prepares application
→ Steve final-submits or later enables submit-after-approval
→ outcome tracking improves future decisions
```

## Unreleased local WIP / browser CDP handoff

This section consolidates the newer local TRUE_NORTH/browser-session context that was previously only in a stashed `TRUE_NORTH.md`. The canonical doc is now this file only.

### Current browser/session priority

The next product priority is to find a reliable, long-lived logged-in Chrome/CDP path so discovery can run without repeated Google/Upwork login blockers.

User preference:

- local browser session can stay open 24/7 on the laptop
- personal Chrome/CDP was requested as default local mode
- direct use of the default personal Chrome profile hit a Chrome remote-debugging restriction

Do not run the scheduler or live worker while working on this unless explicitly approved.

### Personal/default Chrome CDP blocker

The attempted personal Chrome profile was:

```txt
Chrome user data dir: /Users/admin/Library/Application Support/Google/Chrome
Profile directory: Profile 1
Account: manyaos.47@gmail.com
```

Discovered local Chrome profile metadata:

```txt
Default   user_name=steve.logarn@homesteadstudio.co
Profile 1 user_name=manyaos.47@gmail.com
```

Attempted command that failed:

```bash
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  '--remote-debugging-port=9222' \
  '--user-data-dir=/Users/admin/Library/Application Support/Google/Chrome' \
  '--profile-directory=Profile 1' \
  '--no-first-run' \
  '--no-default-browser-check' \
  'https://www.upwork.com/nx/find-work/best-matches/'
```

Observed blocker:

```txt
DevTools remote debugging requires a non-default data directory. Specify this using --user-data-dir.
```

Then:

```bash
npm run browser:cdp:check
```

returned:

```txt
CDP unavailable at http://127.0.0.1:9222: fetch failed
```

Interpretation:

- this is not a Slack UX issue
- this is not a proposal/apply issue
- this is a browser session architecture issue
- recent Chrome appears to require remote debugging to use a non-default user-data-dir
- direct CDP against `/Users/admin/Library/Application Support/Google/Chrome` is likely blocked by Chrome itself

### Preferred Upwork Browser v0

Preferred Upwork Browser v0 is implemented locally but parked.

Reason: Google login is currently blocking live verification.

Do not treat this feature as production-ready until:

- preferred browser can start
- user manually logs into Upwork
- `browser:preferred:check` returns `readyForDiscovery=true`
- discovery-only succeeds from the preferred browser

Use a **non-default long-lived Chrome user-data-dir**, manually log into Upwork once, then keep that visible Chrome/CDP session open. This is the official browser environment the agent works from for Upwork discovery.

Dedicated dir:

```txt
/Users/admin/upwork-rss-reader/data/personal-cdp-profile
```

Start:

```bash
npm run browser:preferred:start
```

This opens:

```txt
https://www.upwork.com/nx/find-work/best-matches/
```

with:

```txt
--remote-debugging-port=9222
--user-data-dir=/Users/admin/upwork-rss-reader/data/personal-cdp-profile
--profile-directory=Default
```

Then manually log into Upwork in that browser if needed. Do not automate password/passkey/2FA/security/CAPTCHA.

Check readiness:

```bash
npm run browser:preferred:check
```

Status output shape:

```json
{
  "online": true,
  "cdpReachable": true,
  "upworkLoggedIn": true,
  "upworkSessionState": "logged_in",
  "currentUrl": "https://www.upwork.com/nx/find-work/best-matches/",
  "title": "Best Matches - Upwork",
  "readyForDiscovery": true
}
```

If `readyForDiscovery=false`, do not silently switch browsers and do not run discovery. Fix the reported `reason` first. Reasons include CDP unreachable, Upwork logged out/login in progress, unknown session, or manual attention/security challenge.

Only after preferred-browser readiness is true, run discovery-only:

```bash
npm --silent run browser:tool -- discovery.best-matches --max-jobs 3 --max-scrolls 4
npm run browser:list
```

Legacy/agent profile mode remains available only when explicitly requested via the older commands:

```bash
npm run browser:session
npm run browser:cdp:check
```

Stop before worker. Do not run:

```bash
npm run browser:worker
```

unless explicitly approved.

### Unmerged browser/profile-mode WIP in local stash

The local stash contains work that was intentionally **not included** in PR #1:

```txt
stash@{0}: On main: pre-clean-pr-uncommitted-wip
```

Stash includes, among other things:

```txt
HANDOFF.md
TRUE_NORTH.md
docs/PERSONAL_CHROME_CDP.md
README.md
src/browserApply.test.ts
src/browserSessionCli.ts
src/browserSessionControl.ts
src/browserSessionInspector.ts
src/browserToolCli.test.ts
src/browserToolCli.ts
src/browserWorker.ts
src/config.ts
src/discoveryScheduler.ts
src/upworkLoginDriver.test.ts
src/upworkLoginDriver.ts
```

Important:

- do not blindly apply the stash
- inspect it first
- cherry-pick only approved browser/session changes
- do not restore `TRUE_NORTH.md` as a second handoff
- do not commit `.pi/taskplane.json`, browser profile data, temp/session HTML, screenshots, or PDFs

Likely useful WIP ideas in the stash:

- `BrowserProfileMode = "agent" | "personal"`
- profile-mode plumbing through session CLI, browser tool CLI, browser worker, and discovery scheduler
- personal Chrome CDP command builder
- CDP-mode readiness/logging improvements
- safer Google account chooser handling
- login driver refinement so email fill only happens on safe Google email-entry pages
- session inspector treatment of Google account chooser as safe `login_in_progress` unless sensitive auth markers appear

Because default personal Chrome CDP is blocked, revise this WIP toward the non-default `data/personal-cdp-profile` strategy before committing.

### CDP acquisition fix already merged into PR #1

The PR includes the committed CDP acquisition fix from the old local line of work.

Problem fixed:

- `/json/version` could work, so `browser:cdp:check` appeared reachable
- real Playwright tools failed because `connectOverCDP()` initialized the default context and sent `Browser.setDownloadBehavior`
- existing Chrome sessions rejected that command with:

```txt
Browser context management is not supported
```

Fix:

- CDP mode installs a Playwright compatibility bypass before `connectOverCDP`
- it suppresses only the internal `Browser.setDownloadBehavior` CDP command in CDP mode
- other CDP errors still propagate
- CDP mode reuses `browser.contexts()[0]`
- CDP mode does not call `launchPersistentContext`
- CDP mode does not create a new browser context
- launch mode remains unchanged

Deep health check command:

```bash
npm run browser:cdp:check
```

It reports:

- CDP reachability
- `connectOverCDP` success/failure
- default context availability
- page count
- selected page URL/title or reason no page exists

### Discovery behavior and constraints

Discovery-origin captures must use Best Matches/source-context pages only.

Rules:

- do not direct navigate to `/jobs/~ID` for discovery-origin captures
- do not reuse direct `/jobs/~ID` tabs for discovery-origin captures
- expected: `directFallbackAttempted=false`
- pause as `source_context_unavailable` if source context is unavailable
- manual Slack URL captures may retain direct behavior

Upwork job IDs must be concrete numeric IDs matching:

```regex
/^\d{12,24}$/
```

Reject UI/component tokens like:

```txt
JobTile-HnXIl
CategoriesEditModal-mCqPI
139ba39c
```

Discovery supports:

- Best Matches source scanning
- scrolling/loading more cards
- recency prioritization
- `postedAtText`
- `recencyRank`
- duplicate skipping
- already-handled skipping

Safe discovery-only command after logged-in browser verification:

```bash
npm --silent run browser:tool -- discovery.best-matches --max-jobs 3 --max-scrolls 4
npm run browser:list
```

### Slack lead message UX decisions

User-facing Slack language should use:

- `lead`
- `lead message`
- `incoming lead message`
- `new lead alert`

Avoid user-facing use of:

- `packet`

Internal DB states may still use names like `packet_sent`; do not churn DB/status naming unless needed.

Main incoming lead messages should mention Steve/Natalie once near the top:

```txt
<@U0A2X5BCNKC> <@U0AHJFYV42K>
```

These are:

```txt
Steve Logarn: <@U0A2X5BCNKC>
Natalie:      <@U0AHJFYV42K>
```

Do not repeat mentions in follow-up/debug/status messages.

Expected Slack lead message qualities:

- heading like `🚀 New Upwork Lead`
- clean sales-friendly copy
- emojis and bullets
- no raw proof asset paths
- no prominent browser internals
- no retry command in normal replies unless browser/manual-attention state makes retry relevant
- final submit remains explicitly manual
- tiny debug footer only when needed

### LLM Job Intelligence Parser status

Parser purpose:

After job capture, the parser reads job title/description/client details and returns structured intelligence:

- primaryPlatform
- platformsMentioned
- platformCategory
- platformPreferenceTier
- platformFitReason
- shouldSkipForPlatform
- skipReason
- businessType
- ecommerceVertical
- jobCategory
- taskType
- requiredSkills
- clientGoal
- redFlags
- fitScoreReasoning
- proposalAngle
- proofRecommendations
- draftConstraints
- platformMismatchWarnings
- needsManualReview
- confidence
- schemaVersion

Platform tiers:

Core:

- Klaviyo
- Attentive
- Postscript
- Omnisend

Secondary:

- MailerLite
- Mailchimp

Non-core/review carefully:

- HubSpot
- Customer.io
- Brevo
- ActiveCampaign
- SendGrid
- Campaign Refinery
- Braze
- Iterable
- Salesforce Marketing Cloud
- other ESPs/CRMs/CDPs

Rules:

- do not hard-skip jobs only because platform is non-core
- treat non-core platform as a review signal
- fit also considers email/SMS/lifecycle/retention relevance, DTC/ecommerce relevance, client quality, budget/spend, recency, scope clarity, red flags, and migration relevance
- if job says HubSpot, do not pretend it is Klaviyo
- if job says Brevo, do not pretend it is Klaviyo
- if job says Customer.io, do not pretend it is Klaviyo
- if job says Klaviyo, Klaviyo language is fine
- if no platform is mentioned, proposal should stay platform-neutral

Live LLM API status from prior local testing:

```txt
OPENAI_API_KEY exists locally, but live smoke failed because OpenAI billing was inactive:
"Your account is not active, please check your billing details on our website."
```

Do not rely on live LLM output until billing is fixed and fixture smoke tests pass. Mocked parser tests pass.

### Browser/session command reference

Start preferred Upwork browser:

```bash
npm run browser:preferred:start
```

Preferred browser readiness check:

```bash
npm run browser:preferred:check
```

Legacy/agent browser session start:

```bash
npm run browser:session
```

CDP deep check:

```bash
npm run browser:cdp:check
```

Session check:

```bash
npm --silent run browser:tool -- session.check
```

Safe login start, only when logged out and not on sensitive auth page:

```bash
npm --silent run browser:tool -- login.start-google --email user@example.com
```

Use real personal email only via local runtime command/env, not committed tests/docs.

Discovery-only after logged in:

```bash
npm --silent run browser:tool -- discovery.best-matches --max-jobs 3 --max-scrolls 4
```

List browser queue:

```bash
npm run browser:list
```

Live worker remains approval-gated:

```bash
BROWSER_SESSION_MODE=cdp BROWSER_DRY_RUN=false BROWSER_HEADLESS=false BROWSER_LIVE_ACTION_LIMIT=1 npm run browser:worker
```

Do not run that command unless explicitly approved.

## Progress log

### 2026-05-16 — First clean GitHub release merged

PR #1 was cleaned and squash-merged into `main` as the first production-quality GitHub release for the Autonomous Upwork Agent.

Merged PR:

```txt
https://github.com/Logarn/upwork-autonomous-agent/pull/1
```

Merge commit:

```txt
d085ed16de28ac91f95e9a4c098cc5c1dff2dfac Ship autonomous Upwork agent foundation
```

Release included:

- product docs and deployment docs
- Slack lead alert/conversation foundations
- browser/CDP session and discovery infrastructure
- source-context capture and queue/worker guardrails
- scheduler infrastructure
- profile metadata and skills/playbooks
- job intelligence parser shell
- safety posture that final submit remains manual

Release explicitly excluded:

- `.pi/taskplane.json`
- `.pi/agents/`
- `.pi/taskplane-config.json`
- `taskplane-tasks/`
- `pi-session*.html`
- browser profile data
- screenshots/temp files
- `profile/attachments/*.pdf`
- real Slack/OpenAI/API tokens

Final pre-merge tests passed:

```bash
npm run build
npm run test:capture
npm run test:slack-socket
npx tsx src/upworkLoginDriver.test.ts
npx tsx src/browserToolCli.test.ts
npx tsx src/browserSessionInspector.test.ts
npx tsx src/browserSafetyGuard.test.ts
npx tsx src/browserDiscoveryTool.test.ts
npx tsx src/browserDiscoveryCapture.test.ts
npx tsx src/discoveryScheduler.test.ts
npx tsx src/browserApply.test.ts
npx tsx src/slackPacketV3.test.ts
npx tsx src/jobIntelligenceParser.test.ts
```

Post-merge state:

```txt
main == origin/main == d085ed16de28ac91f95e9a4c098cc5c1dff2dfac
working tree clean
remote release branch deleted
backup/local-main-before-clean-pr preserved
```

Important local-only context:

- `stash@{0}: On main: pre-clean-pr-uncommitted-wip` contains unmerged browser/profile-mode WIP and the prior TRUE_NORTH/docs export work.
- Do not blindly apply that stash. Inspect it first and cherry-pick only approved changes.
