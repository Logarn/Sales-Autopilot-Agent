# Step 3 Plan: CLI/Testing Path

## Objective
Expose a local command path to preview or enqueue browser apply preparation for an approved job id, with dry-run output that shows exactly what fields would be filled without requiring Upwork credentials.

## Proposed changes
1. Extend `src/browserQueue.ts` with `--apply-preview` and `--apply-prepare` modes for `--job-id <id>`.
2. `--apply-preview` builds a fresh Step 1 plan, prints full operator-facing dry-run details (cover letter text, rate, profile, attachments/highlights, Connects plan, validation issues, stop-before-submit), and exits nonzero on validation errors.
3. `--apply-prepare` builds/validates the plan and enqueues a `prepare_application_review` action with only the plan payload needed by the worker. It should fail closed on Step 1 validation errors.
4. Keep existing generic `--enqueue`, `--list`, and `--update` behavior compatible.
5. Run `npm run build`.

## Notes
Worker artifacts remain minimized from Step 2; this CLI preview is explicit terminal output for the operator-requested dry-run path in Step 3.
