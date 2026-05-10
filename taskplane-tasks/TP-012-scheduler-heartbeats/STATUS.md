# TP-012: Scheduler and Heartbeats — Status

**Current Step:** Step 2: Scheduler loop
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 4
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Required files and paths exist
- [x] Dependencies satisfied

---

### Step 1: Heartbeat schema and helpers
**Status:** ✅ Complete
- [x] Add heartbeat table with required fields and idempotent creation
- [x] Add helper functions for upsert/read/list/stale detection with stable timestamps and JSON metadata defaults
- [x] Validate helper behavior or document why only build validation is possible
- [x] Build passes

---

### Step 2: Scheduler loop
**Status:** 🟨 In Progress
- [ ] Add scheduler module with configurable 5–10 minute cadence, non-overlapping jobs, and graceful stop semantics
- [ ] Include pipeline/browser/health jobs with browser-worker gating and heartbeat recording
- [ ] Add npm script
- [ ] Build passes

---

### Step 3: Health checks and Slack alerts
**Status:** ⬜ Not Started
- [ ] Add health command/report
- [ ] Add Slack stale-worker alert helper
- [ ] Avoid alert spam
- [ ] Build passes

---

### Step 4: Docs/config
**Status:** ⬜ Not Started
- [ ] Env example updated
- [ ] README/deployment updated

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Full tests or env limitation note
- [ ] Build passes
- [ ] Health command tested

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Docs updated
- [ ] Discoveries logged

---

## Reviews
| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | Plan | 1 | REVISE | .reviews/R001-plan-step1.md |
| R002 | Plan | 1 | APPROVE | .reviews/R002-plan-step1.md |
| R003 | Code | 1 | APPROVE | n/a |
| R004 | Plan | 2 | REVISE | .reviews/R004-plan-step2.md |

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Plan reviewer suggested shared TypeScript heartbeat types for scheduler and health reporting. | Advisory; applied via src/heartbeat.ts exports. | Step 1 plan review |
| Plan reviewer suggested scheduler jobs record heartbeats so health reporting can consume real data. | Advisory; include in Step 2 implementation. | Step 2 plan review |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-10 20:41 | Task started | Runtime V2 lane-runner execution |
| 2026-05-10 20:41 | Step 0 started | Preflight |

## Blockers
*None*
| 2026-05-10 20:42 | Review R001 | plan Step 1: REVISE |
| 2026-05-10 20:43 | Review R002 | plan Step 1: APPROVE |
| 2026-05-10 20:45 | Review R003 | code Step 1: APPROVE |
| 2026-05-10 20:46 | Review R004 | plan Step 2: REVISE |
