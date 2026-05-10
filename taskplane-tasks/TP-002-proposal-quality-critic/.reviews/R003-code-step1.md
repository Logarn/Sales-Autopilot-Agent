## Code Review: Step 1: Add proposal critic types and module

### Verdict: APPROVE

### Summary
The Step 1 implementation adds the requested proposal quality types and a deterministic `critiqueProposal()` module covering banned phrases, weak openings, generic claims, length, CTA, proof relevance, and Steve voice signals. The previous placeholder banned-phrase issue is addressed for normal cases such as `With over 8 years of experience`, and `npm run build` passes.

### Issues Found
None.

### Pattern Violations
- None found.

### Test Gaps
- No automated coverage yet for the critic heuristics, especially profile banned phrases with `X` placeholders and score bounds. This is acceptable for Step 1, but should be covered if tests are added for the critic later.

### Suggestions
- Consider treating only uppercase/profile-template `X` as a placeholder before lowercasing, so ordinary banned phrases containing `x` are not compiled with wildcard segments.
- Consider allowing placeholder values with punctuation such as `8+` in `With over X years of experience`.
- Quality check run: `npm run build` passed.
