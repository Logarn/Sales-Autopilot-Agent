# Upwork Notifier (Klaviyo + Shopify Retention Jobs)

Node.js + TypeScript background worker that monitors Upwork jobs via the Apify
Upwork Job Scraper API for
Klaviyo/Shopify retention marketing jobs, scores relevance, deduplicates via SQLite,
and posts rich Slack notifications for high-priority opportunities.

## Features

- Polls multiple Upwork search queries via Apify every 5 minutes (configurable with cron)
- Query configuration via `.env` (`SEARCH_QUERIES`) or JSON (`config/queries.json`)
- Weighted keyword scoring with negative-keyword filtering
- Match levels:
  - `high` (>= `MIN_SCORE_HIGH`) -> Slack notify + `<!channel>`
  - `medium` (>= `MIN_SCORE_TO_NOTIFY`) -> Slack notify
  - `low` (>= 2) -> tracked/logged only
  - `skip` (< 2 or negative keyword hit) -> ignored
- SQLite deduplication using Apify `uid`
- First-run seeding: stores existing jobs without blasting Slack
- Slack queue/retry on failures
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

## npm Scripts

- `npm run dev` - watch mode during development
- `npm run build` - compile TS -> `dist/`
- `npm start` - run compiled worker
- `npm run test:fetch` - fetch configured feeds once, print sample jobs
- `npm run test:slack` - send Slack webhook test message
- `npm run test:run-once` - run full pipeline one time and exit

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
