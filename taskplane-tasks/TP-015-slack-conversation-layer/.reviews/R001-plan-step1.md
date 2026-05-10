## Plan Review: Step 1: Conversation intent model

### Verdict: APPROVE

### Summary
The Step 1 plan covers the required outcomes: adding the conversation intent model, implementing a deterministic natural-language parser with job/application ID extraction, exposing a local CLI/testing path, and keeping the build green. This is appropriately scoped for the foundation step and does not prematurely include later DB mutation or Slack inbound behavior.

### Issues Found
None.

### Missing Items
- None.

### Suggestions
- When implementing, make sure `unknown` is an explicit intent outcome and that parser coverage includes common synonyms/phrasing for approve, reject, revise, regenerate, mark applied/replied, and browser enqueue commands.
- Consider treating missing or ambiguous job/application IDs as deterministic parse failures rather than guessing.
