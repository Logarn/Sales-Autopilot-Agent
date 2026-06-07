# Upwork Sales Operator

A Slack-first tool for finding better Upwork leads, preparing stronger applications, and keeping the final submit button in human hands.

It watches configured job sources, filters out noise, scores the real sales opportunity, drafts proposals, chooses proof, prepares application pages in remote Chrome, and leaves the work ready for review. It is built for a human operator who wants speed without giving up judgment or control.

This is not an auto-apply bot. It helps get high-quality applications ready faster. The human still reviews and submits.

## What It Does

- Finds Upwork jobs from configured sources, manual captures, and browser search.
- Deduplicates reposts and repeated leads before they waste attention.
- Scores jobs for fit, client quality, budget, red flags, Connects risk, and proof match.
- Posts short Slack lead threads and understands natural replies like "prep it", "what's ready?", "retry", or "show me the cover letter".
- Drafts proposals and screening answers from local profile, proof, portfolio, and voice notes.
- Chooses relevant proof files and Upwork portfolio items instead of dumping every asset.
- Prepares approved application pages in remote Chrome and stops before final submit.
- Keeps prepared applications open in a protected QA workspace so they are easy to review in VNC.
- Brings the right remote Chrome tab to the front from Slack, so no manual URL copy/paste is needed.
- Shows a compact QA queue for ready and blocked applications.
- Records outcomes, Connects use, proof choices, and operator corrections so the workflow improves over time.

## Product Flow

1. A lead is found and scored.
2. A short Slack thread explains why it is worth pursuing or skipping.
3. The operator replies naturally in Slack.
4. The system drafts in Slack first when asked, or prepares the remote Chrome application page.
5. The prepared page stays open in a protected QA tab.
6. The operator reviews in VNC, asks for changes in Slack, or manually clicks final submit.
7. Results and learnings are tracked for future lead selection and proposal quality.

## Safety Rules

These are hard boundaries:

- Final submit is always manual.
- CAPTCHA, login, 2FA, Cloudflare, and browser security checks are never bypassed.
- Files are only reported as attached after the uploaded filenames are visible and verified.
- Portfolio items are only reported as selected after the selected labels are visible and verified.
- Cover letters are only reported as filled after the field content is verified.
- Raw action IDs, channel IDs, thread IDs, and queue internals stay out of normal Slack unless debug details are requested.
- Browser work is dry-run or disabled by default until explicitly configured.

## Stack

- Node.js and TypeScript
- SQLite for local state, dedupe, applications, browser queue, memory, and reflections
- Slack Web API plus Socket Mode for two-way Slack control
- Remote Chrome over CDP for browser-assisted application prep
- Apify, manual captures, and browser search for job discovery
- Optional provider routing for job judgment and Slack copywriting, including xAI/Grok and Moonshot/Kimi

## Quick Start

```bash
npm install
cp .env.example .env
npm run build
npm run agent:run-once:dry
npm run validate:promotion
```

For production-style Slack control, configure the Slack app credentials in `.env` and run:

```bash
npm run slack:socket
```

For remote Chrome review work:

```bash
npm run browser:session
npm run browser:cdp:check
BROWSER_WORKER_ENABLED=true npm run browser:worker
```

Browser actions remain conservative by default. Check `.env.example` before enabling live browser work.

## Useful Commands

- `npm run scheduler` - run the continuous discovery loop.
- `npm run slack:socket` - listen for Slack thread replies.
- `npm run browser:search` - run browser search in dry-run or live mode depending on env settings.
- `npm run browser:list` - inspect queued browser actions.
- `npm run app:report` - show application and outcome status.
- `npm run app:analytics` - report replies, interviews, hires, proof usage, and Connects efficiency.
- `npm run knowledge:add` - add local profile, proof, or voice notes.
- `npm run portfolio:upsert` - add or update reusable portfolio metadata.
- `npm run validate:promotion` - run the promotion gate before packaging or deployment.

## Configuration

Start with `.env.example`. The most important settings are:

- Slack: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `DISCOVERY_SLACK_CHANNEL_ID`, `SLACK_ALLOWED_CHANNEL_IDS`
- Discovery: `APIFY_API_TOKEN`, `SEARCH_QUERIES`, `BROWSER_SEARCH_URLS`
- Runtime: `DB_PATH`, `SCHEDULER_INTERVAL_MS`, `TIMEZONE`
- Browser: `BROWSER_DRY_RUN`, `BROWSER_SEARCH_ENABLED`, `BROWSER_WORKER_ENABLED`, `BROWSER_SESSION_MODE`
- Optional model routes: `JOB_INTELLIGENCE_PROVIDER`, `JOB_INTELLIGENCE_MODEL`, `SLACK_COPY_PROVIDER`, `SLACK_COPY_MODEL`

## Docs

- Deployment notes: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Contabo runbook: [docs/CONTABO_RUNBOOK.md](docs/CONTABO_RUNBOOK.md)
- Slack Web API and Socket Mode setup: [docs/SLACK_WEB_API_SOCKET_MODE_DEPLOYMENT.md](docs/SLACK_WEB_API_SOCKET_MODE_DEPLOYMENT.md)
- Browser safety model and apply prep details live in the browser-related docs and tests.

## Project Shape

```text
src/          TypeScript source
config/       query and source configuration
profile/      local profile, proof, portfolio, and voice knowledge
skills/       workflow playbooks
docs/         deployment and operational runbooks
data/         local SQLite state
```

## License

MIT License

Copyright (c)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
