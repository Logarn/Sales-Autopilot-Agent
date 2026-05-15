## Code Review: Step 1: Parser module and types

### Verdict: REVISE

### Summary
The new `src/jobCapture.ts` builds successfully and covers most of the requested parser surface with pure exported types/API and conservative fallbacks. However, URL extraction from pasted text is currently broken, and common Upwork slug URLs/client spend formats are not parsed, so Step 1 does not yet meet the stated URL/job-ID and client-spend extraction requirements.

Quality checks: `.pi/taskplane-config.json` and `package.json` declare no typecheck/lint/format-check commands matching the reviewer static-check list; I ran the task-required `npm run build`, which passed.

### Issues Found
1. **[src/jobCapture.ts:120] [important]** — `deriveUrl()` never returns a URL found in pasted text because the regex has no capture group, while `firstMatch()` only returns `match[1]`. A pasted job-detail page containing `https://www.upwork.com/jobs/...` therefore produces `url: ""` and an empty `manualJob.url` unless Step 2 supplies `--url`. Fix by adding a capturing group around the full URL, e.g. `(https?:\/\/[^\s]+upwork\.com\/jobs\/[^\s]+)`.
2. **[src/jobCapture.ts:113] [important]** — Job ID extraction only handles `/jobs/~id` URLs and misses the common Upwork slug form `/jobs/Some-Title_~022.../`. This violates the planned stable Upwork ID extraction from `~...` URLs and would make update/dedupe behavior less reliable. Broaden the pattern to capture any `~...` token in an Upwork jobs URL, such as `/upwork\.com\/jobs\/[^\s]*~([A-Za-z0-9_-]+)/i`.
3. **[src/jobCapture.ts:194] [important]** — Client spend misses common Upwork displays such as `$10K+ total spent` because the regex requires whitespace immediately after the optional `k/m`. As a result, visible spend becomes `null` and `manualJob.clientSpend` falls back to `0`. Allow an optional plus sign before `total spent`, e.g. `/\$([\d,.]+\s*[km]?)\+?\s+total spent/i`.

### Pattern Violations
- None beyond the parsing correctness issues above.

### Test Gaps
- No parser test/sample currently locks down URL extraction from pasted text, slug-style Upwork URLs, or `$10K+ total spent` client spend. These should be covered by the Step 3 sample or a small targeted parser fixture when tests are added.

### Suggestions
- Consider making `ManualJobCapture` reuse or extend the existing manual job input shape if it is later exported, to avoid drift between parser output and `src/sources/manualSource.ts` normalization.
