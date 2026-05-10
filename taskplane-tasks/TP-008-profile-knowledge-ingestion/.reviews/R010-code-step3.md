## Code Review: Step 3: Proposal integration

### Verdict: REVISE

### Summary
`npm run build` passes, and I found no configured typecheck/lint/format-check commands in `.pi/taskplane-config.json` or `package.json`. The previous meta-instruction leakage has been addressed, but voice knowledge still is not actually consumed in the normal CLI workflow, so the step's voice preference override/supplement outcome is not met.

### Issues Found
1. **[src/agent.ts:177-204] [important]** — Voice artifacts only affect the draft when their tags use undocumented `prefer:` / `ban:` prefixes; the artifact text/summary itself is ignored. The CLI example for this task writes a voice note as plain text (`--text "Prefer a confident, specific next step."`) with no special tag, so that note loads successfully but has no effect on the proposal. Fix by applying voice artifact content/summary as preference input, or by documenting and enforcing structured metadata for preferred/blocked phrases and parsing it from the loader/CLI.
2. **[src/agent.ts:177] [important]** — `knowledge.byType.voice.slice(0, 2)` uses the first two voice files in loader sort order, which is path/timestamp ascending, so newer voice additions cannot override older preferences once more than two notes exist. This conflicts with the requirement that cover-letter preferences can override or supplement current voice rules over time. Fix by selecting the most recent/high-priority voice artifacts, or by merging all bounded voice rules with deterministic precedence where newer notes can override older ones.

### Pattern Violations
- None.

### Test Gaps
- Add a targeted scenario matching the CLI workflow: create a plain-text `voice` knowledge note such as “Prefer a shorter CTA” / “Avoid phrase X”, build a draft, and assert the generated proposal changes and banned wording is removed without requiring magic tags.
- Add a multiple-voice-note case to verify newer preferences can take precedence instead of being silently ignored.

### Suggestions
- `generalKnowledge` and `knowledgeLine()` are currently unused; remove them or wire them in during the next iteration to avoid dead code accumulating.
