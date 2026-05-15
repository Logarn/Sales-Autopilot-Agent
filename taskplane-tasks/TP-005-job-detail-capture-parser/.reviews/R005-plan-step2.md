## Plan Review: Step 2: CLI integration

### Verdict: APPROVE

### Summary
The Step 2 plan covers the required CLI outcomes: parsing a capture file with optional URL override, writing into the existing manual jobs config, upserting by stable identity, printing a useful summary/next command, and validating with the targeted build. It is appropriately outcome-focused and aligns with the parser output and existing manual job pipeline.

### Issues Found
None.

### Missing Items
None.

### Suggestions
- When implementing the upsert, prefer matching by parser-derived `id` first and URL second so repeated captures remain stable even if a pasted/override URL varies slightly.
