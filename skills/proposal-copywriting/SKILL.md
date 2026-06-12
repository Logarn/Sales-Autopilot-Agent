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
2. Confirm `job_understanding` exists.
3. Confirm `brand_fact_pack` exists when brand/category clues exist.
4. Confirm proof/portfolio strategy exists or is marked unavailable.
5. Create `copy_strategy`.
6. Draft cover letter and screening answers from this skill.
7. Run copy quality gates.
8. Only fill browser fields if the draft passes.
9. Stop before final submit.

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
- Client/customer insight before tools.
- Commercial opportunity before credentials.
- Pain/desire before proof.
- Specific mechanism before flow names.
- Proof only when verified or clearly framed as planned.
- Soft human CTA.

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

## Fatal quality gates
Fail or revise before browser fill if:
- the cover letter starts with generic expert/experience copy
- copy contains placeholder/debug/test/scraped UI noise
- copy contains `just adding noise`
- copy ends mid-thought or with truncation ellipsis
- copy has no customer insight
- copy has no business opportunity or commercial pain
- copy lists tools/flows before explaining customer logic
- copy claims proof/portfolio/attachments without verification
- copy has no complete CTA
- copy suggests final submit or bypassing login/CAPTCHA/security/passkey/2FA

## Screening answers
Screening answers should be short, direct, and proof-backed:
1. Direct answer first.
2. Relevant verified or planned proof second.
3. Specific mechanism third.
4. No generic enthusiasm.
