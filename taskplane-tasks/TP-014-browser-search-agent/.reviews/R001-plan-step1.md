## Plan Review: Step 1: Search config and query model

### Verdict: REVISE

### Summary
No implementation plan was provided beyond the existing STATUS.md outcome checkboxes, so I cannot verify that Step 1 will cover the required config fields and model boundaries before implementation. Please add a concise plan for this step that maps the PROMPT requirements to the existing config/type patterns and identifies how dry-run/build safety will be preserved.

### Issues Found
1. **[Severity: important]** — The plan artifact is missing/insufficient: STATUS.md only says “Add search config,” “Add types/helpers,” and “Build passes,” while PROMPT.md specifically requires browser search interval, max jobs per query, search queries, freshness window, and dry-run controls. Add a short plan that states these outcomes explicitly, including default behavior when browser search is disabled or no queries are configured.

### Missing Items
- Plan coverage for how new configuration will integrate with existing `src/config.ts` validation/default patterns without requiring browser credentials or Playwright at build time.
- Plan coverage for the query/result/captured-page types/helpers expected from Step 1, including enough shape to support later runner handoff to capture/normalization.
- Plan coverage for the Step 1 verification command to confirm the build/typecheck still passes.

### Suggestions
- Keep the plan outcome-level: list the config fields/defaults, the type/helper categories, and the build check, without enumerating every implementation function.
