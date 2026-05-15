## Code Review: Step 2: CLI for adding knowledge

### Verdict: REVISE

### Summary
The CLI scripts are wired and the basic knowledge/video/portfolio flows work; `npm run build` passes. However, the knowledge append command can silently overwrite an existing note with the same title on the same day, which conflicts with the mission of accumulating knowledge over time. No configured typecheck/lint/format-check commands were available in `.pi/taskplane-config.json` or `package.json`; I ran the step-required `npm run build` instead.

### Issues Found
1. **[src/knowledge.ts:69] [important]** — Knowledge note filenames use only `YYYY-MM-DD` plus the slugified title, so running `knowledge:add` twice with the same title/type on the same day writes the same path and silently replaces the first note. Fix by making filenames unique (for example include full timestamp down to seconds/milliseconds, append a counter when the path exists, or refuse to overwrite unless an explicit `--force` flag is provided).

### Pattern Violations
- None found.

### Test Gaps
- Missing coverage/manual verification for adding two notes with the same type/title on the same day and confirming both are retained.

### Suggestions
- Consider validating `--sensitivity` and `--allowed-usage` against the declared enum values before writing `portfolio.json`.
