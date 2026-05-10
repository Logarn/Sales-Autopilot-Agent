## Code Review: Step 4: Documentation

### Verdict: APPROVE

### Summary
The README now documents both exact-ID and semantic dedupe, including the stable fields used for fingerprints, ignored volatile noise, persisted `seen_jobs` fingerprints, and the intentionally conservative behavior. I did not run static quality checks because `.pi/taskplane-config.json` declares only `unit`/`build` commands and `package.json` has no `typecheck`, `lint`, or `format:check` scripts.

### Issues Found
None.

### Pattern Violations
- None.

### Test Gaps
- None for this documentation-only step.

### Suggestions
- None.
