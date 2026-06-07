# Soul Constitution Scope and Follow-Ups

This document keeps PR #29 narrow.

PR #29 is the personality and prompt-constitution PR. It is not the complete self-improvement system.

## What PR #29 Covers

- `soul.md` is the operating constitution already present in the repo.
- Slack conversation planning receives soul context.
- Slack copy rewriting receives soul context, including conversation replies, lead packets, QA handoffs, and digest copy.
- Job intelligence and proof reasoning receive soul context.
- Proposal draft generation receives soul runtime guidance.
- Proof/portfolio selection receives soul runtime guidance.
- Self-improvement memory writes include soul runtime guidance in metadata.
- Normal generated Slack copy rejects third-person "the agent" wording.

## What PR #29 Does Not Claim

- Full recursive self-improvement is not complete.
- Weekly operator handoff is not complete.
- Outcome-driven strategy updates are not complete.
- Learned-skill conflict resolution is not complete.
- Dynamic Grok/Kimi model choice is not complete.
- Mayor/Codex task generation is not complete.

## LLM Path Decisions

These user-facing or reasoning paths are soul-wired:

- `src/slackConversationBrain.ts` - primary Slack conversation brain.
- `src/slackCopywriter.ts` - user-facing Slack copy for conversation, lead packet, QA handoff, and digest paths.
- `src/jobIntelligenceParser.ts` - job intelligence and proof reasoning.
- `src/slackThreadBrain.ts` - legacy Slack thread classifier fallback.
- `src/slackConversation.ts` - proposal revision helper.

These structured extraction paths intentionally do not use `soul.md`:

- `src/normalization.ts` - normalizes captured Upwork text into source-backed structured fields. It should preserve facts and avoid personality.
- `src/connectsExtraction.ts` - extracts source-backed Connects numbers from visible text. It should stay literal and evidence-based.

If either extraction path starts producing user-facing copy, route that copy through `src/slackCopywriter.ts` instead of adding personality to extraction.

## Follow-Up PR #31: Self-Improvement Memory Loop

Scope:

- learned skill storage by type and scope
- broader correction detection
- proof preference learning by vertical/job type
- draft style preference learning from operator edits
- outcome memory retrieval into Slack brain and proof/draft strategy
- conflict detection between learned preferences and current instructions
- failure reflection review
- proposed Mayor/Codex task generation when repeated failures need code

## Follow-Up PR #32: Weekly Operator Handoff and Periodic Review

Scope:

- replace or disable default daily digest
- Monday weekly operator handoff
- jobs found and jobs prepared
- manually submitted applications
- replies, interviews, hires, and losses
- Connects used and Connects efficiency
- QA queue and browser blockers
- top learnings and strategy recommendations
- explicit asks for Steve
- scheduled memory and outcome review

## Merge Bar for PR #29

Before merge:

- branch is based on current `main`
- PR body accurately calls this a personality/prompt constitution PR
- production-path tests prove lead packet and QA handoff copy requests include soul context
- promotion validation passes
- final-submit behavior remains manual
- Contabo is not touched
