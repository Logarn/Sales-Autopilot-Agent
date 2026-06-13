# Job Context Read Model

## Summary

Added a read-only `JobContext` layer as the first architecture slice for the Upwork agent reasoning work.

This PR does not change Slack behavior, browser behavior, lead discovery, application prep, or final-submit safety. It creates a shared context object that later planner/browser/proof fixes can use instead of each component rebuilding a partial view of the job.

## Files Changed

- `src/context/jobContext.ts`
  - New `JobContextManager` with builders for job ID, Slack thread, and browser action entry points.
  - Aggregates job, draft, job intelligence, Slack thread state, latest browser action, browser apply plan diagnostics, proof state, Connects status, skill-use trace, draft quality gate, proof overrides, and sales-learning context.
  - Derives a lightweight conversation state with active task and information gaps.
  - Treats browser-action captured Connects as source-backed context before draft or plan estimates.

- `src/context/jobContext.test.ts`
  - Adds dependency-injected unit tests.
  - Verifies pending Slack URL capture threads resolve to the queued browser action and captured Connects.
  - Verifies drafted jobs expose proof, skill trace, quality gate, sales-learning context, and source-backed Connects without false gaps.

## Before

Slack, browser, apply-plan, proof, and learning paths each assembled their own partial job state. That made it hard to answer basic state questions consistently:

- Is capture still pending?
- Does a draft exist?
- Are Connects source-backed or estimated?
- Which proof/portfolio plan is current?
- Did the draft use skill runtime and quality gates?
- What thread or browser action is associated with this job?

## After

Callers can build one read-only context:

```ts
buildJobContextForThread(channelId, threadTs);
buildJobContextForJob(jobId);
buildJobContextForBrowserAction(browserActionId);
```

The returned context includes:

- `conversationState.activeTask`
- `conversationState.informationGaps`
- `connectsStatus`
- `proofState`
- `skillUseTrace`
- `qualityGate`
- `latestBrowserAction`
- `browserPlanResult`
- `salesLearning`

## Safety

- No lead engine changes.
- No browser prep changes.
- No production VNC usage.
- No final-submit behavior changed.
- No secrets touched or printed.
- Browser fill remains gated by existing code paths.

## Tests Run

```bash
npm run build
npx tsx src/context/jobContext.test.ts
npx tsx src/slackConversationPlanner.test.ts
```

All passed.

## Follow-Up PRs

Recommended next slices:

1. Use `JobContext` inside Slack conversation planning as a read path only.
2. Persist an explicit conversation state machine per Slack thread.
3. Add Connects pre-verification gating before browser prep.
4. Add semantic intent parsing behind deterministic safety planning.

