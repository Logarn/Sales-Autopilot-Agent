import assert from "node:assert/strict";
import { scoreJob } from "./filter";
import { decideLeadHandling } from "./leadDecision";
import type { JobIntelligence, JobPosting } from "./types";

function job(partial: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "intel-score-job",
    title: "Lifecycle email strategist for skincare brand",
    url: "https://www.upwork.com/jobs/~intelscore123456",
    description: "Need retention flows, campaigns, and segmentation support for a DTC Shopify skincare store.",
    postedAt: new Date().toISOString(),
    budget: "$1,500",
    clientCountry: "US",
    clientRating: 4.9,
    clientSpend: 25000,
    clientHireRate: 85,
    clientTotalHires: 12,
    clientFeedbackCount: 9,
    category: "Digital Marketing",
    experienceLevel: "Expert",
    connectsCost: 8,
    skills: ["Email Marketing", "Retention Marketing"],
    sourceQuery: "test",
    ...partial,
  };
}

function intel(partial: Partial<JobIntelligence> = {}): JobIntelligence {
  return {
    schemaVersion: "1.0",
    primaryPlatform: "Klaviyo",
    platformsMentioned: ["Klaviyo"],
    platformCategory: "ESP",
    platformPreferenceTier: "core",
    platformFitReason: "Klaviyo is the stated ESP.",
    shouldSkipForPlatform: false,
    skipReason: "",
    businessType: "DTC ecommerce",
    ecommerceVertical: "beauty",
    jobCategory: "Lifecycle marketing",
    taskType: "Klaviyo flow audit and campaign strategy",
    requiredSkills: ["Klaviyo", "Email Marketing", "Segmentation"],
    clientGoal: "Increase repeat purchase and email revenue",
    redFlags: [],
    fitScoreReasoning: "Strong DTC retention fit.",
    proposalAngle: "Lead with retention audit and priority flow fixes.",
    proofRecommendations: ["Beauty retention audit"],
    draftConstraints: [],
    platformMismatchWarnings: [],
    needsManualReview: false,
    confidence: "high",
    ...partial,
  };
}

const base = scoreJob(job());
const withKlaviyoIntel = scoreJob(job(), intel());
assert(withKlaviyoIntel.score > base.score, "Klaviyo/DTC lifecycle intelligence should lift the score");
assert(withKlaviyoIntel.matchedKeywords.includes("dtc lifecycle"), "Strong DTC lifecycle intelligence should be recorded as a match");
assert(withKlaviyoIntel.scoreBreakdown.fitScore.reasons.some((reason) => reason.includes("Job intelligence")), "Fit score reasons should include intelligence-derived context");

const hubspotNoEcommerce = scoreJob(
  job({
    title: "HubSpot CRM cleanup",
    description: "Need contact property cleanup and dashboard admin help for a B2B SaaS company.",
    budget: "$200",
    skills: ["HubSpot", "CRM"],
  }),
  intel({
    primaryPlatform: "HubSpot",
    platformsMentioned: ["HubSpot"],
    platformPreferenceTier: "non_core_review",
    businessType: "B2B SaaS",
    ecommerceVertical: "unknown",
    taskType: "CRM admin cleanup",
    clientGoal: "Organize contacts",
    shouldSkipForPlatform: true,
    skipReason: "HubSpot CRM admin with no ecommerce retention scope.",
  }),
);
assert.equal(hubspotNoEcommerce.matchLevel, "skip", "HubSpot/no ecommerce/vague admin work should be a scoring skip");
assert(hubspotNoEcommerce.score < withKlaviyoIntel.score, "Ineligible platform intelligence should lower score");

const hubspotSaasEmail = scoreJob(
  job({
    title: "HubSpot email automation for SaaS lifecycle",
    description: "Need HubSpot email automation and lifecycle nurture for a B2B SaaS company.",
    budget: "$1,500",
    skills: ["HubSpot", "Email Automation"],
  }),
  intel({
    primaryPlatform: "HubSpot",
    platformsMentioned: ["HubSpot"],
    platformPreferenceTier: "non_core_review",
    businessType: "B2B SaaS",
    ecommerceVertical: "SaaS",
    taskType: "Email automation",
    clientGoal: "Improve SaaS lifecycle nurture emails",
    requiredSkills: ["HubSpot", "Email Automation"],
    fitScoreReasoning: "B2B lifecycle nurture fit.",
    proposalAngle: "Keep the angle grounded in SaaS lifecycle nurture.",
    proofRecommendations: [],
    shouldSkipForPlatform: false,
    skipReason: "",
  }),
);
assert.equal(hubspotSaasEmail.matchLevel, "skip", "SaaS vertical must not count as ecommerce/DTC fit for HubSpot email automation");
assert(!hubspotSaasEmail.scoreBreakdown.fitScore.reasons.some((reason) => reason.includes("strong DTC/ecommerce lifecycle")), "SaaS should not receive DTC/ecommerce lifecycle lift");

const unknownStrongDtc = scoreJob(
  job({
    title: "DTC lifecycle email retention strategist",
    description: "Need lifecycle email and SMS retention flows for a Shopify supplement brand, platform not selected yet.",
  }),
  intel({
    primaryPlatform: "unknown",
    platformsMentioned: [],
    platformPreferenceTier: "unknown",
    platformCategory: "unknown",
    platformFitReason: "Platform not stated.",
    needsManualReview: true,
  }),
);
assert.equal(decideLeadHandling(unknownStrongDtc, intel({
  primaryPlatform: "unknown",
  platformsMentioned: [],
  platformPreferenceTier: "unknown",
  platformCategory: "unknown",
  platformFitReason: "Platform not stated.",
  needsManualReview: true,
})).decision, "manual_review", "Unknown platform with strong DTC lifecycle/email context should become manual review");

const unknownWeakClient = scoreJob(
  job({
    title: "DTC lifecycle email retention strategist",
    description: "Need lifecycle email and SMS retention flows for a Shopify supplement brand, platform not selected yet.",
    clientSpend: 0,
    clientHireRate: 15,
    clientTotalHires: 0,
    clientFeedbackCount: 0,
  }),
  intel({
    primaryPlatform: "unknown",
    platformsMentioned: [],
    platformPreferenceTier: "unknown",
    platformCategory: "unknown",
    platformFitReason: "Platform not stated.",
    needsManualReview: true,
  }),
);
assert.equal(decideLeadHandling(unknownWeakClient, intel({
  primaryPlatform: "unknown",
  platformsMentioned: [],
  platformPreferenceTier: "unknown",
  platformCategory: "unknown",
  platformFitReason: "Platform not stated.",
  needsManualReview: true,
})).decision, "skip", "Unknown-platform leads should be rejected when client quality is weak");

console.log("intelligence scoring tests passed");
