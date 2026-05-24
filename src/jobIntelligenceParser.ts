import {
  JOB_INTELLIGENCE_ENABLED,
  JOB_INTELLIGENCE_MODEL,
  JOB_INTELLIGENCE_TEMPERATURE,
  LLM_PROVIDER,
} from "./config";
import { OpenAiCompatibleProvider, getLlmProviderConfig, type LlmJsonResult } from "./llm/provider";
import type { ApplicationDraft, JobIntelligence, JobPosting, PlatformPreferenceTier } from "./types";

export interface JobIntelligenceInput {
  job: Pick<JobPosting, "id" | "title" | "description" | "category" | "skills" | "budget" | "clientCountry" | "clientRating" | "clientSpend" | "clientHireRate">;
  clientDetails?: Record<string, unknown>;
  draftText?: string;
}

export interface JobIntelligenceResult {
  ok: boolean;
  intelligence: JobIntelligence | null;
  usedLlm: boolean;
  unavailableReason?: string;
  error?: string;
}

export interface JobIntelligenceClient {
  isAvailable(): boolean;
  completeJson<T>(request: { messages: Array<{ role: "system" | "user" | "assistant"; content: string }>; temperature?: number; maxTokens?: number }): Promise<LlmJsonResult<T>>;
}

const KNOWN_PLATFORMS = [
  "Klaviyo",
  "Brevo",
  "HubSpot",
  "Customer.io",
  "Omnisend",
  "MailerLite",
  "Mailchimp",
  "Attentive",
  "Postscript",
  "SendGrid",
  "Campaign Refinery",
  "ActiveCampaign",
  "Braze",
  "Iterable",
  "Salesforce Marketing Cloud",
  "Shopify",
  "WooCommerce",
  "BigCommerce",
  "Magento",
  "Gorgias",
  "Recharge",
  "Skio",
  "Zendesk",
  "Intercom",
  "Kustomer",
  "Yotpo",
];

const VERTICALS = new Set(["beauty", "health", "supplements", "fashion", "food", "home", "SaaS", "unknown"]);
const PLATFORM_CATEGORIES = new Set(["ESP", "CRM", "SMS", "CDP", "ecommerce platform", "support", "subscription", "analytics", "unknown"]);
const PLATFORM_PREFERENCE_TIERS = new Set(["core", "secondary", "non_core_review", "unknown"]);
const CORE_PLATFORMS = new Set(["klaviyo", "attentive", "postscript", "omnisend"]);
const SECONDARY_PLATFORMS = new Set(["mailerlite", "mailchimp"]);
const NON_COMPETING_CONTEXT_PLATFORMS = new Set(["shopify", "woocommerce", "bigcommerce", "magento", "recharge", "skio", "gorgias", "zendesk", "intercom", "kustomer"]);

export const JOB_INTELLIGENCE_SCHEMA = {
  schemaVersion: "1.0",
  required: [
    "primaryPlatform",
    "platformsMentioned",
    "platformCategory",
    "platformPreferenceTier",
    "platformFitReason",
    "shouldSkipForPlatform",
    "skipReason",
    "businessType",
    "ecommerceVertical",
    "jobCategory",
    "taskType",
    "requiredSkills",
    "clientGoal",
    "redFlags",
    "fitScoreReasoning",
    "proposalAngle",
    "proofRecommendations",
    "draftConstraints",
    "platformMismatchWarnings",
    "needsManualReview",
  ],
  platformCategory: [...PLATFORM_CATEGORIES],
  platformPreferenceTier: [...PLATFORM_PREFERENCE_TIERS],
  ecommerceVertical: [...VERTICALS],
} as const;

function normalizePlatformName(value: string): string {
  const trimmed = value.trim();
  const known = KNOWN_PLATFORMS.find((platform) => platform.toLowerCase() === trimmed.toLowerCase());
  if (known) return known;
  return trimmed || "unknown";
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function stringField(value: unknown, fallback = "unknown"): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function booleanField(value: unknown): boolean {
  return value === true;
}

function confidenceField(value: unknown, needsManualReview: boolean): JobIntelligence["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : needsManualReview ? "low" : "medium";
}

function inferPlatformPreferenceTier(primaryPlatform: string, value: unknown): PlatformPreferenceTier {
  const normalized = primaryPlatform.toLowerCase();
  if (CORE_PLATFORMS.has(normalized)) return "core";
  if (SECONDARY_PLATFORMS.has(normalized)) return "secondary";
  if (normalized === "unknown") return "unknown";
  if (value === "core" || value === "secondary" || value === "non_core_review" || value === "unknown") return value;
  return "non_core_review";
}

function platformSkipDecision(tier: PlatformPreferenceTier, input: Record<string, unknown>): { shouldSkipForPlatform: boolean; skipReason: string; needsManualReview: boolean } {
  const llmSkipReason = stringField(input.skipReason, "");
  if (tier === "core") {
    return { shouldSkipForPlatform: false, skipReason: "", needsManualReview: false };
  }
  if (tier === "secondary") {
    return { shouldSkipForPlatform: false, skipReason: "", needsManualReview: false };
  }
  if (tier === "unknown") {
    return {
      shouldSkipForPlatform: booleanField(input.shouldSkipForPlatform),
      skipReason: llmSkipReason || "Platform is unknown or not stated; keep proposal platform-neutral until confirmed.",
      needsManualReview: true,
    };
  }
  const shouldSkipForPlatform = booleanField(input.shouldSkipForPlatform);
  return {
    shouldSkipForPlatform,
    skipReason: shouldSkipForPlatform ? llmSkipReason || "Non-core platform with weak ecommerce/email/SMS/retention fit." : llmSkipReason,
    needsManualReview: true,
  };
}

export function detectPlatformsInText(text: string): string[] {
  const found = KNOWN_PLATFORMS.filter((platform) => new RegExp(`\\b${platform.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  return Array.from(new Set(found));
}

function hasMigrationOrComparisonContext(text: string, primary: string, other: string): boolean {
  const escapedPrimary = primary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedOther = other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const relation = "migrat|migration|switch|moving|compare|comparison|integrat|sync|from|to|between|instead of|rather than";
  return new RegExp(`(${escapedPrimary}.{0,80}(${relation}).{0,80}${escapedOther})|(${escapedOther}.{0,80}(${relation}).{0,80}${escapedPrimary})`, "i").test(text);
}

export function detectPlatformMismatchWarnings(primaryPlatform: string, platformsMentioned: string[], draftText = ""): string[] {
  const primary = normalizePlatformName(primaryPlatform);
  if (!draftText.trim() || primary.toLowerCase() === "unknown") return [];
  const draftPlatforms = detectPlatformsInText(draftText);
  const jobPlatforms = new Set(platformsMentioned.map((platform) => normalizePlatformName(platform).toLowerCase()));
  if (primary !== "unknown") jobPlatforms.add(primary.toLowerCase());

  const warnings: string[] = [];
  for (const draftPlatform of draftPlatforms) {
    if (NON_COMPETING_CONTEXT_PLATFORMS.has(draftPlatform.toLowerCase())) continue;
    if (draftPlatform.toLowerCase() === primary.toLowerCase()) continue;
    if (jobPlatforms.has(draftPlatform.toLowerCase()) && hasMigrationOrComparisonContext(draftText, primary, draftPlatform)) continue;
    warnings.push(`platform_mismatch: job primary platform is ${primary}, but draft mentions ${draftPlatform}.`);
  }
  return warnings;
}

export function createUnavailableJobIntelligence(reason: string): JobIntelligenceResult {
  return { ok: false, intelligence: null, usedLlm: false, unavailableReason: reason };
}

function inferVertical(text: string): JobIntelligence["ecommerceVertical"] {
  if (/beauty|skincare|cosmetic/i.test(text)) return "beauty";
  if (/supplement|wellness|health/i.test(text)) return "supplements";
  if (/fashion|apparel|clothing/i.test(text)) return "fashion";
  if (/food|beverage/i.test(text)) return "food";
  if (/home|furniture|decor/i.test(text)) return "home";
  if (/saas|b2b/i.test(text)) return "SaaS";
  return "unknown";
}

export function buildDeterministicJobIntelligence(job: JobIntelligenceInput["job"], draftText = ""): JobIntelligence {
  const text = `${job.title} ${job.description} ${job.skills.join(" ")} ${job.category}`.toLowerCase();
  const platformsMentioned = detectPlatformsInText(text);
  const primaryPlatform = platformsMentioned.find((platform) => !NON_COMPETING_CONTEXT_PLATFORMS.has(platform.toLowerCase())) ?? platformsMentioned[0] ?? "unknown";
  const platformPreferenceTier = inferPlatformPreferenceTier(primaryPlatform, undefined);
  const ecommerceVertical = inferVertical(text);
  const lifecycleFit = /(retention|lifecycle|email|sms|flow|flows|automation|campaign|segmentation|klaviyo|attentive|postscript|omnisend|mailchimp)/i.test(text);
  const ecommerceFit = /(dtc|d2c|ecommerce|e-commerce|shopify|woocommerce|bigcommerce|beauty|skincare|fashion|supplement|home)/i.test(text) && ecommerceVertical !== "SaaS";
  const needsManualReview = platformPreferenceTier === "unknown" || platformPreferenceTier === "non_core_review";
  const shouldSkipForPlatform = platformPreferenceTier === "non_core_review" && !(ecommerceFit && lifecycleFit);
  const raw = {
    primaryPlatform,
    platformsMentioned,
    platformCategory: primaryPlatform === "unknown" ? "unknown" : CORE_PLATFORMS.has(primaryPlatform.toLowerCase()) || SECONDARY_PLATFORMS.has(primaryPlatform.toLowerCase()) ? "ESP" : "CRM",
    platformPreferenceTier,
    platformFitReason: primaryPlatform === "unknown"
      ? "No primary platform was detected from deterministic job text."
      : `${primaryPlatform} detected from deterministic job text.`,
    shouldSkipForPlatform,
    skipReason: shouldSkipForPlatform ? "Non-core platform without strong ecommerce lifecycle fit." : "",
    businessType: ecommerceFit ? "DTC ecommerce" : ecommerceVertical === "SaaS" ? "B2B SaaS" : "unknown",
    ecommerceVertical,
    jobCategory: job.category || "unknown",
    taskType: lifecycleFit ? "Lifecycle/email/SMS retention work" : "unknown",
    requiredSkills: job.skills,
    clientGoal: lifecycleFit ? "Improve lifecycle retention performance" : "unknown",
    redFlags: [],
    fitScoreReasoning: ecommerceFit && lifecycleFit ? "Deterministic parser found ecommerce lifecycle fit." : "Deterministic parser needs manual review for fit.",
    proposalAngle: lifecycleFit ? "Lead with retention audit and priority lifecycle fixes." : "Keep proposal specific and avoid unsupported platform claims.",
    proofRecommendations: [],
    draftConstraints: primaryPlatform === "unknown" ? ["Stay platform-neutral until the client confirms tooling."] : [],
    platformMismatchWarnings: detectPlatformMismatchWarnings(primaryPlatform, platformsMentioned, draftText),
    needsManualReview,
    confidence: primaryPlatform === "unknown" ? "low" : "medium",
  };
  return validateJobIntelligence(raw, draftText).intelligence ?? {
    schemaVersion: "1.0",
    primaryPlatform: "unknown",
    platformsMentioned: [],
    platformCategory: "unknown",
    platformPreferenceTier: "unknown",
    platformFitReason: "Deterministic parser could not validate platform context.",
    shouldSkipForPlatform: false,
    skipReason: "",
    businessType: "unknown",
    ecommerceVertical: "unknown",
    jobCategory: "unknown",
    taskType: "unknown",
    requiredSkills: [],
    clientGoal: "unknown",
    redFlags: [],
    fitScoreReasoning: "Needs manual review.",
    proposalAngle: "Stay specific and platform-neutral.",
    proofRecommendations: [],
    draftConstraints: ["Stay platform-neutral until tooling is confirmed."],
    platformMismatchWarnings: [],
    needsManualReview: true,
    confidence: "low",
  };
}

export function validateJobIntelligence(raw: unknown, draftText = ""): { valid: boolean; intelligence?: JobIntelligence; errors: string[] } {
  if (!raw || typeof raw !== "object") return { valid: false, errors: ["LLM response was not an object"] };
  const input = raw as Record<string, unknown>;
  const needsManualReview = booleanField(input.needsManualReview);
  const platformCategoryRaw = stringField(input.platformCategory, "unknown");
  const platformCategory = PLATFORM_CATEGORIES.has(platformCategoryRaw) ? platformCategoryRaw as JobIntelligence["platformCategory"] : "unknown";
  const ecommerceVerticalRaw = stringField(input.ecommerceVertical, "unknown");
  const ecommerceVertical = VERTICALS.has(ecommerceVerticalRaw) ? ecommerceVerticalRaw as JobIntelligence["ecommerceVertical"] : "unknown";
  const primaryPlatform = normalizePlatformName(stringField(input.primaryPlatform, "unknown"));
  const platformsMentioned = uniqueStrings(input.platformsMentioned).map(normalizePlatformName);
  if (primaryPlatform !== "unknown" && !platformsMentioned.map((p) => p.toLowerCase()).includes(primaryPlatform.toLowerCase())) {
    platformsMentioned.unshift(primaryPlatform);
  }
  const mismatchWarnings = Array.from(new Set([
    ...uniqueStrings(input.platformMismatchWarnings).filter((warning) => warning.includes("platform_mismatch")),
    ...detectPlatformMismatchWarnings(primaryPlatform, platformsMentioned, draftText),
  ]));
  const platformPreferenceTier = inferPlatformPreferenceTier(primaryPlatform, input.platformPreferenceTier);
  const skipDecision = platformSkipDecision(platformPreferenceTier, input);
  const manualReviewFromTier = skipDecision.needsManualReview;

  const intelligence: JobIntelligence = {
    schemaVersion: "1.0",
    primaryPlatform,
    platformsMentioned,
    platformCategory,
    platformPreferenceTier,
    platformFitReason: stringField(input.platformFitReason, `${platformPreferenceTier} platform fit based on stated platform and job scope.`),
    shouldSkipForPlatform: skipDecision.shouldSkipForPlatform,
    skipReason: skipDecision.skipReason,
    businessType: stringField(input.businessType),
    ecommerceVertical,
    jobCategory: stringField(input.jobCategory),
    taskType: stringField(input.taskType),
    requiredSkills: uniqueStrings(input.requiredSkills),
    clientGoal: stringField(input.clientGoal),
    redFlags: uniqueStrings(input.redFlags),
    fitScoreReasoning: stringField(input.fitScoreReasoning, "Needs manual review; parser did not provide reasoning."),
    proposalAngle: stringField(input.proposalAngle, "Keep proposal specific to the stated platform and client goal."),
    proofRecommendations: uniqueStrings(input.proofRecommendations),
    draftConstraints: uniqueStrings(input.draftConstraints),
    platformMismatchWarnings: mismatchWarnings,
    needsManualReview: needsManualReview || manualReviewFromTier || primaryPlatform === "unknown" || mismatchWarnings.length > 0,
    confidence: confidenceField(input.confidence, needsManualReview || manualReviewFromTier),
  };

  const errors: string[] = [];
  for (const field of JOB_INTELLIGENCE_SCHEMA.required) {
    if (field === "needsManualReview") continue;
    if (!(field in input)) errors.push(`Missing field: ${field}`);
  }
  if (errors.length > 0) return { valid: false, intelligence, errors };
  return { valid: true, intelligence, errors: [] };
}

function buildJobIntelligenceMessages(input: JobIntelligenceInput) {
  return [
    {
      role: "system" as const,
      content: [
        "You are an Upwork job intelligence parser. Return JSON only.",
        "Extract only facts supported by the job text. Do not invent platforms, verticals, or client goals.",
        "Identify any platform/tool in the job, including known and new/unknown tools; do not restrict extraction to a hardcoded list.",
        "Apply Steve's platform preference tiers: core = Klaviyo, Attentive, Postscript, Omnisend; secondary = MailerLite, Mailchimp; non_core_review = HubSpot, Customer.io, Brevo, ActiveCampaign, SendGrid, Campaign Refinery, Braze, Iterable, Salesforce Marketing Cloud, and other ESP/CRM/CDP tools.",
        "Do not treat all ESPs equally: core and secondary platform jobs should not be skipped for platform alone; non-core jobs need careful review and may be skipped when weak-fit, pure CRM/admin, B2B/SaaS-only, low budget, or not ecommerce/email/SMS/retention focused.",
        "Migration into a core or secondary platform should not be skipped purely because the source platform is non-core; migration away from core into non-core should usually need manual review or skip depending on scope.",
        "If a job explicitly names one platform, proposal guidance must not substitute a different platform unless this is migration, comparison, or multi-platform work.",
        "If platform is ambiguous or absent, set primaryPlatform to unknown and needsManualReview true with platform-neutral draftConstraints.",
      ].join(" "),
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        schema: JOB_INTELLIGENCE_SCHEMA,
        allowedEcommerceVerticals: [...VERTICALS],
        platformPreferenceRules: {
          core: ["Klaviyo", "Attentive", "Postscript", "Omnisend"],
          secondary: ["MailerLite", "Mailchimp"],
          nonCoreReviewExamples: ["HubSpot", "Customer.io", "Brevo", "ActiveCampaign", "SendGrid", "Campaign Refinery", "Braze", "Iterable", "Salesforce Marketing Cloud", "other ESPs/CRMs/CDPs"],
        },
        job: input.job,
        clientDetails: input.clientDetails ?? {},
        draftTextForQaOnly: input.draftText ?? "",
        instructions: [
          "Return every required field.",
          "platformMismatchWarnings must include platform_mismatch if draftTextForQaOnly names a different email/SMS/CRM platform than the job's primary platform without migration/comparison context.",
          "Set platformPreferenceTier, platformFitReason, shouldSkipForPlatform, skipReason, and needsManualReview using the platform preference rules and job scope.",
          "Use platform-neutral proposalAngle and draftConstraints when primaryPlatform is unknown.",
        ],
      }),
    },
  ];
}

function defaultJobIntelligenceClient(): JobIntelligenceClient {
  const providerConfig = getLlmProviderConfig();
  return new OpenAiCompatibleProvider({
    enabled: JOB_INTELLIGENCE_ENABLED,
    provider: LLM_PROVIDER,
    apiKey: providerConfig.apiKey,
    model: JOB_INTELLIGENCE_MODEL,
    baseUrl: providerConfig.baseUrl,
  });
}

export async function parseJobIntelligence(input: JobIntelligenceInput, client: JobIntelligenceClient = defaultJobIntelligenceClient()): Promise<JobIntelligenceResult> {
  const deterministicFallback = (reason: string): JobIntelligenceResult => ({
    ok: true,
    intelligence: buildDeterministicJobIntelligence(input.job, input.draftText),
    usedLlm: false,
    unavailableReason: reason,
  });

  if (!client.isAvailable()) {
    return deterministicFallback("Job intelligence LLM unavailable or not configured; used deterministic parser");
  }

  const result = await client.completeJson<unknown>({
    messages: buildJobIntelligenceMessages(input),
    temperature: JOB_INTELLIGENCE_TEMPERATURE,
    maxTokens: 1800,
  });
  if (!result.ok || !result.data) {
    return deterministicFallback(result.skippedReason ?? result.error ?? "Job intelligence LLM failed; used deterministic parser");
  }

  const validated = validateJobIntelligence(result.data, input.draftText);
  if (!validated.valid || !validated.intelligence) {
    return deterministicFallback(`Invalid job intelligence JSON: ${validated.errors.join("; ")}; used deterministic parser`);
  }
  return { ok: true, intelligence: validated.intelligence, usedLlm: true };
}

export async function attachJobIntelligenceToDraft(job: JobPosting, draft: ApplicationDraft, client?: JobIntelligenceClient): Promise<JobIntelligenceResult> {
  const result = await parseJobIntelligence({ job, draftText: draft.proposalText }, client);
  if (result.intelligence) {
    draft.jobIntelligence = result.intelligence;
  }
  return result;
}
