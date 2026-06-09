import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSourceStrategyAnswer,
  buildSourceStrategyMetrics,
  SOURCE_STRATEGY_METRICS_SCHEMA,
} from "./sourceStrategy";
import type { SalesLearningMemory } from "./db";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const now = new Date().toISOString();

function memory(input: Partial<SalesLearningMemory> & Pick<SalesLearningMemory, "id" | "subject" | "hypothesis">): SalesLearningMemory {
  return {
    type: "source_quality",
    scope: "source:test",
    rationale: "",
    confidence: "low",
    evidenceCount: 1,
    status: "tentative",
    source: "test",
    jobId: null,
    channelId: null,
    threadTs: null,
    examples: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

const metrics = buildSourceStrategyMetrics({
  observations: [
    {
      sourceLabel: "Best Matches",
      sourceType: "best_matches",
      leadScore: 91,
      matchLevel: "high",
      status: "replied",
      budget: "$75/hr",
      clientRating: 4.9,
      clientSpend: 120000,
      clientHireRate: 0.82,
    },
    {
      sourceLabel: "Best Matches",
      sourceType: "best_matches",
      leadScore: 84,
      matchLevel: "high",
      status: "interview",
      budgetAmount: 3500,
      clientRating: 4.7,
      clientSpend: 45000,
      clientHireRate: 74,
    },
    {
      sourceLabel: "Best Matches",
      sourceType: "best_matches",
      leadScore: 78,
      matchLevel: "medium",
      status: "applied",
      budget: "$1,500 fixed",
      clientRating: 4.8,
      clientSpend: 30000,
      clientHireRate: 0.7,
    },
    {
      sourceLabel: "Best Matches",
      sourceType: "best_matches",
      leadScore: 66,
      matchLevel: "low",
      status: "lost",
      budget: "$500 fixed",
      clientRating: 4.2,
      clientSpend: 8000,
      clientHireRate: 0.55,
    },
    {
      sourceLabel: "Saved Search - Klaviyo DTC",
      sourceType: "saved_search",
      leadScore: 42,
      matchLevel: "low",
      status: "rejected",
      challenged: true,
      redFlags: ["low budget", "unclear store"],
      budget: "$100 fixed",
      clientRating: 3.8,
      clientSpend: 200,
      clientHireRate: 0.2,
    },
    {
      sourceLabel: "Saved Search - Klaviyo DTC",
      sourceType: "saved_search",
      leadScore: 55,
      matchLevel: "low",
      challenged: true,
      redFlags: true,
      budget: "$15/hr",
      clientRating: 4.0,
      clientSpend: 500,
      clientHireRate: 0.35,
    },
    {
      sourceLabel: "Saved Search - Klaviyo DTC",
      sourceType: "saved_search",
      leadScore: 61,
      matchLevel: "medium",
      status: "applied",
      challengeCount: 1,
      redFlags: 1,
      budget: "$300 fixed",
      clientRating: 4.1,
      clientSpend: 700,
      clientHireRate: 0.4,
    },
  ],
});

const bestMatches = metrics.find((metric) => metric.sourceLabel === "Best Matches");
assert(Boolean(bestMatches), "Best Matches metrics should be present.");
assert(bestMatches!.goodLeadCount === 3, "Best Matches should track lead quality by source.");
assert(bestMatches!.replyCount === 1, "Best Matches should track replies by source.");
assert(bestMatches!.conversionCount === 1, "Best Matches should track interview/hire conversions by source.");
assert(bestMatches!.replyRate === 0.25, "Best Matches reply rate should use submitted/outcome denominator.");
assert(bestMatches!.budgetQualityScore !== null && bestMatches!.budgetQualityScore >= 65, "Best Matches should track budget quality.");
assert(bestMatches!.clientQualityScore !== null && bestMatches!.clientQualityScore >= 70, "Best Matches should track client quality.");
assert(["keep", "prioritize"].includes(bestMatches!.recommendation), "Best Matches should remain active when quality and outcomes exist.");

const savedSearch = metrics.find((metric) => metric.sourceLabel === "Saved Search - Klaviyo DTC");
assert(Boolean(savedSearch), "Saved search metrics should be present.");
assert(savedSearch!.challengeCount === 3, "Saved search should track challenge rate by source.");
assert(savedSearch!.challengeRate === 1, "Saved search challenge rate should be normalized.");
assert(savedSearch!.redFlagLeadCount === 3, "Saved search should track red-flag rate by source.");
assert(savedSearch!.redFlagRate === 1, "Saved search red-flag rate should be normalized.");
assert(savedSearch!.recommendation === "back_off", "Challenge-prone source should be recommended to back off with evidence.");
assert(savedSearch!.reasons.some((reason) => /challenge/i.test(reason)), "Backoff recommendation should include challenge evidence.");
assert(savedSearch!.reasons.some((reason) => /red-flag/i.test(reason)), "Backoff recommendation should include red-flag evidence.");

const sparse = buildSourceStrategyMetrics({
  observations: [
    {
      sourceLabel: "New Manual URL",
      leadScore: 95,
      matchLevel: "high",
      status: "replied",
      budget: "$100/hr",
      clientRating: 5,
      clientSpend: 50000,
      clientHireRate: 0.9,
    },
  ],
});
assert(sparse[0]?.recommendation === "monitor", "One excellent source sample should not create fake certainty.");
assert(sparse[0]?.evidenceLevel === "not enough data", "Sparse evidence should be labeled as not enough data.");
assert(sparse[0]?.caveats.some((caveat) => /sample/i.test(caveat)), "Sparse source should include a sample-size caveat.");

const rejectedMetrics = buildSourceStrategyMetrics({
  observations: [
    {
      sourceLabel: "Rejected Search",
      leadScore: 40,
      matchLevel: "low",
      status: "rejected",
    },
  ],
});
assert(rejectedMetrics[0]?.submittedCount === 1, "Rejected outcomes should count in the submitted/outcome denominator.");
assert(rejectedMetrics[0]?.negativeOutcomeCount === 1, "Rejected outcomes should count as negative outcomes.");
assert(rejectedMetrics[0]?.positiveOutcomeRate === 0, "Rejected-only outcomes should produce a zero positive outcome rate, not missing data.");
assert(
  !rejectedMetrics[0]?.caveats.some((caveat) => /outcomes exist/i.test(caveat)),
  "Rejected outcomes should not be reported as missing outcome data.",
);

const memoryMetrics = buildSourceStrategyMetrics({
  memories: [
    memory({
      id: 1,
      subject: "saved search source quality",
      hypothesis: "Saved search produced repeated challenge friction.",
      evidenceCount: 8,
      metadata: {
        sourceLabel: "Saved Search - Email",
        sourceType: "saved_search",
        scans: 8,
        goodLeadCount: 1,
        challenges: 4,
        redFlagLeadCount: 3,
        positiveOutcomes: 0,
        negativeOutcomes: 2,
        submittedCount: 2,
        budgetQualityScore: 32,
        clientQualityScore: 41,
      },
    }),
    memory({
      id: 2,
      subject: "archived source quality",
      hypothesis: "Archived memories should not count.",
      status: "archived",
      metadata: {
        sourceLabel: "Archived Source",
        scans: 20,
        goodLeadCount: 20,
      },
    }),
  ],
});
assert(memoryMetrics.length === 1, "Source strategy should consume active source_quality memories and ignore archived ones.");
assert(memoryMetrics[0]?.sourceLabel === "Saved Search - Email", "Memory metadata should provide the source label.");
assert(memoryMetrics[0]?.recommendation === "back_off", "Memory-backed challenge evidence should produce backoff recommendation.");

const answer = buildSourceStrategyAnswer({ observations: metrics.flatMap(() => []), memories: [], limit: 2 });
assert(answer.text.includes("not have measured source-quality data"), "Empty answer should avoid fake certainty.");

const workingAnswer = buildSourceStrategyAnswer({
  observations: [
    {
      sourceLabel: "Best Matches",
      leadScore: 90,
      matchLevel: "high",
      status: "replied",
      budget: "$80/hr",
      clientRating: 4.9,
      clientSpend: 90000,
      clientHireRate: 0.85,
    },
    {
      sourceLabel: "Best Matches",
      leadScore: 86,
      matchLevel: "high",
      status: "submitted",
      budget: "$2,500 fixed",
      clientRating: 4.8,
      clientSpend: 30000,
      clientHireRate: 0.7,
    },
    {
      sourceLabel: "Saved Search - Klaviyo DTC",
      leadScore: 40,
      matchLevel: "low",
      challenged: true,
      redFlags: ["captcha friction"],
    },
    {
      sourceLabel: "Saved Search - Klaviyo DTC",
      leadScore: 48,
      matchLevel: "low",
      challenged: true,
      redFlags: ["bad budget"],
    },
    {
      sourceLabel: "Saved Search - Klaviyo DTC",
      leadScore: 50,
      matchLevel: "low",
      challenged: true,
      redFlags: ["client fit"],
      status: "lost",
    },
  ],
});
assert(workingAnswer.text.includes("Here is what I am seeing from the lead sources"), "Answer function should provide Steve-facing copy.");
assert(workingAnswer.text.includes("Backoff candidates"), "Answer should call out backoff candidates when evidence supports it.");
assert(!/definitely|always|guarantee/i.test(workingAnswer.text), "Answer must not imply fake certainty.");
assert(workingAnswer.schema === SOURCE_STRATEGY_METRICS_SCHEMA, "Answer should expose the metrics schema.");

const source = readFileSync(resolve(__dirname, "sourceStrategy.ts"), "utf8");
assert(!/from\s+["']\.\/slackSocket["']/.test(source), "Source strategy must not import slackSocket.");
assert(!/from\s+["']\.\/browserApply["']/.test(source), "Source strategy must not import browser apply behavior.");
assert(!/\b(updateApplicationStatus|recordSubmission|queueBrowserApplicationAction)\b/.test(source), "Source strategy must not mutate final-submit/apply behavior.");
assert(!/\bprocess\.env\.[A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)\b/.test(source), "Source strategy should not read secrets.");

console.log("source strategy tests passed");
