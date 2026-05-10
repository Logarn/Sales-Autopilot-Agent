# Task: TP-016 - Browser Apply Preparer

**Created:** 2026-05-10
**Size:** L

## Review Level: 3 (Full)

**Assessment:** Adds the browser workflow that prepares Upwork applications. It touches browser automation and must enforce no-submit/approval guardrails, so full review is required.
**Score:** 7/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 2

## Mission

Implement the safe browser apply preparer: after human approval, the browser worker can open the Upwork apply page, select/verify profile, fill the approved cover letter, set rate, suggest/select allowed highlights/attachments where practical, set Connects/boost within guardrails, and stop before final submission. It must never submit without explicit future-mode approval and must pause on security challenges.

## Dependencies

- **External:** Browser queue foundation is already integrated in `main`.
- **Task:** TP-015 (Slack conversation approval/handoff must exist before browser apply preparation)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `src/browserWorker.ts`
- `src/browserQueue.ts`
- `src/applications.ts`
- `src/db.ts`
- `profile/connects-rules.json`
- `docs/DEPLOYMENT.md`

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None for build. Browser execution optional and dry-run safe.

## File Scope

- `src/browserApply.ts`
- `src/browserWorker.ts`
- `src/browserQueue.ts`
- `src/db.ts`
- `src/types.ts`
- `src/config.ts`
- `package.json`
- `.env.example`
- `README.md`
- `docs/DEPLOYMENT.md`

## Steps

### Step 0: Preflight
- [ ] Required files and paths exist
- [ ] Dependencies satisfied or documented

### Step 1: Apply preparation plan model
- [ ] Add types/service that converts an approved application into browser-fill instructions: URL, profile, rate, cover letter, attachments/highlights, connects plan, and stop-before-submit flag
- [ ] Validate direct job link, approved status, proposal text, Connects caps, and allowed attachments before browser action
- [ ] Build passes

### Step 2: Browser apply worker path
- [ ] Add handler for apply/prepare browser action that opens apply page in dry-run/no-credentials-safe mode
- [ ] Detect login/security states and pause safely
- [ ] In enabled mode, fill fields conservatively where selectors are found, but never click final submit
- [ ] Save minimized diagnostic status/artifacts only
- [ ] Build passes

### Step 3: CLI/testing path
- [ ] Add command to enqueue/preview an apply preparation for a job ID
- [ ] Add dry-run output showing exactly what would be filled
- [ ] Build passes

### Step 4: Documentation
- [ ] Update README/deployment docs with apply preparer setup and guardrails

### Step 5: Testing & Verification
- [ ] Run full tests if available; document env limitations
- [ ] Build passes
- [ ] Dry-run apply preparation works without Upwork credentials

### Step 6: Documentation & Delivery
- [ ] Docs updated
- [ ] Discoveries logged

## Documentation Requirements

**Must Update:**
- `README.md`
- `.env.example`
- `docs/DEPLOYMENT.md`

**Check If Affected:**
- `skills/browser-apply/SKILL.md` if present

## Completion Criteria

- [ ] Approved applications can produce browser-fill plans
- [ ] Browser worker has safe apply preparation path
- [ ] Dry-run works without credentials
- [ ] No final-submit behavior exists
- [ ] Build passes

## Git Commit Convention

Commits must include `TP-016`.

## Do NOT

- Click final submit
- Bypass CAPTCHA/2FA/security checks
- Store plaintext credentials
- Attach unapproved/private files

---

## Amendments (Added During Execution)
