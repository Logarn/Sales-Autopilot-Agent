## Plan Review: Step 1: Knowledge file schema and loader

### Verdict: REVISE

### Summary
The available Step 1 plan in STATUS.md only restates the high-level checklist from PROMPT.md and does not describe how the loader/schema will satisfy the task's safety and usability requirements. Before implementation, the plan needs enough outcome-level detail to cover malformed/empty knowledge directories, supported artifact shapes, and how loaded content will remain concise for later proposal generation.

### Issues Found
1. **[Severity: important]** — The plan does not define the expected schema/contract for markdown vs JSON knowledge artifacts or how type grouping (`voice`, `proof`, `portfolio`, `video`, `bid_rules`, `general`) will be represented. Add outcome-level acceptance criteria for recognized types, optional metadata/tags, and the returned profile-enrichment structure so later CLI and proposal-integration steps have a stable target.
2. **[Severity: important]** — The safe-loader behavior is underspecified. The plan should explicitly cover empty/missing `profile/knowledge/`, malformed JSON, unsupported file extensions/types, and unreadable files without breaking existing profile/portfolio loading.
3. **[Severity: important]** — The plan only mentions `npm run build`; it lacks test/verification intent for the loader's core behavior. Add targeted verification for at least empty directory, valid markdown/json artifacts, malformed JSON handling, and concise/truncated output behavior.

### Missing Items
- Outcome criteria for producing "concise usable context" rather than blindly returning unbounded note contents.
- Backward-compatibility statement that existing `profile/profile.json` and `profile/portfolio.json` loading remains unchanged when no knowledge files exist.

### Suggestions
- Consider including deterministic ordering (for example by type then filename/date) as a non-blocking design goal so prompt context is stable across runs.
