## Code Review: Step 1: Search config and query model

### Verdict: REVISE

### Summary
The new config exports and browser-search data shapes are in place, dry-run/search are disabled by default, and `npm run build` passes. However, the URL helpers currently treat any `http(s)` input as a browser search target and the “safe Upwork job URL” check can match an Upwork URL embedded inside an arbitrary URL/string, which weakens the safety boundary that later browser runner code will depend on.

### Issues Found
1. **[src/browserSearch.ts:24-27] [important]** — `normalizeUpworkSearchInput` accepts any `http(s)` URL as a configured search URL, so `BROWSER_SEARCH_URLS=https://example.com/...` would be normalized and later opened as if it were an Upwork search. Step 1 is establishing the safe query model for the browser runner, so this should validate that URL inputs are Upwork search URLs (for example host `www.upwork.com`/`upwork.com` and path under `/nx/search/jobs/`) or reject/ignore them with a clear skip reason; plain text inputs can continue to be converted into canonical Upwork search URLs.
2. **[src/browserSearch.ts:12,74-75] [important]** — `isSafeUpworkJobUrl` uses an unanchored regex, so strings like `https://evil.test/?next=https://www.upwork.com/jobs/~0123456789` return true. Because this helper is intended to gate job-detail navigation, implement it with `new URL(...)` plus exact host/path checks (and then extract the `~jobId` from the Upwork path), or anchor the validation so the entire trimmed value must be an Upwork job URL.

### Pattern Violations
- None beyond the safety-validation gaps above.

### Test Gaps
- Add focused coverage or at least executable checks for URL normalization/safety: plain query to canonical search URL, valid Upwork search URL, non-Upwork URL rejection, valid Upwork job URL, and embedded-Upwork-in-foreign-URL rejection.

### Suggestions
- Project config did not declare reviewer static checks matching `typecheck`/`lint`/`format:check` (only `build`), and `package.json` has no `typecheck`, `lint`, or `format:check` scripts. I ran `npm run build` because Step 1 requires it; it passed.
