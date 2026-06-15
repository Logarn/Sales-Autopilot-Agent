import { loadConnectsRules } from "./profile";
import type { ConnectsRules, ConnectsStrategySnapshot, JobPosting, ScoreBreakdown, SourceBackedConnects } from "./types";

interface ConnectsStrategyInput {
  job: JobPosting;
  score: number;
  scoreBreakdown: Pick<ScoreBreakdown, "clientQualityScore" | "opportunityScore" | "connectsRiskScore" | "redFlagScore">;
  suggestedBoostConnects?: number;
}

export interface VisibleBoostBid {
  rank: number;
  connects: number;
}

export interface VisibleBoostDecision {
  boostConnects: number;
  reason: string;
  targetRank: number | null;
  skippedReason?: string;
}

export function hasUnknownRequiredConnects(strategy?: Pick<ConnectsStrategySnapshot, "requiredConnects" | "sourceBackedConnects"> | null): boolean {
  return strategy?.sourceBackedConnects?.requiredConnects === null || strategy?.requiredConnects === null;
}

function parseBudgetMax(value: string): number | null {
  const values = value.match(/\d+(?:,\d{3})*(?:\.\d+)?/g)?.map((item) => Number(item.replace(/,/g, ""))) ?? [];
  if (values.length === 0) return null;
  return Math.max(...values);
}

function isHourlyBudget(value: string): boolean {
  return /\/\s*hr|hourly|per hour/i.test(value);
}

function competitionRisk(job: JobPosting): { level: "low" | "medium" | "high" | "unknown"; penalty: number; reason?: string } {
  const proposals = job.proposalCount;
  if (proposals !== null && proposals !== undefined) {
    if (proposals >= 50) return { level: "high", penalty: 22, reason: `${proposals} proposals already` };
    if (proposals >= 20) return { level: "medium", penalty: 10, reason: `${proposals} proposals already` };
    return { level: "low", penalty: 0, reason: `${proposals} proposals so far` };
  }
  if (job.competitionLevel && job.competitionLevel !== "unknown") {
    if (job.competitionLevel === "high") return { level: "high", penalty: 18, reason: "High competition signal" };
    if (job.competitionLevel === "medium") return { level: "medium", penalty: 8, reason: "Medium competition signal" };
    return { level: "low", penalty: 0, reason: "Low competition signal" };
  }
  return { level: "unknown", penalty: 4 };
}

function sourceBackedConnectsForJob(job: JobPosting): SourceBackedConnects {
  if (job.connects) return job.connects;
  const requiredConnects = Number.isFinite(job.connectsCost) && job.connectsCost > 0
    ? Math.max(0, Math.floor(job.connectsCost))
    : null;
  return {
    requiredConnects,
    boostConnects: null,
    totalConnects: null,
    confidence: requiredConnects === null ? "unknown" : "low",
    sourceText: null,
    sourceLocation: null,
    extractionMethod: requiredConnects === null ? "not_found" : "legacy_field",
  };
}

export function extractVisibleBoostBids(text: string): VisibleBoostBid[] {
  const bids: VisibleBoostBid[] = [];
  const patterns = [
    /(?:rank|place|position|#)\s*(\d{1,2})[^\n]{0,60}?(\d{1,3})\s+connects?/gi,
    /(\d{1,2})(?:st|nd|rd|th)?\s+(?:place|position)[^\n]{0,60}?(\d{1,3})\s+connects?/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const rank = Number.parseInt(match[1] ?? "", 10);
      const connects = Number.parseInt(match[2] ?? "", 10);
      if (Number.isFinite(rank) && Number.isFinite(connects) && rank > 0 && connects >= 0) {
        bids.push({ rank, connects });
      }
    }
  }
  const seen = new Set<string>();
  return bids
    .sort((left, right) => left.rank - right.rank || left.connects - right.connects)
    .filter((bid) => {
      const key = `${bid.rank}:${bid.connects}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function chooseVisibleBoost(input: {
  requiredConnects: number | null;
  expectedValueScore: number;
  clientQualityScore: number;
  opportunityScore: number;
  currentBids: VisibleBoostBid[];
  rules?: ConnectsRules;
}): VisibleBoostDecision {
  const rules = input.rules ?? loadConnectsRules();
  const maxBoost = Math.min(50, Math.max(0, rules.maxBoost));
  if (input.requiredConnects === null) {
    return { boostConnects: 0, targetRank: null, reason: "No boost set.", skippedReason: "Required Connects are unknown." };
  }
  if (input.expectedValueScore < 82 || input.clientQualityScore < 60 || input.opportunityScore < 60) {
    return { boostConnects: 0, targetRank: null, reason: "No boost set.", skippedReason: "Job is not high-fit enough for optional boost." };
  }
  const topVisible = input.currentBids
    .filter((bid) => bid.rank >= 1 && bid.rank <= 4 && bid.connects > 0)
    .sort((left, right) => left.rank - right.rank);
  if (topVisible.length === 0) {
    return { boostConnects: 0, targetRank: null, reason: "No boost set.", skippedReason: "No visible boost table was available." };
  }
  const target = topVisible[topVisible.length - 1]!;
  const requiredBoost = Math.max(0, Math.floor(target.connects));
  if (requiredBoost > maxBoost) {
    return {
      boostConnects: 0,
      targetRank: target.rank,
      reason: "No boost set.",
      skippedReason: `Visible top-${target.rank} boost requires ${requiredBoost} Connects, above cap ${maxBoost}.`,
    };
  }
  return {
    boostConnects: requiredBoost,
    targetRank: target.rank,
    reason: `Boost ${requiredBoost} Connects targets the visible top-${target.rank} range.`,
  };
}

export function chooseConnectsBoost(input: {
  job: JobPosting;
  score: number;
  clientQualityScore: number;
  opportunityScore: number;
}): number {
  const rules = loadConnectsRules();
  const requiredConnects = sourceBackedConnectsForJob(input.job).requiredConnects;
  if (requiredConnects === null || requiredConnects > rules.requireApprovalAbove) return 0;
  if (input.score < 82 || input.clientQualityScore < 60 || input.opportunityScore < 60) return 0;
  return 0;
}

export function evaluateConnectsStrategy(input: ConnectsStrategyInput): ConnectsStrategySnapshot {
  const rules = loadConnectsRules();
  const sourceBackedConnects = sourceBackedConnectsForJob(input.job);
  const requiredConnects = sourceBackedConnects.requiredConnects;
  const strategyRequiredConnects = requiredConnects;
  const suggestedBoostConnects = requiredConnects === null ? 0 : Math.max(0, Math.floor(input.suggestedBoostConnects ?? 0));
  const totalConnects = requiredConnects === null ? null : requiredConnects + suggestedBoostConnects;
  const clientQuality = input.scoreBreakdown.clientQualityScore.score;
  const opportunity = input.scoreBreakdown.opportunityScore.score;
  const connectsRisk = input.scoreBreakdown.connectsRiskScore.score;
  const redFlags = input.scoreBreakdown.redFlagScore.score;
  const budgetMax = parseBudgetMax(input.job.budget);
  const competition = competitionRisk(input.job);

  const reasons: string[] = [];
  const risks: string[] = [];
  if (requiredConnects !== null && requiredConnects <= rules.idealBoostMin) reasons.push(`Required Connects are reasonable (${requiredConnects}).`);
  if (suggestedBoostConnects > 0) reasons.push(`Suggested boost is conservative (${suggestedBoostConnects}).`);
  if (clientQuality >= 70) reasons.push(`Client quality supports spend (${clientQuality}/100).`);
  if (opportunity >= 70) reasons.push(`Opportunity quality supports spend (${opportunity}/100).`);
  if (budgetMax !== null && (budgetMax >= 1000 || (isHourlyBudget(input.job.budget) && budgetMax >= 40))) {
    reasons.push(`Budget supports Connects spend (${input.job.budget}).`);
  }
  if (competition.reason && competition.level === "low") reasons.push(competition.reason);

  if (requiredConnects === null) risks.push("Required Connects are unknown from visible source text.");
  if (requiredConnects !== null && requiredConnects > rules.maxRequiredPerJob) risks.push(`Required Connects exceed hard cap (${requiredConnects}/${rules.maxRequiredPerJob}).`);
  if (totalConnects !== null && totalConnects > rules.requireApprovalAbove) risks.push(`Total Connects require approval (${totalConnects}/${rules.requireApprovalAbove}).`);
  if (clientQuality < 55) risks.push(`Client quality is weak (${clientQuality}/100).`);
  if (opportunity < 55) risks.push(`Opportunity quality is weak (${opportunity}/100).`);
  if (redFlags < 55) risks.push(`Red-flag score is weak (${redFlags}/100).`);
  if (budgetMax !== null && budgetMax > 0 && !isHourlyBudget(input.job.budget) && budgetMax < 300) risks.push(`Budget is too low for paid Connects risk (${input.job.budget}).`);
  if (competition.reason && competition.level !== "low") risks.push(competition.reason);

  const expectedValueScore = Math.max(0, Math.min(100, Math.round(
    input.score * 0.34 +
      clientQuality * 0.24 +
      opportunity * 0.18 +
      connectsRisk * 0.14 +
      redFlags * 0.1 -
      competition.penalty -
      Math.max(0, (requiredConnects === null ? rules.requireApprovalAbove + 1 : totalConnects ?? 0) - rules.idealBoostMin) * 0.6,
  )));

  if (requiredConnects === null) {
    const decision = expectedValueScore < 48 || (clientQuality < 40 && input.score < 90) ? "skip" : "manual_review";
    return {
      decision,
      requiredConnects: strategyRequiredConnects,
      suggestedBoostConnects: 0,
      totalConnects: strategyRequiredConnects,
      expectedValueScore,
      sourceBackedConnects,
      reasons,
      risks: decision === "skip" ? [...risks, "Expected value is too weak to spend Connects without a source-backed required cost."] : risks,
    };
  }

  if (requiredConnects > rules.maxRequiredPerJob || expectedValueScore < 48 || (clientQuality < 40 && input.score < 90)) {
    return {
      decision: "skip",
      requiredConnects,
      suggestedBoostConnects: 0,
      totalConnects: requiredConnects,
      expectedValueScore,
      sourceBackedConnects,
      reasons,
      risks: [...risks, "Expected value is too weak to spend Connects."],
    };
  }

  if (
    totalConnects !== null && totalConnects > rules.requireApprovalAbove ||
    expectedValueScore < 68 ||
    clientQuality < 60 ||
    opportunity < 60 ||
    competition.level === "high"
  ) {
    return {
      decision: "manual_review",
      requiredConnects,
      suggestedBoostConnects,
      totalConnects,
      expectedValueScore,
      sourceBackedConnects,
      reasons,
      risks,
    };
  }

  return {
    decision: "safe_apply",
    requiredConnects,
    suggestedBoostConnects,
    totalConnects,
    expectedValueScore,
    sourceBackedConnects,
    reasons,
    risks,
  };
}

export function formatConnectsStrategy(strategy: ConnectsStrategySnapshot): string {
  const decision = strategy.decision === "safe_apply" ? "safe to apply" : strategy.decision.replace("_", " ");
  const required = strategy.sourceBackedConnects?.requiredConnects === null ? "unknown" : String(strategy.requiredConnects);
  const total = strategy.sourceBackedConnects?.requiredConnects === null ? "unknown" : String(strategy.totalConnects);
  const riskText = strategy.risks.length > 0 ? ` Watch-outs: ${strategy.risks.join("; ")}` : "";
  return `Connects strategy: ${decision}; required ${required}; boost ${strategy.suggestedBoostConnects}; total ${total}; EV ${strategy.expectedValueScore}/100.${riskText}`;
}
