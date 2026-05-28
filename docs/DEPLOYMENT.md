# Deployment Overview

This document is the short deployment map for the Upwork Agent test repo.

Primary repo:

- `/Users/admin/upwork-rss-reader-gascity-test`

Primary detailed runbook:

- [docs/CONTABO_RUNBOOK.md](CONTABO_RUNBOOK.md)

## What the agent does

The agent is a Slack-first Upwork lead pipeline:

1. discover jobs
2. normalize and score them
3. apply platform, proof, and Connects guardrails
4. send qualified leads to Slack
5. optionally prepare browser-side draft work
6. stop before final submit

It is not an uncontrolled auto-apply bot.

## Runtime layers

### Slack

- Slack Web API is the production outbound path for parent lead messages and thread replies
- Socket Mode is the production inbound path for opportunity-thread commands
- incoming webhook is fallback-only and cannot preserve one-job-one-thread state by itself
- Slack is the primary operator surface
- run `npm run slack:socket` persistently, or use `deploy/systemd/upwork-agent-slack-socket.service`

### Lead engine

- `npm run agent:run-once:dry` validates one safe dry-run cycle
- `npm run agent:run-once` runs one non-continuous live cycle
- `npm run agent:run` is the continuous lead-engine command used later by `systemd`

### Browser / CDP

- preferred deployment mode is `BROWSER_SESSION_MODE=cdp`
- a persistent Chrome session runs on the server
- the operator logs into Upwork manually once on the server
- the browser worker must not bypass login or challenge flows
- final submit remains manual

### LLM providers

Supported deployment paths:

- OpenAI
- OpenRouter
- generic OpenAI-compatible providers such as xAI, Moonshot/Kimi, and Mistral

Provider-specific examples live in:

- `.env.example`
- [docs/CONTABO_RUNBOOK.md](CONTABO_RUNBOOK.md)

## Validation commands

Use these before packaging or server rollout:

```bash
npm run build
npm run validate:promotion
npm run validate:contabo-env
npm run preflight:contabo
```

`validate:promotion` is the single deployability gate for the repo.

## Deployment assets

Systemd templates:

- `deploy/systemd/upwork-agent-browser-session.service`
- `deploy/systemd/upwork-agent-lead-engine.service`
- `deploy/systemd/upwork-agent-slack-socket.service`
- `deploy/systemd/upwork-agent-health.service`
- `deploy/systemd/upwork-agent-health.timer`

Validation scripts:

- `scripts/validate-promotion.sh`
- `scripts/validate-contabo-env.sh`
- `scripts/preflight-contabo.sh`

## What remains manual

- final Upwork submit
- CAPTCHA / challenge handling
- re-login / 2FA
- manual browser recovery
- any questionable Connects-spend decision

## Rollback

If a deployment is unstable:

1. stop the lead engine service
2. disable continuous mode
3. set `BROWSER_DRY_RUN=true`
4. keep browser profile and database intact
5. restore a known-good commit if needed
6. rerun validation before re-enabling services

The full rollback sequence is documented in [docs/CONTABO_RUNBOOK.md](CONTABO_RUNBOOK.md).
