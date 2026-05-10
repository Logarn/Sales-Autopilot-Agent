# TP-013: LLM Normalization Layer — Status

**Current Step:** Step 1: Normalized schema
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Required files and paths exist
- [x] Dependencies satisfied or documented

---

### Step 1: Normalized schema
**Status:** 🟨 In Progress
- [x] Define normalized packet types/schema for core job, client, requirements, questions, skills, connects, risks, proof hints, and proposal instructions
- [x] Add validation/repair helpers that merge LLM/deterministic data while rejecting unsafe direct links and preserving guarded fallback fields
- [x] Build passes
- [x] Replace rawTextHash snippet metadata with a non-reversible digest and prevent LLM-provided raw text from being preserved
- [x] Preserve deterministic direct job URL during repair and warn when discarding LLM-provided alternate URLs

---

### Step 2: Optional OpenAI-compatible provider
**Status:** ⬜ Not Started
- [ ] Add LLM config
- [ ] Implement safe provider wrapper
- [ ] Support no-key fallback
- [ ] Build passes

---

### Step 3: Normalization pipeline
**Status:** ⬜ Not Started
- [ ] Normalize via LLM when enabled, fallback otherwise
- [ ] Feed downstream workflow
- [ ] Add CLI command
- [ ] Build passes

---

### Step 4: Docs and examples
**Status:** ⬜ Not Started
- [ ] README updated
- [ ] .env.example updated
- [ ] Example command added

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Full tests or env limitation note
- [ ] Build passes
- [ ] Fallback CLI tested

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Docs updated
- [ ] Discoveries logged

---

## Reviews
| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-10 20:58 | Task started | Runtime V2 lane-runner execution |
| 2026-05-10 20:58 | Step 0 started | Preflight |

## Blockers
*None*
| 2026-05-10 20:59 | Review R001 | plan Step 1: APPROVE |
| 2026-05-10 21:02 | Review R002 | code Step 1: REVISE |
| 2026-05-10 21:03 | Review R003 | code Step 1: REVISE |
