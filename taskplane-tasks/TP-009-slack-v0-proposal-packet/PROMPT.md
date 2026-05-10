# Task: TP-009 - Slack V0 Proposal Packet

**Created:** 2026-05-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Improves existing Slack webhook output and adds a test command. It touches notification code and CLI only, no auth-sensitive changes beyond using existing webhook env.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 1, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-009-slack-v0-proposal-packet/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Use the existing Slack Incoming Webhook to send a high-quality version-0 proposal packet to Slack for manual testing before VM hookup. Do not require a new Slack app. The message should be clear enough for Steve to decide whether to apply, revise manually, or reject.

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `src/slack.ts` — current webhook notification implementation
- `src/applications.ts` — application report/status commands
- `src/db.ts` — application persistence
- `docs/PRODUCT_VISION.md` — Slack-first workflow

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** Existing `SLACK_CHANNEL_WEBHOOK_URL` env var only. Do not require Slack app/interactivity.

## File Scope

- `src/slack.ts`
- `src/slackPreview.ts`
- `src/db.ts`
- `src/types.ts`
- `package.json`
- `README.md`
- `.env.example`

## Steps

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] Dependencies satisfied

### Step 1: Slack packet structure improvements

- [ ] Refine proposal packet blocks to show score units, proposal quality, reasons/risks, Connects plan, proof selection, and draft proposal in a readable order
- [ ] Add webhook-compatible URL buttons only: View Upwork, copy/manual instructions if possible, no interactive callbacks
- [ ] Include clear limitation note in code/docs: incoming webhook is one-way; true Slack chat/revisions require Slack app or later polling approach
- [ ] Run targeted build: `npm run build`

### Step 2: Slack preview/test command

- [ ] Add command to send a Slack preview for a specific `--job-id` from stored application/job data
- [ ] Add command/sample mode that sends a synthetic V0 proposal packet if no job exists
- [ ] Ensure command fails clearly when webhook env is missing and never logs webhook secrets
- [ ] Run targeted build: `npm run build`

### Step 3: Documentation

- [ ] Update README with Slack webhook test workflow
- [ ] Document what V0 can do with webhook and what later requires Slack app/socket mode

### Step 4: Testing & Verification

- [ ] Run full test suite if available; document env limitations
- [ ] Build passes: `npm run build`
- [ ] Preview command works in dry/no-webhook failure mode with clear error OR sends if webhook configured

### Step 5: Documentation & Delivery

- [ ] Must Update docs modified
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `README.md` — Slack V0 testing workflow
- `.env.example` — clarify webhook-only V0

**Check If Affected:**
- `docs/PRODUCT_VISION.md`

## Completion Criteria

- [ ] Existing webhook can send a polished proposal packet
- [ ] User can test Slack structure before VM deployment
- [ ] Build passes

## Git Commit Convention

Commits must include `TP-009`.

## Do NOT

- Create or require a new Slack app
- Add Slack OAuth/socket-mode tokens in this task
- Store webhook secrets in git
- Break existing Slack notifications

---

## Amendments (Added During Execution)
