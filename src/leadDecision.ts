import { hasUnknownRequiredConnects } from "./connectsStrategy";
import { evaluatePlatformEligibility, type PlatformEligibility } from "./platformEligibility";
import { loadFreelancerProfile } from "./profile";
import type { FreelancerProfile, JobIntelligence, ScoredJob } from "./types";

export type LeadDecisionType = "post_to_slack" | "skip" | "manual_review";

export interface LeadDecisionResult {
  decision: LeadDecisionType;
  reason: string;
  scoreUsed: number;
  platformEligibility: PlatformEligibility;
  shouldPostToSlack: boolean;
  shouldAutoPrepare: boolean;
  watchOuts: string[];
  internalSkipReason?: string;
}

interface FreelancerProfileRequirementAssessment {
  decision: "pass" | "manual_review" | "skip";
  reason?: string;
  watchOut?: string;
}

function parseMoneyAmount(raw: string | null | undefined, suffix: string | null | undefined): number | null {
  const numeric = Number.parseFloat(String(raw ?? "").replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const normalizedSuffix = String(suffix ?? "").trim().toLowerCase();
  if (normalizedSuffix === "k") return numeric * 1000;
  if (normalizedSuffix === "m") return numeric * 1000000;
  return numeric;
}

function formatUsd(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

function parseProfileUpworkEarnings(profile: FreelancerProfile): number {
  const value = profile.upwork?.totalEarnings;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  const match = String(value ?? "").match(/([0-9][0-9,]*(?:\.\d+)?)\s*([km])?/i);
  return parseMoneyAmount(match?.[1], match?.[2]) ?? 0;
}

function findMinimumUpworkEarningsRequirement(job: ScoredJob): number | null {
  const source = `${job.title}\n${job.description}\n${(job.skills || []).join("\n")}`;
  const patterns = [
    /\b(?:must|need|needs|requires?|requirement|looking for|only)\b[^.\n]{0,140}?\b(?:earned|earnings?|made)\b[^.\n]{0,120}?\b(?:on|in)\s+upwork\b[^.\n]{0,40}?\$?\s*([0-9][0-9,]*(?:\.\d+)?)\s*([km])?/i,
    /\b(?:earned|earnings?|made)\b[^.\n]{0,80}?(?:at least|minimum|over|above|more than)?[^0-9$]{0,20}?\$?\s*([0-9][0-9,]*(?:\.\d+)?)\s*([km])?\+?[^.\n]{0,120}?\b(?:on|in)\s+upwork\b/i,
    /\bupwork\b[^.\n]{0,120}?\b(?:earned|earnings?|made)\b[^.\n]{0,80}?(?:at least|minimum|over|above|more than)?[^0-9$]{0,20}?\$?\s*([0-9][0-9,]*(?:\.\d+)?)\s*([km])?/i,
    /\bminimum\b[^.\n]{0,30}?\$?\s*([0-9][0-9,]*(?:\.\d+)?)\s*([km])?[^.\n]{0,60}?\b(?:earned|earnings?)\b[^.\n]{0,60}?\bupwork\b/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const amount = parseMoneyAmount(match?.[1], match?.[2]);
    if (amount !== null) return amount;
  }
  return null;
}

function assessFreelancerProfileRequirements(job: ScoredJob, profile: FreelancerProfile): FreelancerProfileRequirementAssessment {
  const requiredUpworkEarnings = findMinimumUpworkEarningsRequirement(job);
  if (!requiredUpworkEarnings) return { decision: "pass" };
  const currentUpworkEarnings = parseProfileUpworkEarnings(profile);
  if (currentUpworkEarnings >= requiredUpworkEarnings) return { decision: "pass" };

  const closeEnoughFloor = Math.min(5000, requiredUpworkEarnings * 0.5);
  const watchOut = `Job asks for ${formatUsd(requiredUpworkEarnings)}+ earned on Upwork; profile shows about ${formatUsd(currentUpworkEarnings)}.`;
  if (currentUpworkEarnings < closeEnoughFloor) {
    return {
      decision: "skip",
      reason: "Explicit Upwork earnings requirement is far above the current profile.",
      watchOut,
    };
  }
  return {
    decision: "manual_review",
    reason: "Job asks for higher Upwork earnings than the current profile; keep it human-reviewed only.",
    watchOut,
  };
}

function isDtcEcommerceVertical(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return Boolean(normalized) && !["unknown", "saas", "n/a", "none"].includes(normalized);
}

function hasStrongDtcSignals(job: ScoredJob, intelligence?: JobIntelligence | null): boolean {
  const requiredSkills = intelligence && Array.isArray(intelligence.requiredSkills) ? intelligence.requiredSkills : [];
  const text = `${job.title} ${job.description} ${(job.skills || []).join(" ")} ${intelligence?.taskType ?? ""} ${intelligence?.businessType ?? ""} ${intelligence?.clientGoal ?? ""} ${requiredSkills.join(" ")}`.toLowerCase();
  const commerceTerms = ["dtc", "d2c", "ecommerce", "e-commerce", "shopify", "woocommerce", "bigcommerce", "beauty", "skincare", "fashion", "supplements", "food", "home"];
  const lifecycleTerms = ["retention", "lifecycle", "email", "sms", "flow", "flows", "automation", "campaign", "segmentation", "klaviyo", "attentive", "postscript", "omnisend", "mailchimp", "mailerlite"];
  const commerceFit = intelligence && isDtcEcommerceVertical(intelligence.ecommerceVertical)
    ? true
    : commerceTerms.some((term) => text.includes(term));
  const lifecycleFit = lifecycleTerms.some((term) => text.includes(term));
  return commerceFit && lifecycleFit;
}

function hasMajorRedFlags(job: ScoredJob, intelligence?: JobIntelligence | null): boolean {
  const redFlagScore = job.scoreBreakdown?.redFlagScore?.score ?? 100;
  const risks = [
    ...(job.scoreBreakdown?.risks ?? []),
    ...(job.applicationDraft?.redFlags ?? []),
    ...(intelligence && Array.isArray(intelligence.redFlags) ? intelligence.redFlags : []),
    ...(intelligence && Array.isArray(intelligence.platformMismatchWarnings) ? intelligence.platformMismatchWarnings : []),
  ].map((value) => value.toLowerCase());
  const majorTerms = ["scam", "commission only", "free trial", "equity only", "full-time", "full time", "on-site", "onsite", "w2", "verification", "blocked", "captcha", "account access"];
  return redFlagScore < 40 || Boolean(intelligence?.shouldSkipForPlatform) || risks.some((risk) => majorTerms.some((term) => risk.includes(term)));
}

function parseBudgetMax(job: ScoredJob): number | null {
  const values = job.budget.match(/\d+(?:,\d{3})*(?:\.\d+)?/g)?.map((value) => Number(value.replace(/,/g, ""))) ?? [];
  if (values.length === 0) return null;
  return Math.max(...values);
}

function ageHours(job: ScoredJob, now = new Date()): number | null {
  const postedAt = new Date(job.postedAt).getTime();
  if (!Number.isFinite(postedAt)) return null;
  return Math.max(0, (now.getTime() - postedAt) / (60 * 60 * 1000));
}

function hasScopeClarity(job: ScoredJob, intelligence?: JobIntelligence | null): boolean {
  const task = intelligence?.taskType?.trim().toLowerCase() ?? "";
  const goal = intelligence?.clientGoal?.trim().toLowerCase() ?? "";
  if (task && goal && !["unknown", "not specified", "general", "n/a"].includes(task) && !["unknown", "not specified", "general", "n/a"].includes(goal)) {
    return true;
  }
  const text = `${job.title} ${job.description} ${(job.skills || []).join(" ")}`.toLowerCase();
  return ["audit", "flow", "flows", "campaign", "automation", "segmentation", "retention", "lifecycle", "sms", "email", "migration", "strategy", "setup"].some((term) => text.includes(term));
}

function watchOutsForLead(job: ScoredJob, intelligence?: JobIntelligence | null): string[] {
  const watchOuts = [
    ...(job.scoreBreakdown?.risks ?? []),
    ...(job.applicationDraft?.redFlags ?? []),
    ...(intelligence && Array.isArray(intelligence.redFlags) ? intelligence.redFlags : []),
    ...(intelligence && Array.isArray(intelligence.platformMismatchWarnings) ? intelligence.platformMismatchWarnings : []),
  ];
  const budgetMax = parseBudgetMax(job);
  const postedAgeHours = ageHours(job);
  if (budgetMax !== null && budgetMax > 0 && budgetMax < 300) {
    watchOuts.push(`Low budget signal (${job.budget})`);
  }
  if (postedAgeHours !== null && postedAgeHours > 72) {
    watchOuts.push(`Older posting (${Math.round(postedAgeHours)}h old)`);
  }
  if (!hasScopeClarity(job, intelligence)) {
    watchOuts.push("Unclear scope/client goal");
  }
  if (job.clientSpend <= 0) {
    watchOuts.push("No client spend recorded");
  } else if (job.clientSpend < 500) {
    watchOuts.push(`Low client spend ($${Math.round(job.clientSpend)})`);
  }
  if (job.clientTotalHires <= 0) {
    watchOuts.push("No prior client hires recorded");
  }
  if (job.clientFeedbackCount <= 0) {
    watchOuts.push("No client feedback history");
  }
  if (job.clientHireRate > 0 && job.clientHireRate < 35) {
    watchOuts.push(`Low client hire rate (${Math.round(job.clientHireRate)}%)`);
  }
  if (job.clientRating > 0 && job.clientRating < 4.2) {
    watchOuts.push(`Low client rating (${job.clientRating.toFixed(1)})`);
  }
  return Array.from(new Set(watchOuts));
}

function isBudgetTooWeak(job: ScoredJob): boolean {
  if (/\/\s*hr|hourly|per hour/i.test(job.budget)) {
    const hourlyMax = parseBudgetMax(job);
    return hourlyMax !== null && hourlyMax > 0 && hourlyMax < 20;
  }
  const budgetMax = parseBudgetMax(job);
  return budgetMax !== null && budgetMax > 0 && budgetMax < 250;
}

function isStale(job: ScoredJob): boolean {
  const postedAgeHours = ageHours(job);
  return postedAgeHours !== null && postedAgeHours > 168;
}

function hasVeryWeakClientHistory(job: ScoredJob): boolean {
  return job.clientSpend <= 0 && job.clientTotalHires <= 0 && job.clientFeedbackCount <= 0;
}

function hasExplicitPoorClientSignal(job: ScoredJob): boolean {
  const risks = job.scoreBreakdown?.clientQualityScore?.risks.map((risk) => risk.toLowerCase()) ?? [];
  return (
    (job.clientRating > 0 && job.clientRating < 4.2) ||
    (job.clientHireRate > 0 && job.clientHireRate < 35) ||
    risks.some((risk) => risk.includes("low client rating") || risk.includes("low hire rate"))
  );
}

function hasMissingOnlyClientHistory(job: ScoredJob): boolean {
  return hasVeryWeakClientHistory(job) && job.clientRating <= 0 && job.clientHireRate <= 0 && !hasExplicitPoorClientSignal(job);
}

export function decideLeadHandling(job: ScoredJob, intelligence?: JobIntelligence | null): LeadDecisionResult {
  const eligibility = evaluatePlatformEligibility(intelligence);
  const profile = loadFreelancerProfile();
  const profileRequirement = assessFreelancerProfileRequirements(job, profile);
  const watchOuts = Array.from(new Set([
    ...watchOutsForLead(job, intelligence),
    ...(profileRequirement.watchOut ? [profileRequirement.watchOut] : []),
  ]));
  const strongSignals = hasStrongDtcSignals(job, intelligence);
  const scopeClear = hasScopeClarity(job, intelligence);
  const clientQuality = job.scoreBreakdown?.clientQualityScore?.score ?? 50;
  const missingOnlyClientHistory = hasMissingOnlyClientHistory(job);
  const connectsStrategy = job.applicationDraft?.connectsStrategy ?? job.scoreBreakdown?.connectsStrategy;
  const connectsRequiredUnknown = hasUnknownRequiredConnects(connectsStrategy);
  const platformEligible = eligibility.platformEligibility === "eligible";
  const weakBudget = isBudgetTooWeak(job);
  const stale = isStale(job);

  if (eligibility.platformEligibility === "ineligible") {
    return {
      decision: "skip",
      reason: "Platform is currently unapproved.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: false,
      shouldAutoPrepare: false,
      watchOuts,
      internalSkipReason: eligibility.eligibilityReason,
    };
  }

  if (hasMajorRedFlags(job, intelligence)) {
    return {
      decision: "skip",
      reason: "Major red flags detected.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: false,
      shouldAutoPrepare: false,
      watchOuts,
      internalSkipReason: "major_red_flags",
    };
  }

  if (profileRequirement.decision === "skip") {
    return {
      decision: "skip",
      reason: profileRequirement.reason ?? "Explicit freelancer-profile requirement is too far above the current profile.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: false,
      shouldAutoPrepare: false,
      watchOuts,
      internalSkipReason: "freelancer_profile_requirement",
    };
  }

  if (profileRequirement.decision === "manual_review") {
    return {
      decision: "manual_review",
      reason: profileRequirement.reason ?? "Explicit freelancer-profile requirement needs human review.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: true,
      shouldAutoPrepare: false,
      watchOuts,
    };
  }

  if (stale && job.score < 82) {
    return {
      decision: "skip",
      reason: "Posting is stale and not strong enough to justify Slack review.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: false,
      shouldAutoPrepare: false,
      watchOuts,
      internalSkipReason: "stale_weak_lead",
    };
  }

  if (job.score < 58) {
    return {
      decision: "skip",
      reason: "Fit score is below lead threshold.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: false,
      shouldAutoPrepare: false,
      watchOuts,
      internalSkipReason: "low_score",
    };
  }

  if (eligibility.platformEligibility === "manual_review") {
    if (strongSignals && job.score >= 60 && scopeClear && !weakBudget) {
      return {
        decision: "manual_review",
        reason: "Platform needs manual review, but DTC lifecycle/email context is strong.",
        scoreUsed: job.score,
        platformEligibility: eligibility.platformEligibility,
        shouldPostToSlack: true,
        shouldAutoPrepare: false,
        watchOuts,
      };
    }
    return {
      decision: "skip",
      reason: "Platform unknown with weak or unclear DTC/retention signals.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: false,
      shouldAutoPrepare: false,
      watchOuts,
      internalSkipReason: "unknown_platform_weak_signals",
    };
  }

  if (weakBudget && job.score < 82) {
    return {
      decision: "skip",
      reason: "Budget is too weak for Slack lead quality threshold.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: false,
      shouldAutoPrepare: false,
      watchOuts,
      internalSkipReason: "weak_budget",
    };
  }

  if (connectsStrategy?.decision === "skip" && !connectsRequiredUnknown) {
    return {
      decision: "skip",
      reason: "Connects strategy says expected value is too weak.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: false,
      shouldAutoPrepare: false,
      watchOuts: [...watchOuts, ...connectsStrategy.risks],
      internalSkipReason: "connects_strategy_skip",
    };
  }

  const weakClientQualityHardBlock =
    (clientQuality < 35 && !missingOnlyClientHistory) ||
    (hasVeryWeakClientHistory(job) && !missingOnlyClientHistory);
  if (weakClientQualityHardBlock && job.score < 88) {
    return {
      decision: "skip",
      reason: "Client quality signals are too weak for Slack lead review.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: false,
      shouldAutoPrepare: false,
      watchOuts,
      internalSkipReason: "weak_client_quality",
    };
  }

  if (!strongSignals && job.score < 78) {
    return {
      decision: "skip",
      reason: "Approved platform found, but DTC/ecommerce lifecycle fit is not strong enough.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: false,
      shouldAutoPrepare: false,
      watchOuts,
      internalSkipReason: "weak_dtc_lifecycle_fit",
    };
  }

  if (!scopeClear && job.score < 85) {
    return {
      decision: "manual_review",
      reason: "Lead may fit, but scope clarity is weak.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: true,
      shouldAutoPrepare: false,
      watchOuts,
    };
  }

  if (connectsStrategy?.decision === "manual_review" && !connectsRequiredUnknown) {
    return {
      decision: "manual_review",
      reason: "Connects spend needs manual review before applying.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: true,
      shouldAutoPrepare: false,
      watchOuts: [...watchOuts, ...connectsStrategy.risks],
    };
  }

  if ((clientQuality < 55 || hasVeryWeakClientHistory(job)) && job.score < 92) {
    return {
      decision: "manual_review",
      reason: "Lead fits but client quality is weak enough to require review.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: true,
      shouldAutoPrepare: false,
      watchOuts,
    };
  }

  if (!platformEligible) {
    return {
      decision: "manual_review",
      reason: "Platform status requires review before draft prep.",
      scoreUsed: job.score,
      platformEligibility: eligibility.platformEligibility,
      shouldPostToSlack: true,
      shouldAutoPrepare: false,
      watchOuts,
    };
  }

  return {
    decision: "post_to_slack",
    reason: "Approved platform, strong fit, and sufficient lead quality.",
    scoreUsed: job.score,
    platformEligibility: eligibility.platformEligibility,
    shouldPostToSlack: true,
    shouldAutoPrepare: true,
    watchOuts,
  };
}
