# Task: TP-005 - Job Detail Capture Parser

**Created:** 2026-05-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds a parser/CLI that converts pasted Upwork job-detail page text into normalized manual-job entries. Moderate new parsing surface, low security risk, reversible.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-005-job-detail-capture-parser/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Build a Job Detail Capture Parser so a user can paste Upwork job detail page text into a file and create/update `config/manual-jobs.json` automatically. This is the safest bridge toward an agent: reliable manual capture now, browser/VM capture later, all feeding the same normalized job pipeline.

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `docs/PRODUCT_VISION.md` — product constraints and capture philosophy
- `src/capture.ts` — apply-screen parser pattern to follow
- `src/manual.ts` — manual job file format and CLI style

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None

## File Scope

- `src/jobCapture.ts`
- `src/manual.ts`
- `src/sources/manualSource.ts`
- `package.json`
- `README.md`
- `captures/*`

## Steps

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] Dependencies satisfied

### Step 1: Parser module and types

- [ ] Create `src/jobCapture.ts` with a pure parser that extracts title, URL/job ID, description, posted time, location, budget/type, duration, experience level, skills, proposal count, invites, interviews, connects if visible, and client spend/rating/location when present
- [ ] Parser handles pasted text like the user's beauty-brand job example without requiring browser access
- [ ] Include conservative fallbacks when fields are missing
- [ ] Run targeted build: `npm run build`

### Step 2: CLI integration

- [ ] Add CLI command to parse `--file` and optional `--url`, then create/update `config/manual-jobs.json`
- [ ] Preserve existing manual jobs and update by stable job ID/URL when the same job is captured again
- [ ] Print a concise summary of extracted fields and next suggested command
- [ ] Run targeted build: `npm run build`

### Step 3: Documentation and sample

- [ ] Add a sample capture text file under `captures/`
- [ ] Update README with job detail capture workflow

### Step 4: Testing & Verification

- [ ] Run FULL test suite if available; document absence if not
- [ ] Build passes: `npm run build`
- [ ] Manually test parser against sample capture

### Step 5: Documentation & Delivery

- [ ] Must Update docs modified
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `README.md` — document job detail capture command

**Check If Affected:**
- `docs/PRODUCT_VISION.md`

## Completion Criteria

- [ ] Pasted job text can create/update a manual job
- [ ] Generated manual job runs through existing pipeline
- [ ] Build passes

## Git Commit Convention

Commits must include `TP-005`.

## Do NOT

- Automate Upwork login in this task
- Store credentials
- Bypass CAPTCHA or anti-bot protections
- Skip build

---

## Amendments (Added During Execution)
