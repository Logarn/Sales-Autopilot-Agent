# Task: TP-003 - Advanced Scoring Model

**Created:** 2026-05-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Refactors scoring from a single keyword score into structured components used by downstream Slack/app logic. Moderate blast radius and data-shape changes, no security impact, reversible.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-003-advanced-scoring-model/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Replace the shallow single-score model with structured opportunity scoring: fit, client quality, opportunity timing/competition proxies, red flags, and Connects risk. This makes Slack packets explain why a job is worth attention and creates better future training data for outcome tracking.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/PRODUCT_VISION.md` — scoring philosophy and positive/red-flag criteria
- `profile/profile.json` — Steve's preferred industries, job types, skills, and avoid list
- `profile/connects-rules.json` — Connects risk thresholds

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None

## File Scope

- `src/scoring.ts`
- `src/filter.ts`
- `src/types.ts`
- `src/agent.ts`
- `src/slack.ts`
- `README.md`

## Steps

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] Dependencies satisfied

### Step 1: Add structured scoring types and scorer

- [ ] Add score breakdown types to `src/types.ts`
- [ ] Create `src/scoring.ts` that computes fitScore, clientQualityScore, opportunityScore, redFlagScore, connectsRiskScore, finalScore, reasons, and risks
- [ ] Incorporate profile preferences and Connects rules without breaking missing-config fallbacks
- [ ] Run targeted build/typecheck: `npm run build`

**Artifacts:**
- `src/scoring.ts` (new)
- `src/types.ts` (modified)

### Step 2: Wire structured scoring into existing pipeline

- [ ] Update `src/filter.ts` or `scoreJob()` flow so `ScoredJob` contains the score breakdown while preserving existing match levels
- [ ] Update `src/agent.ts` to use score breakdown reasons/risks where appropriate
- [ ] Update `src/slack.ts` to display the structured score components concisely
- [ ] Run targeted build/typecheck: `npm run build`

**Artifacts:**
- `src/filter.ts` (modified)
- `src/agent.ts` (modified)
- `src/slack.ts` (modified)

### Step 3: Documentation

- [ ] Update README with the new scoring categories and thresholds
- [ ] Note that final scoring is deterministic and will later be adjusted using outcome data

**Artifacts:**
- `README.md` (modified)

### Step 4: Testing & Verification

- [ ] Run FULL test suite: `npm test` if available; if no test script exists, document that in STATUS.md
- [ ] Fix all failures
- [ ] Build passes: `npm run build`

### Step 5: Documentation & Delivery

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `README.md` — document scoring model

**Check If Affected:**
- `docs/PRODUCT_VISION.md` — update only if scoring philosophy changes

## Completion Criteria

- [ ] Jobs have a structured score breakdown
- [ ] Slack explains score components, not just a raw number
- [ ] Existing notification behavior still works
- [ ] Build passes

## Git Commit Convention

Commits happen at **step boundaries**. All commits for this task MUST include the task ID:

- **Step completion:** `feat(TP-003): complete Step N — description`
- **Bug fixes:** `fix(TP-003): description`
- **Tests:** `test(TP-003): description`
- **Hydration:** `hydrate: TP-003 expand Step N checkboxes`

## Do NOT

- Add LLM/API dependencies in this task
- Change source fetching logic
- Change database schema unless strictly necessary; log debt if richer persistence is needed later
- Skip `npm run build`
- Commit without the task ID prefix

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
