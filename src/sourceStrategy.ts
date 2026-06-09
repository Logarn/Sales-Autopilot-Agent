import type { SalesLearningMemory } from "./db";
import type { ApplicationStatus, MatchLevel } from "./types";

export type SourceStrategyRecommendation = "prioritize" | "keep" | "monitor" | "back_off";
export type SourceStrategyEvidenceLevel = "not enough data" | "tentative" | "strong";

export interface SourceStrategyObservation {
  sourceLabel: string;
  sourceType?: string | null;
  leadId?: string | null;
  leadScore?: number | null;
  matchLevel?: MatchLevel | null;
  status?: ApplicationStatus | "reply" | "none" | null;
  challengeCount?: number | null;
  challenged?: boolean | null;
  redFlags?: string[] | number | boolean | null;
  budget?: string | null;
  budgetAmount?: number | null;
  clientRating?: number | null;
  clientSpend?: number | null;
  clientHireRate?: number | null;
  metadata?: Record<string, unknown>;
}

export interface SourceMetricSnapshot {
  schemaVersion: "source_strategy_v2";
  sourceLabel: string;
  sourceType: string | null;
  sampleSize: number;
  scanCount: number;
  goodLeadCount: number;
  goodLeadRate: number | null;
  challengeCount: number;
  challengeRate: number | null;
  redFlagLeadCount: number;
  redFlagRate: number | null;
  submittedCount: number;
  replyCount: number;
  replyRate: number | null;
  conversionCount: number;
  conversionRate: number | null;
  positiveOutcomeCount: number;
  positiveOutcomeRate: number | null;
  negativeOutcomeCount: number;
  averageLeadScore: number | null;
  budgetQualityScore: number | null;
  clientQualityScore: number | null;
  qualityScore: number;
  recommendation: SourceStrategyRecommendation;
  evidenceLevel: SourceStrategyEvidenceLevel;
  reasons: string[];
  caveats: string[];
}

export interface SourceStrategyAnswer {
  text: string;
  metrics: SourceMetricSnapshot[];
  schema: typeof SOURCE_STRATEGY_METRICS_SCHEMA;
}

interface SourceMetricAccumulator {
  sourceLabel: string;
  sourceType: string | null;
  sampleSize: number;
  scanCount: number;
  goodLeadCount: number;
  challengeCount: number;
  redFlagLeadCount: number;
  submittedCount: number;
  replyCount: number;
  conversionCount: number;
  positiveOutcomeCount: number;
  negativeOutcomeCount: number;
  leadScoreTotal: number;
  leadScoreCount: number;
  budgetQualityTotal: number;
  budgetQualityCount: number;
  clientQualityTotal: number;
  clientQualityCount: number;
}

export const SOURCE_STRATEGY_METRICS_SCHEMA = {
  schemaVersion: "source_strategy_v2",
  dimensions: ["sourceLabel", "sourceType"],
  counters: [
    "sampleSize",
    "scanCount",
    "goodLeadCount",
    "challengeCount",
    "redFlagLeadCount",
    "submittedCount",
    "replyCount",
    "conversionCount",
    "positiveOutcomeCount",
    "negativeOutcomeCount",
  ],
  rates: [
    "goodLeadRate",
    "challengeRate",
    "redFlagRate",
    "replyRate",
    "conversionRate",
    "positiveOutcomeRate",
  ],
  qualityScores: ["averageLeadScore", "budgetQualityScore", "clientQualityScore", "qualityScore"],
  recommendation: "prioritize | keep | monitor | back_off",
  certainty: "evidenceLevel plus caveats; never deterministic from sparse evidence",
} as const;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function sourceKey(label: string): string {
  return clean(label).toLowerCase() || "unknown source";
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round(clamp(numerator / denominator, 0, 1));
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && clean(value) ? clean(value) : null;
}

function parseBudgetAmount(value: string | null | undefined): number | null {
  const text = clean(value).toLowerCase();
  if (!text) return null;
  const hourly = text.match(/\$?\s*(\d+(?:\.\d+)?)\s*(?:-|to)\s*\$?\s*(\d+(?:\.\d+)?)\s*\/?\s*(?:hr|hour)/);
  if (hourly) return (Number(hourly[1]) + Number(hourly[2])) / 2;
  const singleHourly = text.match(/\$?\s*(\d+(?:\.\d+)?)\s*\/?\s*(?:hr|hour)/);
  if (singleHourly) return Number(singleHourly[1]);
  const fixed = text.match(/\$?\s*([\d,]+(?:\.\d+)?)(?:\s*(?:fixed|budget))?/);
  if (!fixed) return null;
  return Number(fixed[1].replace(/,/g, ""));
}

function budgetQuality(input: SourceStrategyObservation): number | null {
  const amount = input.budgetAmount ?? parseBudgetAmount(input.budget);
  if (amount === null || !Number.isFinite(amount)) return null;
  const hourly = /\b(?:hr|hour|hourly)\b/i.test(input.budget ?? "");
  if (hourly) {
    if (amount >= 80) return 100;
    if (amount >= 50) return 85;
    if (amount >= 35) return 70;
    if (amount >= 25) return 50;
    return 25;
  }
  if (amount >= 5000) return 100;
  if (amount >= 2500) return 85;
  if (amount >= 1000) return 70;
  if (amount >= 500) return 50;
  return 25;
}

function clientQuality(input: SourceStrategyObservation): number | null {
  const rating = input.clientRating;
  const spend = input.clientSpend;
  const hireRate = input.clientHireRate;
  const parts: number[] = [];
  if (typeof rating === "number" && Number.isFinite(rating)) parts.push(clamp((rating / 5) * 100));
  if (typeof spend === "number" && Number.isFinite(spend)) parts.push(clamp(Math.log10(Math.max(1, spend)) * 20));
  if (typeof hireRate === "number" && Number.isFinite(hireRate)) parts.push(clamp(hireRate <= 1 ? hireRate * 100 : hireRate));
  if (!parts.length) return null;
  return round(parts.reduce((sum, value) => sum + value, 0) / parts.length);
}

function redFlagCount(value: SourceStrategyObservation["redFlags"]): number {
  if (Array.isArray(value)) return value.filter((flag) => clean(flag)).length;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  return value ? 1 : 0;
}

function isGoodLead(input: SourceStrategyObservation): boolean {
  if (redFlagCount(input.redFlags) > 0) return false;
  if (typeof input.leadScore === "number" && input.leadScore >= 75) return true;
  return input.matchLevel === "high" || input.matchLevel === "medium";
}

function isSubmitted(status: SourceStrategyObservation["status"]): boolean {
  return status === "applied" || status === "submitted" || isPositiveOutcome(status) || status === "lost";
}

function isPositiveOutcome(status: SourceStrategyObservation["status"]): boolean {
  return status === "reply" || status === "replied" || status === "interview" || status === "hired";
}

function isConversion(status: SourceStrategyObservation["status"]): boolean {
  return status === "interview" || status === "hired";
}

function isNegativeOutcome(status: SourceStrategyObservation["status"]): boolean {
  return status === "lost" || status === "rejected";
}

function emptyAccumulator(sourceLabel: string, sourceType?: string | null): SourceMetricAccumulator {
  return {
    sourceLabel: clean(sourceLabel) || "unknown source",
    sourceType: clean(sourceType) || null,
    sampleSize: 0,
    scanCount: 0,
    goodLeadCount: 0,
    challengeCount: 0,
    redFlagLeadCount: 0,
    submittedCount: 0,
    replyCount: 0,
    conversionCount: 0,
    positiveOutcomeCount: 0,
    negativeOutcomeCount: 0,
    leadScoreTotal: 0,
    leadScoreCount: 0,
    budgetQualityTotal: 0,
    budgetQualityCount: 0,
    clientQualityTotal: 0,
    clientQualityCount: 0,
  };
}

function addObservation(acc: SourceMetricAccumulator, observation: SourceStrategyObservation): void {
  acc.sampleSize += 1;
  acc.scanCount += 1;
  const challengeCount = Math.max(0, Math.round(observation.challengeCount ?? (observation.challenged ? 1 : 0)));
  const flags = redFlagCount(observation.redFlags);
  acc.challengeCount += challengeCount;
  if (flags > 0) acc.redFlagLeadCount += 1;
  if (isGoodLead(observation)) acc.goodLeadCount += 1;
  if (isSubmitted(observation.status)) acc.submittedCount += 1;
  if (observation.status === "reply" || observation.status === "replied") acc.replyCount += 1;
  if (isConversion(observation.status)) acc.conversionCount += 1;
  if (isPositiveOutcome(observation.status)) acc.positiveOutcomeCount += 1;
  if (isNegativeOutcome(observation.status)) acc.negativeOutcomeCount += 1;
  if (typeof observation.leadScore === "number" && Number.isFinite(observation.leadScore)) {
    acc.leadScoreTotal += clamp(observation.leadScore);
    acc.leadScoreCount += 1;
  }
  const budget = budgetQuality(observation);
  if (budget !== null) {
    acc.budgetQualityTotal += budget;
    acc.budgetQualityCount += 1;
  }
  const client = clientQuality(observation);
  if (client !== null) {
    acc.clientQualityTotal += client;
    acc.clientQualityCount += 1;
  }
}

function addMemory(acc: SourceMetricAccumulator, memory: SalesLearningMemory): void {
  const metadata = memory.metadata ?? {};
  const scans = Math.max(0, Math.round(numberFrom(metadata.scans) ?? memory.evidenceCount ?? 0));
  const goodLeadCount = Math.max(0, Math.round(numberFrom(metadata.goodLeadCount) ?? 0));
  const challenges = Math.max(0, Math.round(numberFrom(metadata.challenges) ?? numberFrom(metadata.challengeCount) ?? 0));
  const redFlags = Math.max(0, Math.round(numberFrom(metadata.redFlagLeadCount) ?? numberFrom(metadata.redFlags) ?? 0));
  const positive = Math.max(0, Math.round(numberFrom(metadata.positiveOutcomes) ?? numberFrom(metadata.positiveOutcomeCount) ?? 0));
  const negative = Math.max(0, Math.round(numberFrom(metadata.negativeOutcomes) ?? numberFrom(metadata.negativeOutcomeCount) ?? 0));
  const replies = Math.max(0, Math.round(numberFrom(metadata.replyCount) ?? numberFrom(metadata.replies) ?? 0));
  const conversions = Math.max(0, Math.round(numberFrom(metadata.conversionCount) ?? 0));
  const submitted = Math.max(0, Math.round(numberFrom(metadata.submittedCount) ?? positive + negative));

  acc.sampleSize += scans;
  acc.scanCount += scans;
  acc.goodLeadCount += goodLeadCount;
  acc.challengeCount += challenges;
  acc.redFlagLeadCount += redFlags;
  acc.positiveOutcomeCount += positive;
  acc.negativeOutcomeCount += negative;
  acc.replyCount += replies || positive;
  acc.conversionCount += conversions;
  acc.submittedCount += submitted;

  const averageLeadScore = numberFrom(metadata.averageLeadScore) ?? numberFrom(metadata.leadScore);
  if (averageLeadScore !== null) {
    acc.leadScoreTotal += clamp(averageLeadScore) * Math.max(1, scans || memory.evidenceCount);
    acc.leadScoreCount += Math.max(1, scans || memory.evidenceCount);
  }
  const budgetScore = numberFrom(metadata.budgetQualityScore);
  if (budgetScore !== null) {
    acc.budgetQualityTotal += clamp(budgetScore) * Math.max(1, scans || memory.evidenceCount);
    acc.budgetQualityCount += Math.max(1, scans || memory.evidenceCount);
  }
  const clientScore = numberFrom(metadata.clientQualityScore);
  if (clientScore !== null) {
    acc.clientQualityTotal += clamp(clientScore) * Math.max(1, scans || memory.evidenceCount);
    acc.clientQualityCount += Math.max(1, scans || memory.evidenceCount);
  }
}

function average(total: number, count: number): number | null {
  if (count <= 0) return null;
  return round(total / count);
}

function evidenceLevel(sampleSize: number): SourceStrategyEvidenceLevel {
  if (sampleSize >= 12) return "strong";
  if (sampleSize >= 3) return "tentative";
  return "not enough data";
}

function scoreSource(input: {
  sampleSize: number;
  goodLeadRate: number | null;
  challengeRate: number | null;
  redFlagRate: number | null;
  positiveOutcomeRate: number | null;
  replyRate: number | null;
  budgetQualityScore: number | null;
  clientQualityScore: number | null;
  averageLeadScore: number | null;
}): number {
  const leadQuality = input.goodLeadRate === null ? 45 : input.goodLeadRate * 100;
  const outcome = input.positiveOutcomeRate === null
    ? input.replyRate === null ? 45 : input.replyRate * 100
    : input.positiveOutcomeRate * 100;
  const challenge = input.challengeRate === null ? 70 : (1 - input.challengeRate) * 100;
  const redFlags = input.redFlagRate === null ? 70 : (1 - input.redFlagRate) * 100;
  const budget = input.budgetQualityScore ?? 50;
  const client = input.clientQualityScore ?? 50;
  const leadScore = input.averageLeadScore ?? 50;
  const sparsePenalty = input.sampleSize < 3 ? 12 : input.sampleSize < 6 ? 5 : 0;
  return round(clamp(
    leadQuality * 0.22
    + outcome * 0.22
    + challenge * 0.17
    + redFlags * 0.17
    + budget * 0.08
    + client * 0.08
    + leadScore * 0.06
    - sparsePenalty,
  ));
}

function recommendationFor(snapshot: Omit<SourceMetricSnapshot, "recommendation" | "reasons" | "caveats">): SourceStrategyRecommendation {
  const enough = snapshot.sampleSize >= 3;
  if (!enough) return "monitor";
  const challengeProne = (snapshot.challengeRate ?? 0) >= 0.4 && snapshot.challengeCount >= 2;
  const redFlagProne = (snapshot.redFlagRate ?? 0) >= 0.45 && snapshot.redFlagLeadCount >= 2;
  const lowYield = (snapshot.goodLeadRate ?? 1) <= 0.2 && snapshot.goodLeadCount <= 1;
  const noOutcomeProof = snapshot.positiveOutcomeCount === 0 && snapshot.submittedCount > 0;
  if (challengeProne || redFlagProne || (lowYield && noOutcomeProof)) return "back_off";
  if (snapshot.qualityScore >= 72 && ((snapshot.positiveOutcomeRate ?? 0) > 0 || (snapshot.goodLeadRate ?? 0) >= 0.55)) return "prioritize";
  if (snapshot.qualityScore >= 58) return "keep";
  return "monitor";
}

function reasonsFor(snapshot: Omit<SourceMetricSnapshot, "reasons" | "caveats">): string[] {
  const reasons: string[] = [];
  if (snapshot.goodLeadRate !== null) reasons.push(`${snapshot.goodLeadCount}/${snapshot.scanCount || snapshot.sampleSize} leads qualified (${Math.round(snapshot.goodLeadRate * 100)}%)`);
  if (snapshot.challengeRate !== null && snapshot.challengeCount > 0) reasons.push(`${snapshot.challengeCount} challenge signal${snapshot.challengeCount === 1 ? "" : "s"} (${Math.round(snapshot.challengeRate * 100)}%)`);
  if (snapshot.redFlagRate !== null && snapshot.redFlagLeadCount > 0) reasons.push(`${snapshot.redFlagLeadCount} red-flag lead${snapshot.redFlagLeadCount === 1 ? "" : "s"} (${Math.round(snapshot.redFlagRate * 100)}%)`);
  if (snapshot.replyRate !== null) reasons.push(`${snapshot.replyCount}/${snapshot.submittedCount} replied (${Math.round(snapshot.replyRate * 100)}%)`);
  if (snapshot.conversionRate !== null && snapshot.conversionCount > 0) reasons.push(`${snapshot.conversionCount}/${snapshot.submittedCount} converted to interview/hire (${Math.round(snapshot.conversionRate * 100)}%)`);
  if (snapshot.budgetQualityScore !== null) reasons.push(`budget quality ${snapshot.budgetQualityScore}/100`);
  if (snapshot.clientQualityScore !== null) reasons.push(`client quality ${snapshot.clientQualityScore}/100`);
  if (!reasons.length) reasons.push("not enough measured source evidence yet");
  return reasons;
}

function caveatsFor(snapshot: Omit<SourceMetricSnapshot, "caveats" | "reasons">): string[] {
  const caveats: string[] = [];
  if (snapshot.evidenceLevel === "not enough data") caveats.push("sample is too small for a firm source call");
  if (snapshot.submittedCount === 0) caveats.push("reply/conversion rates are unavailable until outcomes exist");
  if (snapshot.budgetQualityScore === null) caveats.push("budget quality is missing for this source");
  if (snapshot.clientQualityScore === null) caveats.push("client quality is missing for this source");
  return caveats;
}

function finalizeAccumulator(acc: SourceMetricAccumulator): SourceMetricSnapshot {
  const denominator = Math.max(acc.sampleSize, acc.scanCount);
  const averageLeadScore = average(acc.leadScoreTotal, acc.leadScoreCount);
  const budgetQualityScore = average(acc.budgetQualityTotal, acc.budgetQualityCount);
  const clientQualityScore = average(acc.clientQualityTotal, acc.clientQualityCount);
  const base = {
    schemaVersion: "source_strategy_v2" as const,
    sourceLabel: acc.sourceLabel,
    sourceType: acc.sourceType,
    sampleSize: acc.sampleSize,
    scanCount: acc.scanCount,
    goodLeadCount: acc.goodLeadCount,
    goodLeadRate: rate(acc.goodLeadCount, denominator),
    challengeCount: acc.challengeCount,
    challengeRate: rate(acc.challengeCount, denominator),
    redFlagLeadCount: acc.redFlagLeadCount,
    redFlagRate: rate(acc.redFlagLeadCount, denominator),
    submittedCount: acc.submittedCount,
    replyCount: acc.replyCount,
    replyRate: rate(acc.replyCount, acc.submittedCount),
    conversionCount: acc.conversionCount,
    conversionRate: rate(acc.conversionCount, acc.submittedCount),
    positiveOutcomeCount: acc.positiveOutcomeCount,
    positiveOutcomeRate: rate(acc.positiveOutcomeCount, acc.submittedCount),
    negativeOutcomeCount: acc.negativeOutcomeCount,
    averageLeadScore,
    budgetQualityScore,
    clientQualityScore,
    qualityScore: 0,
    evidenceLevel: evidenceLevel(acc.sampleSize),
  };
  const withScore = {
    ...base,
    qualityScore: scoreSource(base),
  };
  const withRecommendation = {
    ...withScore,
    recommendation: recommendationFor(withScore),
  };
  return {
    ...withRecommendation,
    reasons: reasonsFor(withRecommendation),
    caveats: caveatsFor(withRecommendation),
  };
}

export function buildSourceStrategyMetrics(input: {
  observations?: SourceStrategyObservation[];
  memories?: SalesLearningMemory[];
} = {}): SourceMetricSnapshot[] {
  const bySource = new Map<string, SourceMetricAccumulator>();
  const ensure = (sourceLabel: string, sourceType?: string | null): SourceMetricAccumulator => {
    const key = sourceKey(sourceLabel);
    const existing = bySource.get(key);
    if (existing) {
      if (!existing.sourceType && sourceType) existing.sourceType = clean(sourceType);
      return existing;
    }
    const acc = emptyAccumulator(sourceLabel, sourceType);
    bySource.set(key, acc);
    return acc;
  };

  for (const observation of input.observations ?? []) {
    const acc = ensure(observation.sourceLabel, observation.sourceType);
    addObservation(acc, observation);
  }

  for (const memory of input.memories ?? []) {
    if (memory.type !== "source_quality" || memory.status === "forgotten" || memory.status === "archived") continue;
    const sourceLabel = stringFrom(memory.metadata.sourceLabel) ?? memory.scope ?? memory.subject;
    const sourceType = stringFrom(memory.metadata.sourceType);
    const acc = ensure(sourceLabel, sourceType);
    addMemory(acc, memory);
  }

  return Array.from(bySource.values())
    .map(finalizeAccumulator)
    .sort((left, right) => {
      const rank = recommendationRank(right.recommendation) - recommendationRank(left.recommendation);
      return rank || right.qualityScore - left.qualityScore || right.sampleSize - left.sampleSize || left.sourceLabel.localeCompare(right.sourceLabel);
    });
}

function recommendationRank(value: SourceStrategyRecommendation): number {
  switch (value) {
    case "prioritize":
      return 4;
    case "keep":
      return 3;
    case "monitor":
      return 2;
    case "back_off":
      return 1;
  }
}

function recommendationLabel(value: SourceStrategyRecommendation): string {
  switch (value) {
    case "prioritize":
      return "prioritize";
    case "keep":
      return "keep running";
    case "monitor":
      return "monitor";
    case "back_off":
      return "back off";
  }
}

function lineForMetric(metric: SourceMetricSnapshot, index: number): string {
  const caveat = metric.caveats.length ? ` Caveat: ${metric.caveats[0]}.` : "";
  return `${index + 1}. ${metric.sourceLabel}: ${recommendationLabel(metric.recommendation)} (${metric.evidenceLevel}, score ${metric.qualityScore}/100). ${metric.reasons.join("; ")}.${caveat}`;
}

function summarizeBackoffs(metrics: SourceMetricSnapshot[]): string | null {
  const backoffs = metrics.filter((metric) => metric.recommendation === "back_off");
  if (!backoffs.length) return null;
  return `Backoff candidates: ${backoffs.map((metric) => `${metric.sourceLabel} because ${metric.reasons.slice(0, 2).join(" and ")}`).join("; ")}.`;
}

function defaultMemories(): SalesLearningMemory[] {
  const { listSalesLearningMemories } = require("./db") as {
    listSalesLearningMemories: (limit?: number) => SalesLearningMemory[];
  };
  return listSalesLearningMemories(300);
}

export function buildSourceStrategyAnswer(input: {
  question?: string | null;
  observations?: SourceStrategyObservation[];
  memories?: SalesLearningMemory[];
  limit?: number;
} = {}): SourceStrategyAnswer {
  const memories = input.memories ?? (input.observations ? [] : defaultMemories());
  const metrics = buildSourceStrategyMetrics({ observations: input.observations, memories });
  const limit = Math.max(1, input.limit ?? 5);
  if (!metrics.length) {
    return {
      schema: SOURCE_STRATEGY_METRICS_SCHEMA,
      metrics,
      text: "Evidence level: not enough data. I do not have measured source-quality data yet, so I cannot say which sources are working. I will track lead quality, challenges, red flags, outcomes, budget quality, and client quality by source before making a stronger call.",
    };
  }
  const shown = metrics.slice(0, limit);
  const backoff = summarizeBackoffs(metrics);
  return {
    schema: SOURCE_STRATEGY_METRICS_SCHEMA,
    metrics,
    text: [
      "Here is what I am seeing from the lead sources:",
      ...shown.map(lineForMetric),
      backoff,
      "Treat these as source recommendations, not certainty. Sparse samples stay in monitor mode until more outcomes arrive.",
    ].filter(Boolean).join("\n"),
  };
}
