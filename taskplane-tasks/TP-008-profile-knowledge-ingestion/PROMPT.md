# Task: TP-008 - Profile Knowledge Ingestion

**Created:** 2026-05-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds local knowledge ingestion commands and loaders that influence proposal generation. Moderate data-shape changes, low security risk, reversible.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-008-profile-knowledge-ingestion/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Enable Steve to add profile details over time — voice tweaks, cover-letter preferences, additional proof points, portfolio edits, extra videos/transcripts, and notes — without editing code. The agent should load this accumulated knowledge and use it to improve proposals and bid recommendations.

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `profile/profile.json` — current profile/voice structure
- `profile/portfolio.json` — current portfolio metadata
- `profile/video-intro-transcript.md` — example long-form knowledge artifact
- `src/profile.ts` — current loaders
- `src/agent.ts` — proposal generation path

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None

## File Scope

- `src/profile.ts`
- `src/profileKnowledge.ts`
- `src/agent.ts`
- `src/types.ts`
- `src/knowledge.ts`
- `package.json`
- `README.md`
- `profile/knowledge/*`
- `profile/portfolio.json`

## Steps

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] Dependencies satisfied

### Step 1: Knowledge file schema and loader

- [ ] Add `profile/knowledge/` support for markdown/json notes grouped by type: voice, proof, portfolio, video, bid_rules, general
- [ ] Create loader that reads knowledge artifacts safely and returns concise usable context for proposal generation
- [ ] Add types for knowledge artifacts and profile enrichment
- [ ] Run targeted build: `npm run build`

### Step 2: CLI for adding knowledge

- [ ] Add CLI command(s) to append knowledge notes from text/file with type and optional tags
- [ ] Add portfolio upsert command or documented JSON workflow for adding/updating portfolio items without code changes
- [ ] Add video transcript ingestion command or file workflow for additional videos/transcripts
- [ ] Print clear summaries of what was added
- [ ] Run targeted build: `npm run build`

### Step 3: Proposal integration

- [ ] Update proposal generation to use relevant voice/proof/portfolio knowledge without overloading prompts or producing generic text
- [ ] Ensure cover-letter preferences can override or supplement current profile voice rules
- [ ] Keep behavior safe when knowledge directory is empty
- [ ] Run targeted build: `npm run build`

### Step 4: Documentation and sample knowledge

- [ ] Add sample knowledge files or README examples for voice tweaks, portfolio addition, and video transcript addition
- [ ] Update README with knowledge ingestion commands/workflow

### Step 5: Testing & Verification

- [ ] Run full test suite if available; document expected env limitations
- [ ] Build passes: `npm run build`
- [ ] Demonstrate a sample knowledge note is loaded without breaking app report

### Step 6: Documentation & Delivery

- [ ] Must Update docs modified
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `README.md` — profile knowledge ingestion workflow

**Check If Affected:**
- `docs/PRODUCT_VISION.md`

## Completion Criteria

- [ ] User can add profile/voice/proof knowledge without code edits
- [ ] Proposal generation can consume the knowledge
- [ ] Build passes

## Git Commit Convention

Commits must include `TP-008`.

## Do NOT

- Add remote services or paid LLM dependencies
- Store secrets in profile knowledge files
- Break existing profile/portfolio loading

---

## Amendments (Added During Execution)
