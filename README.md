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

## npm Scripts

- `npm run dev` - watch mode during development
- `npm run build` - compile TS -> `dist/`
- `npm start` - run compiled worker
- `npm run test:fetch` - fetch configured feeds once, print sample jobs
- `npm run test:slack` - send Slack webhook test message
- `npm run test:run-once` - run full pipeline one time and exit
- `npm run add:manual-job -- --url <url> --title <title>` - add a manual job to the ingestion queue
- `npm run app:report` - print application outcome summary and recent tracked opportunities
- `npm run app:status -- --job-id <id> --status applied --note "Applied manually"` - update an application status
- `npm run app:note -- --job-id <id> --note "Client replied"` - add an application note
- `npm run app:apply -- --job-id <id> --required-connects 10 --boost-connects 35 --rank 1 --client-spend 393 --rate 35 --profile "Email Marketing" --attachments "Truly Beauty - Case Study.pdf,Portfolio.pdf"` - record actual submission details
- `npm run app:analytics` - report reply/interview/hire rates, Connects efficiency, and top proof assets
- `npm run app:capture -- --job-id <id> --file captures/apply-screen.txt --record` - parse pasted Upwork apply-screen text and record structured submission details

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

## Docker

Build and run with compose:

```bash
docker compose up --build -d
```

SQLite DB persists to `./data` via mounted volume.
