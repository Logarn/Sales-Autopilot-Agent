import { MIN_SCORE_HIGH, MIN_SCORE_TO_NOTIFY } from "./config";
import { chooseConnectsBoost, evaluateConnectsStrategy } from "./connectsStrategy";
import { evaluatePlatformEligibility } from "./platformEligibility";
import { loadConnectsRules, loadFreelancerProfile } from "./profile";
import { ConnectsRules, FreelancerProfile, JobIntelligence, JobPosting, MatchLevel, ScoreBreakdown, ScoreComponent } from "./types";

const HIGH_VALUE_KEYWORDS = [
  "klaviyo",
  "shopify plus",
  "retention marketing",
  "email flows",
  "sms flows",
  "lifecycle marketing",
  "customer retention",
  "win-back",
  "abandoned cart",
  "post-purchase",
  "welcome series",
  "browse abandonment",
  "shopify plus email",
  "welcome series klaviyo",
  "abandoned cart email",
  "post-purchase flow",
  "win-back campaign",
  "klaviyo specialist",
  "klaviyo for shopify",
  "klaviyo shopify email specialist",
  "klaviyo email specialist",
  "klaviyo email flows",
  "klaviyo flows",
];

const MEDIUM_VALUE_KEYWORDS = [
  "shopify",
  "email marketing",
  "sms marketing",
  "email automation",
  "ecommerce email",
  "drip campaign",
  "email sequence",
  "segmentation",
  "campaign management",
  "marketing automation",
  "customer journey",
  "postscript",
  "attentive",
  "omnisend",
  "mailchimp marketing",
  "mailchimp email marketing",
  "shopify marketing",
  "shopify retention marketing",
  "shopify email marketing",
  "email automation shopify",
  "dtc email marketing",
  "ecommerce retention",
  "klaviyo marketing",
];

const LOW_VALUE_KEYWORDS = [
  "ecommerce",
  "email",
  "sms",
  "retention",
  "crm",
  "newsletter",
  "subscriber",
  "opt-in",
  "deliverability",
  "a/b testing",
];

const NEGATIVE_KEYWORDS = [
  "wordpress",
  "wix",
  "squarespace",
  "hubspot only",
  "salesforce only",
  "full-time",
  "w2",
  "on-site",
  "in-office",
];

export interface KeywordConfig {
  high: string[];
  medium: string[];
  low: string[];
  negative: string[];
}

export interface StructuredScoreResult {
  score: number;
  matchedKeywords: string[];
  negativeKeywords: string[];
  matchLevel: MatchLevel;
  scoreBreakdown: ScoreBreakdown;
}

interface IntelligenceScoreAdjustment {
  fitDelta: number;
  opportunityDelta: number;
  redFlagDelta: number;
  connectsDelta: number;
  finalDelta: number;
  hardNegative: boolean;
  matchedKeywords: string[];
  negativeKeywords: string[];
  reasons: string[];
  risks: string[];
}

function clamp(score: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(score)));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function includesAny(normalizedText: string, terms: string[]): string[] {
  return terms.filter((term) => term && normalizedText.includes(term.toLowerCase()));
}

function intelligenceText(intelligence: JobIntelligence): string {
  const platformsMentioned = Array.isArray(intelligence.platformsMentioned) ? intelligence.platformsMentioned : [];
  const requiredSkills = Array.isArray(intelligence.requiredSkills) ? intelligence.requiredSkills : [];
  const redFlags = Array.isArray(intelligence.redFlags) ? intelligence.redFlags : [];
  const proofRecommendations = Array.isArray(intelligence.proofRecommendations) ? intelligence.proofRecommendations : [];
  const draftConstraints = Array.isArray(intelligence.draftConstraints) ? intelligence.draftConstraints : [];
  const platformMismatchWarnings = Array.isArray(intelligence.platformMismatchWarnings) ? intelligence.platformMismatchWarnings : [];
  return [
    intelligence.primaryPlatform,
    platformsMentioned.join(" "),
    intelligence.businessType,
    intelligence.ecommerceVertical,
    intelligence.jobCategory,
    intelligence.taskType,
    requiredSkills.join(" "),
    intelligence.clientGoal,
    redFlags.join(" "),
    intelligence.fitScoreReasoning,
    intelligence.proposalAngle,
    proofRecommendations.join(" "),
    draftConstraints.join(" "),
    platformMismatchWarnings.join(" "),
  ].join(" ").toLowerCase();
}

function hasMeaningfulValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && !["unknown", "not specified", "n/a", "none", "general"].includes(normalized);
}

function isDtcEcommerceVertical(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return Boolean(normalized) && !["unknown", "saas", "n/a", "none"].includes(normalized);
}

function hasStrongDtcLifecycleSignals(normalizedText: string, intelligence: JobIntelligence): boolean {
  const ecommerceSignals = [
    "dtc",
    "d2c",
    "ecommerce",
    "e-commerce",
    "shopify",
    "woocommerce",
    "bigcommerce",
    "magento",
    "beauty",
    "skincare",
    "fashion",
    "supplements",
    "food",
    "home",
  ];
  const lifecycleSignals = [
    "klaviyo",
    "retention",
    "lifecycle",
    "email",
    "sms",
    "flow",
    "flows",
    "automation",
    "campaign",
    "segmentation",
    "win-back",
    "abandoned cart",
    "post-purchase",
    "welcome series",
  ];
  const ecommerceFit =
    isDtcEcommerceVertical(intelligence.ecommerceVertical) ||
    ecommerceSignals.some((term) => normalizedText.includes(term));
  const lifecycleFit = lifecycleSignals.some((term) => normalizedText.includes(term));
  return ecommerceFit && lifecycleFit;
}

function hasClearScope(intelligence: JobIntelligence, normalizedText: string): boolean {
  if (hasMeaningfulValue(intelligence.taskType) && hasMeaningfulValue(intelligence.clientGoal)) {
    return true;
  }
  return [
    "audit",
    "flows",
    "flow",
    "campaign",
    "lifecycle",
    "retention",
    "segmentation",
    "sms",
    "email automation",
    "migration",
    "setup",
    "strategy",
  ].some((term) => normalizedText.includes(term));
}

function buildIntelligenceAdjustment(
  intelligence: JobIntelligence | null | undefined,
  baseText: string,
): IntelligenceScoreAdjustment {
  const empty: IntelligenceScoreAdjustment = {
    fitDelta: 0,
    opportunityDelta: 0,
    redFlagDelta: 0,
    connectsDelta: 0,
    finalDelta: 0,
    hardNegative: false,
    matchedKeywords: [],
    negativeKeywords: [],
    reasons: [],
    risks: [],
  };
  if (!intelligence) return empty;

  const normalizedText = `${baseText} ${intelligenceText(intelligence)}`.toLowerCase();
  const eligibility = evaluatePlatformEligibility(intelligence);
  const adjustment: IntelligenceScoreAdjustment = { ...empty };
  const strongDtcLifecycle = hasStrongDtcLifecycleSignals(normalizedText, intelligence);
  const clearScope = hasClearScope(intelligence, normalizedText);
  const nonCorePlatform = intelligence.platformPreferenceTier === "non_core_review";

  if (eligibility.platformEligibility === "eligible") {
    adjustment.fitDelta += intelligence.platformPreferenceTier === "core" ? 12 : 8;
    adjustment.reasons.push(`Job intelligence: approved platform${eligibility.approvedPlatformMatched ? ` (${eligibility.approvedPlatformMatched})` : ""}.`);
    if (eligibility.approvedPlatformMatched) adjustment.matchedKeywords.push(eligibility.approvedPlatformMatched);
  } else if (eligibility.platformEligibility === "manual_review") {
    adjustment.risks.push(`Job intelligence: ${eligibility.eligibilityReason}`);
    adjustment.redFlagDelta -= 4;
    if (strongDtcLifecycle) {
      adjustment.fitDelta += 5;
      adjustment.reasons.push("Job intelligence: platform unknown, but DTC lifecycle/email context is strong enough for manual review.");
    }
  } else {
    adjustment.fitDelta -= 35;
    adjustment.opportunityDelta -= 15;
    adjustment.redFlagDelta -= 35;
    adjustment.finalDelta -= 18;
    adjustment.hardNegative = true;
    adjustment.risks.push(`Job intelligence: ${eligibility.eligibilityReason}`);
    if (intelligence.primaryPlatform) adjustment.negativeKeywords.push(intelligence.primaryPlatform.toLowerCase());
  }

  if (strongDtcLifecycle) {
    adjustment.fitDelta += 12;
    adjustment.opportunityDelta += 6;
    adjustment.reasons.push("Job intelligence: strong DTC/ecommerce lifecycle context.");
    adjustment.matchedKeywords.push("dtc lifecycle", "ecommerce retention");
  }

  if (clearScope) {
    adjustment.opportunityDelta += 5;
    adjustment.reasons.push("Job intelligence: scope and client goal are clear.");
  } else {
    adjustment.opportunityDelta -= 12;
    adjustment.redFlagDelta -= 10;
    adjustment.risks.push("Job intelligence: vague or unclear scope.");
  }

  if (nonCorePlatform && !strongDtcLifecycle) {
    adjustment.fitDelta -= 18;
    adjustment.opportunityDelta -= 10;
    adjustment.redFlagDelta -= 12;
    adjustment.risks.push("Job intelligence: non-core platform without strong DTC lifecycle fit.");
  }

  if (/hubspot/i.test(intelligence.primaryPlatform) && !strongDtcLifecycle) {
    adjustment.fitDelta -= 12;
    adjustment.redFlagDelta -= 10;
    adjustment.hardNegative = true;
    adjustment.risks.push("Job intelligence: HubSpot/non-ecommerce work is outside the preferred lead lane.");
  }

  if (intelligence.shouldSkipForPlatform) {
    adjustment.fitDelta -= 25;
    adjustment.redFlagDelta -= 20;
    adjustment.finalDelta -= 15;
    adjustment.hardNegative = true;
    adjustment.risks.push(`Job intelligence: ${intelligence.skipReason || "platform parser marked this lead as a skip."}`);
  }

  if (intelligence.needsManualReview) {
    adjustment.risks.push("Job intelligence: manual review required before draft prep.");
    adjustment.finalDelta -= strongDtcLifecycle ? 0 : 5;
  }

  if (intelligence.confidence === "low") {
    adjustment.risks.push("Job intelligence: low-confidence parser result.");
    adjustment.finalDelta -= 3;
  }

  const intelligenceRedFlags = [
    ...(Array.isArray(intelligence.redFlags) ? intelligence.redFlags : []),
    ...(Array.isArray(intelligence.platformMismatchWarnings) ? intelligence.platformMismatchWarnings : []),
  ].filter(Boolean);
  if (intelligenceRedFlags.length > 0) {
    adjustment.redFlagDelta -= Math.min(45, intelligenceRedFlags.length * 10);
    adjustment.risks.push(...intelligenceRedFlags.map((flag) => `Job intelligence red flag: ${flag}`));
    adjustment.negativeKeywords.push(...intelligenceRedFlags.map((flag) => flag.toLowerCase()).slice(0, 4));
  }

  return adjustment;
}

function scoreFit(normalizedText: string, profile: FreelancerProfile): ScoreComponent & { matchedKeywords: string[]; negativeKeywords: string[] } {
  const matchedHigh = includesAny(normalizedText, HIGH_VALUE_KEYWORDS);
  const matchedMedium = includesAny(normalizedText, MEDIUM_VALUE_KEYWORDS);
  const matchedLow = includesAny(normalizedText, LOW_VALUE_KEYWORDS);
  const matchedSkills = includesAny(normalizedText, profile.skills ?? []);
  const matchedIndustries = includesAny(normalizedText, profile.preferredIndustries ?? []);
  const matchedJobTypes = includesAny(normalizedText, profile.preferredJobTypes ?? []);
  const negativeKeywords = unique([
    ...includesAny(normalizedText, NEGATIVE_KEYWORDS),
    ...includesAny(normalizedText, profile.avoidIndustries ?? []),
    ...includesAny(normalizedText, profile.avoidJobTypes ?? []),
  ]);

  const score = clamp(
    20 +
      matchedHigh.length * 9 +
      matchedMedium.length * 5 +
      matchedLow.length * 2 +
      Math.min(matchedSkills.length * 3, 18) +
      Math.min(matchedIndustries.length * 4, 12) +
      Math.min(matchedJobTypes.length * 5, 15) -
      negativeKeywords.length * 18,
  );

  const reasons = [
    ...matchedHigh.slice(0, 4).map((keyword) => `Strong keyword match: ${keyword}`),
    ...matchedMedium.slice(0, 3).map((keyword) => `Relevant keyword match: ${keyword}`),
    ...matchedSkills.slice(0, 3).map((skill) => `Profile skill match: ${skill}`),
    ...matchedIndustries.slice(0, 2).map((industry) => `Preferred industry: ${industry}`),
    ...matchedJobTypes.slice(0, 2).map((jobType) => `Preferred job type: ${jobType}`),
  ];

  return {
    score,
    reasons: unique(reasons),
    risks: negativeKeywords.map((keyword) => `Avoid/negative match: ${keyword}`),
    matchedKeywords: unique([...matchedHigh, ...matchedMedium, ...matchedLow, ...matchedSkills, ...matchedIndustries, ...matchedJobTypes]),
    negativeKeywords,
  };
}

function scoreClientQuality(job: JobPosting): ScoreComponent {
  const reasons: string[] = [];
  const risks: string[] = [];
  let score = 45;

  if (job.clientRating >= 4.8 && job.clientFeedbackCount >= 5) {
    score += 25;
    reasons.push(`Strong client rating (${job.clientRating.toFixed(1)})`);
  } else if (job.clientRating >= 4.5) {
    score += 15;
    reasons.push(`Good client rating (${job.clientRating.toFixed(1)})`);
  } else if (job.clientRating > 0 && job.clientRating < 4.2) {
    score -= 18;
    risks.push(`Low client rating (${job.clientRating.toFixed(1)})`);
  } else if (job.clientFeedbackCount === 0) {
    score -= 5;
    risks.push("No client feedback yet");
  }

  if (job.clientSpend >= 10000) {
    score += 20;
    reasons.push(`Proven spend: $${job.clientSpend.toLocaleString()}`);
  } else if (job.clientSpend >= 1000) {
    score += 10;
    reasons.push(`Some spend history: $${job.clientSpend.toLocaleString()}`);
  } else if (job.clientSpend === 0) {
    score -= 8;
    risks.push("No recorded client spend");
  }

  if (job.clientHireRate >= 70) {
    score += 10;
    reasons.push(`High hire rate (${job.clientHireRate}%)`);
  } else if (job.clientHireRate > 0 && job.clientHireRate < 35) {
    score -= 12;
    risks.push(`Low hire rate (${job.clientHireRate}%)`);
  }

  if (job.clientTotalHires >= 10) {
    score += 5;
    reasons.push(`${job.clientTotalHires} prior hires`);
  }

  return { score: clamp(score), reasons, risks };
}

function scoreOpportunity(job: JobPosting, normalizedText: string): ScoreComponent {
  const reasons: string[] = [];
  const risks: string[] = [];
  let score = 50;

  if (job.budget) {
    const budgetNumbers = job.budget.match(/\d+(?:,\d{3})*/g)?.map((value) => Number(value.replace(/,/g, ""))) ?? [];
    const maxBudget = Math.max(0, ...budgetNumbers);
    const hourlyBudget = /\/\s*hr|hourly|per hour/i.test(job.budget);
    if (hourlyBudget && maxBudget >= 50) {
      score += 14;
      reasons.push(`Strong hourly budget signal (${job.budget})`);
    } else if (hourlyBudget && maxBudget >= 35) {
      score += 8;
      reasons.push(`Solid hourly budget signal (${job.budget})`);
    } else if (maxBudget >= 3000) {
      score += 20;
      reasons.push(`High budget signal (${job.budget})`);
    } else if (maxBudget >= 1000) {
      score += 12;
      reasons.push(`Solid budget signal (${job.budget})`);
    } else if (maxBudget > 0 && maxBudget < 300) {
      score -= 12;
      risks.push(`Low budget signal (${job.budget})`);
    }
  }

  if (normalizedText.includes("urgent") || normalizedText.includes("asap") || normalizedText.includes("immediately")) {
    score += 8;
    reasons.push("Timing urgency may favor fast response");
  }

  if (normalizedText.includes("expert") || normalizedText.includes("specialist") || normalizedText.includes("audit") || normalizedText.includes("strategy")) {
    score += 10;
    reasons.push("Job asks for expert/specialist work");
  }

  if (normalizedText.includes("entry level") || normalizedText.includes("cheap") || normalizedText.includes("simple task")) {
    score -= 15;
    risks.push("Commodity/low-complexity language");
  }

  if (job.experienceLevel.toLowerCase().includes("expert")) {
    score += 10;
    reasons.push("Expert experience level requested");
  } else if (job.experienceLevel.toLowerCase().includes("entry")) {
    score -= 10;
    risks.push("Entry-level opportunity");
  }

  return { score: clamp(score), reasons, risks };
}

function scoreRedFlags(normalizedText: string, negativeKeywords: string[]): ScoreComponent {
  const risks = [...negativeKeywords.map((keyword) => `Negative keyword: ${keyword}`)];
  let penalty = negativeKeywords.length * 20;

  const extraFlags = ["free trial", "commission only", "equity only", "no agencies", "24/7", "rockstar", "guru"];
  for (const flag of extraFlags) {
    if (normalizedText.includes(flag)) {
      penalty += 12;
      risks.push(`Red-flag phrase: ${flag}`);
    }
  }

  const score = clamp(100 - penalty);
  return {
    score,
    reasons: score >= 85 ? ["Few red flags detected"] : [],
    risks: unique(risks),
  };
}

function scoreConnectsRisk(job: JobPosting, rules: ConnectsRules): ScoreComponent {
  const reasons: string[] = [];
  const risks: string[] = [];
  let score = 85;

  if (job.connectsCost <= 0) {
    reasons.push("No Connects cost detected");
  } else if (job.connectsCost <= rules.idealBoostMin) {
    reasons.push(`Low Connects cost (${job.connectsCost})`);
  } else if (job.connectsCost <= rules.maxRequiredPerJob) {
    score -= Math.max(0, job.connectsCost - rules.idealBoostMin);
    reasons.push(`Connects cost within configured cap (${job.connectsCost}/${rules.maxRequiredPerJob})`);
  } else {
    score -= 45;
    risks.push(`Connects cost exceeds cap (${job.connectsCost}/${rules.maxRequiredPerJob})`);
  }

  if (job.connectsCost > rules.requireApprovalAbove) {
    score -= 15;
    risks.push(`Requires approval above ${rules.requireApprovalAbove} Connects`);
  }

  if (rules.neverBidMax && job.connectsCost >= rules.maxBoost) {
    score -= 20;
    risks.push("At or above max boost threshold; do not auto-bid max");
  }

  if ((job.proposalCount ?? 0) >= 50) {
    score -= 20;
    risks.push(`High competition: ${job.proposalCount} proposals already`);
  } else if ((job.proposalCount ?? 0) >= 20) {
    score -= 10;
    risks.push(`Moderate competition: ${job.proposalCount} proposals already`);
  }

  return { score: clamp(score), reasons, risks };
}

function toMatchLevel(finalScore: number, hasHardNegative: boolean): MatchLevel {
  if (hasHardNegative) return "skip";
  if (finalScore >= Math.max(70, MIN_SCORE_HIGH * 10)) return "high";
  if (finalScore >= Math.max(45, MIN_SCORE_TO_NOTIFY * 10)) return "medium";
  if (finalScore >= 30) return "low";
  return "skip";
}

export function scoreJobStructured(job: JobPosting, intelligence?: JobIntelligence | null): StructuredScoreResult {
  const profile = loadFreelancerProfile();
  const connectsRules = loadConnectsRules();
  const normalizedText = [job.title, job.description, job.skills.join(" "), job.category, job.sourceQuery].join(" ").toLowerCase();

  const fit = scoreFit(normalizedText, profile);
  const clientQualityScore = scoreClientQuality(job);
  const opportunityScore = scoreOpportunity(job, normalizedText);
  const redFlagScore = scoreRedFlags(normalizedText, fit.negativeKeywords);
  const connectsRiskScore = scoreConnectsRisk(job, connectsRules);
  const intelligenceAdjustment = buildIntelligenceAdjustment(intelligence, normalizedText);
  const adjustedFitScore: ScoreComponent = {
    score: clamp(fit.score + intelligenceAdjustment.fitDelta),
    reasons: unique([...fit.reasons, ...intelligenceAdjustment.reasons]),
    risks: unique([...fit.risks, ...intelligenceAdjustment.risks.filter((risk) => !risk.startsWith("Job intelligence red flag:"))]),
  };
  const adjustedOpportunityScore: ScoreComponent = {
    score: clamp(opportunityScore.score + intelligenceAdjustment.opportunityDelta),
    reasons: unique([...opportunityScore.reasons, ...intelligenceAdjustment.reasons.filter((reason) => /scope|client goal|DTC|ecommerce/i.test(reason))]),
    risks: unique([...opportunityScore.risks, ...intelligenceAdjustment.risks.filter((risk) => /scope|non-core/i.test(risk))]),
  };
  const adjustedRedFlagScore: ScoreComponent = {
    score: clamp(redFlagScore.score + intelligenceAdjustment.redFlagDelta),
    reasons: redFlagScore.reasons,
    risks: unique([...redFlagScore.risks, ...intelligenceAdjustment.risks]),
  };
  const adjustedConnectsRiskScore: ScoreComponent = {
    score: clamp(connectsRiskScore.score + intelligenceAdjustment.connectsDelta),
    reasons: connectsRiskScore.reasons,
    risks: connectsRiskScore.risks,
  };

  const finalScore = clamp(
    adjustedFitScore.score * 0.4 +
      clientQualityScore.score * 0.2 +
      adjustedOpportunityScore.score * 0.18 +
      adjustedRedFlagScore.score * 0.14 +
      adjustedConnectsRiskScore.score * 0.08 +
      intelligenceAdjustment.finalDelta,
  );
  const suggestedBoostConnects = chooseConnectsBoost({
    job,
    score: finalScore,
    clientQualityScore: clientQualityScore.score,
    opportunityScore: adjustedOpportunityScore.score,
  });
  const connectsStrategy = evaluateConnectsStrategy({
    job,
    score: finalScore,
    scoreBreakdown: {
      clientQualityScore,
      opportunityScore: adjustedOpportunityScore,
      connectsRiskScore: adjustedConnectsRiskScore,
      redFlagScore: adjustedRedFlagScore,
    },
    suggestedBoostConnects,
  });

  const breakdown: ScoreBreakdown = {
    fitScore: adjustedFitScore,
    clientQualityScore,
    opportunityScore: adjustedOpportunityScore,
    redFlagScore: adjustedRedFlagScore,
    connectsRiskScore: adjustedConnectsRiskScore,
    finalScore,
    reasons: unique([
      ...adjustedFitScore.reasons,
      ...clientQualityScore.reasons,
      ...adjustedOpportunityScore.reasons,
      ...adjustedRedFlagScore.reasons,
      ...adjustedConnectsRiskScore.reasons,
    ]).slice(0, 10),
    risks: unique([
      ...adjustedFitScore.risks,
      ...clientQualityScore.risks,
      ...adjustedOpportunityScore.risks,
      ...adjustedRedFlagScore.risks,
      ...adjustedConnectsRiskScore.risks,
    ]).slice(0, 10),
    connectsStrategy,
  };

  return {
    score: finalScore,
    matchedKeywords: unique([...fit.matchedKeywords, ...intelligenceAdjustment.matchedKeywords]),
    negativeKeywords: unique([...fit.negativeKeywords, ...intelligenceAdjustment.negativeKeywords]),
    matchLevel: toMatchLevel(
      finalScore,
      intelligenceAdjustment.hardNegative ||
        fit.negativeKeywords.length > 0 ||
        adjustedRedFlagScore.score < 50 ||
        adjustedConnectsRiskScore.score < 35,
    ),
    scoreBreakdown: breakdown,
  };
}

export function getKeywordConfig(): KeywordConfig {
  return {
    high: HIGH_VALUE_KEYWORDS,
    medium: MEDIUM_VALUE_KEYWORDS,
    low: LOW_VALUE_KEYWORDS,
    negative: NEGATIVE_KEYWORDS,
  };
}
