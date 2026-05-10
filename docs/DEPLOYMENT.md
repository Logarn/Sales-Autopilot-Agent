# VM / Cloud Deployment Runbook

This project can run as a background Upwork opportunity agent on a VM or cloud host. It polls configured sources, scores and deduplicates jobs, sends Slack review packets, tracks outcomes in SQLite, and can process a safe browser-action queue. It is not an auto-apply bot.

## Runtime modes

Build before using production commands:

```bash
npm install
npm run build
```

Operational commands:

| Purpose | Command |
| --- | --- |
| Autonomous scheduler loop | `npm run scheduler` |
| Continuous cron-based worker | `npm run worker` or `npm start` |
| One-shot pipeline run | `npm run run:once` |
| Heartbeat health report | `npm run health` |
| Application report | `npm run report` |
| Outcome analytics | `npm run analytics` |
| Browser queue worker | `npm run browser:worker:prod` |
| Development worker | `npm run worker:dev` |

For Docker Compose:

```bash
cp .env.example .env
# edit secrets and runtime settings
docker compose up --build -d
docker compose logs -f notifier
docker compose restart notifier
docker compose down
```

## VM setup

1. Provision a Linux VM with Node.js 20+ or Docker Engine + Compose.
2. Clone the repository to a private directory on the host.
3. Copy `.env.example` to `.env` and set secrets there; do not commit `.env`.
4. Create persistent host directories before first run:

   ```bash
   mkdir -p data config profile captures
   chmod 700 data profile
   ```

5. Start with Docker Compose or run `npm run scheduler` under a process manager such as systemd, pm2, or the cloud provider's service supervisor. Use `npm run worker` only if you prefer the older cron-based worker mode.

## Environment variables

Core variables are documented in `.env.example`. Required values for normal operation:

- `SLACK_CHANNEL_WEBHOOK_URL` — Slack incoming webhook for approval packets and alerts.
- `APIFY_API_TOKEN` — token for Apify-backed Upwork search scraping.
- `DB_PATH` — SQLite path, default `./data/jobs.db`.
- `SEARCH_QUERIES` or `QUERIES_CONFIG_PATH` — job search source configuration.

Important runtime controls:

- `CRON_SCHEDULE`, `DAILY_SUMMARY_CRON`, `TIMEZONE` — cron-based worker polling and summary cadence.
- `SCHEDULER_INTERVAL_MS` — autonomous scheduler cadence, normalized to the 5–10 minute range.
- `HEARTBEAT_STALE_AFTER_MS` — age threshold for stale worker health findings.
- `HEALTH_ALERT_COOLDOWN_MS` — per-finding Slack alert cooldown to avoid spam.
- `PROFILE_CONFIG_PATH`, `PORTFOLIO_CONFIG_PATH`, `CONNECTS_RULES_CONFIG_PATH` — local profile/proof/risk inputs.
- `MANUAL_JOBS_CONFIG_PATH` — manual queue JSON path.
- `BROWSER_WORKER_ENABLED=false` by default. Set `true` only when intentionally processing queued browser actions.
- `BROWSER_DRY_RUN=true` by default. Keep enabled unless a human has prepared the VM browser session and accepts the platform risk.
- `BROWSER_USER_DATA_DIR=./data/browser-profile` — VM-local browser session storage.
- `BROWSER_ARTIFACT_DIR=./data/browser-artifacts` — minimized diagnostics only.

## Persistent storage

Persist these directories across container rebuilds and VM restarts:

| Path | Purpose |
| --- | --- |
| `data/` | SQLite DB, browser profile, browser artifacts |
| `config/` | Query and manual-job JSON files |
| `profile/` | Profile, portfolio, and Connects rules |
| `captures/` | Manual pasted job/apply-screen captures |

The Compose file mounts `./data` into `/app/data`. If you store mutable config/profile/captures on the host, mount those directories too or copy them into the image intentionally.

## SQLite backup and recovery

SQLite is stored at `DB_PATH`. Back up while the service is quiet when possible:

```bash
sqlite3 data/jobs.db ".backup 'data/jobs-$(date +%Y%m%d-%H%M%S).db'"
```

If `sqlite3` is not installed, stop the worker and copy `data/jobs.db` plus any `-wal` and `-shm` files. Restore by stopping the worker, replacing the DB files, and starting again.

## Browser session storage model

The browser queue is safe by default and does not require local desktop control. Queue entries are stored in SQLite and processed only by the browser worker. In dry-run mode the worker records what it would do without launching a browser.

If live browser inspection is enabled in the future, it should use the VM-local `BROWSER_USER_DATA_DIR` so cookies/session state stay on the server. Do not sync a personal laptop browser profile into the VM. Treat browser profile directories as sensitive secrets and include them in encrypted backups only when necessary.

## Safety and platform-risk guidance

- Human approval is required before any real Upwork application is submitted.
- The worker must not bypass CAPTCHA, 2FA, Cloudflare, login challenges, or other security controls.
- The browser worker must pause on security challenges and wait for a human.
- Do not store plaintext Upwork credentials in `.env`, config files, logs, captures, or diagnostics.
- Do not fill proposal fields or submit proposals automatically as part of this runtime setup.
- Keep Slack/webhook/API tokens in `.env` or the cloud secret manager, never in git.
- Minimize captures and browser artifacts; avoid full authenticated page archives unless explicitly approved.
- Upwork automation may violate platform expectations or Terms of Service. Operate in human-in-the-loop mode and review platform rules before enabling browser features.

## Operational runbook

Daily / routine:

```bash
npm run health
npm run report
npm run analytics
```

Autonomous runtime:

```bash
npm run scheduler
```

Scheduler mode runs the pipeline, optional browser queue processing, and heartbeat health checks every 5–10 minutes. Health alerts use the existing Slack webhook and are conservative: stale workers and browser/auth-required findings are rate-limited by `HEALTH_ALERT_COOLDOWN_MS`.

Incident checks:

1. Inspect logs (`docker compose logs -f notifier` or supervisor logs).
2. Run `npm run health` to inspect worker heartbeats, stale-worker status, and browser/auth-required findings.
3. Confirm `data/jobs.db` exists and the disk is not full.
4. Check Slack webhook and Apify token validity if feeds or notifications fail.
5. Keep `BROWSER_WORKER_ENABLED=false` while diagnosing browser queue issues unless browser processing is the incident.

Updates:

```bash
git pull
npm install
npm run build
npm run health
# restart process manager or docker compose up --build -d
```

Before enabling any live browser processing, verify that dry-run queue processing works and that a human can intervene on the VM session.
