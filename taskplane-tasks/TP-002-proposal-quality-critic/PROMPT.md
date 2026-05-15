# Task: TP-002 - Proposal Quality Critic

**Created:** 2026-05-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds a new proposal QA module and integrates it into draft generation and Slack output. Moderate blast radius, new pattern in this codebase, no auth/security changes, easy to revert.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-002-proposal-quality-critic/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Build a deterministic Proposal Quality Critic that grades every generated proposal before it is shown in Slack. The goal is to prevent generic AI-sounding cover letters by checking Steve's voice rules, pain-based opening, banned phrases, relevance of proof, CTA strength, and length. The critic should expose actionable issues and a score that can be stored in the draft and displayed in Slack.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/PRODUCT_VISION.md` — product philosophy and proposal quality bar
- `profile/profile.json` — Steve voice rules and banned/preferred phrases
- `profile/video-intro-transcript.md` — source language for Steve's proposal voice

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None

## File Scope

- `src/critic.ts`
- `src/agent.ts`
- `src/types.ts`
- `src/slack.ts`
- `README.md`

## Steps

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] Dependencies satisfied

### Step 1: Add proposal critic types and module

- [ ] Add proposal quality result types to `src/types.ts`
- [ ] Create `src/critic.ts` with deterministic checks for banned phrases, weak openings, generic claims, proposal length, CTA strength, proof relevance, and Steve voice markers
- [ ] Ensure critic returns a 0-100 score plus issue list and positive signals
- [ ] Run targeted build/typecheck: `npm run build`

**Artifacts:**
- `src/critic.ts` (new)
- `src/types.ts` (modified)

### Step 2: Integrate critic into proposal drafts and Slack

- [ ] Update `src/agent.ts` so `buildApplicationDraft()` attaches critic output to every draft
- [ ] Update `src/slack.ts` to show Proposal Quality score and top issues/signals in job packets
- [ ] Ensure existing draft generation still works when profile config has missing optional fields
- [ ] Run targeted build/typecheck: `npm run build`

**Artifacts:**
- `src/agent.ts` (modified)
- `src/slack.ts` (modified)

### Step 3: Documentation and examples

- [ ] Update README with the Proposal Quality Critic behavior
- [ ] Include examples of what the critic flags, especially banned phrases and generic openings

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
- `README.md` — document proposal critic and Slack display

**Check If Affected:**
- `docs/PRODUCT_VISION.md` — update only if implementation changes the product direction

## Completion Criteria

- [ ] Every application draft includes proposal quality analysis
- [ ] Slack packet displays proposal quality score and useful warnings
- [ ] Build passes
- [ ] README updated

## Git Commit Convention

Commits happen at **step boundaries**. All commits for this task MUST include the task ID:

- **Step completion:** `feat(TP-002): complete Step N — description`
- **Bug fixes:** `fix(TP-002): description`
- **Tests:** `test(TP-002): description`
- **Hydration:** `hydrate: TP-002 expand Step N checkboxes`

## Do NOT

- Add LLM/API dependencies in this task
- Modify submission automation
- Change job source behavior
- Skip `npm run build`
- Commit without the task ID prefix

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
