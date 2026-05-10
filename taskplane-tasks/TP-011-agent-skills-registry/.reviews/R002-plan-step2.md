## Plan Review: Step 2: Add registry/loader

### Verdict: REVISE

### Summary
I could not find an actual implementation plan for Step 2 in the request or task files beyond the three STATUS checkboxes. Those outcomes are directionally correct, but they do not specify key loader behavior needed to ensure the npm commands work reliably and safely against the Step 1 `skills/*/SKILL.md` content.

### Issues Found
1. **[Severity: important]** — The plan does not define the registry/loader contract: how skill names map to `skills/<name>/SKILL.md`, what list output contains, how `read` handles unknown names/path traversal, and what CLI arguments/scripts operators will use. Add outcome-level coverage for deterministic skill discovery, safe name validation, clear not-found errors, and both list/read CLI entry points before implementation.

### Missing Items
- Specify that `src/skills.ts` should be executable as a CLI as well as expose reusable list/read helpers.
- Specify npm script usage for listing all skills and showing one skill by name.
- Include error handling expectations for missing `skills` directory, missing `SKILL.md`, invalid skill names, and unknown skill names.

### Suggestions
- Keep output simple and script-friendly: sorted skill names for list, raw markdown for read, and non-zero exit codes on CLI errors.
