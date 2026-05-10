# TP-004: Semantic Dedupe — Status

**Current Step:** Step 1: Add fingerprinting utilities
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Required files and paths exist
- [x] Dependencies satisfied

---

### Step 1: Add fingerprinting utilities
**Status:** 🟨 In Progress

- [x] Create `src/dedupe.ts` with normalization, fingerprinting, and similarity scoring
- [x] Fingerprint considers stable job fields and ignores noise
- [x] Add dedupe result types if necessary
- [x] Run targeted build/typecheck: `npm run build`

---

### Step 2: Integrate dedupe into fetch pipeline
**Status:** ⬜ Not Started

- [ ] Dedupe by exact ID first and near-duplicate similarity second
- [ ] Keep strongest/latest duplicate candidate deterministically
- [ ] Log dedupe counts by source
- [ ] Run targeted build/typecheck: `npm run build`

---

### Step 3: Persist fingerprints for seen jobs
**Status:** ⬜ Not Started

- [ ] Add nullable `fingerprint` column to `seen_jobs`
- [ ] Store fingerprint when marking jobs seen
- [ ] Use stored fingerprints to suppress practical repost duplicates
- [ ] Run targeted build/typecheck: `npm run build`

---

### Step 4: Documentation
**Status:** ⬜ Not Started

- [ ] Update README with dedupe behavior
- [ ] Document conservative deterministic strategy

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing or absence of test script documented
- [ ] All failures fixed
- [ ] Build passes

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-10 16:28 | Task started | Runtime V2 lane-runner execution |
| 2026-05-10 16:28 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
| 2026-05-10 16:29 | Review R001 | plan Step 1: APPROVE |
