# Task: TP-006 - Browser Queue Foundation

**Created:** 2026-05-10
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Adds a browser-action queue and cloud/VM-safe browser worker skeleton. It introduces new architecture but must not submit proposals or bypass platform controls. Data model changes are reversible migrations.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-006-browser-queue-foundation/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Build the safe foundation for a future browser-based Upwork agent that can run on a VM/cloud instance without taking control of the user's local machine. This task should create a browser-action queue, policy guardrails, and a Playwright-compatible worker skeleton that can open Upwork pages and detect login/auth-required states. It must remain human-in-the-loop: no automatic final submission, no CAPTCHA/2FA bypass, no stealth/evasion.

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `docs/PRODUCT_VISION.md` — human approval and platform-risk philosophy
- `profile/connects-rules.json` — Connects guardrails
- `src/applications.ts` — application status/submission tracking
- `src/db.ts` — migration style

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None; Playwright may be added as an optional dependency if needed, but do not require real Upwork login to test build.

## File Scope

- `src/browserQueue.ts`
- `src/browserWorker.ts`
- `src/db.ts`
- `src/config.ts`
- `src/types.ts`
- `package.json`
- `.env.example`
- `README.md`
- `docs/PRODUCT_VISION.md`

## Steps

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] Dependencies satisfied

### Step 1: Queue schema and CLI

- [ ] Add `browser_actions` table with fields for job_id, action_type, status, payload JSON, attempts, last_error, created_at, updated_at
- [ ] Add CLI helpers to enqueue actions such as `open_job`, `open_apply_page`, and `prepare_application_review`
- [ ] Add list/update commands for queued actions
- [ ] Run targeted build: `npm run build`

### Step 2: Browser worker skeleton

- [ ] Create `src/browserWorker.ts` that processes pending browser actions in dry-run/safe mode by default
- [ ] If Playwright is used, launch a browser context with a configurable user data dir suitable for VM/cloud persistent sessions
- [ ] Detect and log states: login required, 2FA required, CAPTCHA/security challenge, job page loaded, apply page loaded
- [ ] Do not fill or submit proposals in this task; only prepare/read pages and save diagnostic artifacts when configured
- [ ] Run targeted build: `npm run build`

### Step 3: Safety/policy guardrails

- [ ] Add config flags for `BROWSER_WORKER_ENABLED`, `BROWSER_HEADLESS`, `BROWSER_USER_DATA_DIR`, `BROWSER_DRY_RUN`, and artifact directory
- [ ] Enforce dry-run default and explicit opt-in for browser worker
- [ ] Document that the system must not bypass CAPTCHA/2FA and must pause for human intervention
- [ ] Run targeted build: `npm run build`

### Step 4: Documentation

- [ ] Update README with browser queue commands and cloud-session model
- [ ] Update docs/product vision with browser queue / approval-first architecture if needed

### Step 5: Testing & Verification

- [ ] Run FULL test suite if available; document absence if not
- [ ] Build passes: `npm run build`
- [ ] CLI can enqueue and list a sample browser action without Upwork credentials

### Step 6: Documentation & Delivery

- [ ] Must Update docs modified
- [ ] Discoveries logged

## Documentation Requirements

**Must Update:**
- `README.md` — browser queue setup and commands
- `.env.example` — browser worker config

**Check If Affected:**
- `docs/PRODUCT_VISION.md`

## Completion Criteria

- [ ] Browser queue exists and can be managed from CLI
- [ ] Worker skeleton can safely process/skip actions without credentials
- [ ] Browser automation is explicitly human-in-the-loop and dry-run by default
- [ ] Build passes

## Git Commit Convention

Commits must include `TP-006`.

## Do NOT

- Do not auto-submit proposals
- Do not bypass CAPTCHA, Cloudflare, 2FA, or anti-bot systems
- Do not store plaintext Upwork passwords
- Do not take control of the user's local browser session
- Do not push to GitHub

---

## Amendments (Added During Execution)
