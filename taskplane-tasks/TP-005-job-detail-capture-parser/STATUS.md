# TP-005: Job Detail Capture Parser — Status

**Current Step:** Step 3: Documentation and sample
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 8
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Required files and paths exist
- [x] Dependencies satisfied

---

### Step 1: Parser module and types
**Status:** ✅ Complete

Plan: add a pure `src/jobCapture.ts` module exporting typed parsed job-detail output plus a `parseJobDetailCapture(text, options?)` API. The parser will normalize pasted browser text by lines, derive a stable Upwork job ID from `~...` URLs or explicit IDs when present, accept an optional URL for Step 2 CLI integration, and return both capture-specific fields and a `manualJob` shape aligned with `config/manual-jobs.json`. Extraction will use conservative regex/section fallbacks for title, description, posted time, location, budget/hourly/fixed type, duration, experience level, skills, activity metrics, Connects, and client spend/rating/location; missing numeric fields become `null` in parsed metadata and safe manual-job defaults. Validate by adding the module, checking representative beauty-brand-style text mentally/sample-compatible, then running `npm run build`.

- [x] Add review revision plan for parser API, field coverage, fallbacks, and build validation
- [x] Create parser for Upwork job detail pasted text
- [x] Extract core job/client/activity fields with fallbacks
- [x] Build passes
- [x] Fix code review parser issues for pasted URL extraction, slug job IDs, and `$10K+` client spend

---

### Step 2: CLI integration
**Status:** ✅ Complete
- [x] Add CLI command for `--file` and optional `--url`
- [x] Create/update manual jobs by stable ID/URL
- [x] Print extracted summary and next command
- [x] Build passes

---

### Step 3: Documentation and sample
**Status:** 🟨 In Progress
- [x] Add sample capture text
- [x] Update README workflow
- [ ] Fix sample-visible client rating extraction for `out of 5` wording

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Full tests or no-test-script note
- [ ] Build passes
- [ ] Sample capture tested

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Docs updated
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-10 17:31 | Task started | Runtime V2 lane-runner execution |
| 2026-05-10 17:31 | Step 0 started | Preflight |

## Blockers

*None*
| 2026-05-10 17:33 | Review R001 | plan Step 1: REVISE |
| 2026-05-10 17:33 | Review R002 | plan Step 1: APPROVE |
| 2026-05-10 17:36 | Review R003 | code Step 1: REVISE |
| 2026-05-10 17:37 | Review R004 | code Step 1: APPROVE |
| 2026-05-10 17:38 | Review R005 | plan Step 2: APPROVE |
| 2026-05-10 17:41 | Review R006 | code Step 2: APPROVE |
| 2026-05-10 17:42 | Review R007 | plan Step 3: APPROVE |
| 2026-05-10 17:43 | Review R008 | code Step 3: REVISE |
