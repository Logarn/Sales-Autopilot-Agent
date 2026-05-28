# Contabo Runbook

This runbook is for deploying the Upwork Agent test repo to a Contabo virtual server after the repo is promotion-ready.

Scope:

- repo: `/Users/admin/upwork-rss-reader-gascity-test`
- target host path: `/opt/upwork-agent/app`
- shared state root: `/opt/upwork-agent/shared`

This runbook does not authorize auto-submit behavior. Final submit remains manual.

## 1. Runtime model

Recommended production shape:

- one Contabo VM
- one persistent Chrome session on the server
- one lead-engine process managed by `systemd`
- one Slack Socket Mode listener managed by `systemd`
- SQLite stored on the server
- shared browser profile and artifacts stored outside the repo checkout

## 2. Server prerequisites

Provision Ubuntu 22.04 or 24.04.

Create a dedicated user:

```bash
sudo useradd --create-home --shell /bin/bash upwork-agent
```

Install base packages:

```bash
sudo apt-get update
sudo apt-get install -y curl git jq sqlite3 unzip xvfb
```

Install Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Install Chrome and runtime dependencies:

```bash
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get install -y ./google-chrome-stable_current_amd64.deb
sudo npx playwright install-deps chromium
```

## 3. Filesystem layout

App checkout:

- `/opt/upwork-agent/app`

Shared state:

- `/opt/upwork-agent/shared/data`
- `/opt/upwork-agent/shared/logs`
- `/opt/upwork-agent/shared/browser-profile`

Create the directories:

```bash
sudo mkdir -p /opt/upwork-agent/app
sudo mkdir -p /opt/upwork-agent/shared/data
sudo mkdir -p /opt/upwork-agent/shared/logs
sudo mkdir -p /opt/upwork-agent/shared/browser-profile
sudo chown -R upwork-agent:upwork-agent /opt/upwork-agent
```

## 4. Install the app

Clone the repo:

```bash
sudo -u upwork-agent git clone <repo-url> /opt/upwork-agent/app
cd /opt/upwork-agent/app
sudo -u upwork-agent npm ci
sudo -u upwork-agent npm run build
```

Run the repo-level checks before any service enablement:

```bash
sudo -u upwork-agent npm run validate:promotion
sudo -u upwork-agent npm run validate:contabo-env /opt/upwork-agent/app/.env
sudo -u upwork-agent npm run preflight:contabo
```

## 5. Configure the server `.env`

Create the server env file from the example:

```bash
sudo -u upwork-agent cp /opt/upwork-agent/app/.env.example /opt/upwork-agent/app/.env
```

Required values to set:

- Slack:
  - `SLACK_BOT_TOKEN`
  - `SLACK_APP_TOKEN`
  - `SLACK_SOCKET_MODE_ENABLED`
  - `SLACK_INBOUND_MODE`
  - `DISCOVERY_SLACK_CHANNEL_ID`
  - `SLACK_ALLOWED_CHANNEL_IDS`
  - optional fallback: `SLACK_CHANNEL_WEBHOOK_URL`
- Upwork discovery:
  - `APIFY_API_TOKEN`
- LLM:
  - `LLM_PROVIDER`
  - provider-specific API key and model
- state paths:
  - `DB_PATH=/opt/upwork-agent/shared/data/jobs.db`
  - `BROWSER_USER_DATA_DIR=/opt/upwork-agent/shared/browser-profile`
  - `BROWSER_ARTIFACT_DIR=/opt/upwork-agent/shared/data/browser-artifacts`
  - `AGENT_ENGINE_STATE_PATH=/opt/upwork-agent/shared/data/agent-engine-state.json`

Recommended production defaults:

```env
TIMEZONE=Africa/Nairobi
LOG_LEVEL=info
BROWSER_SESSION_MODE=cdp
BROWSER_CDP_URL=http://127.0.0.1:9222
BROWSER_SEARCH_ENABLED=true
BROWSER_WORKER_ENABLED=false
BROWSER_DRY_RUN=true
AGENT_ENGINE_ENABLED=false
```

Do not store Upwork username or password in `.env`.

## 6. LLM provider configuration

### OpenAI

```env
LLM_NORMALIZATION_ENABLED=true
LLM_PROVIDER=openai
OPENAI_API_KEY=...
LLM_MODEL=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1
```

### xAI / Grok

```env
LLM_NORMALIZATION_ENABLED=true
LLM_PROVIDER=openai-compatible
LLM_API_KEY=...
LLM_BASE_URL=https://api.x.ai/v1
LLM_MODEL=<grok-model>
```

### Moonshot / Kimi

```env
LLM_NORMALIZATION_ENABLED=true
LLM_PROVIDER=openai-compatible
LLM_API_KEY=...
LLM_BASE_URL=https://api.moonshot.ai/v1
LLM_MODEL=<kimi-model>
```

### Mistral

```env
LLM_NORMALIZATION_ENABLED=true
LLM_PROVIDER=openai-compatible
LLM_API_KEY=...
LLM_BASE_URL=https://api.mistral.ai/v1
LLM_MODEL=<mistral-model>
```

### OpenRouter

```env
LLM_NORMALIZATION_ENABLED=true
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=<provider/model>
```

Use one provider at a time in production. Do not turn on multiple providers in the same server `.env`.

## 7. Manual Upwork login on the server

Upwork login is manual and server-local.

Start the browser session:

```bash
sudo -u upwork-agent npm run browser:session
```

Then:

1. open the visible Chrome window on the server
2. log into Upwork manually
3. complete any 2FA manually
4. confirm the account lands on a normal Upwork page
5. run:

```bash
sudo -u upwork-agent npm run browser:cdp:check
```

If login challenge, CAPTCHA, or auth failure appears:

- stop automation
- resolve it manually in the same server browser session
- do not script around it

## 8. Dry-run and safe live-cycle commands

### Dry-run

Use dry-run first:

```bash
sudo -u upwork-agent npm run agent:run-once:dry
```

This is the required first server-side validation run.

### One safe live cycle

Before enabling always-on mode:

- keep `BROWSER_WORKER_ENABLED=false`
- keep final submit behavior unchanged
- keep browser session healthy

Then run one single non-continuous cycle:

```bash
sudo -u upwork-agent npm run agent:run-once
```

This verifies:

- discovery
- scoring
- Slack packet generation
- state persistence

without enabling always-on mode.

## 9. Enable and disable always-on mode

The lead engine should only be enabled after dry-run and one safe live cycle pass cleanly.

Copy the service templates:

```bash
sudo cp deploy/systemd/upwork-agent-*.service /etc/systemd/system/
sudo cp deploy/systemd/upwork-agent-health.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

Enable browser session, lead engine, and health timer:

```bash
sudo systemctl enable --now upwork-agent-browser-session.service
sudo systemctl enable --now upwork-agent-slack-socket.service
sudo systemctl enable --now upwork-agent-lead-engine.service
sudo systemctl enable --now upwork-agent-health.timer
```

Disable always-on mode:

```bash
sudo systemctl disable --now upwork-agent-lead-engine.service
sudo systemctl disable --now upwork-agent-slack-socket.service
sudo systemctl disable --now upwork-agent-health.timer
```

If browser manual attention is needed:

```bash
sudo systemctl stop upwork-agent-lead-engine.service
```

Resolve the browser problem manually, then start it again.

## 10. Logs and health

View logs:

```bash
journalctl -u upwork-agent-browser-session.service -f
journalctl -u upwork-agent-slack-socket.service -f
journalctl -u upwork-agent-lead-engine.service -f
journalctl -u upwork-agent-health.service -f
```

Run health manually:

```bash
sudo -u upwork-agent npm run health
```

Expected behaviors:

- qualified leads go to Slack
- browser login failures or challenge states pause work
- health alerts are rate-limited
- no automatic final submit occurs

## 11. Rollback

If the server rollout goes bad:

1. stop services

```bash
sudo systemctl stop upwork-agent-lead-engine.service
sudo systemctl stop upwork-agent-health.timer
```

2. revert to safer runtime settings in `.env`

```env
AGENT_ENGINE_ENABLED=false
BROWSER_WORKER_ENABLED=false
BROWSER_DRY_RUN=true
```

3. keep the database and browser profile intact
4. restore the previous known-good commit if needed
5. rerun:

```bash
sudo -u upwork-agent npm run build
sudo -u upwork-agent npm run validate:promotion
```

## 12. What remains manual

These actions stay manual by policy:

- final Upwork submit
- CAPTCHA and challenge handling
- re-login and 2FA
- manual browser recovery
- any questionable Connects-spend decision
- any proof upload that needs judgment

The server can prepare work continuously. It does not replace human judgment at the final gate.
