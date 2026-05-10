## Code Review: Step 1: Add structured scoring types and scorer

### Verdict: REVISE

### Summary
The new structured scoring types and scorer are in place, and `npm run build` passes. However, the change also rewales the legacy `job.score` to 0-100 and wires it into the live pipeline before downstream consumers are updated, which breaks application draft fit scoring for notified jobs.

### Issues Found
1. **[src/agent.ts:175] [important]** — `buildApplicationDraft()` still assumes `job.score` is on the old small keyword scale and multiplies it by 10. Since `scoreJob()` now returns `finalScore` on a 0-100 scale, almost any notified job clamps to `fitScore: 100` (even a skip-level sample scoring 21 produced draft `fitScore` 100). Fix by using `job.scoreBreakdown.fitScore.score` or `job.scoreBreakdown.finalScore` directly, or defer wiring `scoreJob()` to the structured 0-100 score until the agent is updated.

### Pattern Violations
- None blocking.

### Test Gaps
- Add/adjust a focused scoring or draft-generation check that verifies a low/skip-scoring job does not produce a 100/100 application draft fit score after structured scoring is enabled.

### Suggestions
- Remove the unused `fields` / `combinedText` variables in `src/filter.ts` now that text assembly lives inside `scoreJobStructured()`.
- Quality checks: `.pi/taskplane-config.json` has no configured typecheck/lint/format-check commands and `package.json` has no matching fallback scripts; I ran the task's targeted `npm run build`, and it passed.
