import assert from "node:assert/strict";
import { evaluatePlatformEligibility } from "./platformEligibility";
import type { JobIntelligence } from "./types";

function intelligence(overrides: Partial<JobIntelligence>): JobIntelligence {
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
    ...overrides,
  };
}

const cases: Array<[string, Partial<JobIntelligence>, string]> = [
  ["Klaviyo eligible", { primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo"] }, "eligible"],
  ["Attentive eligible", { primaryPlatform: "Attentive", platformsMentioned: ["Attentive"] }, "eligible"],
  ["Postscript eligible", { primaryPlatform: "Postscript", platformsMentioned: ["Postscript"] }, "eligible"],
  ["Omnisend eligible", { primaryPlatform: "Omnisend", platformsMentioned: ["Omnisend"] }, "eligible"],
  ["Mailchimp eligible", { primaryPlatform: "Mailchimp", platformsMentioned: ["Mailchimp"] }, "eligible"],
  ["MailerLite eligible", { primaryPlatform: "MailerLite", platformsMentioned: ["MailerLite"] }, "eligible"],
  ["HubSpot ineligible", { primaryPlatform: "HubSpot", platformsMentioned: ["HubSpot"] }, "ineligible"],
  ["Customer.io ineligible", { primaryPlatform: "Customer.io", platformsMentioned: ["Customer.io"] }, "ineligible"],
  ["Brevo ineligible", { primaryPlatform: "Brevo", platformsMentioned: ["Brevo"] }, "ineligible"],
  ["HubSpot to Klaviyo eligible", { primaryPlatform: "Klaviyo", platformsMentioned: ["HubSpot", "Klaviyo"] }, "eligible"],
  ["Klaviyo to HubSpot ineligible", { primaryPlatform: "HubSpot", platformsMentioned: ["Klaviyo", "HubSpot"] }, "ineligible"],
  ["No platform manual", { primaryPlatform: "unknown", platformsMentioned: [] }, "manual_review"],
  ["HubSpot DTC lifecycle manual", { primaryPlatform: "HubSpot", platformsMentioned: ["HubSpot"], taskType: "Lifecycle email flows", clientGoal: "Improve retention email revenue" }, "manual_review"],
  ["HubSpot SaaS email automation ineligible", { primaryPlatform: "HubSpot", platformsMentioned: ["HubSpot"], businessType: "B2B SaaS", ecommerceVertical: "SaaS", taskType: "Email automation", clientGoal: "Improve SaaS nurture emails" }, "ineligible"],
];

for (const [label, partial, expected] of cases) {
  const result = evaluatePlatformEligibility(intelligence(partial));
  assert.equal(result.platformEligibility, expected, label);
}

const ineligible = evaluatePlatformEligibility(intelligence({ primaryPlatform: "HubSpot", platformsMentioned: ["HubSpot"] }));
assert.equal(ineligible.platformEligibility, "ineligible");
assert.equal(ineligible.skippedBecausePlatform, true);
assert.match(ineligible.eligibilityReason, /unapproved/i);
assert.equal(ineligible.approvedPlatformMatched, null);

assert.equal(evaluatePlatformEligibility(null).platformEligibility, "manual_review");
console.log("platform eligibility tests passed");
