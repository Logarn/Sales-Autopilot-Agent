import assert from "node:assert/strict";
import { buildApplicationDraft } from "./agent";
import { scoreJob } from "./filter";
import { qaApplicationDraftPlatformGrounding } from "./proposalQa";
import type { JobPosting } from "./types";

function job(partial: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "brevo-supersmart",
    title: "Brevo Account Setup and Configuration",
    url: "https://www.upwork.com/jobs/~123456789012345678",
    description: [
      "We run store SuperSmart / us.supersmart.com and need technical Brevo account setup and configuration.",
      "Scope includes sender reputation warmup, contact import and cleanup, source and behavior list and segment architecture, welcome/cart/birthday/referral/sleeper automations, newsletter technical setup, unsubscribe/list targeting, and separation of transactional API email vs lifecycle flows/newsletters.",
    ].join(" "),
    postedAt: new Date().toISOString(),
    budget: "$500",
    clientCountry: "United States",
    clientRating: 5,
    clientSpend: 12000,
    clientHireRate: 90,
    clientTotalHires: 8,
    clientFeedbackCount: 6,
    category: "Email Marketing",
    experienceLevel: "Expert",
    connectsCost: 8,
    skills: ["Brevo", "Email Marketing", "Marketing Automation", "Segmentation", "Deliverability"],
    sourceQuery: "controlled-proof",
    proposalCount: 6,
    competitionLevel: "low",
    ...partial,
  };
}

const scored = scoreJob(job());
const draft = buildApplicationDraft(scored);
const proposal = draft.proposalText;

assert.equal(draft.jobIntelligence?.primaryPlatform, "Brevo");
assert.doesNotMatch(proposal, /klaviyo/i, "Brevo/SuperSmart proposal must not substitute Klaviyo for the main work");
assert.match(proposal, /SuperSmart/i, "Proposal should name the visible store when present");
assert.match(proposal, /us\.supersmart\.com/i, "Proposal should name the visible store domain when present");
assert.match(proposal, /Brevo account setup/i, "Proposal should ground the work in Brevo account setup");
assert.match(proposal, /sender reputation/i, "Proposal should mention sender reputation warmup");
assert.match(proposal, /contact import\/cleanup|contact import and cleanup|list cleanup/i, "Proposal should mention contact import/list cleanup");
assert.match(proposal, /segmentation/i, "Proposal should mention segmentation/list architecture");
assert.match(proposal, /automation/i, "Proposal should mention automation setup");
assert.match(proposal, /transactional API/i, "Proposal should mention transactional API separation");
assert.equal(
  draft.proposalQuality.issues.some((issue) => issue.category === "platform_mismatch"),
  false,
  "Generated Brevo draft should not trip the platform mismatch critic",
);
const platformQa = qaApplicationDraftPlatformGrounding(draft);
assert.equal(
  platformQa.warnings.some((warning) => warning.code === "platform_mismatch"),
  false,
  "Generated Brevo draft should not trip platform mismatch QA",
);

console.log("agent proposal grounding tests passed");
