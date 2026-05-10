## Code Review: Step 1: Apply preparation plan model

### Verdict: REVISE

### Summary
The new model/service covers most of the requested Step 1 fields and guardrails, and `npm run build` passes. However, the apply URL derivation uses the internal application `job_id` instead of the Upwork job id from the stored URL, which produces invalid apply links for manual/captured jobs whose ids are `manual:*`.

### Issues Found
1. **[src/browserApply.ts:72] [important]** — `deriveApplyUrl()` builds `/ab/proposals/job/~${jobId}/apply/` from the database/application id, but manual imports commonly use internal ids such as `manual:<base64>` or `manual:upwork-<id>` while the real Upwork id is only present in `seen_jobs.url`. For an approved manual job with `url=https://www.upwork.com/jobs/..._~0123456789abcdef/`, this produces an invalid apply URL like `https://www.upwork.com/ab/proposals/job/~manual%3A.../apply/`, so Step 1 does not reliably convert approved applications into browser-fill instructions. Fix: validate that the stored URL is a direct Upwork job/apply URL and extract the `~...` Upwork id from that URL when constructing the apply URL; if no Upwork job id can be extracted, return an `invalid_upwork_link` error instead of manufacturing an apply URL from the internal id.

### Pattern Violations
- None found.

### Test Gaps
- No coverage for manual/captured jobs where `applications.job_id` differs from the Upwork `~job` id embedded in `seen_jobs.url`. Add a unit/integration case for that path, plus an invalid Upwork URL case.

### Suggestions
- Consider requiring `https:` in `parseUpworkUrl()` so a direct `/apply` URL cannot preserve an insecure `http://` source as `applyUrl`.
