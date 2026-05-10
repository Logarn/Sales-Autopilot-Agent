# Task: TP-013 - LLM Normalization Layer

**Created:** 2026-05-10
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Adds optional LLM provider integration and schema validation for normalizing messy Upwork data. Touches parsing/scoring/proposal path but must keep deterministic fallback and avoid secrets in logs.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-013-llm-normalization-layer/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Add an optional LLM normalization layer: raw Upwork/browser/email/manual text should be converted into the agreed structured opportunity packet before Slack/proposal output. The LLM is an interpreter, not the governor; deterministic validation, guardrails, scoring, and critic remain authoritative. If no LLM key is configured, the system must fall back to existing deterministic parsing.

## Dependencies

- **Task:** TP-011 (Skills registry documents the llm-normalization skill; if not present, proceed with code and document missing skill integration)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `src/jobCapture.ts`
- `src/scoring.ts`
- `src/agent.ts`
- `src/types.ts`
- `docs/PRODUCT_VISION.md`
- `profile/profile.json`

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None for build. LLM calls must be optional.

## File Scope

- `src/llm/*`
- `src/normalization.ts`
- `src/types.ts`
- `src/config.ts`
- `src/jobCapture.ts`
- `src/agent.ts`
- `.env.example`
- `package.json`
- `README.md`

## Steps

### Step 0: Preflight
- [ ] Required files and paths exist
- [ ] Dependencies satisfied or missing dependency documented

### Step 1: Normalized schema
- [ ] Define normalized opportunity packet types/schema covering job, client, requirements, application questions, skills, connects, risks, proof hints, and proposal instructions
- [ ] Add validation/repair helpers that reject unsafe/missing direct-link data and preserve deterministic fallbacks
- [ ] Run targeted build: `npm run build`

### Step 2: Optional OpenAI-compatible provider
- [ ] Add config for `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`, and enable flag
- [ ] Implement provider wrapper that never logs API keys or raw secrets
- [ ] Support dry-run/no-key fallback
- [ ] Run targeted build: `npm run build`

### Step 3: Normalization pipeline
- [ ] Add function to normalize raw job/apply text via LLM when enabled, else deterministic parser
- [ ] Ensure output can feed scoring/proposal/Slack packet path
- [ ] Add CLI command to normalize a capture file and print JSON for testing
- [ ] Run targeted build: `npm run build`

### Step 4: Docs and examples
- [ ] Update README with LLM normalization workflow and fallback behavior
- [ ] Update `.env.example` with LLM settings
- [ ] Add example command using a capture file

### Step 5: Testing & Verification
- [ ] Run full tests if available; document env limitations
- [ ] Build passes: `npm run build`
- [ ] CLI normalize works without an API key using fallback

### Step 6: Documentation & Delivery
- [ ] Docs updated
- [ ] Discoveries logged

## Documentation Requirements

**Must Update:**
- `README.md`
- `.env.example`

**Check If Affected:**
- `docs/PRODUCT_VISION.md`
- `skills/llm-normalization/SKILL.md` if created by TP-011

## Completion Criteria

- [ ] Optional LLM normalizer exists
- [ ] Deterministic fallback works without API key
- [ ] Normalized packet can feed downstream workflow
- [ ] Build passes

## Git Commit Convention

Commits must include `TP-013`.

## Do NOT

- Make LLM required for local build/test
- Log API keys/secrets
- Let LLM override deterministic Connects/safety guardrails
- Add auto-submit behavior

---

## Amendments (Added During Execution)
