import assert from "node:assert/strict";
import { decideLeadHandling } from "./leadDecision";
import type { JobIntelligence, ScoredJob } from "./types";

function mkJob(partial: Partial<ScoredJob> = {}): ScoredJob {
  return {
    id: "~job",
    title: "Klaviyo retention strategist",
    url: "https://upwork.test/job",
    description: "Need ecommerce lifecycle email + sms retention support",
    postedAt: new Date().toISOString(),
    budget: "$500",
    clientCountry: "US",
    clientRating: 4.9,
    clientSpend: 10000,
    clientHireRate: 80,
    clientTotalHires: 10,
    clientFeedbackCount: 8,
    category: "Marketing",
    experienceLevel: "Expert",
    connectsCost: 12,
    skills: ["Email Marketing", "SMS Marketing"],
    sourceQuery: "test",
    score: 82,
    matchLevel: "high",
    matchedKeywords: ["retention"],
    negativeKeywords: [],
    scoreBreakdown: {
      fitScore: { score: 82, reasons: [], risks: [] },
      clientQualityScore: { score: 75, reasons: [], risks: [] },
      opportunityScore: { score: 78, reasons: [], risks: [] },
      redFlagScore: { score: 90, reasons: [], risks: [] },
      connectsRiskScore: { score: 75, reasons: [], risks: [] },
      finalScore: 82,
      reasons: [],
      risks: [],
    },
    ...partial,
  };
}

function intel(partial: Partial<JobIntelligence>): JobIntelligence {
  return {
    schemaVersion: "1.0",
    primaryPlatform: "Klaviyo",
    platformsMentioned: ["Klaviyo"],
    platformCategory: "ESP",
    platformPreferenceTier: "core",
    platformFitReason: "",
    shouldSkipForPlatform: false,
    skipReason: "",
    businessType: "DTC ecommerce",
    ecommerceVertical: "beauty",
    jobCategory: "",
    taskType: "",
    requiredSkills: [],
    clientGoal: "",
    redFlags: [],
    fitScoreReasoning: "",
    proposalAngle: "",
    proofRecommendations: [],
    draftConstraints: [],
    platformMismatchWarnings: [],
    needsManualReview: false,
    confidence: "high",
    ...partial,
  };
}

assert.equal(decideLeadHandling(mkJob({ score: 88 }), intel({ primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo"] })).decision, "post_to_slack");
assert.equal(decideLeadHandling(mkJob({ score: 72 }), intel({ primaryPlatform: "Omnisend", platformsMentioned: ["Omnisend"] })).decision, "post_to_slack");
assert.equal(decideLeadHandling(mkJob({ score: 90 }), intel({ primaryPlatform: "HubSpot", platformsMentioned: ["HubSpot"] })).decision, "skip");
assert.equal(decideLeadHandling(mkJob({ score: 90 }), intel({ primaryPlatform: "Brevo", platformsMentioned: ["Brevo"] })).shouldPostToSlack, false);
assert.equal(decideLeadHandling(mkJob({
  score: 78,
  title: "DTC email retention strategist",
  description: "Need lifecycle email and sms retention",
  scoreBreakdown: {
    ...mkJob().scoreBreakdown!,
    clientQualityScore: { score: 88, reasons: [], risks: [] },
    finalScore: 78,
  },
}), intel({ primaryPlatform: "unknown", platformsMentioned: [] })).decision, "manual_review");
assert.equal(decideLeadHandling(mkJob({ score: 45 }), intel({ primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo"] })).decision, "skip");
assert.equal(decideLeadHandling(mkJob({ score: 74, budget: "$120", description: "Need Klaviyo campaign help for a Shopify skincare brand." }), intel({ primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo"] })).decision, "skip");
assert.equal(decideLeadHandling(mkJob({ score: 76, description: "Need email marketing help." }), intel({ primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo"], taskType: "unknown", clientGoal: "unknown", ecommerceVertical: "unknown", businessType: "unknown" })).decision, "skip");
assert.equal(decideLeadHandling(mkJob({ score: 88, title: "HubSpot email automation for SaaS company", description: "Need lifecycle nurture emails for B2B SaaS." }), intel({ primaryPlatform: "HubSpot", platformsMentioned: ["HubSpot"], platformPreferenceTier: "non_core_review", businessType: "B2B SaaS", ecommerceVertical: "SaaS", taskType: "Email automation", clientGoal: "Improve SaaS nurture emails" })).decision, "skip");

const weakClientBreakdown = {
  ...mkJob().scoreBreakdown!,
  clientQualityScore: { score: 30, reasons: [], risks: ["No spend or hires"] },
  finalScore: 86,
};
const weakClient = decideLeadHandling(mkJob({
  score: 86,
  clientSpend: 0,
  clientHireRate: 20,
  clientTotalHires: 0,
  clientFeedbackCount: 0,
  scoreBreakdown: { ...weakClientBreakdown, clientQualityScore: { score: 30, reasons: [], risks: ["Low hire rate (20%)"] } },
}), intel({ primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo"] }));
assert.equal(weakClient.decision, "skip");
assert.equal(weakClient.shouldPostToSlack, false);
assert.equal(weakClient.internalSkipReason, "weak_client_quality");
assert(weakClient.watchOuts.includes("No client spend recorded"));
assert(weakClient.watchOuts.includes("No prior client hires recorded"));

const missingClientData = decideLeadHandling(mkJob({
  score: 86,
  clientRating: 0,
  clientSpend: 0,
  clientHireRate: 0,
  clientTotalHires: 0,
  clientFeedbackCount: 0,
  scoreBreakdown: weakClientBreakdown,
}), intel({ primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo"] }));
assert.equal(missingClientData.decision, "skip");
assert.equal(missingClientData.shouldPostToSlack, false);
assert.equal(missingClientData.shouldAutoPrepare, false);
assert(missingClientData.watchOuts.includes("No client spend recorded"));

const reviewClient = decideLeadHandling(mkJob({
  score: 89,
  clientSpend: 0,
  clientTotalHires: 0,
  clientFeedbackCount: 0,
  scoreBreakdown: { ...weakClientBreakdown, clientQualityScore: { score: 46, reasons: [], risks: [] }, finalScore: 89 },
}), intel({ primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo"] }));
assert.equal(reviewClient.decision, "skip");
assert.equal(reviewClient.shouldAutoPrepare, false);
assert(reviewClient.watchOuts.includes("No client feedback history"));

const borderlineClient = decideLeadHandling(mkJob({
  score: 90,
  scoreBreakdown: { ...mkJob().scoreBreakdown!, clientQualityScore: { score: 69, reasons: [], risks: [] }, finalScore: 90 },
}), intel({ primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo"] }));
assert.equal(borderlineClient.decision, "skip");
assert.equal(borderlineClient.internalSkipReason, "weak_client_quality");

const croOnly = decideLeadHandling(mkJob({
  title: "Shopify CRO specialist",
  description: "Need conversion rate optimization, landing page testing, funnel work, and homepage UX fixes for our store.",
  skills: ["Shopify", "Conversion Rate Optimization", "Landing Pages"],
  score: 91,
  scoreBreakdown: { ...mkJob().scoreBreakdown!, clientQualityScore: { score: 84, reasons: [], risks: [] }, finalScore: 91 },
}), intel({
  primaryPlatform: "Klaviyo",
  platformsMentioned: ["Klaviyo", "Shopify"],
  taskType: "CRO and landing page optimization",
  clientGoal: "Improve onsite conversion rate",
}));
assert.equal(croOnly.decision, "skip");
assert.equal(croOnly.internalSkipReason, "out_of_scope");

const shopifyDevelopment = decideLeadHandling(mkJob({
  title: "Shopify developer for theme customization",
  description: "Need Shopify theme customization, Liquid fixes, and storefront updates.",
  skills: ["Shopify", "Liquid", "Theme Customization"],
  score: 93,
  scoreBreakdown: { ...mkJob().scoreBreakdown!, clientQualityScore: { score: 86, reasons: [], risks: [] }, finalScore: 93 },
}), intel({
  primaryPlatform: "Klaviyo",
  platformsMentioned: ["Klaviyo", "Shopify"],
  taskType: "Shopify theme development",
  clientGoal: "Improve storefront UX",
}));
assert.equal(shopifyDevelopment.decision, "skip");
assert.equal(shopifyDevelopment.internalSkipReason, "out_of_scope");

const ineligible = decideLeadHandling(mkJob({ score: 90 }), intel({ primaryPlatform: "Customer.io", platformsMentioned: ["Customer.io"] }));
assert.equal(ineligible.shouldAutoPrepare, false);

const hardProfileGate = decideLeadHandling(mkJob({
  description: "Need Klaviyo help. To apply, you must have earned over $10,000 on Upwork already.",
}), intel({ primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo"] }));
assert.equal(hardProfileGate.decision, "skip");
assert.equal(hardProfileGate.internalSkipReason, "freelancer_profile_requirement");
assert(hardProfileGate.watchOuts.some((item) => item.includes("earned on Upwork")));

const nearProfileGate = decideLeadHandling(mkJob({
  description: "Need lifecycle email support. Please only apply if you have earned at least $600 on Upwork.",
}), intel({ primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo"] }));
assert.equal(nearProfileGate.decision, "manual_review");
assert.equal(nearProfileGate.shouldAutoPrepare, false);

console.log("lead decision tests passed");
