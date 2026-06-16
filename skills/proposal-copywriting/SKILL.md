# Proposal Copywriting Skill

## Purpose
Write Upwork cover letters and screening answers like a sharp direct-response sales operator, not a generic form filler.

The proposal must prove Steve understood the client, the client customer, the commercial pain, and the practical next step before it talks about tools or credentials.

## Runtime triggers
- Cover-letter drafting
- Screening-answer drafting
- Proposal preview or revision
- Application prep before browser fill

## Runtime order
1. Read the full Upwork job title and description.
2. Load `soul.md` before writing or rewriting any proposal, screening answer, or Slack-facing proposal copy.
3. Confirm `job_understanding` exists.
4. Confirm `brand_fact_pack` exists when brand/category clues exist.
5. Confirm proof/portfolio strategy exists or is marked unavailable.
6. Create `copy_strategy`.
7. Draft screening answers first when client questions exist.
8. Draft cover letter and screening answers from this skill.
9. Run the proposal scorecard and copy quality gates.
10. Only fill browser fields if the draft passes.
11. Stop before final submit.

## Copy strategy schema
The runtime must create:

```json
{
  "job_title": "",
  "client_business": "",
  "brand_name": "",
  "brand_url": "",
  "category": "",
  "target_customer": "",
  "customer_state_of_mind": "",
  "customer_pain_or_desire": "",
  "client_commercial_pain": "",
  "cost_of_inaction": "",
  "money_leak": "",
  "buying_moment": "",
  "repeat_purchase_or_conversion_moment": "",
  "likely_lifecycle_gap": "",
  "offer_or_project_mechanism": "",
  "retention_lane": "migration_foundation | revenue_lift | founder_voice | lifecycle_operator | subscription_winback | technical_retention | agency_support | email_template_clarity | flow_audit",
  "proof_angle": "",
  "proof_verification_state": "verified | planned | unavailable | do_not_claim",
  "tone": "casual | direct | sharp | warm | witty",
  "opening_angle": "",
  "one_sentence_sales_argument": "",
  "cta": "",
  "unknowns": [],
  "do_not_claim": []
}
```

Unknown fields stay unknown. Do not fake research, proof, portfolio, metrics, attachments, or browser-visible state.

## Required copy shape
- Human opener: `Steve here,` then `How is your day going?`
- First two sentences contain at least two concrete details from the job post or visible company context.
- Client/customer insight before tools.
- Commercial opportunity before credentials.
- Pain/desire before proof.
- Specific mechanism before flow names.
- Exactly one proof artifact or relevant example. Never proof dump.
- That proof must carry one metric or quantified result when proof is available.
- One 3-5 day micro-milestone with explicit acceptance criteria using `Done = ...`.
- One logistics sentence.
- End with a choice-based CTA, such as quick call vs async outline, or one direct scope-tied question.
- Default supervised proposal length: 150-220 words.
- Proof only when verified or clearly framed as planned.

## Direct-response principles
- Pain first.
- Specificity before capability.
- Customer psychology before tools.
- Cost of inaction before credentials.
- Clear mechanism before proof.
- Proof after the logic.
- Strong but human CTA.
- Write to the client reader's ego and outcome, not Steve's credentials.
- Answer: who cares, so what, and what is in it for the client.

## Category logic
- Gardening: seasons, planting windows, plant type, climate, skill level, care mistakes, replenishment, customer confidence.
- Beauty/skincare: trust, routine, skin anxiety, product education, product pairing, first result, replenishment.
- Fashion/apparel: occasion, identity, fit, styling confidence, seasonal drops, discovery, abandoned intent.
- Email design: hierarchy, offer clarity, skim behavior, mobile-first reading, CTA placement, conversion friction.
- B2B/SaaS: workflow pain, wasted time, risk reduction, decision confidence, implementation friction, adoption.

## Retention marketing lanes
- Migration/foundation: Shopify Email or another ESP is capping segmentation, reporting, SMS, or behavioral logic.
- Revenue lift: client names email revenue share, conversion, CRO, RPR, repeat purchase, or revenue growth.
- Founder voice: client cares about voice, tone, personal writing, or not sounding like a marketing department.
- Lifecycle operator: campaigns, flows, segmentation, and weekly owned-channel output.
- Subscription/win-back: replenishment, repeat purchase, subscriptions, churn, or win-back recovery.
- Technical retention: integrations, deliverability, event tracking, QA, Liquid/HTML, subscriptions, or API work.
- Agency support: multiple brands/accounts where speed, QA, and consistency matter.
- Email template clarity: offer hierarchy, product path, mobile skim behavior, and CTA clarity.
- Flow/audit: underperforming flows, missing automations, account audit, or prioritized quick wins.

## Fatal quality gates
Fail or revise before browser fill if:
- `soul.md` was not loaded before proposal copywriting
- the first two sentences do not contain two job-specific details
- the cover letter starts with generic expert/experience copy
- copy contains placeholder/debug/test/scraped UI noise
- copy contains `just adding noise`
- copy ends mid-thought or with truncation ellipsis
- copy has no customer insight
- copy has no business opportunity or commercial pain
- copy lists tools/flows before explaining customer logic
- copy has no single relevant proof artifact/example, or mentions more than one proof item
- copy has no metric or quantified result attached to the proof
- copy has no 3-5 day `Done = ...` micro-milestone
- copy asks more than two questions
- copy has no choice-based CTA
- copy claims proof/portfolio/attachments without verification
- copy has no complete CTA
- copy suggests final submit or bypassing login/CAPTCHA/security/passkey/2FA

## Proposal scorecard
Run this before browser fill. Ready requires 85+ with no hard failures.

| Dimension | Weight | Hard fail |
|---|---:|---|
| Opener specificity | 15 | Generic opener that could fit any job |
| Client-goal understanding | 15 | Misreads or ignores the main ask |
| Proof relevance | 15 | No proof, or more than one unrelated proof |
| Micro-milestone clarity | 15 | No first slice or no `Done = ...` criteria |
| Screening-answer quality | 10 | Required question skipped or vague |
| Tone / humanity | 10 | `soul.md` missing or generic AI voice |
| Logistics | 5 | No availability/timeline/async rhythm |
| CTA quality | 5 | Passive or missing close |
| Readability | 5 | Wall of text or outside 150-220 word band without reason |
| Honesty / risk control | 5 | Invented research, fake guarantee, or off-platform/payment language |

## Screening answers
Screening answers should be short, direct, and proof-backed:
1. Direct answer first.
2. Relevant verified or planned proof second.
3. Specific mechanism third.
4. No generic enthusiasm.
