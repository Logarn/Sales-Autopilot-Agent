# Mayor Production Playbook

This playbook is the Mayor-owned path for deploying merged `origin/main` to the
Contabo host. It is intentionally narrow: no feature branches, no broad logs, no
secret printing, no production action before the gates are clean, and no final
Upwork submit automation.

## Scope

- Repo: `https://github.com/Logarn/upwork-autonomous-agent.git`
- Production checkout: `/opt/upwork-agent/app`
- Local Mayor coordination repo: `/Users/admin/upwork-rss-reader-gascity-test`
- Production user: `upwork-agent`
- Services:
  - `upwork-agent-browser-session.service`
  - `upwork-agent-slack-socket.service`
  - `upwork-agent-lead-engine.service`
  - `upwork-agent-health.timer`

Final submit remains manual. CAPTCHA, Cloudflare, login, passkey, and 2FA flows
remain manual browser work in the server VNC session.

## Hard Gates

Stop immediately if any gate fails.

1. Verify the repo and remote:

   ```bash
   cd /opt/upwork-agent/app
   git remote get-url origin
   ```

   Expected:

   ```text
   https://github.com/Logarn/upwork-autonomous-agent.git
   ```

2. Verify the checkout is production-safe:

   ```bash
   git status --short --branch
   git fetch origin main
   git rev-parse HEAD
   git rev-parse origin/main
   ```

   Production deployment must run from `main`, with a clean worktree, after a
   fast-forward pull from `origin/main`. Never deploy a feature branch.

3. Stop write-capable services before updating code:

   ```bash
   sudo systemctl stop upwork-agent-lead-engine.service
   sudo systemctl stop upwork-agent-slack-socket.service
   ```

   Keep the browser session running unless it is unhealthy or the browser
   service itself is being updated.

4. Pull merged main only:

   ```bash
   git pull --ff-only origin main
   ```

   If this is not a fast-forward from `origin/main`, stop and report.

5. Install and validate without printing secrets:

   ```bash
   npm ci
   npm run build
   npm run validate:promotion
   npm run proof:check
   npm run validate:contabo-env /opt/upwork-agent/app/.env
   ENV_FILE=/opt/upwork-agent/app/.env npm run preflight:contabo
   ```

   `validate:contabo-env` checks key presence and production shape; it does not
   print token values. Do not use `cat .env`, `printenv`, broad `journalctl`, or
   shell tracing with env loaded.

6. Verify browser/session health:

   ```bash
   sudo systemctl start upwork-agent-browser-session.service
   sudo -u upwork-agent ENV_FILE=/opt/upwork-agent/app/.env npm run browser:session:check
   ```

   If the browser shows login, 2FA, CAPTCHA, Cloudflare, access denied, or
   another challenge, stop automation and clear it manually in VNC.

7. Start Slack Socket Mode before the lead engine:

   ```bash
   sudo systemctl start upwork-agent-slack-socket.service
   ```

8. Run smoke and one controlled dry run:

   ```bash
   sudo -u upwork-agent ENV_FILE=/opt/upwork-agent/app/.env npm run production:smoke
   sudo -u upwork-agent ENV_FILE=/opt/upwork-agent/app/.env npm run agent:run-once:dry
   ```

9. Start the lead engine only after every gate above is clean:

   ```bash
   sudo systemctl start upwork-agent-lead-engine.service
   sudo systemctl start upwork-agent-health.timer
   ```

10. Write a structured report with statuses only. Include SHAs, service states,
    command names, pass/fail results, and blockers. Do not include secrets or
    broad historical logs.

## Helper

The helper wraps the gates above and writes a compact markdown report:

```bash
sudo -u upwork-agent \
  ENV_FILE=/opt/upwork-agent/app/.env \
  npm run mayor:production-check -- \
    --pull-origin-main \
    --install \
    --manage-services \
    --start-lead-engine \
    --report /opt/upwork-agent/shared/logs/mayor-production-check.md
```

Behavior:

- verifies the expected origin remote
- fetches `origin/main`
- refuses non-`main` production checkouts
- refuses dirty production checkouts
- fast-forwards from `origin/main` only when `--pull-origin-main` is set
- stops lead and Slack services before update checks
- runs build, promotion validation, proof checks, env validation, preflight,
  browser check, production smoke, and controlled dry run
- starts Slack Socket Mode before the lead engine
- starts the lead engine only with `--start-lead-engine` after clean gates
- writes a markdown report without env values

Developer/template validation can use `.env.example` without touching services:

```bash
ENV_FILE=.env.example npm run mayor:production-check -- \
  --local-template \
  --report /tmp/mayor-production-template-report.md
```

Template mode is not a production deployment. It exists to verify the helper and
documentation from a feature branch. Because local developer worktrees do not
carry production proof files, template mode runs the proof asset unit gate;
production mode runs `npm run proof:check` against the server asset root.

## Rollback

If deployment is unstable:

```bash
sudo systemctl stop upwork-agent-lead-engine.service
sudo systemctl stop upwork-agent-health.timer
sudo systemctl stop upwork-agent-slack-socket.service
```

Set safe runtime flags in `/opt/upwork-agent/app/.env`:

```env
AGENT_ENGINE_ENABLED=false
BROWSER_WORKER_ENABLED=false
BROWSER_DRY_RUN=true
```

Keep the database and browser profile intact. Restore the previous known-good
commit only after identifying the target SHA, then rerun the full gate sequence.

## Sample Report

```markdown
# Mayor Production Check Report

- generated_at: `2026-06-10T01:20:00+03:00`
- repo: `/opt/upwork-agent/app`
- env_file: `/opt/upwork-agent/app/.env`
- local_template: `0`
- manage_services: `1`
- start_lead_engine: `1`

| Gate | Status | Detail |
| --- | --- | --- |
| origin remote | ok | `https://github.com/Logarn/upwork-autonomous-agent.git` |
| fetch origin/main | ok | `git fetch origin main` |
| pull merged origin/main only | ok | `git pull --ff-only origin main` |
| build | ok | `npm run build` |
| promotion validation | ok | `npm run validate:promotion` |
| proof assets | ok | `npm run proof:check` |
| env validation | ok | `bash scripts/validate-contabo-env.sh /opt/upwork-agent/app/.env` |
| contabo preflight | ok | `env ENV_FILE=/opt/upwork-agent/app/.env npm run preflight:contabo` |
| browser session check | ok | `env ENV_FILE=/opt/upwork-agent/app/.env npm run browser:session:check` |
| service start upwork-agent-slack-socket.service | ok | `systemctl start upwork-agent-slack-socket.service` |
| production smoke | ok | `env ENV_FILE=/opt/upwork-agent/app/.env npm run production:smoke` |
| controlled dry run | ok | `env ENV_FILE=/opt/upwork-agent/app/.env npm run agent:run-once:dry` |
| service start upwork-agent-lead-engine.service | ok | `systemctl start upwork-agent-lead-engine.service` |

Final submit remains manual. Secrets are not printed by this report.
```
