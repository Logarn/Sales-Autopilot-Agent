# Task: TP-012 - Scheduler and Heartbeats

**Created:** 2026-05-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds autonomous runtime primitives: queue/scheduler loop, heartbeat table, health checks, and stale-worker alerts. Touches DB/config/runtime but no credentials/auth changes.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-012-scheduler-heartbeats/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Add the true autonomy foundation: a scheduler that can run every 5–10 minutes, heartbeat records for workers, health commands, stale-worker detection, and Slack alerts when the agent is stuck. This prepares the app to run continuously on a VM/cloud instance.

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `src/index.ts`
- `src/db.ts`
- `src/slack.ts`
- `src/browserQueue.ts`
- `docs/DEPLOYMENT.md`
- `.env.example`

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None

## File Scope

- `src/scheduler.ts`
- `src/heartbeat.ts`
- `src/db.ts`
- `src/config.ts`
- `src/slack.ts`
- `src/index.ts`
- `package.json`
- `.env.example`
- `README.md`
- `docs/DEPLOYMENT.md`

## Steps

### Step 0: Preflight
- [ ] Required files and paths exist
- [ ] Dependencies satisfied

### Step 1: Heartbeat schema and helpers
- [ ] Add heartbeat table with worker, status, lastRunAt, lastSuccessAt, run counts, error summary, metadata JSON
- [ ] Add helper functions to write/read/stale heartbeats
- [ ] Run targeted build: `npm run build`

### Step 2: Scheduler loop
- [ ] Add scheduler module that can run configured jobs every 5–10 minutes without blocking shutdown
- [ ] Include jobs for pipeline run, browser queue processing if enabled, and health checks
- [ ] Add npm script for agent/scheduler mode
- [ ] Run targeted build: `npm run build`

### Step 3: Health checks and Slack alerts
- [ ] Add health command/report for heartbeat status
- [ ] Add Slack alert helper for stale workers and auth-required/browser-required states using existing webhook
- [ ] Ensure alerts are rate-limited or conservative to avoid spam
- [ ] Run targeted build: `npm run build`

### Step 4: Docs/config
- [ ] Update env example with scheduler/heartbeat thresholds
- [ ] Update README and deployment doc with autonomous runtime and health commands

### Step 5: Testing & Verification
- [ ] Run full tests if available; document env limitations
- [ ] Build passes: `npm run build`
- [ ] Run health command locally

### Step 6: Documentation & Delivery
- [ ] Docs updated
- [ ] Discoveries logged

## Documentation Requirements

**Must Update:**
- `README.md`
- `.env.example`
- `docs/DEPLOYMENT.md`

**Check If Affected:**
- `docs/PRODUCT_VISION.md`

## Completion Criteria

- [ ] Scheduler mode exists
- [ ] Heartbeat health command works
- [ ] Slack stale-worker alert path exists
- [ ] Build passes

## Git Commit Convention

Commits must include `TP-012`.

## Do NOT

- Require real Slack/Upwork credentials for tests
- Spam Slack on every run
- Auto-submit proposals

---

## Amendments (Added During Execution)
