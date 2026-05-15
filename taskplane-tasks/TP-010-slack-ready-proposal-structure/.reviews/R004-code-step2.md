## Code Review: Step 2: Generate better V0 proposals

### Verdict: REVISE

### Summary
The proposal generation now creates structured sections and moves proof earlier, and `npm run build` passes. However, one explicit-instruction path inserts internal guidance into the client-facing `proposalText` rather than actually answering the client, so Step 2's “answer explicit client instructions” outcome is not reliably met.

### Issues Found
1. **[src/agent.ts:114-116,306-321] [important]** — When a job asks for a portfolio/example/case study/proof, the generated client-facing proposal includes text like `To answer the application notes directly: Proof: include the strongest relevant retention/Klaviyo examples rather than a broad portfolio dump.` That reads as an internal instruction, not an answer to the client, and it is inserted directly into `proposalText`. Fix by generating client-facing proof answers with concrete selected examples/results (or moving the internal attachment instruction only into `structuredProposal.suggestedAttachments` / browser-fill notes) so the final cover letter answers the request naturally.
2. **[src/agent.ts:111-113] [important]** — The explicit budget/rate answer always prefers `$${profile.hourlyRate}/hr` whenever an hourly rate exists, even for fixed-price/budget/retainer prompts. This can contradict `suggestBid()` and give the wrong client-facing answer for fixed-budget jobs. Fix by reusing `suggestBid(job, profile)` or checking whether the job is hourly before emitting an hourly rate.

### Pattern Violations
- None identified.

### Test Gaps
- No targeted tests or sample fixtures cover explicit client instruction extraction (portfolio/proof request, fixed-budget rate request, availability/approach request). These would catch the internal-note-in-client-copy regression.

### Suggestions
- `npm run build` passes. I did not find configured `typecheck`, `lint`, or `format:check` commands under the review-command discovery rules; `build` is the available TypeScript compile check and was run because this step explicitly claims it.
