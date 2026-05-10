## Plan Review: Step 1: Add structured scoring types and scorer

### Verdict: APPROVE

### Summary
The plan covers the required Step 1 outcomes: adding structured score types, introducing a deterministic scorer with component scores/reasons/risks, and using profile preferences plus Connects rules while preserving safe fallbacks. It appropriately leaves pipeline wiring, Slack display, and documentation to later steps.

### Issues Found
None.

### Missing Items
- None.

### Suggestions
- When implementing, define clear score ranges/weights for each component and ensure `finalScore` can coexist with the legacy numeric `score` until Step 2 completes.
- Include fallback behavior for absent or partial profile/connects-rule config directly in the scorer so future wiring does not need to special-case missing files.
