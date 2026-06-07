import type {
  SalesLearningConfidence,
  SalesLearningMemoryStatus,
  SalesLearningMemoryType,
  UpsertSalesLearningMemoryInput,
} from "./db";
import type { ApplicationStatus } from "./types";

const HARD_OPTIONAL_BOOST_CAP = 50;

export type SalesLearningSignalKind = "proposal_diff" | "boost_expected_value" | "source_timing_attribution";

export interface StructuredSalesLearningSignal {
  kind: SalesLearningSignalKind;
  type: SalesLearningMemoryType;
  scope: string;
  subject: string;
  hypothesis: string;
  rationale: string;
  confidence: SalesLearningConfidence;
  evidenceCount: number;
  status: SalesLearningMemoryStatus;
  source: string;
  examples: string[];
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface ProposalDiffInput {
  generatedDraft: string;
  finalDraft: string;
  editor?: "Steve" | "Natalie" | "operator" | string;
  scope?: string;
  source?: string;
  jobId?: string | null;
}

export interface ProposalDiffResult {
  signals: StructuredSalesLearningSignal[];
  memoryInputs: UpsertSalesLearningMemoryInput[];
  tags: string[];
  wordDelta: number;
  finalWordCount: number;
  generatedWordCount: number;
}

export interface BoostBid {
  rank: number;
  connects: number;
  label?: string;
}

export interface BoostExpectedValueInput {
  requiredConnects: number | null;
  chosenBoostConnects: number | null;
  boostTable?: BoostBid[];
  topBids?: number[];
  chosenRank?: number | null;
  outcome?: ApplicationStatus | "reply" | "none" | null;
  scope?: string;
  source?: string;
  leadScore?: number | null;
  matchLevel?: string | null;
}

export interface SourceOutcomeCount {
  outcome: ApplicationStatus | "reply" | "none";
  count: number;
}

export interface SourceScanSummary {
  sourceLabel: string;
  sourceType?: string | null;
  scans: number;
  goodLeadCount: number;
  browserChecks?: number;
  challenges?: number;
  outcomes?: SourceOutcomeCount[];
}

export interface TimingAttributionInput {
  postedAt?: string | null;
  discoveredAt?: string | null;
  preparedAt?: string | null;
  submittedAt?: string | null;
  outcome?: ApplicationStatus | "reply" | "none" | null;
}

export interface SourceTimingAttributionInput {
  sourceLabel: string;
  sourceType?: string | null;
  scope?: string;
  source?: string;
  scans?: SourceScanSummary[];
  timing?: TimingAttributionInput;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: string | null | undefined, max = 260): string {
  const cleaned = clean(value);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function wordCount(value: string): number {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function firstSentence(value: string): string {
  return compact(clean(value).split(/(?<=[.!?])\s+/)[0] ?? "", 180);
}

function lastSentence(value: string): string {
  const sentences = clean(value).split(/(?<=[.!?])\s+/).filter(Boolean);
  return compact(sentences[sentences.length - 1] ?? "", 180);
}

function containsAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function hoursBetween(left?: string | null, right?: string | null): number | null {
  const leftMs = Date.parse(left ?? "");
  const rightMs = Date.parse(right ?? "");
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return null;
  return Math.max(0, Math.round(((rightMs - leftMs) / 3_600_000) * 100) / 100);
}

function isPositiveOutcome(outcome?: BoostExpectedValueInput["outcome"]): boolean {
  return outcome === "reply" || outcome === "replied" || outcome === "interview" || outcome === "hired";
}

function outcomeLabel(outcome?: BoostExpectedValueInput["outcome"]): string {
  if (outcome === "reply" || outcome === "replied") return "reply";
  if (outcome === "interview") return "interview";
  if (outcome === "hired") return "hire";
  if (outcome === "lost" || outcome === "rejected") return String(outcome);
  return "outcome";
}

function confidenceFromSignalCount(count: number): SalesLearningConfidence {
  if (count >= 4) return "medium";
  return "low";
}

function toMemoryInput(signal: StructuredSalesLearningSignal): UpsertSalesLearningMemoryInput {
  return {
    type: signal.type,
    scope: signal.scope,
    subject: signal.subject,
    hypothesis: signal.hypothesis,
    rationale: signal.rationale,
    confidence: signal.confidence,
    evidenceCount: signal.evidenceCount,
    status: signal.status,
    source: signal.source,
    examples: signal.examples,
    metadata: {
      ...signal.metadata,
      signalKind: signal.kind,
      tags: signal.tags,
    },
  };
}

export function salesLearningSignalsToMemoryInputs(signals: StructuredSalesLearningSignal[]): UpsertSalesLearningMemoryInput[] {
  return signals.map(toMemoryInput);
}

const GENERIC_INTRO_PATTERNS = [
  /\bI\s+(?:have|bring)\s+(?:extensive|strong|deep|[0-9]+\+?\s+years)\s+experience\b/i,
  /\bI'?d\s+love\s+to\s+help\b/i,
  /\bI\s+can\s+help\s+(?:you\s+)?(?:with|build|improve|create)\b/i,
  /\bAs\s+an?\s+(?:experienced|expert|seasoned)\b/i,
  /\bI\s+speciali[sz]e\s+in\b/i,
];

const DIRECT_DIAGNOSIS_PATTERNS = [
  /\b(?:leak|leaking|bleeding|losing|wasting|missing)\s+(?:revenue|sales|repeat|margin|customers|leads)\b/i,
  /\b(?:post-purchase|abandoned cart|welcome|retention|deliverability|conversion|lifecycle)\s+(?:flow|flows|leak|gap|problem|issue|fix|diagnosis)\b/i,
  /\b(?:first|main|biggest)\s+(?:fix|problem|gap|bottleneck|revenue)\b/i,
  /\bI'?d\s+fix\b/i,
  /\bdiagnos(?:e|is)\b/i,
];

const DIRECT_CTA_PATTERNS = [
  /\b(?:send|share|drop|reply with|point me to|give me)\b/i,
  /\b(?:store url|account access|current flow|first two fixes|quick audit|screenshots?)\b/i,
];

const PROOF_FRAMING_PATTERNS = [
  /\b(?:closest proof|case study|result|lift|proof|similar|because|worked on|retention lift|revenue lift)\b/i,
];

export function buildProposalDiffLearning(input: ProposalDiffInput): ProposalDiffResult {
  const generated = clean(input.generatedDraft);
  const final = clean(input.finalDraft);
  const generatedOpener = firstSentence(generated);
  const finalOpener = firstSentence(final);
  const generatedCta = lastSentence(generated);
  const finalCta = lastSentence(final);
  const generatedWords = wordCount(generated);
  const finalWords = wordCount(final);
  const wordDelta = finalWords - generatedWords;

  const generatedGenericIntro = containsAny(generatedOpener, GENERIC_INTRO_PATTERNS);
  const finalGenericIntro = containsAny(finalOpener, GENERIC_INTRO_PATTERNS);
  const genericExperienceIntroRemoved = generatedGenericIntro && !finalGenericIntro;
  const directDiagnosisAdded = !containsAny(generatedOpener, DIRECT_DIAGNOSIS_PATTERNS)
    && containsAny(finalOpener, DIRECT_DIAGNOSIS_PATTERNS);
  const ctaChanged = Boolean(generatedCta && finalCta && generatedCta !== finalCta);
  const directCtaAdded = ctaChanged && containsAny(finalCta, DIRECT_CTA_PATTERNS);
  const proofFramingChanged = containsAny(final, PROOF_FRAMING_PATTERNS)
    && (!containsAny(generated, PROOF_FRAMING_PATTERNS) || generated !== final);
  const shorter = generatedWords > 0 && finalWords > 0 && finalWords <= Math.floor(generatedWords * 0.85);
  const moreDirectTone = /\byou(?:r)?\b/i.test(final) || /\bI'?d\s+(?:fix|start|cut|check|point)\b/i.test(final);

  const tags = unique([
    genericExperienceIntroRemoved ? "generic_experience_intro_removed" : null,
    directDiagnosisAdded ? "direct_commercial_diagnosis_added" : null,
    directCtaAdded ? "direct_cta_added" : ctaChanged ? "cta_changed" : null,
    proofFramingChanged ? "proof_framing_changed" : null,
    shorter ? "shorter_final_draft" : null,
    moreDirectTone ? "more_direct_tone" : null,
  ]);

  if (tags.length === 0) {
    return { signals: [], memoryInputs: [], tags, wordDelta, finalWordCount: finalWords, generatedWordCount: generatedWords };
  }

  const scope = clean(input.scope) || "proposal:global";
  const editor = clean(input.editor) || "Steve/Natalie";
  const hypothesisParts = [
    genericExperienceIntroRemoved || directDiagnosisAdded
      ? `${editor} edits favor direct commercial diagnosis over generic experience intros`
      : `${editor} edits are proposal style evidence`,
    proofFramingChanged ? "tight proof framing" : null,
    directCtaAdded ? "clearer next-step CTAs" : ctaChanged ? "CTA changes" : null,
    shorter ? "shorter drafts" : null,
    moreDirectTone ? "more direct tone" : null,
  ].filter(Boolean);

  const signal: StructuredSalesLearningSignal = {
    kind: "proposal_diff",
    type: "proposal_style",
    scope,
    subject: `${scope}:proposal_diff`,
    hypothesis: `For similar proposals, ${hypothesisParts.join(", ")}.`,
    rationale: [
      `Generated opener: ${generatedOpener || "none"}.`,
      `Final opener: ${finalOpener || "none"}.`,
      ctaChanged ? `CTA changed from "${generatedCta}" to "${finalCta}".` : null,
      `Length changed from ${generatedWords} to ${finalWords} words.`,
    ].filter(Boolean).join(" "),
    confidence: confidenceFromSignalCount(tags.length),
    evidenceCount: 1,
    status: "tentative",
    source: input.source ?? "proposal_diff",
    examples: unique([generatedOpener ? `generated: ${generatedOpener}` : null, finalOpener ? `final: ${finalOpener}` : null, finalCta ? `final CTA: ${finalCta}` : null]),
    tags,
    metadata: {
      jobId: input.jobId ?? null,
      editor,
      generatedWordCount: generatedWords,
      finalWordCount: finalWords,
      wordDelta,
      genericExperienceIntroRemoved,
      directDiagnosisAdded,
      ctaChanged,
      directCtaAdded,
      proofFramingChanged,
      shorter,
      moreDirectTone,
    },
  };
  return {
    signals: [signal],
    memoryInputs: [toMemoryInput(signal)],
    tags,
    wordDelta,
    finalWordCount: finalWords,
    generatedWordCount: generatedWords,
  };
}

function normalizeBoostTable(input: BoostExpectedValueInput): BoostBid[] {
  const fromTable = (input.boostTable ?? [])
    .filter((bid) => Number.isFinite(bid.rank) && Number.isFinite(bid.connects))
    .map((bid) => ({ ...bid, connects: Math.max(0, Math.round(bid.connects)) }));
  if (fromTable.length > 0) {
    return fromTable.sort((left, right) => left.rank - right.rank);
  }
  return (input.topBids ?? [])
    .filter((connects) => Number.isFinite(connects))
    .map((connects, index) => ({ rank: index + 1, connects: Math.max(0, Math.round(connects)) }))
    .sort((left, right) => left.rank - right.rank);
}

function boostToClear(connects: number | null | undefined): number | null {
  if (typeof connects !== "number" || !Number.isFinite(connects)) return null;
  return Math.min(HARD_OPTIONAL_BOOST_CAP, Math.max(0, Math.round(connects) + 1));
}

function inferBoostRank(chosenBoost: number | null, table: BoostBid[]): number | null {
  if (chosenBoost === null) return null;
  const sortedByConnects = [...table].sort((left, right) => right.connects - left.connects);
  const betterOrEqual = sortedByConnects.filter((bid) => chosenBoost >= bid.connects);
  return betterOrEqual.length ? Math.min(...betterOrEqual.map((bid) => bid.rank)) : null;
}

export function buildBoostExpectedValueSignal(input: BoostExpectedValueInput): StructuredSalesLearningSignal {
  const table = normalizeBoostTable(input);
  const rawChosenBoost = typeof input.chosenBoostConnects === "number" && Number.isFinite(input.chosenBoostConnects)
    ? Math.max(0, Math.round(input.chosenBoostConnects))
    : null;
  const cappedChosenBoost = rawChosenBoost === null ? null : Math.min(HARD_OPTIONAL_BOOST_CAP, rawChosenBoost);
  const inferredRank = input.chosenRank ?? inferBoostRank(cappedChosenBoost, table);
  const top1 = table.find((bid) => bid.rank === 1)?.connects ?? null;
  const top2 = table.find((bid) => bid.rank === 2)?.connects ?? null;
  const top3 = table.find((bid) => bid.rank === 3)?.connects ?? null;
  const top2Clear = boostToClear(top2);
  const top3Clear = boostToClear(top3);
  const positive = isPositiveOutcome(input.outcome);
  const scope = clean(input.scope) || "boost:global";
  const tags = unique([
    positive ? "positive_outcome" : null,
    inferredRank === 2 ? "top_2_visibility_signal" : null,
    inferredRank === 3 ? "top_3_visibility_signal" : null,
    inferredRank === 1 && top2 !== null && cappedChosenBoost !== null && cappedChosenBoost - top2 >= 8 ? "number_1_likely_overbid" : null,
    rawChosenBoost !== null && rawChosenBoost > HARD_OPTIONAL_BOOST_CAP ? "over_cap_input_ignored_as_repeatable" : null,
    top3Clear !== null ? "minimum_top_3_estimate" : null,
  ]);
  const visibilityPhrase = inferredRank && inferredRank <= 3 ? `top-${inferredRank}` : "visible";
  const likelyWasteful = tags.includes("number_1_likely_overbid");
  const enoughPhrase = positive && inferredRank && inferredRank <= 3
    ? `${visibilityPhrase} visibility produced a ${outcomeLabel(input.outcome)} signal`
    : "use outcome data to test minimum useful visibility";
  const wastePhrase = likelyWasteful
    ? `#1 likely overpaid versus top-2/top-3 thresholds (${top2Clear ?? "unknown"}/${top3Clear ?? "unknown"} Connects, capped at ${HARD_OPTIONAL_BOOST_CAP})`
    : `do not turn this into an always-boost-${HARD_OPTIONAL_BOOST_CAP} rule`;

  return {
    kind: "boost_expected_value",
    type: "boost_strategy",
    scope,
    subject: `${scope}:expected_value`,
    hypothesis: `For similar jobs, ${enoughPhrase}; ${wastePhrase}.`,
    rationale: `Required=${input.requiredConnects ?? "unknown"}, chosen boost=${rawChosenBoost ?? "unknown"}, capped repeatable boost=${cappedChosenBoost ?? "unknown"}, rank=${inferredRank ?? "unknown"}, top bids=${table.map((bid) => `#${bid.rank}:${bid.connects}`).join(", ") || "unknown"}.`,
    confidence: positive && inferredRank && inferredRank <= 3 ? "medium" : "low",
    evidenceCount: 1,
    status: "tentative",
    source: input.source ?? "boost_expected_value",
    examples: unique([
      `required ${input.requiredConnects ?? "unknown"}`,
      cappedChosenBoost === null ? null : `chosen boost ${cappedChosenBoost}`,
      inferredRank === null ? null : `rank ${inferredRank}`,
      input.outcome ? `outcome ${input.outcome}` : null,
    ]),
    tags,
    metadata: {
      hardOptionalBoostCap: HARD_OPTIONAL_BOOST_CAP,
      requiredConnects: input.requiredConnects,
      chosenBoostConnects: cappedChosenBoost,
      observedChosenBoostConnects: rawChosenBoost,
      chosenRank: inferredRank,
      top1Connects: top1,
      top2Connects: top2,
      top3Connects: top3,
      top2ClearConnects: top2Clear,
      top3ClearConnects: top3Clear,
      outcome: input.outcome ?? null,
      leadScore: input.leadScore ?? null,
      matchLevel: input.matchLevel ?? null,
      learnedRuleIsDeterministic: false,
    },
  };
}

function aggregateScans(scans: SourceScanSummary[]): {
  scans: number;
  goodLeadCount: number;
  browserChecks: number;
  challenges: number;
  positiveOutcomes: number;
  negativeOutcomes: number;
} {
  return scans.reduce((acc, scan) => {
    acc.scans += Math.max(0, scan.scans);
    acc.goodLeadCount += Math.max(0, scan.goodLeadCount);
    acc.browserChecks += Math.max(0, scan.browserChecks ?? 0);
    acc.challenges += Math.max(0, scan.challenges ?? 0);
    for (const outcome of scan.outcomes ?? []) {
      if (isPositiveOutcome(outcome.outcome)) acc.positiveOutcomes += Math.max(0, outcome.count);
      if (outcome.outcome === "lost" || outcome.outcome === "rejected") acc.negativeOutcomes += Math.max(0, outcome.count);
    }
    return acc;
  }, { scans: 0, goodLeadCount: 0, browserChecks: 0, challenges: 0, positiveOutcomes: 0, negativeOutcomes: 0 });
}

export function buildSourceTimingAttributionSignals(input: SourceTimingAttributionInput): StructuredSalesLearningSignal[] {
  const signals: StructuredSalesLearningSignal[] = [];
  const sourceLabel = clean(input.sourceLabel) || "unknown source";
  const scope = clean(input.scope) || `source:${sourceLabel}`;
  const scanTotals = aggregateScans(input.scans ?? []);
  const scanCount = scanTotals.scans || (input.scans?.length ?? 0);
  const goodLeadRate = scanTotals.scans > 0 ? Math.round((scanTotals.goodLeadCount / scanTotals.scans) * 100) / 100 : null;
  const noisy = scanTotals.browserChecks >= 3 && (scanTotals.challenges > 0 || (goodLeadRate !== null && goodLeadRate <= 0.25));

  if (scanTotals.scans > 0 || scanTotals.browserChecks > 0 || scanTotals.challenges > 0) {
    const sourceTags = unique([
      noisy ? "noisy_source_with_browser_checks" : null,
      scanTotals.challenges > 0 ? "challenge_friction" : null,
      scanTotals.goodLeadCount > 0 ? "good_leads_seen" : null,
      scanTotals.positiveOutcomes > 0 ? "positive_source_outcome" : null,
    ]);
    const qualityPhrase = noisy
      ? `${sourceLabel} looks noisy: ${scanTotals.scans} scans produced ${scanTotals.goodLeadCount} good leads with ${scanTotals.browserChecks} browser checks and ${scanTotals.challenges} challenges`
      : `${sourceLabel} produced ${scanTotals.goodLeadCount} good leads from ${scanTotals.scans} scans`;
    signals.push({
      kind: "source_timing_attribution",
      type: "source_quality",
      scope,
      subject: `${sourceLabel}:source_quality`,
      hypothesis: noisy
        ? `${qualityPhrase}; down-rank or cooldown this source until quality improves.`
        : `${qualityPhrase}; keep comparing it against other sources before changing priority.`,
      rationale: `Source type=${input.sourceType ?? "unknown"}, scans=${scanTotals.scans}, good leads=${scanTotals.goodLeadCount}, browser checks=${scanTotals.browserChecks}, challenges=${scanTotals.challenges}, positive outcomes=${scanTotals.positiveOutcomes}.`,
      confidence: scanCount >= 5 || scanTotals.challenges >= 2 ? "medium" : "low",
      evidenceCount: Math.max(1, scanCount),
      status: "tentative",
      source: input.source ?? "source_timing_attribution",
      examples: unique([sourceLabel, input.sourceType ?? null, noisy ? "browser checks/challenges" : null]),
      tags: sourceTags,
      metadata: {
        sourceLabel,
        sourceType: input.sourceType ?? null,
        scans: scanTotals.scans,
        goodLeadCount: scanTotals.goodLeadCount,
        goodLeadRate,
        browserChecks: scanTotals.browserChecks,
        challenges: scanTotals.challenges,
        positiveOutcomes: scanTotals.positiveOutcomes,
        negativeOutcomes: scanTotals.negativeOutcomes,
      },
    });
  }

  const timing = input.timing;
  if (timing) {
    const postedToDiscoveredHours = hoursBetween(timing.postedAt, timing.discoveredAt);
    const postedToPreparedHours = hoursBetween(timing.postedAt, timing.preparedAt);
    const postedToSubmittedHours = hoursBetween(timing.postedAt, timing.submittedAt);
    const positive = isPositiveOutcome(timing.outcome);
    const hasTiming = postedToDiscoveredHours !== null || postedToPreparedHours !== null || postedToSubmittedHours !== null;
    if (hasTiming) {
      const freshnessHours = postedToPreparedHours ?? postedToDiscoveredHours ?? postedToSubmittedHours;
      const fresh = typeof freshnessHours === "number" && freshnessHours <= 6;
      signals.push({
        kind: "source_timing_attribution",
        type: "timing_hypothesis",
        scope,
        subject: `${sourceLabel}:timing`,
        hypothesis: positive && fresh
          ? `${sourceLabel} has positive freshness evidence: prepared about ${freshnessHours}h after posting and produced a ${outcomeLabel(timing.outcome)} signal.`
          : `${sourceLabel} timing should keep tracking posted/discovered/prepared/submitted delays before drawing a hard rule.`,
        rationale: `posted=${timing.postedAt ?? "unknown"}, discovered=${timing.discoveredAt ?? "unknown"}, prepared=${timing.preparedAt ?? "unknown"}, submitted=${timing.submittedAt ?? "unknown"}, outcome=${timing.outcome ?? "unknown"}.`,
        confidence: positive && fresh ? "medium" : "low",
        evidenceCount: 1,
        status: "tentative",
        source: input.source ?? "source_timing_attribution",
        examples: unique([
          freshnessHours === null ? null : `${freshnessHours}h posting-to-${postedToPreparedHours !== null ? "prep" : "discovery"}`,
          timing.outcome ? `outcome ${timing.outcome}` : null,
        ]),
        tags: unique([
          fresh ? "fresh_timing_signal" : null,
          positive ? "positive_timing_outcome" : null,
          postedToSubmittedHours !== null ? "submitted_timestamp_observed" : null,
        ]),
        metadata: {
          sourceLabel,
          sourceType: input.sourceType ?? null,
          postedAt: timing.postedAt ?? null,
          discoveredAt: timing.discoveredAt ?? null,
          preparedAt: timing.preparedAt ?? null,
          submittedAt: timing.submittedAt ?? null,
          postedToDiscoveredHours,
          postedToPreparedHours,
          postedToSubmittedHours,
          outcome: timing.outcome ?? null,
          submittedTimestampIsAttributionOnly: true,
        },
      });
    }
  }

  return signals;
}

