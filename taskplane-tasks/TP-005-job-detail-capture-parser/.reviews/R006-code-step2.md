## Code Review: Step 2: CLI integration

### Verdict: APPROVE

### Summary
The CLI integration meets the Step 2 outcomes: `capture:job` routes `--file` input through the parser, supports an optional URL override, creates or updates `config/manual-jobs.json` by stable id/URL, and prints a concise summary with the next command. I ran `npm run build` successfully and also smoke-tested `npm run capture:job` against a temporary capture/manual-jobs path, including a repeat run that updated rather than duplicated the job. No configured typecheck/lint/format-check commands were declared under the required keys, so no additional quality checks were available.

### Issues Found
None.

### Pattern Violations
- None.

### Test Gaps
- No automated CLI coverage was added for create/update behavior, but the task defers broader testing and sample verification to later steps.

### Suggestions
- Consider validating `--file` values that are missing or accidentally point at another flag so users get usage output instead of a raw file-read error.
