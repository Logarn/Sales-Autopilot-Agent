# Step 1 Plan: Apply Preparation Plan Model

## Objective
Add a deterministic service that converts an existing approved application draft into a safe browser-fill plan. The output is data only: target URL, profile/rate/proposal fields, allowed attachments/highlights, Connects plan, validation warnings/errors, and `stopBeforeSubmit: true`.

## Proposed changes
1. Extend `src/types.ts` with `BrowserApplyFillPlan`, `BrowserApplyConnectsPlan`, validation issue types, and small field instruction types. Keep the model serializable so it can be placed in browser queue payloads and dry-run output.
2. Add `src/browserApply.ts` service with:
   - `buildBrowserApplyPlan(jobId, options?)` reading the approved application via `getApplicationDraft` and the job URL via a new/read helper in `src/db.ts`.
   - Direct URL derivation that accepts Upwork job/apply URLs only and derives an apply URL without requiring credentials.
   - Conservative profile/rate parsing from structured proposal browser-fill notes and suggested bid.
   - Attachment filtering from selected portfolio items: allow only items whose sensitivity is not `private`, `allowedUsage` is not `never`, and whose file path/name is present; return skipped reasons for anything disallowed.
   - Connects validation against `profile/connects-rules.json`: required Connects must be non-negative and <= `maxRequiredPerJob`; boost is clamped to `maxBoost`, never auto-maxed, and emits approval-required warnings above `requireApprovalAbove`.
3. Add a DB helper to fetch the canonical job URL for a job id without exposing broader row internals.
4. Ensure the service fails closed with explicit errors for non-approved status, missing proposal text, missing/direct-invalid link, and hard Connects cap violations. It should not enqueue or perform browser actions in Step 1.
5. Run `npm run build` for typecheck verification.

## Assumptions
- `approved` in `applications.status` is the human approval gate from TP-015.
- `selectedPortfolioItems` are the only approved attachment candidates available in current schema.
- If no structured browser fill notes exist, the approved proposal text and existing suggested bid/connects values are still valid plan inputs, with warnings for missing optional profile notes/highlights.
