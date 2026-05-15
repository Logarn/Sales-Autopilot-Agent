## Plan Review: Step 1: Heartbeat schema and helpers

### Verdict: APPROVE

### Summary
The revised Step 1 plan addresses the prior R001 blockers: it now calls out required heartbeat fields, idempotent table creation, helper outcomes for upsert/read/list/stale detection, timestamp stability, JSON metadata defaults, and validation intent. This is sufficient for the Step 1 outcome and should support the later scheduler, health, and alerting steps.

### Issues Found
None.

### Missing Items
- None.

### Suggestions
- When implementing stale detection, prefer accepting an explicit threshold/current-time parameter where practical so Step 3 health checks and any lightweight validation can exercise boundary cases deterministically.
