## Code Review: Step 4: Docs and examples

### Verdict: APPROVE

### Summary
The documentation updates satisfy Step 4: README now describes the optional LLM normalization workflow, deterministic fallback/guardrails, and a capture-file example; `.env.example` includes the new LLM settings with safe disabled defaults. I did not run static quality checks because `.pi/taskplane-config.json` only declares `unit`/`build` commands and `package.json` has no `typecheck`, `lint`, or `format:check` scripts.

### Issues Found
None.

### Pattern Violations
- None.

### Test Gaps
- None blocking for this docs/examples step.

### Suggestions
- If users need machine-parseable JSON for piping to `jq`, consider documenting the quiet form, e.g. `DOTENV_CONFIG_QUIET=true npm --silent run normalize:capture -- captures/job-detail-sample.txt --url ...`, because plain `npm run` can add npm/dotenv banner output before the JSON.
