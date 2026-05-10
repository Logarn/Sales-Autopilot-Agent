## Code Review: Step 3: Documentation

### Verdict: APPROVE

### Summary
The README now documents the structured deterministic scoring model, component categories, Slack/application visibility, and the 80/45/30 match-level thresholds required by Step 3. I did not run static quality checks because the project config/package scripts expose no `typecheck`, `lint`, or `format:check` command under the reviewer-required command discovery rules.

### Issues Found
None.

### Pattern Violations
None.

### Test Gaps
None for this documentation-only step.

### Suggestions
- Consider adding a short note near the environment variables that `MIN_SCORE_TO_NOTIFY=4` and `MIN_SCORE_HIGH=8` are legacy 0-10-style knobs that map to 45/80+ final-score thresholds, so operators do not set them to `45`/`80` directly.
