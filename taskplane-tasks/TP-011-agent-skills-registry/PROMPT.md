# Task: TP-011 - Agent Skills Registry

**Created:** 2026-05-10
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Adds natural-language skill docs and a lightweight registry/loader so future agents can load only relevant context. Mostly docs/config with small code surface.
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-011-agent-skills-registry/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Create a natural-language skills registry for the Upwork Revenue Assistant. The goal is to prevent the LLM from loading the full project context every time. Each skill should be a descriptive `SKILL.md` playbook with when to use it, inputs, outputs, guardrails, failure modes, and relevant code/files. Add a lightweight loader/CLI so operators and future agents can list/read skills on demand.

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `docs/PRODUCT_VISION.md`
- `README.md`
- `src/agent.ts`
- `src/browserQueue.ts`
- `src/browserWorker.ts`
- `src/slack.ts`

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None

## File Scope

- `skills/*/SKILL.md`
- `src/skills.ts`
- `package.json`
- `README.md`
- `docs/PRODUCT_VISION.md`

## Steps

### Step 0: Preflight
- [ ] Required files and paths exist
- [ ] Dependencies satisfied

### Step 1: Create skill docs
- [ ] Create highly descriptive `SKILL.md` files for upwork-search, job-extraction, llm-normalization, fit-scoring, proposal-writing, proposal-critic, proof-selector, connects-governor, slack-packet, slack-conversation, browser-apply, outcome-tracking, and heartbeat-monitor
- [ ] Each skill is written as a natural-language operating playbook, not a stub: purpose, when to use, when not to use, required inputs, optional inputs, output schema, step-by-step procedure, examples, guardrails, failure modes, recovery actions, related files/functions, and handoff to next skills
- [ ] Each skill includes at least one realistic Upwork/Steve example so a future LLM can call the skill without loading the whole project context
- [ ] Ensure browser/Slack skills explicitly preserve human approval and no CAPTCHA/2FA bypass

### Step 2: Add registry/loader
- [ ] Add `src/skills.ts` with list/read helpers for skills
- [ ] Add npm script to list skills and show one skill by name
- [ ] Run targeted build: `npm run build`

### Step 3: Documentation
- [ ] Update README with skill registry usage
- [ ] Update product vision if useful to mention skills-on-demand architecture

### Step 4: Testing & Verification
- [ ] Run full test suite if available; document env limitations
- [ ] Build passes: `npm run build`

### Step 5: Documentation & Delivery
- [ ] Docs updated
- [ ] Discoveries logged

## Documentation Requirements

**Must Update:**
- `README.md`

**Check If Affected:**
- `docs/PRODUCT_VISION.md`

## Completion Criteria

- [ ] Skills exist and are descriptive enough for future agent use
- [ ] Skill list/read command works
- [ ] Build passes

## Git Commit Convention

Commits must include `TP-011`.

## Do NOT

- Add paid LLM calls
- Store secrets
- Replace existing code behavior

---

## Amendments (Added During Execution)
