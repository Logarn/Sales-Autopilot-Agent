## Code Review: Step 3: Documentation and sample

### Verdict: REVISE

### Summary
The README workflow and sample file cover the intended documentation outcomes, and the sample is broadly representative. However, the new sample includes a visible client rating that the current parser does not extract, so the documented/sample workflow would fail the upcoming “manually test parser against sample capture” verification for one of the required client detail fields. No configured typecheck/lint/format-check commands were available in `.pi/taskplane-config.json` or `package.json`; I did run a targeted parser invocation against the sample to validate the documentation artifact.

### Issues Found
1. **[captures/job-detail-sample.txt:34] [important]** — The sample says `Rating is 4.9 out of 5.`, but `parseJobDetailCapture(captures/job-detail-sample.txt)` returns `client.rating: null`. This conflicts with the README claim that visible client details are parsed and with TP-005’s requirement to extract client rating when present. Fix by updating the parser rating regex to handle the `out of 5` wording (preferred, since the sample looks realistic), then confirm the sample yields `client.rating: 4.9`.

### Pattern Violations
- None.

### Test Gaps
- The sample capture should be included in the manual/targeted verification path; currently parsing it exposes the missing client rating extraction above.

### Suggestions
- Consider adding a README note that `--url` is optional only when the pasted capture text already includes the Upwork job URL; otherwise it is required.
