import { MIN_SCORE_HIGH, MIN_SCORE_TO_NOTIFY } from "./config";
import { loadConnectsRules, loadFreelancerProfile } from "./profile";
import { ConnectsRules, FreelancerProfile, JobPosting, MatchLevel, ScoreBreakdown, ScoreComponent } from "./types";

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

function clamp(score: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(score)));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function includesAny(normalizedText: string, terms: string[]): string[] {
  return terms.filter((term) => term && normalizedText.includes(term.toLowerCase()));
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
    if (maxBudget >= 3000) {
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

  return { score: clamp(score), reasons, risks };
}

function toMatchLevel(finalScore: number, hasHardNegative: boolean): MatchLevel {
  if (hasHardNegative) return "skip";
  if (finalScore >= Math.max(70, MIN_SCORE_HIGH * 10)) return "high";
  if (finalScore >= Math.max(45, MIN_SCORE_TO_NOTIFY * 10)) return "medium";
  if (finalScore >= 30) return "low";
  return "skip";
}

export function scoreJobStructured(job: JobPosting): StructuredScoreResult {
  const profile = loadFreelancerProfile();
  const connectsRules = loadConnectsRules();
  const normalizedText = [job.title, job.description, job.skills.join(" "), job.category, job.sourceQuery].join(" ").toLowerCase();

  const fit = scoreFit(normalizedText, profile);
  const clientQualityScore = scoreClientQuality(job);
  const opportunityScore = scoreOpportunity(job, normalizedText);
  const redFlagScore = scoreRedFlags(normalizedText, fit.negativeKeywords);
  const connectsRiskScore = scoreConnectsRisk(job, connectsRules);

  const finalScore = clamp(
    fit.score * 0.4 +
      clientQualityScore.score * 0.2 +
      opportunityScore.score * 0.18 +
      redFlagScore.score * 0.14 +
      connectsRiskScore.score * 0.08,
  );

  const breakdown: ScoreBreakdown = {
    fitScore: { score: fit.score, reasons: fit.reasons, risks: fit.risks },
    clientQualityScore,
    opportunityScore,
    redFlagScore,
    connectsRiskScore,
    finalScore,
    reasons: unique([
      ...fit.reasons,
      ...clientQualityScore.reasons,
      ...opportunityScore.reasons,
      ...redFlagScore.reasons,
      ...connectsRiskScore.reasons,
    ]).slice(0, 10),
    risks: unique([
      ...fit.risks,
      ...clientQualityScore.risks,
      ...opportunityScore.risks,
      ...redFlagScore.risks,
      ...connectsRiskScore.risks,
    ]).slice(0, 10),
  };

  return {
    score: finalScore,
    matchedKeywords: fit.matchedKeywords,
    negativeKeywords: fit.negativeKeywords,
    matchLevel: toMatchLevel(finalScore, fit.negativeKeywords.length > 0 || redFlagScore.score < 50 || connectsRiskScore.score < 35),
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
