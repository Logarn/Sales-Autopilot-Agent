# TP-014: Browser Search Agent — Status

**Current Step:** Step 2: Browser search runner
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 3
**Review Counter:** 4
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Required files and paths exist
- [x] Dependencies satisfied or documented

---

### Step 1: Search config and query model
**Status:** ✅ Complete

**Plan:** Extend `src/config.ts` using existing env parsing/default patterns with browser-search enablement, dry-run/no-browser behavior, interval minutes, max jobs per query, query list/URLs, and freshness window while keeping Playwright/credentials optional. Add exported query/result/captured-page shapes and URL/text helper boundaries in `src/types.ts`/new search module so later runner code can hand off conservative captures to existing capture/normalization paths. Verify with `npm run build`.

- [x] Add explicit Step 1 plan covering config fields, model boundaries, dry-run safety, and build verification
- [x] Add search config
- [x] Add types/helpers
- [x] Build passes
- [x] Restrict browser search URL inputs to Upwork job search pages and harden job URL safety checks
- [x] Add executable checks for browser search URL/query normalization safety

---

### Step 2: Browser search runner
**Status:** 🟨 In Progress
- [ ] Open configured Upwork searches when enabled
- [ ] Detect login/security states and pause safely
- [ ] Capture links/details and hand off downstream
- [ ] Dry-run behavior works
- [ ] Build passes

---

### Step 3: Queue/scheduler integration
**Status:** ⬜ Not Started
- [ ] Add search command/scheduler hook
- [ ] Write heartbeat metadata
- [ ] Keep RSS/Apify fallback behavior
- [ ] Build passes

---

### Step 4: Documentation
**Status:** ⬜ Not Started
- [ ] README/deployment updated

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Full tests or env limitation note
- [ ] Build passes
- [ ] Dry-run command tested

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Docs updated
- [ ] Discoveries logged

---

## Reviews
| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | Plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R002 | Plan | Step 1 | APPROVE | .reviews/R002-plan-step1.md |
| R003 | Code | Step 1 | REVISE | .reviews/R003-code-step1.md |
| R004 | Code | Step 1 | APPROVE | .reviews/R004-code-step1.md |

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Playwright is intentionally optional via src/playwright-optional.d.ts and must remain optional for dry-run/build safety. | Preserve optional import/availability checks while implementing browser search. | package.json, src/playwright-optional.d.ts |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-10 21:37 | Task started | Runtime V2 lane-runner execution |
| 2026-05-10 21:37 | Step 0 started | Preflight |

## Blockers
*None*
| 2026-05-10 21:38 | Review R001 | plan Step 1: REVISE |
| 2026-05-10 21:39 | Review R002 | plan Step 1: APPROVE |
| 2026-05-10 21:41 | Review R003 | code Step 1: REVISE |
| 2026-05-10 21:43 | Review R004 | code Step 1: APPROVE |
