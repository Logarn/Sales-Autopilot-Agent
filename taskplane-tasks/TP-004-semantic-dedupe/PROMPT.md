# Task: TP-004 - Semantic Dedupe

**Created:** 2026-05-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds near-duplicate detection to the ingestion pipeline and persistence schema. It touches fetcher/database behavior and adds a lightweight migration, but does not affect auth/security.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-004-semantic-dedupe/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Add deterministic semantic/near-duplicate detection so reposts and template jobs do not flood Slack or waste proposal attention. Exact ID dedupe already exists; this task should add normalized fingerprints and similarity checks for title/description/budget/client/source patterns while keeping the strongest/latest version.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/PRODUCT_VISION.md` — dedupe requirements and repost philosophy

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None

## File Scope

- `src/dedupe.ts`
- `src/fetcher.ts`
- `src/db.ts`
- `src/types.ts`
- `README.md`

## Steps

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] Dependencies satisfied

### Step 1: Add fingerprinting utilities

- [ ] Create `src/dedupe.ts` with normalization, tokenization, stable fingerprinting, and simple similarity scoring
- [ ] Fingerprint should consider title, description, budget, client country, skills, and source query while ignoring volatile text/noise
- [ ] Add types needed for dedupe results to `src/types.ts` if necessary
- [ ] Run targeted build/typecheck: `npm run build`

**Artifacts:**
- `src/dedupe.ts` (new)
- `src/types.ts` (modified if needed)

### Step 2: Integrate dedupe into fetch pipeline

- [ ] Update `src/fetcher.ts` so fetched jobs are deduped by exact ID first and near-duplicate fingerprint/similarity second
- [ ] Keep the strongest/latest candidate when duplicates are found using deterministic heuristics
- [ ] Log dedupe counts by source for observability
- [ ] Run targeted build/typecheck: `npm run build`

**Artifacts:**
- `src/fetcher.ts` (modified)

### Step 3: Persist fingerprints for seen jobs

- [ ] Add a nullable `fingerprint` column to `seen_jobs` using existing schema migration style in `src/db.ts`
- [ ] Store fingerprint when marking jobs seen
- [ ] Use stored fingerprints to avoid notifying near-duplicate reposts already seen when practical
- [ ] Run targeted build/typecheck: `npm run build`

**Artifacts:**
- `src/db.ts` (modified)

### Step 4: Documentation

- [ ] Update README with exact vs semantic dedupe behavior
- [ ] Document that dedupe is deterministic and intentionally conservative

**Artifacts:**
- `README.md` (modified)

### Step 5: Testing & Verification

- [ ] Run FULL test suite: `npm test` if available; if no test script exists, document that in STATUS.md
- [ ] Fix all failures
- [ ] Build passes: `npm run build`

### Step 6: Documentation & Delivery

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `README.md` — document semantic dedupe

**Check If Affected:**
- `docs/PRODUCT_VISION.md` — update only if dedupe strategy changes

## Completion Criteria

- [ ] Near-duplicate jobs in the same fetch batch are collapsed
- [ ] Seen-job fingerprints are persisted
- [ ] Reposts already seen are less likely to be re-notified
- [ ] Build passes

## Git Commit Convention

Commits happen at **step boundaries**. All commits for this task MUST include the task ID:

- **Step completion:** `feat(TP-004): complete Step N — description`
- **Bug fixes:** `fix(TP-004): description`
- **Tests:** `test(TP-004): description`
- **Hydration:** `hydrate: TP-004 expand Step N checkboxes`

## Do NOT

- Add vector database or embedding dependencies in this task
- Make fuzzy matching so aggressive that distinct jobs are collapsed
- Break exact ID dedupe
- Skip `npm run build`
- Commit without the task ID prefix

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
