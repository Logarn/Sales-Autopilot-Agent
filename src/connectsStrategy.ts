import { loadConnectsRules } from "./profile";
import type { ConnectsStrategySnapshot, JobPosting, ScoreBreakdown, SourceBackedConnects } from "./types";

interface ConnectsStrategyInput {
  job: JobPosting;
  score: number;
  scoreBreakdown: Pick<ScoreBreakdown, "clientQualityScore" | "opportunityScore" | "connectsRiskScore" | "redFlagScore">;
  suggestedBoostConnects?: number;
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

export function chooseConnectsBoost(input: {
  job: JobPosting;
  score: number;
  clientQualityScore: number;
  opportunityScore: number;
}): number {
  const rules = loadConnectsRules();
  const requiredConnects = sourceBackedConnectsForJob(input.job).requiredConnects;
  if (requiredConnects === null || requiredConnects > rules.requireApprovalAbove) return 0;
  const competition = competitionRisk(input.job);
  if (input.score < 82 || input.clientQualityScore < 60 || input.opportunityScore < 60) return 0;
  if (competition.level === "high" && input.score < 92) return 0;
  return rules.idealBoostMin;
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
