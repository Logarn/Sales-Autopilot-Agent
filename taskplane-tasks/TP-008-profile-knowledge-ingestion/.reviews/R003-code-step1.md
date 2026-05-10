## Code Review: Step 1: Knowledge file schema and loader

### Verdict: REVISE

### Summary
The new artifact types and loader cover the main happy paths, and `npm run build` passes. However, the loader still has unsafe traversal behavior for unreadable directories and can infer artifact types from path segments outside the configured knowledge directory, which violates the safe/missing-type behavior required for Step 1.

### Issues Found
1. **[src/profileKnowledge.ts:141] [important]** — `collectFiles()` calls `fs.readdirSync()` during traversal without catching errors, so an unreadable subdirectory under `profile/knowledge` throws out of `loadProfileKnowledge()` instead of returning partial results plus a warning. I reproduced this with a `chmod 000` nested directory; `loadProfileKnowledge()` threw `EACCES`. Fix by threading the warnings list/relative paths into traversal or wrapping `statSync`/`readdirSync` calls and recording a `KnowledgeLoadWarning` before continuing.
2. **[src/profileKnowledge.ts:90] [important]** — `inferType()` scans every segment of the absolute file path, so a note without metadata can be incorrectly classified if any parent directory outside `profile/knowledge` is named `voice`, `proof`, `portfolio`, `video`, `bid_rules`, or `general`. I reproduced this with `/tmp/general/.../knowledge/misc/note.md`, which was loaded as `general` instead of warning for missing type. Fix by inferring from the path relative to the configured knowledge directory only, or by passing the relative knowledge path into `inferType()`.

### Pattern Violations
- None beyond the safe-loader issues above.

### Test Gaps
- Add/keep targeted coverage for unreadable directories during recursive traversal.
- Add coverage that files outside recognized type subdirectories and without valid `type` metadata produce warnings, independent of the workspace/absolute parent path names.

### Suggestions
- `npm run build` passed. No configured `typecheck`, `lint`, or `format:check` commands were present in `.pi/taskplane-config.json` or `package.json`; build was run because this step explicitly requires it.
