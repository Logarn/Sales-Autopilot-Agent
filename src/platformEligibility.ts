import type { JobIntelligence } from "./types";

export type PlatformEligibility = "eligible" | "ineligible" | "manual_review";

export interface PlatformEligibilityResult {
  platformEligibility: PlatformEligibility;
  eligibilityReason: string;
  approvedPlatformMatched: string | null;
  skippedBecausePlatform: boolean;
}

const APPROVED_CORE = new Set(["klaviyo", "attentive", "postscript", "omnisend"]);
const APPROVED_SECONDARY = new Set(["mailchimp", "mailerlite"]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function isDtcEcommerceVertical(value: string | undefined): boolean {
  const normalized = normalize(value ?? "");
  return Boolean(normalized) && !["unknown", "saas", "n/a", "none"].includes(normalized);
}

function hasDtcLifecycleContext(intelligence: JobIntelligence): boolean {
  const requiredSkills = Array.isArray(intelligence.requiredSkills) ? intelligence.requiredSkills : [];
  const text = [
    intelligence.businessType ?? "",
    intelligence.ecommerceVertical ?? "",
    intelligence.jobCategory ?? "",
    intelligence.taskType ?? "",
    intelligence.clientGoal ?? "",
    requiredSkills.join(" "),
    intelligence.fitScoreReasoning ?? "",
  ].join(" ").toLowerCase();
  const ecommerceFit =
    isDtcEcommerceVertical(intelligence.ecommerceVertical) ||
    ["dtc", "d2c", "ecommerce", "e-commerce", "shopify", "woocommerce", "bigcommerce", "beauty", "skincare", "fashion", "supplements"].some((term) => text.includes(term));
  const lifecycleFit = ["retention", "lifecycle", "email", "sms", "flow", "automation", "campaign", "segmentation"].some((term) => text.includes(term));
  return ecommerceFit && lifecycleFit;
}

export function evaluatePlatformEligibility(intelligence?: JobIntelligence | null): PlatformEligibilityResult {
  if (!intelligence) {
    return {
      platformEligibility: "manual_review",
      eligibilityReason: "Job intelligence unavailable; requires manual platform review.",
      approvedPlatformMatched: null,
      skippedBecausePlatform: false,
    };
  }

  const primary = normalize(intelligence.primaryPlatform || "unknown");
  const mentioned = new Set((Array.isArray(intelligence.platformsMentioned) ? intelligence.platformsMentioned : []).map(normalize));
  if (primary !== "unknown") mentioned.add(primary);

  const approved = [...mentioned].find((p) => APPROVED_CORE.has(p) || APPROVED_SECONDARY.has(p)) ?? null;

  if (approved && primary === "unknown") {
    return {
      platformEligibility: "eligible",
      eligibilityReason: `Approved platform detected (${approved}).`,
      approvedPlatformMatched: approved,
      skippedBecausePlatform: false,
    };
  }

  if (primary === "unknown") {
    return {
      platformEligibility: "manual_review",
      eligibilityReason: "No explicit platform detected; job may be DTC retention and needs manual review.",
      approvedPlatformMatched: null,
      skippedBecausePlatform: false,
    };
  }

  if (APPROVED_CORE.has(primary) || APPROVED_SECONDARY.has(primary)) {
    return {
      platformEligibility: "eligible",
      eligibilityReason: `Primary platform ${intelligence.primaryPlatform} is approved.`,
      approvedPlatformMatched: primary,
      skippedBecausePlatform: false,
    };
  }

  if (intelligence.shouldSkipForPlatform || !hasDtcLifecycleContext(intelligence)) {
    return {
      platformEligibility: "ineligible",
      eligibilityReason: `Primary platform ${intelligence.primaryPlatform} is currently unapproved for this scope.`,
      approvedPlatformMatched: approved,
      skippedBecausePlatform: true,
    };
  }

  return {
    platformEligibility: "manual_review",
    eligibilityReason: `Primary platform ${intelligence.primaryPlatform} is non-core and needs manual review before any draft prep.`,
    approvedPlatformMatched: approved,
    skippedBecausePlatform: false,
  };
}
