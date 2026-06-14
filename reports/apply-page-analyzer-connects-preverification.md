# Apply Page Analyzer + Connects Pre-Verification

Branch: `codex/apply-page-analyzer-connects-preverify`

## Summary

Implemented a structured, read-only Upwork apply-page analyzer and integrated it into browser apply preparation readiness. The worker now records page structure, challenge/login/2FA state, required Connects, boost visibility/selection, cover letter state, screening answer state, rate state, attachment state, portfolio/profile highlight state, and final submit control visibility without clicking submit.

## Safety Behavior

- Final submit remains manual. The analyzer can detect submit controls such as `Send for 8 Connects`, but it never clicks them.
- Browser/security/challenge, login, and 2FA pages block preparation before any fill attempt.
- Unknown page structure fails closed and is not marked ready.
- Required Connects must be visible/readable before an application can be treated as ready.
- Visible boost tables are recorded separately from selected boost values; table visibility alone does not imply a boost was set.
- Browser preparation is not marked ready unless analyzer-backed checks confirm page structure, final submit visibility, required Connects, cover letter, rate, and planned required fields.

## Files Changed

- `src/browser/applyPageAnalyzer.ts`
- `src/browserApplyPageAnalyzer.test.ts`
- `src/browserApply.test.ts`
- `src/browserWorker.ts`

## Verification

- `npm ci` because dependencies were missing locally.
- `npm run build`
- `npx tsx src/browserApplyPageAnalyzer.test.ts`
- `npx tsx src/browserApply.test.ts`
- `npx tsx src/connectsExtraction.test.ts`

## Notes

No live Upwork, browser prep, VNC, production, Contabo, lead-engine, PR, merge, or deployment activity was performed.
