## Code Review: Step 1: Add proposal critic types and module

### Verdict: REVISE

### Summary
The new critic module and proposal quality types are in place, deterministic, and `npm run build` passes. However, the banned-phrase check does not correctly handle the profile's `X` placeholder phrase, so a key Steve voice rule can be missed.

### Issues Found
1. **[src/critic.ts:100] [important]** — Placeholder banned phrases such as profile `"With over X years of experience"` will not flag real drafts like `"With over 8 years of experience"`. `normalize(phrase).replace("x", "")` produces `"with over  years of experience"`, which still will not match the number-filled text. Fix by treating `X` in banned phrases as a wildcard regex segment (for example `\bwith over\s+\d+\s+years of experience\b`) or by adding explicit normalized pattern handling for this template.

### Pattern Violations
- None found.

### Test Gaps
- No targeted test or example covers profile banned phrases with placeholders/variable values.

### Suggestions
- Consider normalizing whitespace/punctuation before phrase matching to make the critic less brittle.
- Quality check run: `npm run build` passed.
