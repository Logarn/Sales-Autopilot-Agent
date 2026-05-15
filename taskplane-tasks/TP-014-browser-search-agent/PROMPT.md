# Task: TP-014 - Browser Search Agent

**Created:** 2026-05-10
**Size:** L

## Review Level: 3 (Full)

**Assessment:** Implements the browser-based search backbone for authenticated Upwork polling. It touches browser worker/search/runtime logic and must preserve platform safety, so full review is warranted.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-014-browser-search-agent/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Build the browser search agent foundation so the VM/cloud browser session can become the primary source of Upwork opportunities. It should poll configured searches every 5–10 minutes, open job detail pages, capture text safely, enqueue normalization/scoring, and treat RSS/Apify as fallback only. It must not bypass login/CAPTCHA/2FA and must run safely in dry-run/no-credentials mode.

## Dependencies

- **External:** Scheduler/heartbeats and LLM normalization are already integrated in `main`.

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `src/browserWorker.ts`
- `src/browserQueue.ts`
- `src/jobCapture.ts`
- `src/normalization.ts` if present
- `docs/DEPLOYMENT.md`
- `docs/PRODUCT_VISION.md`

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None for build. Browser execution must be optional and dry-run safe.

## File Scope

- `src/browserSearch.ts`
- `src/browserWorker.ts`
- `src/browserQueue.ts`
- `src/config.ts`
- `src/types.ts`
- `package.json`
- `.env.example`
- `README.md`
- `docs/DEPLOYMENT.md`

## Steps

### Step 0: Preflight
- [ ] Required files and paths exist
- [ ] Dependencies satisfied or documented

### Step 1: Search config and query model
- [ ] Add config for browser search interval, max jobs per query, search queries, freshness window, and dry-run controls
- [ ] Add types/helpers for browser search results and captured job pages
- [ ] Build passes

### Step 2: Browser search runner
- [ ] Implement runner that opens configured Upwork search URLs/queries in a persistent browser context when enabled
- [ ] Detect login/security challenge states and pause/heartbeat rather than bypass
- [ ] Capture job links/detail text conservatively and enqueue/hand off to existing job capture/normalization path
- [ ] Provide no-browser/dry-run behavior for local testing
- [ ] Build passes

### Step 3: Queue/scheduler integration
- [ ] Add browser search command and optional scheduler hook
- [ ] Write heartbeat/summary metadata for searches run/jobs found/errors
- [ ] Ensure RSS/Apify remain fallbacks, not blockers
- [ ] Build passes

### Step 4: Documentation
- [ ] Update README and deployment docs with browser-search setup and safety model

### Step 5: Testing & Verification
- [ ] Run full tests if available; document env limitations
- [ ] Build passes
- [ ] Dry-run command works without Upwork credentials

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
- `skills/upwork-search/SKILL.md` if present

## Completion Criteria

- [ ] Browser search command/runner exists
- [ ] Dry-run/no-credentials mode works
- [ ] Auth/security challenges pause safely
- [ ] Build passes

## Git Commit Convention

Commits must include `TP-014`.

## Do NOT

- Bypass CAPTCHA/2FA/security checks
- Store plaintext Upwork credentials
- Auto-apply or submit proposals
- Require browser credentials for build/tests

---

## Amendments (Added During Execution)
