import assert from "node:assert/strict";
import { buildApplicationDraft } from "./agent";
import { chooseVisibleBoost, evaluateConnectsStrategy, extractVisibleBoostBids } from "./connectsStrategy";
import { scoreJob } from "./filter";
import { decideLeadHandling } from "./leadDecision";
import type { JobIntelligence, JobPosting, SourceBackedConnects } from "./types";

function job(partial: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "connects-job",
    title: "Klaviyo retention strategist for Shopify beauty brand",
    url: "https://www.upwork.com/jobs/~connects123456",
    description: "Need Klaviyo flows, campaigns, segmentation, SMS, and retention support for a DTC skincare store.",
    postedAt: new Date().toISOString(),
    budget: "$2,500",
    clientCountry: "US",
    clientRating: 4.9,
    clientSpend: 50000,
    clientHireRate: 80,
    clientTotalHires: 14,
    clientFeedbackCount: 10,
    category: "Digital Marketing",
    experienceLevel: "Expert",
    connectsCost: 8,
    skills: ["Klaviyo", "Shopify", "Email Marketing"],
    sourceQuery: "test",
    proposalCount: 8,
    competitionLevel: "low",
    ...partial,
  };
}

function sourceBackedConnects(requiredConnects: number | null, sourceText: string | null = null): SourceBackedConnects {
  return {
    requiredConnects,
    boostConnects: null,
    totalConnects: null,
    confidence: requiredConnects === null ? "unknown" : "high",
    sourceText,
    sourceLocation: sourceText ? "line 1" : null,
    extractionMethod: requiredConnects === null ? "not_found" : "deterministic_visible_text",
  };
}

const klaviyoIntel: JobIntelligence = {
  schemaVersion: "1.0",
  primaryPlatform: "Klaviyo",
  platformsMentioned: ["Klaviyo"],
  platformCategory: "ESP",
  platformPreferenceTier: "core",
  platformFitReason: "Klaviyo is stated.",
  shouldSkipForPlatform: false,
  skipReason: "",
  businessType: "DTC ecommerce",
  ecommerceVertical: "beauty",
  jobCategory: "Lifecycle marketing",
  taskType: "Klaviyo retention",
  requiredSkills: ["Klaviyo"],
  clientGoal: "Increase repeat purchase",
  redFlags: [],
  fitScoreReasoning: "Strong fit.",
  proposalAngle: "Lead with lifecycle audit.",
  proofRecommendations: [],
  draftConstraints: [],
  platformMismatchWarnings: [],
  needsManualReview: false,
  confidence: "high",
};

const strong = scoreJob(job());
strong.applicationDraft = buildApplicationDraft(strong);
assert.equal(strong.scoreBreakdown.connectsStrategy?.decision, "safe_apply");
assert.equal(strong.applicationDraft.connectsStrategy?.decision, "safe_apply");
assert.equal(strong.applicationDraft.suggestedBoostConnects, 0, "Initial drafts should wait for a visible Upwork boost table before setting optional boost.");

const crowded = scoreJob(job({ proposalCount: 58, competitionLevel: "high" }));
const crowdedStrategy = evaluateConnectsStrategy({
  job: crowded,
  score: crowded.score,
  scoreBreakdown: crowded.scoreBreakdown,
  suggestedBoostConnects: 10,
});
assert.equal(crowdedStrategy.decision, "manual_review");
assert(crowdedStrategy.risks.some((risk) => risk.includes("proposals")), "High proposal count should be called out");

const unknownRequired = scoreJob(job({ connectsCost: 0, connects: sourceBackedConnects(null) }));
assert.equal(unknownRequired.scoreBreakdown.connectsStrategy?.decision, "manual_review");
assert.equal(unknownRequired.scoreBreakdown.connectsStrategy?.requiredConnects, null);
assert.equal(unknownRequired.scoreBreakdown.connectsStrategy?.totalConnects, null);
assert.equal(unknownRequired.scoreBreakdown.connectsStrategy?.sourceBackedConnects?.requiredConnects, null);
assert.equal(unknownRequired.scoreBreakdown.connectsStrategy?.suggestedBoostConnects, 0);
assert(
  unknownRequired.scoreBreakdown.connectsStrategy?.risks.some((risk) => risk.includes("unknown from visible source text")),
  "Unknown required Connects should be a fail-closed risk",
);

const highRequired = scoreJob(job({
  connectsCost: 32,
  connects: sourceBackedConnects(32, "This proposal requires 32 Connects"),
}));
assert.equal(highRequired.scoreBreakdown.connectsStrategy?.decision, "manual_review");
assert(
  highRequired.scoreBreakdown.connectsStrategy?.risks.some((risk) => risk.includes("require approval")),
  "High required Connects should require manual review",
);

const weak = scoreJob(job({
  budget: "$1,500",
  clientSpend: 0,
  clientTotalHires: 0,
  clientFeedbackCount: 0,
  clientHireRate: 0,
  connectsCost: 24,
  proposalCount: 65,
  competitionLevel: "high",
}));
weak.applicationDraft = buildApplicationDraft(weak);
assert.equal(weak.scoreBreakdown.connectsStrategy?.decision, "skip");
assert.equal(weak.applicationDraft.suggestedBoostConnects, 0, "Weak leads should not recommend boost Connects");
const decision = decideLeadHandling(weak, klaviyoIntel);
assert.equal(decision.decision, "skip");
assert.equal(decision.internalSkipReason, "connects_strategy_skip");

const visibleBids = extractVisibleBoostBids("Boost table\n#1 bid 60 Connects\n#2 bid 35 Connects\n#3 bid 22 Connects\n#4 bid 12 Connects");
assert.deepEqual(visibleBids.slice(0, 4), [
  { rank: 1, connects: 60 },
  { rank: 2, connects: 35 },
  { rank: 3, connects: 22 },
  { rank: 4, connects: 12 },
]);
const highFitVisibleBoost = chooseVisibleBoost({
  requiredConnects: 8,
  expectedValueScore: 90,
  clientQualityScore: 80,
  opportunityScore: 82,
  currentBids: visibleBids,
});
assert.equal(highFitVisibleBoost.boostConnects, 12, "High-fit boost should use the minimum visible top-4 bid.");
assert.equal(highFitVisibleBoost.targetRank, 4);

const mediumFitVisibleBoost = chooseVisibleBoost({
  requiredConnects: 8,
  expectedValueScore: 75,
  clientQualityScore: 80,
  opportunityScore: 82,
  currentBids: visibleBids,
});
assert.equal(mediumFitVisibleBoost.boostConnects, 0, "Medium/uncertain jobs should default to no boost.");

const tooExpensiveBoost = chooseVisibleBoost({
  requiredConnects: 8,
  expectedValueScore: 92,
  clientQualityScore: 90,
  opportunityScore: 90,
  currentBids: [
    { rank: 1, connects: 90 },
    { rank: 2, connects: 80 },
    { rank: 3, connects: 70 },
    { rank: 4, connects: 55 },
  ],
});
assert.equal(tooExpensiveBoost.boostConnects, 0, "Boost strategy must never exceed the 50 Connects hard cap.");
assert(tooExpensiveBoost.skippedReason?.includes("above cap 50"), "Too-expensive boost should explain the skip reason.");

console.log("connects strategy tests passed");
