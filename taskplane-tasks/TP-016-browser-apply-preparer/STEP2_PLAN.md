# Step 2 Plan: Browser Apply Worker Path

## Objective
Teach the browser worker to process `prepare_application_review` actions safely. The worker should use the Step 1 fill plan, open only the apply page, detect login/security states, optionally fill conservative fields when browser execution is explicitly enabled, and always stop before final submit.

## Proposed changes
1. Update `src/browserWorker.ts` action URL resolution so `prepare_application_review` uses `payload.applyPlan.applyUrl` or builds a fresh plan by job id; dry-run should log/save the fill plan without opening credentials-dependent pages.
2. Expand browser state handling with explicit apply-preparation results. Login, 2FA, CAPTCHA, Cloudflare, and security challenge states stay terminal `paused` with no filling attempts.
3. Add conservative fill helpers against generic/textarea/input selectors for cover letter, rate, and Connects/boost. Only fill if a selector is visible/fillable; collect skipped fields rather than throwing; never select or click submit/final action controls.
4. Save minimized JSON diagnostics only: action id, job id, URL, detected state, fields attempted/skipped, validation issue codes, and stop-before-submit flag. No HTML, screenshots, credentials, or full page archives.
5. Run `npm run build`.

## Guardrails
- `BROWSER_DRY_RUN=true` never launches a browser and never requires Upwork credentials.
- Any Step 1 validation error pauses the action instead of opening a browser.
- Security/login states are detected before filling and pause immediately.
- There is no code path that clicks final submit.
