# Task: TP-015 - Slack Conversation Layer

**Created:** 2026-05-10
**Size:** L

## Review Level: 3 (Full)

**Assessment:** Adds inbound Slack control paths for approve/revise/reject. This touches command handling and potentially secrets/signing verification, so full review is warranted.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 1

## Mission

Add the foundation for Slack as the command center: approve, reject, revise, regenerate, mark applied/replied, and enqueue browser actions. Prefer minimal manual setup, but document that existing incoming webhook is one-way; true inbound Slack conversation requires either Slack Events/Interactivity, Socket Mode, or a documented polling workaround. Implement the safest minimal path that can be tested locally without exposing secrets.

## Dependencies

- **External:** Slack V0 proposal packets and LLM normalization are already integrated in `main` from prior completed tasks TP-009 and TP-013.

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `src/slack.ts`
- `src/slackPreview.ts`
- `src/agent.ts`
- `src/applications.ts`
- `src/browserQueue.ts`
- `README.md`

## Environment

- **Workspace:** `/Users/admin/upwork-rss-reader`
- **Services required:** None for build. Slack inbound credentials optional.

## File Scope

- `src/slackConversation.ts`
- `src/slack.ts`
- `src/db.ts`
- `src/types.ts`
- `src/agent.ts`
- `package.json`
- `.env.example`
- `README.md`
- `docs/DEPLOYMENT.md`

## Steps

### Step 0: Preflight
- [ ] Required files and paths exist
- [ ] Dependencies satisfied or documented

### Step 1: Conversation intent model
- [ ] Add intent types for approve, reject, revise, regenerate, mark_applied, mark_replied, enqueue_browser_apply, and unknown
- [ ] Add parser for local CLI/testing natural-language commands against a job/application ID
- [ ] Build passes

### Step 2: Draft revision/update flow
- [ ] Add command/service to apply a revision instruction to a stored application draft, using LLM if available or storing revision request if not
- [ ] Preserve proposal version/audit trail
- [ ] Re-render/send Slack preview after revision when webhook configured
- [ ] Build passes

### Step 3: Approval/browser queue handoff
- [ ] Add approve/reject commands that update DB status and optionally enqueue browser apply action
- [ ] Add Slack inbound config placeholders and clear docs for Events/Socket Mode/polling options
- [ ] Build passes

### Step 4: Documentation
- [ ] Update README/deployment docs with Slack V0 webhook vs inbound conversation options
- [ ] Emphasize no web UI, Slack-first control plane

### Step 5: Testing & Verification
- [ ] Run full tests if available; document env limitations
- [ ] Build passes
- [ ] Local CLI conversation commands work without Slack credentials

### Step 6: Documentation & Delivery
- [ ] Docs updated
- [ ] Discoveries logged

## Documentation Requirements

**Must Update:**
- `README.md`
- `.env.example`
- `docs/DEPLOYMENT.md`

**Check If Affected:**
- `skills/slack-conversation/SKILL.md` if present

## Completion Criteria

- [ ] Local conversation intent handling works
- [ ] Approve/reject/revise paths update DB/audit state
- [ ] Browser action can be enqueued after approval
- [ ] Slack inbound limitations and setup are documented
- [ ] Build passes

## Git Commit Convention

Commits must include `TP-015`.

## Do NOT

- Require new Slack app credentials for build/tests
- Log Slack secrets
- Add a web UI
- Auto-submit proposals

---

## Amendments (Added During Execution)
