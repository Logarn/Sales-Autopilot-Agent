## Plan Review: Step 1: Add fingerprinting utilities

### Verdict: APPROVE

### Summary
The Step 1 plan covers the required outcome: introducing deterministic normalization, tokenization/fingerprinting, and simple similarity scoring in `src/dedupe.ts`, with type additions only if needed. I treated the STATUS.md Step 1 checklist as the available plan; it is broad but adequate for this utility-focused step and aligns with the task constraints to stay conservative and avoid embedding/vector dependencies.

### Issues Found
None.

### Missing Items
- None.

### Suggestions
- Keep the exported utility API explicit enough for Step 2/3 integration, e.g. fingerprint generation plus a similarity/result shape that can explain why two jobs matched.
- Include a small set of volatile/noise patterns in normalization from the start, but avoid overly aggressive matching that could collapse distinct jobs.
