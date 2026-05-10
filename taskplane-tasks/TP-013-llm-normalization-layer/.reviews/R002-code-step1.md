## Code Review: Step 1: Normalized schema

### Verdict: REVISE

### Summary
The normalized packet types cover the requested job/client/requirements/questions/skills/connects/risks/proof/proposal sections, and `npm run build` passes. However, the deterministic packet currently stores raw capture text in a field named `rawTextHash`, which can leak job/email/manual capture content into later JSON output or logs and undermines the task's security/privacy constraint.

### Issues Found
1. **[src/normalization.ts:62] [important]** — `rawTextHash` is not a hash; it embeds the first 80 characters of `rawText` (`${rawText.length}:${rawText.slice(0, 80)}`). Because normalized packets are intended to feed CLI/Slack/proposal paths in later steps, this can expose raw browser/email/manual text anywhere the packet is printed or logged. Fix by computing a real non-reversible digest (for example Node `crypto.createHash("sha256").update(rawText).digest("hex")`) and avoid preserving arbitrary LLM-provided raw text in this field during repair.

### Pattern Violations
- None found.

### Test Gaps
- No tests or sample assertions cover that normalized packet metadata does not contain raw capture snippets. Add a targeted check once tests are introduced for the normalization layer.

### Suggestions
- Quality checks: `.pi/taskplane-config.json` and `package.json` do not define typecheck/lint/format-check commands under the required names; I ran the task's targeted `npm run build` anyway, and it passed.
