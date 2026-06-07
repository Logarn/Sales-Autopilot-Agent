# PR #31: Long-Term Sales Memory and Self-Improvement Loop MVP

This PR builds the foundation for the agent to feel like it remembers what has happened since day one without dumping all history into prompts.

The runtime pattern is:

1. Keep short-term context small: current Slack thread, job/application, draft, proof state, browser state, QA state, and latest instruction.
2. Store long-term events and compact memories in the database.
3. Retrieve only relevant memories by metadata, keywords, scope, recency, importance, confidence, and evidence.
4. Inject compact memory summaries into LLM prompts.
5. Log task outcomes, score them by task type, reflect on weak spots, and create proposed improvements or eval cases.

Self-improvement is an outer loop around a fixed production model:

`run -> log -> score -> reflect -> create memory/improvement candidate -> test -> ship -> repeat`

The agent can store memories, hypotheses, eval cases, and proposed Mayor/Codex tasks. It cannot silently edit code, activate prompt changes, deploy, or change final-submit behavior.

## Included

- General long-term memory tables:
  - `agent_events`
  - `agent_memories`
  - `memory_embeddings`
  - `memory_consolidations`
- Self-improvement loop tables:
  - `task_telemetry`
  - `improvement_candidates`
  - `prompt_tool_versions`
  - `self_improvement_evals`
- Sales-learning compatibility/detail tables:
  - `sales_learning_events`
  - `sales_learning_memories`
- Compact memories with confidence, importance, evidence count, status, version, freshness, source ids, keywords, supersession, and contradiction fields.
- Hybrid lexical/metadata retrieval from `agent_memories`.
- Retrieval updates `last_used_at`.
- Optional embedding schema and helper stubs. Vector scoring is deferred.
- Optional consolidation schema and helper stubs. Scheduled consolidation is deferred.
- Proposal-style learning from draft revisions.
- Proof-preference learning from Slack proof corrections and positive outcomes.
- Boost-strategy learning from recorded Connects/boost decisions and outcomes.
- Timing/source hypotheses from outcomes.
- LLM reflection hook for outcome/failure hypotheses and proposed Mayor/Codex tasks.
- Task telemetry for:
  - Slack replies
  - lead packets
  - lead judgment
  - proposal drafts
  - proof/portfolio selection
  - boost decisions
  - browser apply prep/retry
  - source scans
  - QA handoffs
  - outcome recording
- Task scorecards by type, including success/failure, correction/frustration, blocker/retry, manual intervention, provider/model, latency, outcomes, and failure reasons.
- Improvement candidates with proposed status by default:
  - memory examples
  - prompt adjustments
  - tool-rule adjustments
  - code tasks for Mayor/Codex
  - eval cases
  - regression tests
- Prompt/tool-rule version artifacts with rollback links and test references. Version records are not deployed by writing them.
- Eval harness skeleton for Slack, lead judgment, proof selection, boost decision, draft quality, and retry/browser-blocker fixtures.
- Relevant memory injection into:
  - Slack conversation brain
  - proposal revision
  - draft guidance
  - proof/portfolio selection
  - job intelligence/proof reasoning
- Slack memory controls:
  - `what did you learn?`
  - `what patterns are working?`
  - `what proof is working?`
  - `what boost strategy is working?`
  - `remember this ...`
  - `forget that`

## Memory Boundaries

- Memories are hypotheses, not hard rules.
- One event creates tentative memory.
- Repeated evidence can strengthen a memory.
- Current instructions can override learned preferences.
- Current instructions cannot override hard safety.
- Forgotten memories are excluded from retrieval.
- Normal memory remains invisible unless Steve asks.

## Safety Boundaries

- Final submit remains manual.
- CAPTCHA/security checks are never bypassed.
- Optional boost remains capped by deterministic Connects rules.
- Proof/files/portfolio still require deterministic verification before being called verified.
- Code-improvement memories only propose Mayor/Codex tasks. They do not edit or deploy code.
- Improvement candidates stay `proposed` until reviewed and shipped through the normal PR/deploy path.
- Prompt/tool version records are artifacts for controlled changes, not live production mutation.

## Deferred

- PR #32: weekly operator handoff and scheduled memory/outcome consolidation.
- PR #36: source health and challenge backoff.
- PR #38: deeper outcome analytics, cohort scoring, and strategy ranking.
- Runtime vector embedding generation and semantic similarity scoring.
- Full dynamic model routing between Grok/Kimi.
- Encryption/hard delete/access control beyond forgotten status.
- Automatic code modification or deployment.
