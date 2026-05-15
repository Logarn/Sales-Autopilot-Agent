# Task: TP-010 - Slack-Ready Proposal Structure

**Created:** 2026-05-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds structured proposal sections and client-question handling so Slack packets and future browser filling are more reliable. Moderate proposal-generation changes, reversible.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-010-slack-ready-proposal-structure/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Improve the proposal artifact so it is not just a blob of text. It should include structured sections: opening, diagnosis, proof, client-request answers, rate/retainer answer, CTA, suggested attachments/highlights, and browser-fill instructions. This makes V0 more useful in Slack and prepares for future Slack revision/browser apply flows.

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `src/agent.ts` — current proposal generation
- `src/critic.ts` — proposal quality checks
- `src/types.ts` — application draft types
- `profile/profile.json` — voice/proof details
- `docs/PRODUCT_VISION.md` — proposal quality bar

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None

## File Scope

- `src/agent.ts`
- `src/types.ts`
- `src/critic.ts`
- `src/slack.ts`
- `README.md`

## Steps

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] Dependencies satisfied

### Step 1: Structured proposal draft types

- [ ] Add structured proposal fields to application draft types while preserving `proposalText`
- [ ] Include fields for opening, diagnosis, proof, application-question answers, rate/retainer answer, CTA, and browser-fill notes
- [ ] Keep backwards compatibility with existing DB storage where practical
- [ ] Run targeted build: `npm run build`

### Step 2: Generate better V0 proposals

- [ ] Update proposal generation to answer explicit client application instructions when detected in job text
- [ ] Use relevant proof earlier for high-fit jobs, especially beauty/DTC/Klaviyo examples
- [ ] Keep final proposal concise and Steve-like, not generic
- [ ] Run targeted build: `npm run build`

### Step 3: Slack/browser readiness

- [ ] Update Slack packet display to show structured sections compactly
- [ ] Add browser-fill notes that specify approved text, profile, rate, attachments/highlights, and Connects plan
- [ ] Ensure proposal critic still evaluates the final cover-letter text
- [ ] Run targeted build: `npm run build`

### Step 4: Documentation

- [ ] Update README with structured proposal packet format

### Step 5: Testing & Verification

- [ ] Run full test suite if available; document env limitations
- [ ] Build passes: `npm run build`
- [ ] Validate against the beauty/Klaviyo job if available in DB/manual jobs

### Step 6: Documentation & Delivery

- [ ] Must Update docs modified
- [ ] Discoveries logged

## Documentation Requirements

**Must Update:**
- `README.md` — structured proposal packet format

**Check If Affected:**
- `docs/PRODUCT_VISION.md`

## Completion Criteria

- [ ] Proposal draft has structured sections and final text
- [ ] Explicit client instructions are answered when present
- [ ] Slack packet/browser-fill handoff is clearer
- [ ] Build passes

## Git Commit Convention

Commits must include `TP-010`.

## Do NOT

- Add Slack interactive app behavior in this task
- Add browser auto-submit behavior
- Make proposals longer/generic just to answer every possible field

---

## Amendments (Added During Execution)
