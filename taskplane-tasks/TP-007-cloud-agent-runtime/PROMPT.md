# Task: TP-007 - Cloud Agent Runtime

**Created:** 2026-05-10
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Adds deployment/runtime documentation and scripts for VM/cloud operation. Mostly config/docs with limited code changes, low risk.
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 1, Security: 1, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-007-cloud-agent-runtime/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Prepare the project to run as a background agent on a VM/cloud host. The agent should poll sources, process manual/browser queues, persist SQLite data, and expose clear operational commands without depending on the user's local machine. This task focuses on runtime scaffolding and documentation, not full browser submission automation.

## Dependencies

- **Task:** TP-006 (Browser queue foundation should exist or be accounted for; if not complete, document pending integration and implement only independent runtime pieces)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `README.md` — existing Docker/runtime docs
- `docker-compose.yml`
- `Dockerfile`
- `.env.example`
- `docs/PRODUCT_VISION.md`

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** Docker optional; do not require actual deployment.

## File Scope

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `README.md`
- `docs/DEPLOYMENT.md`
- `package.json`

## Steps

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] Dependencies satisfied or documented

### Step 1: Runtime commands and modes

- [ ] Review package scripts and add clear commands for worker, one-shot run, analytics, browser queue worker if available, and health/report checks
- [ ] Ensure commands are suitable for VM/cloud execution and do not require local desktop control
- [ ] Run targeted build: `npm run build`

### Step 2: Deployment documentation

- [ ] Create `docs/DEPLOYMENT.md` with VM/cloud setup, env vars, persistent volumes, SQLite backup notes, browser session storage model, and operational runbook
- [ ] Include safety guidance: no CAPTCHA/2FA bypass, human approval mode, secret handling, and Upwork ToS/platform-risk awareness

### Step 3: Docker/compose review

- [ ] Update Dockerfile/docker-compose only if needed for persistent data/profile/attachments/captures/artifacts volumes
- [ ] Keep changes conservative and build-compatible

### Step 4: Testing & Verification

- [ ] Run FULL test suite if available; document absence if not
- [ ] Build passes: `npm run build`
- [ ] README links to deployment doc

### Step 5: Documentation & Delivery

- [ ] Must Update docs modified
- [ ] Discoveries logged

## Documentation Requirements

**Must Update:**
- `README.md` — link to deployment doc and runtime modes
- `docs/DEPLOYMENT.md` — new deployment/runbook doc

**Check If Affected:**
- `.env.example`
- `docker-compose.yml`
- `Dockerfile`

## Completion Criteria

- [ ] Project has a clear VM/cloud deployment runbook
- [ ] Persistent data/session/artifact directories are documented
- [ ] Background-agent commands are documented
- [ ] Build passes

## Git Commit Convention

Commits must include `TP-007`.

## Do NOT

- Push to any remote
- Require real Upwork credentials for tests
- Add auto-submit behavior
- Store plaintext credentials

---

## Amendments (Added During Execution)
