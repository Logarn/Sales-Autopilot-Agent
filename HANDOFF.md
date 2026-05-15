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

- bypass CAPTCHA, Cloudflare, 2FA, or security checks
- store plaintext Upwork passwords
- auto-submit proposals without explicit approved mode
- bid max automatically
- attach private/internal files
- take control of the local desktop browser

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
