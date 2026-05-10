# Upwork Revenue Assistant Product Vision

Build a server-side Upwork opportunity engine, not an auto-apply bot.

The product should reliably find high-fit jobs, write human proposals in Steve's voice, choose the right proof, protect Connects, and send a clean approval queue to Slack.

## Operating principle

Do not optimize for proposal volume. Optimize for high-fit, fast-response, high-quality applications that a sharp human would have sent manually.

## MVP flow

1. Capture opportunities from multiple sources.
2. Normalize and enrich job details.
3. Deduplicate exact and near-duplicate jobs.
4. Score fit, client quality, opportunity, red flags, and Connects risk.
5. Draft a proposal in Steve's voice.
6. Select relevant portfolio proof.
7. Send an approval packet to Slack.
8. Track the outcome.

## Sources

RSS is only a fallback. The system should support:

- Apify/search scraping
- Upwork RSS where useful
- Upwork email alerts parsed from Gmail
- Manual job URL ingestion
- Future browser-session search capture

## Guardrails

- Direct job link required before application.
- No automatic applying in MVP.
- No max bidding.
- No boost unless score and client quality justify it.
- No applying above Connects thresholds without approval.
- No Loom/video-required jobs unless explicitly enabled.
- No ambiguous or private attachments.
- Store every draft and decision in an audit log.

## Proposal quality bar

The proposal should sound like a person who understood the job in 10 seconds. Avoid generic AI filler, fake enthusiasm, and broad claims.

Bad:

> I am excited to apply for your role and believe I am the perfect fit.

Better:

> The hard part with Klaviyo flows is not getting them live. It is making sure the offer, timing, segmentation, copy, and QA are tight enough to produce revenue without annoying buyers.

## Product phases

### Phase 1: Reliable opportunity engine

- Multi-source capture
- normalized job database
- direct links required
- Slack queue

### Phase 2: Proposal quality engine

- Steve voice guide
- proof selector
- anti-fluff checker
- critic/rewrite loop
- approved proposal examples

### Phase 3: Outcome tracking

Track jobs sent, approved, applied, replies, interviews, hires, losses, proposal version, attachments, bid amount, and Connects used.

### Phase 4: Guarded autopilot

Only after quality is proven. Autopilot applies only under strict score, risk, Connects, attachment, and QA constraints.
