# Proposal Critic Skill

## Purpose
Grade draft quality and identify generic/unsafe proposal issues.

## When to use
Use this skill when the current task matches the purpose above and you need compact project-specific operating context without loading the whole repository.

## When not to use
Do not use this skill to bypass product guardrails, invent facts, store secrets, make paid LLM/API calls not requested by the operator, or replace existing deterministic code paths without an explicit task.

## Required inputs
ApplicationDraft/proposal text, selected proof, job context

## Optional inputs
- Recent logs or captured artifacts
- Relevant profile knowledge from `profile/knowledge/`
- Existing database/application record when available
- Operator instructions from Slack or the task prompt

## Output schema
Return concise natural language plus structured fields where useful:
- `decision`: proceed, skip, pause, revise, or escalate
- `summary`: what was found or produced
- `evidence`: source fields, file paths, links, or reasons
- `risks`: missing data, platform safety issues, Connects concerns, or quality issues
- `next_skill`: recommended handoff skill

## Procedure
1. Confirm the input has a direct job or system context relevant to this skill.
2. Read only the smallest related files/functions listed below.
3. Preserve known facts exactly; mark missing facts as unknown instead of guessing.
4. Apply Steve/Upwork guardrails: high-fit opportunities, direct links, human approval, conservative Connects, and auditability.
5. Produce the output in a form the next skill can consume.
6. If blocked, explain the missing input and choose `pause` or `escalate` rather than fabricating.

## Realistic Upwork/Steve example
Flags 'Dear hiring manager' and a vague CTA, then asks for a tighter Klaviyo-specific opening and concrete next step.

## Guardrails
- This assistant is not an auto-apply bot; humans stay in control.
- Require direct Upwork links before application preparation.
- Do not store credentials, secrets, private attachments, or full authenticated page archives.
- Keep claims in Steve's proposal tied to job text or approved profile/proof data.
- Prefer conservative skip/pause decisions over risky automation.

## Failure modes
- Missing direct Upwork URL or job id.
- Ambiguous budget, Connects, or client history.
- Generic proposal text that sounds AI-written.
- Slack/webhook/source/database unavailable.
- Browser/login/security challenge encountered.

## Recovery actions
- Request or capture the missing direct URL/text.
- Fall back to deterministic local rules and existing profile data.
- Queue human review when approval, Connects, login, 2FA, CAPTCHA, or unclear facts are involved.
- Log the reason in the application record or task status before moving on.

## Related files/functions
- `src/index.ts` pipeline orchestration and health checks
- `src/sources/*` source ingestion
- `src/jobCapture.ts`, `src/manual.ts`, `src/capture.ts` pasted/manual job capture
- `src/filter.ts`, `src/scoring.ts` scoring and notification thresholds
- `src/agent.ts` proposal drafting, proof, Connects recommendations
- `src/critic.ts` proposal quality checks
- `src/slack.ts`, `src/slackPreview.ts` Slack packet formatting
- `src/browserQueue.ts`, `src/browserWorker.ts` queued browser actions
- `src/applications.ts`, `src/db.ts` outcome tracking and persistence
- `profile/profile.json`, `profile/portfolio.json`, `profile/connects-rules.json`, `profile/knowledge/`

## Handoff to next skills
Recommended next skill: `slack-packet or proposal-writing revision`. Include the output schema above so the next skill can continue without rereading broad context.
