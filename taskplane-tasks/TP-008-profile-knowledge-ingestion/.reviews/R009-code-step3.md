## Code Review: Step 3: Proposal integration

### Verdict: REVISE

### Summary
The build passes (`npm run build`), and the empty-directory path remains safe through `loadProfileKnowledge()`. However, the integration currently leaks internal knowledge/control notes directly into the client-facing proposal instead of applying them to generation decisions, which violates the Step 3 voice/preference requirement and can expose bid strategy.

### Issues Found
1. **[src/agent.ts:200] [important]** — Voice knowledge is appended to `proposalText` as `Voice preference to apply quietly: ...`. That is not “applied quietly”; it becomes part of the cover letter shown to the client and can make drafts look like prompt/instruction leakage. Fix by using voice knowledge to adjust template wording and banned/preferred phrases before composing the final draft, or by storing such guidance outside `proposalText`.
2. **[src/agent.ts:197-205] [important]** — Bid-rule and general knowledge are also inserted into the cover letter (`Bid preference: ...`, `Useful profile context: ...`). Bid preferences are internal recommendation inputs, not client-facing proposal copy, and could expose pricing/approval strategy. Fix by applying bid_rules to `suggestedBid`/connects warnings or internal fit reasons, and only include proof/portfolio/general text in the proposal when it is explicitly suitable as client-facing evidence.

### Pattern Violations
- None beyond the proposal-copy leakage above.

### Test Gaps
- Add/perform a targeted scenario with voice and bid_rules knowledge loaded, then assert the generated proposal does not contain meta labels such as `Voice preference`, `Bid preference`, or internal rule text.

### Suggestions
- Consider a small formatter/helper that separates client-facing knowledge snippets from internal guidance before composing the proposal.
