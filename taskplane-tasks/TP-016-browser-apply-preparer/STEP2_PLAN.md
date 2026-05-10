# Step 2 Plan: Browser Apply Worker Path

## Objective
Teach the browser worker to process `prepare_application_review` actions safely. The worker should use the Step 1 fill plan, open only the apply page, detect login/security states, optionally fill conservative fields when browser execution is explicitly enabled, and always stop before final submit.

## Proposed changes
1. Update `src/browserWorker.ts` action URL resolution so `prepare_application_review` builds or refreshes a Step 1 plan by job id. Any supplied `payload.applyPlan` is treated as untrusted/stale metadata: if it contains blocking validation errors, or a refreshed plan is invalid, pause before browser navigation.
2. Dry-run should log/save only minimized metadata without opening credentials-dependent pages: action id, job id, apply URL, validation issue codes/severities, cover-letter length (not text), attachment/highlight counts (not paths), and `stopBeforeSubmit`.
3. Expand browser state handling with explicit apply-preparation results. Login, 2FA, CAPTCHA, Cloudflare, and security challenge states stay terminal `paused` with no filling attempts.
4. Add conservative fill helpers against generic/textarea/input selectors for cover letter, rate, and Connects/boost. Only fill if a selector is visible/fillable; collect skipped fields rather than throwing; never select or click submit/final action controls.
5. For allowed attachments/highlights, attempt only where clear file inputs or checkbox/text selectors are available. Otherwise record explicit manual/skipped field names and counts in minimized diagnostics; never attach disallowed/private files.
6. Save minimized JSON diagnostics only: action id, job id, URL, detected state, field names attempted/skipped/manual, validation issue codes, content lengths/counts, and stop-before-submit flag. No proposal text, attachment paths, HTML, screenshots, credentials, or full page archives.
7. Run `npm run build`.

## Guardrails
- `BROWSER_DRY_RUN=true` never launches a browser and never requires Upwork credentials.
- Any Step 1 validation error pauses the action instead of opening a browser.
- Security/login states are detected before filling and pause immediately.
- There is no code path that clicks final submit.
