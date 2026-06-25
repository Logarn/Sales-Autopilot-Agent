import assert from "node:assert/strict";

import {
  classifyScreeningQuestion,
  classifyScreeningQuestions,
  resolveScreeningQuestionAnswer,
} from "./screeningQuestionRegistry";
import type { FreelancerProfile } from "./types";

const profile: FreelancerProfile = {
  name: "Steve Logarn",
  title: "Klaviyo Silver Partner | Retention for DTC Brands",
  niche: "DTC ecommerce retention and lifecycle marketing",
  hourlyRate: 35,
  location: "Nairobi, Kenya",
  summary: "I help DTC brands improve lifecycle revenue in Klaviyo and Shopify.",
  skills: ["Klaviyo", "Shopify", "Email Marketing", "SMS Marketing"],
  preferredIndustries: ["DTC", "ecommerce"],
  avoidIndustries: [],
  preferredJobTypes: ["Klaviyo audit", "flow buildout"],
  avoidJobTypes: [],
  proofPoints: [
    "Truly Beauty: turned a low-LTV list into a $14M/year retention engine",
    "Lifely: email revenue $145K to $425K/month, +193% in 6 months",
  ],
  upwork: {
    availability: "As Needed - Open to Offers",
  },
  voice: {
    tone: ["direct"],
    openingStyle: "Open with the client problem.",
    ctaStyle: "Ask for a useful next step.",
    lengthPreference: "120-190 words.",
    bannedPhrases: [],
    preferredPhrases: [],
  },
};

const intentCases: Array<[string, ReturnType<typeof classifyScreeningQuestion>["intent"], ReturnType<typeof classifyScreeningQuestion>["risk"], boolean]> = [
  ["Have you done a similar Shopify lifecycle project before?", "similar_project", "low", true],
  ["What is your availability and when can you start?", "availability", "low", true],
  ["What hourly rate do you charge for this work?", "hourly_rate", "low", true],
  ["Describe your experience with Klaviyo and Shopify.", "platform_experience", "low", true],
  ["Please attach screenshots or case studies showing results.", "proof_request", "medium", false],
  ["Are you legally authorized to work in the United States?", "legal_authorization", "high", false],
  ["Please provide your passport number and personal email address.", "sensitive_personal_info", "high", false],
  ["What is your favorite color?", "unknown", "high", false],
];

for (const [question, expectedIntent, expectedRisk, autoAllowed] of intentCases) {
  const result = classifyScreeningQuestion(question);
  assert.equal(result.intent, expectedIntent, question);
  assert.equal(result.risk, expectedRisk, question);
  assert.equal(result.autoAnswerAllowed, autoAllowed, question);
  assert.equal(result.requiresHumanReview, !autoAllowed, question);
  assert.equal(result.originalText, question, "Classification should keep the original question text for auditability");
  assert(result.normalizedText.length > 0, "Classification should include normalized text");
}

const batch = classifyScreeningQuestions([
  "When can you start?",
  "Send your phone number.",
]);
assert.deepEqual(batch.map((item) => item.intent), ["availability", "sensitive_personal_info"]);

const hourlyResolution = resolveScreeningQuestionAnswer("What is your hourly rate?", { profile });
assert.equal(hourlyResolution.needsHumanReview, false);
assert.equal(hourlyResolution.answer, "My standard Upwork rate is $35/hr.");
assert.equal(hourlyResolution.source, "profile");

const availabilityResolution = resolveScreeningQuestionAnswer("What is your availability?", { profile });
assert.equal(availabilityResolution.needsHumanReview, false);
assert.match(availabilityResolution.answer ?? "", /As Needed - Open to Offers/);

const platformResolution = resolveScreeningQuestionAnswer("Do you have Klaviyo experience?", { profile });
assert.equal(platformResolution.needsHumanReview, false);
assert.match(platformResolution.answer ?? "", /Klaviyo/);
assert.equal(platformResolution.confidence, "high");

const similarProjectResolution = resolveScreeningQuestionAnswer("Have you handled similar retention work before?", { profile });
assert.equal(similarProjectResolution.needsHumanReview, false);
assert.match(similarProjectResolution.answer ?? "", /Truly Beauty/);
assert.equal(similarProjectResolution.source, "profile");

const proofRequestResolution = resolveScreeningQuestionAnswer("Can you upload a case study link?", { profile });
assert.equal(proofRequestResolution.classification.intent, "proof_request");
assert.equal(proofRequestResolution.answer, null);
assert.equal(proofRequestResolution.needsHumanReview, true);
assert.match(proofRequestResolution.reason, /medium-risk|human review/i);

const sensitiveResolution = resolveScreeningQuestionAnswer("What is your personal phone number?", { profile });
assert.equal(sensitiveResolution.classification.intent, "sensitive_personal_info");
assert.equal(sensitiveResolution.answer, null);
assert.equal(sensitiveResolution.needsHumanReview, true);

const missingProfileResolution = resolveScreeningQuestionAnswer("What is your hourly rate?");
assert.equal(missingProfileResolution.answer, null);
assert.equal(missingProfileResolution.needsHumanReview, true);
assert.match(missingProfileResolution.reason, /No saved freelancer profile/);

console.log("screeningQuestionRegistry tests passed");
