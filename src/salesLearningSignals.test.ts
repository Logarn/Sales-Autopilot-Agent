import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildBoostExpectedValueSignal,
  buildProposalDiffLearning,
  buildScreeningAnswerDiffLearning,
  buildSourceTimingAttributionSignals,
  salesLearningSignalsToMemoryInputs,
} from "./salesLearningSignals";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const steveEdit = buildProposalDiffLearning({
  scope: "fashion:klaviyo",
  editor: "Steve",
  generatedDraft: [
    "I have extensive experience with Klaviyo and would love to help with your email marketing.",
    "I can create flows and campaigns for your store.",
    "Let me know if you would like to discuss.",
  ].join("\n\n"),
  finalDraft: [
    "Your post-purchase flow is leaking repeat revenue before the second order.",
    "Fly Boutique is the closest proof here because we fixed the same retention gap.",
    "Send me the store URL and I will point to the first two fixes.",
  ].join("\n\n"),
});

assert(steveEdit.signals.length === 1, "Steve edit should produce one proposal style signal.");
const proposalSignal = steveEdit.signals[0]!;
assert(proposalSignal.type === "proposal_style", "Proposal diff should map to proposal_style.");
assert(proposalSignal.tags.includes("generic_experience_intro_removed"), "Generic experience intro removal should be detected.");
assert(proposalSignal.tags.includes("direct_commercial_diagnosis_added"), "Direct commercial diagnosis should be detected.");
assert(proposalSignal.tags.includes("direct_cta_added"), "Direct CTA changes should be detected.");
assert(proposalSignal.tags.includes("proof_framing_changed"), "Proof framing changes should be detected.");
assert(/direct commercial diagnosis/i.test(proposalSignal.hypothesis), "Hypothesis should learn direct commercial diagnosis.");
assert(steveEdit.memoryInputs[0]?.type === "proposal_style", "Proposal diff should convert to a memory input.");

const unchangedProposal = buildProposalDiffLearning({
  scope: "fashion:klaviyo",
  editor: "Steve",
  generatedDraft: [
    "Your post-purchase flow is leaking repeat revenue before the second order.",
    "Fly Boutique is the closest proof here because we fixed the same retention gap.",
  ].join("\n\n"),
  finalDraft: [
    "Your post-purchase flow is leaking repeat revenue before the second order.",
    "Fly Boutique is the closest proof here because we fixed the same retention gap.",
  ].join("\n\n"),
});
assert(unchangedProposal.signals.length === 0, "Identical proposal readback must not create a proposal_style_signal.");
assert(unchangedProposal.memoryInputs.length === 0, "Identical proposal readback must not create proposal memory input.");

const screeningEdit = buildScreeningAnswerDiffLearning({
  scope: "fashion:klaviyo",
  questionText: "What approach would you take first?",
  questionFamily: "approach_plan",
  questionFingerprint: "abc123",
  editor: "Steve",
  draftedAnswer: "I can help with flows and campaigns.",
  finalAnswer: "I would start by auditing the Klaviyo post-purchase flow, then prioritize the first retention leak by revenue impact.",
});
assert(screeningEdit.signals.length === 1, "Material screening answer edit should produce one signal.");
const screeningSignal = screeningEdit.signals[0]!;
assert(screeningSignal.type === "screening_answer", "Screening answer diff should map to screening_answer.");
assert(screeningSignal.tags.includes("screening_direct_plan_added"), "Concrete first-step plan should be detected.");
assert(screeningSignal.tags.includes("screening_specificity_added"), "Platform/job specificity should be detected.");
assert(screeningEdit.memoryInputs[0]?.type === "screening_answer", "Screening answer diff should convert to a memory input.");

const unchangedScreening = buildScreeningAnswerDiffLearning({
  questionText: "What approach would you take first?",
  draftedAnswer: "I would audit Klaviyo flows first.",
  finalAnswer: "I would audit Klaviyo flows first.",
});
assert(unchangedScreening.signals.length === 0, "Identical screening readback must not create a screening_answer signal.");

const boostSignal = buildBoostExpectedValueSignal({
  scope: "fashion:klaviyo",
  requiredConnects: 12,
  boostTable: [
    { rank: 1, connects: 42 },
    { rank: 2, connects: 35 },
    { rank: 3, connects: 28 },
  ],
  chosenBoostConnects: 29,
  outcome: "replied",
  leadScore: 91,
  matchLevel: "high",
});

assert(boostSignal.type === "boost_strategy", "Boost helper should create boost_strategy signal.");
assert(boostSignal.tags.includes("top_3_visibility_signal"), "Top-3 reply should be preserved as a signal.");
assert(/top-3 visibility produced a reply/i.test(boostSignal.hypothesis), "Boost hypothesis should say top-3 was enough for a reply.");
assert(!/always boost 50/i.test(boostSignal.hypothesis), "Boost helper must not encode deterministic always-boost-50 behavior.");
assert((boostSignal.metadata.chosenBoostConnects as number) <= 50, "Chosen boost metadata must preserve the <=50 cap.");
assert((boostSignal.metadata.top3ClearConnects as number) <= 50, "Top-3 recommendation metadata must preserve the <=50 cap.");

const overbidSignal = buildBoostExpectedValueSignal({
  scope: "beauty:klaviyo",
  requiredConnects: 16,
  topBids: [61, 31, 24],
  chosenBoostConnects: 52,
  chosenRank: 1,
  outcome: "none",
});

assert(overbidSignal.tags.includes("over_cap_input_ignored_as_repeatable"), "Over-cap observed boost should be marked non-repeatable.");
assert((overbidSignal.metadata.chosenBoostConnects as number) === 50, "Over-cap boost should be capped in repeatable metadata.");
assert((overbidSignal.metadata.top2ClearConnects as number) <= 50, "Top-2 clear estimate should stay under cap.");

const rawRankBeforeCapSignal = buildBoostExpectedValueSignal({
  scope: "fashion:klaviyo",
  requiredConnects: 12,
  boostTable: [
    { rank: 1, connects: 55 },
    { rank: 2, connects: 49 },
    { rank: 3, connects: 24 },
  ],
  chosenBoostConnects: 56,
  outcome: "replied",
});
assert(rawRankBeforeCapSignal.tags.includes("observed_rank_from_over_cap_bid"), "Over-cap rank evidence should be marked as observational.");
assert(rawRankBeforeCapSignal.metadata.observedChosenBoostConnects === 56, "Raw observed boost must be retained for attribution.");
assert(rawRankBeforeCapSignal.metadata.chosenBoostConnects === 50, "Repeatable boost metadata should remain capped.");
assert(rawRankBeforeCapSignal.metadata.observedChosenRank === 1, "Observed rank should be inferred from the raw boost before cap.");
assert(rawRankBeforeCapSignal.metadata.repeatableChosenRank === 2, "Repeatable rank should be inferred from the capped boost.");
assert(rawRankBeforeCapSignal.metadata.chosenRank === 2, "Legacy chosenRank metadata should not claim the capped bid achieved the raw observed rank.");
assert(/observed rank=1|observed rank=1/i.test(rawRankBeforeCapSignal.rationale.replace(/\s+/g, " ")), "Rationale should preserve observed raw rank.");
assert(/repeatable rank=2/i.test(rawRankBeforeCapSignal.rationale.replace(/\s+/g, " ")), "Rationale should preserve repeatable capped rank.");

const sourceSignals = buildSourceTimingAttributionSignals({
  sourceLabel: "Saved Search - Klaviyo DTC",
  sourceType: "saved_search",
  scans: [
    {
      sourceLabel: "Saved Search - Klaviyo DTC",
      sourceType: "saved_search",
      scans: 10,
      goodLeadCount: 1,
      browserChecks: 8,
      challenges: 3,
      outcomes: [{ outcome: "none", count: 9 }],
    },
  ],
});
const sourceQuality = sourceSignals.find((signal) => signal.type === "source_quality");
assert(Boolean(sourceQuality), "Source attribution should create a source_quality signal.");
assert(sourceQuality!.tags.includes("noisy_source_with_browser_checks"), "Noisy saved search with browser checks should be tagged.");
assert(/down-rank or cooldown/i.test(sourceQuality!.hypothesis), "Noisy source hypothesis should recommend lower priority or cooldown.");
assert(sourceQuality!.metadata.browserChecks === 8, "Source signal should preserve browser check count.");
assert(sourceQuality!.metadata.challenges === 3, "Source signal should preserve challenge count.");

const timingSignals = buildSourceTimingAttributionSignals({
  sourceLabel: "Best Matches",
  sourceType: "best_matches",
  timing: {
    postedAt: "2026-06-07T08:00:00.000Z",
    discoveredAt: "2026-06-07T08:15:00.000Z",
    preparedAt: "2026-06-07T08:45:00.000Z",
    submittedAt: "2026-06-07T09:00:00.000Z",
    outcome: "replied",
  },
});
const timingSignal = timingSignals.find((signal) => signal.type === "timing_hypothesis");
assert(Boolean(timingSignal), "Timing attribution should create a timing_hypothesis signal.");
assert(timingSignal!.tags.includes("fresh_timing_signal"), "Fresh prep should be tagged.");
assert(/positive freshness evidence/i.test(timingSignal!.hypothesis), "Timing hypothesis should preserve freshness outcome.");
assert(timingSignal!.metadata.submittedTimestampIsAttributionOnly === true, "Submitted timestamp must be attribution-only metadata.");

const allMemoryInputs = salesLearningSignalsToMemoryInputs([proposalSignal, boostSignal, sourceQuality!, timingSignal!]);
assert(allMemoryInputs.every((input) => input.status === "tentative"), "Signal memory inputs should remain hypotheses.");
assert(allMemoryInputs.some((input) => input.type === "source_quality"), "Memory input conversion should preserve source_quality.");

const source = readFileSync(resolve(__dirname, "salesLearningSignals.ts"), "utf8");
assert(!/from\s+["']\.\/browserApply["']/.test(source), "Signal helper must not import browser apply behavior.");
assert(!/from\s+["']\.\/applications["']/.test(source), "Signal helper must not import application status mutation behavior.");
assert(!/\b(updateApplicationStatus|recordSubmission|applyApplicationRevision|queueBrowserApplicationAction)\b/.test(source), "Signal helper must not mutate or queue final-submit/apply behavior.");

console.log("sales learning signals tests passed");
