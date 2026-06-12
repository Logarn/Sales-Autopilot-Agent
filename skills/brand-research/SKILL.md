# Brand Research Skill

## Purpose
Build a conservative `brand_fact_pack` before proposal copy when a job post gives a brand, website, product, category, or useful market clue.

This skill exists to help the agent sound like it understands the client's customer, buying moment, lifecycle leak, and commercial pain before writing.

## Runtime triggers
- Job description contains a brand, store, company, website, product, or useful category clue.
- Application prep needs brand/category intelligence before cover-letter drafting.
- Proposal revision asks for stronger brand, customer, ICP, product, category, or commercial insight.

## When not to use
- No useful brand, website, product, or category clue exists and category-level research would be guesswork.
- The only possible research path would require the production Upwork/VNC browser session.
- The page requires login, paywall bypass, CAPTCHA, 2FA, passkey, or security handling.

## Required output
Create `brand_fact_pack`:

```json
{
  "brand_name": "",
  "website_urls": [],
  "what_the_brand_sells": "",
  "product_category": "",
  "target_customer_icp": "",
  "customer_buying_moment": "",
  "repeat_purchase_moment": "",
  "emotional_pain_or_desire": "",
  "likely_lifecycle_leak": "",
  "likely_conversion_leak": "",
  "customer_education_gaps": [],
  "objections_or_trust_gaps": [],
  "language_or_hooks": [],
  "proof_angle": "",
  "assumptions": [],
  "what_not_to_claim": [],
  "confidence": "high | medium | low | unavailable",
  "sources": [],
  "source_details": [
    {
      "title": "",
      "url": "",
      "snippet": "",
      "provider": ""
    }
  ],
  "web_research_provider": "",
  "web_research_status": "not_applicable | not_configured | skipped | succeeded | failed",
  "web_research_query": ""
}
```

## Research rules
- Use web/category research only when the job gives a brand, website, product, category, or useful clue.
- Use a tool/search-provider path, not the production Upwork application browser session.
- Read returned source snippets/URLs and keep citations internally in `source_details`.
- Keep research separate from the production Upwork application browser session.
- Do not open arbitrary URLs through Slack remote Chrome.
- Do not use the production Upwork/VNC Chrome session for general web browsing.
- Do not bypass login, paywalls, CAPTCHA, 2FA, passkeys, or security pages.
- Do not store secrets, cookies, private page archives, or credentials.
- Do not fake research.
- Do not invent facts.
- If live research is unavailable, write from the job post and clearly mark assumptions internally.
- Do not cite unverifiable claims in the cover letter.

## Safe fallback
If only category clues are available, build a category-level fact pack and mark confidence as `low` or `medium`. Use phrases such as "category-level customer logic" internally, not fake brand-specific claims.

If a web provider is not configured or returns no safe sources, set `web_research_status` to `not_configured` or `failed`, add the reason to `assumptions`, and keep the proposal grounded in the job post and category logic.

## Handoff
Pass `brand_fact_pack` to `proposal-copywriting` before `copy_strategy` is created.
