# TP-004: Semantic Dedupe — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Required files and paths exist
- [ ] Dependencies satisfied

---

### Step 1: Add fingerprinting utilities
**Status:** ⬜ Not Started

- [ ] Create `src/dedupe.ts` with normalization, fingerprinting, and similarity scoring
- [ ] Fingerprint considers stable job fields and ignores noise
- [ ] Add dedupe result types if necessary
- [ ] Run targeted build/typecheck: `npm run build`

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
