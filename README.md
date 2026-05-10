# Upwork Revenue Assistant

Node.js + TypeScript background worker that monitors Upwork jobs, scores fit, generates human-in-the-loop proposal packets, selects relevant proof, deduplicates via SQLite, and posts rich Slack notifications for high-priority opportunities.

The product direction is an Upwork revenue assistant, not an auto-apply bot: find better jobs, write better proposals, protect Connects, and keep the human in control.

## Features

- Polls Upwork opportunities via pluggable sources every 5 minutes (configurable with cron)
- Current sources: Apify search scraper + manual job ingestion
- Query configuration via `.env` (`SEARCH_QUERIES`) or JSON (`config/queries.json`)
- Structured deterministic scoring with fit, client quality, opportunity, red-flag, and Connects-risk components
- Match levels:
  - `high` (final score >= 80) -> Slack notify + `<!channel>`
  - `medium` (final score >= 45) -> Slack notify
  - `low` (final score >= 30) -> tracked/logged only
  - `skip` (< 30, hard negative match, severe red flags, or severe Connects risk) -> ignored
- SQLite deduplication using exact source IDs plus conservative semantic fingerprints
- First-run seeding: stores existing jobs without blasting Slack
- Slack queue/retry on failures
- Proposal packet generation using local profile and portfolio metadata
- Suggested proof/attachment selection with guardrails
- Deterministic Proposal Quality Critic that scores draft quality before Slack review
- Application draft storage in SQLite
- Startup health checks (Slack + feed reachability + DB stats)
- Daily summary digest at 8:00 AM Africa/Nairobi (configurable)
- Graceful shutdown on `SIGINT` / `SIGTERM`

## Project Structure

```text
upwork-notifier/
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── feeds.ts
│   ├── fetcher.ts
│   ├── filter.ts
│   ├── db.ts
│   ├── slack.ts
│   ├── logger.ts
│   ├── types.ts
│   └── utils.ts
├── config/queries.json
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

## Requirements

- Node.js 18+
- Slack Incoming Webhook URL
- Apify API token

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy env file and edit:

   ```bash
   cp .env.example .env
   ```

3. Build:

   ```bash
   npm run build
   ```

4. Run once (pipeline test):

   ```bash
   npm run test:run-once
   ```

5. Run continuously:

   ```bash
   npm start
   ```

## Scoring Model

Each job receives a deterministic 0-100 score breakdown before Slack notification. The scorer is local and rule-based; it does not call an LLM or external scoring API.

Score components:

- **Fit** — keyword, profile skill, preferred industry, and preferred job-type alignment from `profile/profile.json`.
- **Client quality** — client rating, feedback history, spend, hire rate, and prior hires.
- **Opportunity** — budget signals, urgency/timing, expertise requested, and whether the work looks strategic vs. commodity.
- **Red flags** — negative keywords, avoid industries/job types, and suspicious phrases such as commission-only or free-trial language.
- **Connects risk** — required Connects compared with `profile/connects-rules.json` approval and cap thresholds.

Slack packets show the final score plus component scores, the top reasons, and the top risks so the reviewer can see why a job was promoted or down-ranked. Application drafts reuse the same reasons and risks for their fit score and red-flag sections.

Thresholds are intentionally conservative: `high` starts at 80, `medium` at 45, `low` at 30, and hard-negative/risk conditions force `skip`. These rules are deterministic today for predictable behavior and auditability. Future tuning should adjust weights and thresholds using tracked outcome data such as replies, interviews, hires, and Connects spent.

## Deduplication

The ingestion pipeline removes duplicates in two deterministic passes before scoring and notification:

1. **Exact ID dedupe** collapses repeated source IDs and keeps the strongest/latest copy using stable tie-breakers.
2. **Semantic dedupe** builds a normalized fingerprint from title, description, budget, client country, skills, and source query, ignoring volatile repost noise such as timestamps, URLs, and job-id text. Jobs with matching fingerprints or high conservative similarity are treated as practical repost duplicates.

Fingerprints are stored with `seen_jobs`, so later runs can suppress likely reposts that arrive under a new source ID. The strategy is intentionally conservative: when similarity is uncertain, distinct jobs are kept rather than risk hiding a real opportunity.

## Proposal Quality Critic

Every generated application draft is graded by a deterministic critic before it appears in Slack. The critic returns a 0-100 score, issue list, positive signals, and word count so the human reviewer can quickly spot drafts that sound generic or weak.

The critic checks for:

- banned AI-sounding phrases from `profile/profile.json`
- weak generic openings instead of a pain-based first line
- generic claims that are not tied to the job
- proposal length outside Steve's preferred 120-190 word range
- vague or missing CTA
- proof that is not clearly relevant to the job post
- Steve voice markers such as direct diagnostic phrasing

Examples of flagged issues:

- `Dear hiring manager, I am excited to apply...` -> banned phrase and weak opening
- `With over 8 years of experience...` -> matches the profile's placeholder banned phrase `With over X years of experience`
- `I can help you achieve your goals` -> generic claim without diagnostic proof
- `Let me know if you want to chat` -> vague CTA compared with `send me the store URL and what is not working in Klaviyo now`

Slack packets show the Proposal Quality score plus the top issues and positive signals above the proposal draft.

## Job Detail Capture Workflow

Use job detail capture when you have a promising Upwork job open in a browser but do not want to automate login or scraping. Copy the visible job-detail page text, save it under `captures/`, then import it into the manual job queue:

```bash
pbpaste > captures/job-detail.txt
npm run capture:job -- --file captures/job-detail.txt --url https://www.upwork.com/jobs/Beauty-Brand-Klaviyo-Email-Marketing_~022053519741553119886/
npm run test:run-once
```

The command parses title, description, budget/type, duration, experience level, skills, activity, Connects, and client details when visible. The `--url` flag is optional only when the pasted text already includes the Upwork job URL; otherwise provide it so the system keeps a direct application link. It creates or updates `config/manual-jobs.json` using the stable Upwork job ID or URL, then prints a short summary and the next pipeline command. Missing fields are kept conservative (`Not specified`, `0`, or empty arrays) so the normal scoring/proposal pipeline can still run while making weak captures obvious.

Sample pasted text lives at `captures/job-detail-sample.txt`.

## Profile Knowledge Ingestion

Steve can add profile knowledge without editing TypeScript. The loader reads markdown or JSON artifacts under `profile/knowledge/` grouped by type: `voice`, `proof`, `portfolio`, `video`, `bid_rules`, and `general`. Missing or empty knowledge directories are safe; malformed or unsupported files are skipped with warnings.

Add a note from text or a file:

```bash
npm run knowledge:add -- --type voice --title "Short confident CTA" --text "Prefer a shorter CTA and a specific next step. Avoid phrase \"quick sense\"." --tags "cta"
npm run knowledge:add -- --type proof --title "Klaviyo retention win" --file notes/proof.md --tags "Klaviyo,Shopify"
```

Add/update portfolio metadata without code changes:

```bash
npm run portfolio:upsert -- --id retention-audit --name "Retention audit sample" --description "Klaviyo audit proof" --result "Found lifecycle revenue leaks" --industries "DTC,ecommerce" --platforms "Klaviyo,Shopify" --job-types "audit,flow optimization" --file-path "profile/attachments/Portfolio.pdf"
```

Add another video transcript as knowledge:

```bash
npm run knowledge:video -- --file profile/video-intro-transcript.md --title "Intro video transcript" --tags "intro,credibility"
```

Sample artifacts live in `profile/knowledge/voice/`, `profile/knowledge/portfolio/`, and `profile/knowledge/video/`. Proposal generation uses relevant proof/portfolio notes as client-facing evidence, applies voice notes as quiet style preferences, and keeps bid-rule notes internal to recommendations/Connects warnings.

## Browser Queue Safety Model

The browser queue is a cloud/VM-safe foundation for future human-in-the-loop browser assistance. It stores requested browser actions in SQLite and processes them only when the worker is explicitly enabled:

```bash
npm run browser:enqueue -- --job-id job-123 --action open_job --url https://www.upwork.com/jobs/~0123
npm run browser:enqueue -- --job-id job-123 --action open_apply_page --url https://www.upwork.com/ab/proposals/job/job-123/apply/
npm run browser:enqueue -- --job-id job-123 --action prepare_application_review --url https://www.upwork.com/jobs/~0123 --notes "Review before applying"
npm run browser:list -- --status pending
npm run browser:update -- --id 1 --status paused --error "Login required"
BROWSER_WORKER_ENABLED=true npm run browser:worker
```

Safety defaults are conservative: `BROWSER_WORKER_ENABLED=false` and `BROWSER_DRY_RUN=true`. Dry-run mode records that an action would be opened but does not launch a browser. If live browser inspection is enabled later, the worker uses a persistent VM-local user data directory (`BROWSER_USER_DATA_DIR`) so it does not take over a local desktop session.

The worker must pause for human intervention on login, 2FA, CAPTCHA, Cloudflare, or any other security challenge. It must not bypass security controls, store Upwork passwords, fill proposal fields, or submit proposals. Optional artifacts are minimized diagnostics only (state, URL, title, bounded text excerpt), not full authenticated page archives.

## npm Scripts

- `npm run dev` - watch mode during development
- `npm run build` - compile TS -> `dist/`
- `npm start` - run compiled worker
- `npm run test:fetch` - fetch configured feeds once, print sample jobs
- `npm run test:slack` - send Slack webhook test message
- `npm run test:run-once` - run full pipeline one time and exit
- `npm run add:manual-job -- --url <url> --title <title>` - add a manual job to the ingestion queue
- `npm run capture:job -- --file captures/job-detail.txt [--url <url>]` - parse pasted Upwork job-detail text and create/update the manual job queue
- `npm run app:report` - print application outcome summary and recent tracked opportunities
- `npm run app:status -- --job-id <id> --status applied --note "Applied manually"` - update an application status
- `npm run app:note -- --job-id <id> --note "Client replied"` - add an application note
- `npm run app:apply -- --job-id <id> --required-connects 10 --boost-connects 35 --rank 1 --client-spend 393 --rate 35 --profile "Email Marketing" --attachments "Truly Beauty - Case Study.pdf,Portfolio.pdf"` - record actual submission details
- `npm run app:analytics` - report reply/interview/hire rates, Connects efficiency, and top proof assets
- `npm run app:capture -- --job-id <id> --file captures/apply-screen.txt --record` - parse pasted Upwork apply-screen text and record structured submission details
- `npm run knowledge:add -- --type voice --text "Prefer concise CTAs" [--title <title>] [--tags "cta"]` - append a local profile knowledge note
- `npm run knowledge:video -- --file profile/video-intro-transcript.md --title "Intro video"` - ingest an additional video/transcript note
- `npm run portfolio:upsert -- --id <id> --name <name> --description <text> --result <text>` - add/update portfolio metadata without code changes
- `npm run browser:enqueue -- --job-id <id> --action open_job --url <upwork-url>` - add a safe browser action to the SQLite queue
- `npm run browser:list -- [--status pending] [--limit 25]` - list queued browser actions
- `npm run browser:update -- --id <action-id> --status paused --error "Login required"` - manually update a queued browser action
- `npm run browser:worker` - process pending browser actions only when `BROWSER_WORKER_ENABLED=true`; dry-run remains default

## Environment Variables

See `.env.example` for full list. Core settings:

```env
SLACK_CHANNEL_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
APIFY_API_TOKEN=your_apify_token_here
CRON_SCHEDULE=0 * * * *
DAILY_SUMMARY_CRON=0 8 * * *
TIMEZONE=Africa/Nairobi
MIN_SCORE_TO_NOTIFY=4
MIN_SCORE_HIGH=8
DB_PATH=./data/jobs.db
```

### Feed Query Configuration

Option A - environment variable:

```env
SEARCH_QUERIES=Klaviyo Shopify email marketing|Klaviyo retention marketing
```

Option B - JSON config file (default `./config/queries.json`):

```json
{
  "queries": ["Klaviyo Shopify email marketing", "Klaviyo retention marketing"]
}
```

## Cloud / VM Runtime

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full VM/cloud runbook, environment guidance, persistent volume model, SQLite backup notes, browser-session safety model, and operational checklist.

Common production commands after `npm run build`:

- `npm run worker` / `npm start` - continuous background agent
- `npm run run:once` - one-shot poll/process/notify run
- `npm run health` - config, Slack, source, and DB health check without starting the scheduler
- `npm run report` - application summary report
- `npm run analytics` - outcome and Connects analytics
- `npm run browser:worker:prod` - process queued browser actions on a VM/cloud host; still disabled unless `BROWSER_WORKER_ENABLED=true`

## Docker

Build and run with compose:

```bash
docker compose up --build -d
```

SQLite DB and browser artifacts persist to `./data`; Compose also mounts `./config`, `./profile`, and `./captures` for VM-safe runtime configuration and manual capture workflows.
