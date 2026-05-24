import assert from "node:assert/strict";
import {
  detectPlatformMismatchWarnings,
  parseJobIntelligence,
  validateJobIntelligence,
  type JobIntelligenceClient,
} from "./jobIntelligenceParser";
import type { JobPosting } from "./types";

class MockClient implements JobIntelligenceClient {
  constructor(private readonly response: unknown, private readonly available = true) {}
  isAvailable(): boolean { return this.available; }
  async completeJson<T>(): Promise<{ ok: boolean; data?: T; error?: string }> {
    if (this.response instanceof Error) return { ok: false, error: this.response.message };
    return { ok: true, data: this.response as T };
  }
}

function job(overrides: Partial<JobPosting>): JobPosting {
  return {
    id: "~012345678901234567890",
    title: "Email marketing automation expert",
    url: "https://www.upwork.com/jobs/~012345678901234567890",
    description: "We need help with lifecycle email flows for our ecommerce store.",
    postedAt: new Date().toISOString(),
    budget: "$500",
    clientCountry: "US",
    clientRating: 5,
    clientSpend: 10000,
    clientHireRate: 80,
    clientTotalHires: 20,
    clientFeedbackCount: 12,
    category: "Email Marketing",
    experienceLevel: "Expert",
    connectsCost: 12,
    skills: ["Email Marketing"],
    sourceQuery: "test",
    ...overrides,
  };
}

function intelligence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    primaryPlatform: "Klaviyo",
    platformsMentioned: ["Klaviyo"],
    platformCategory: "ESP",
    platformPreferenceTier: "core",
    platformFitReason: "Core lifecycle platform with ecommerce retention fit.",
    shouldSkipForPlatform: false,
    skipReason: "",
    businessType: "DTC ecommerce",
    ecommerceVertical: "beauty",
    jobCategory: "email marketing",
    taskType: "automation audit",
    requiredSkills: ["flows", "segmentation"],
    clientGoal: "Improve retention revenue",
    redFlags: [],
    fitScoreReasoning: "Strong match for lifecycle email work.",
    proposalAngle: "Lead with lifecycle revenue diagnosis.",
    proofRecommendations: ["retention flow proof"],
    draftConstraints: ["Keep platform references accurate."],
    platformMismatchWarnings: [],
    needsManualReview: false,
    confidence: "high",
    ...overrides,
  };
}

async function parseWith(response: Record<string, unknown>, draftText: string, description = "Fixture job"): Promise<NonNullable<Awaited<ReturnType<typeof parseJobIntelligence>>["intelligence"]>> {
  const result = await parseJobIntelligence(
    { job: job({ title: String(response.primaryPlatform), description }), draftText },
    new MockClient(response)
  );
  assert.equal(result.ok, true, result.error);
  assert(result.intelligence);
  return result.intelligence;
}

async function assertMismatch(platform: string, category: string, draftPlatform = "Klaviyo"): Promise<void> {
  const parsed = await parseWith(
    intelligence({ primaryPlatform: platform, platformsMentioned: [platform], platformCategory: category }),
    `I can improve your ${draftPlatform} lifecycle flows and campaigns.`,
    `We use ${platform} and need help improving automations.`
  );
  assert.equal(parsed.primaryPlatform, platform);
  assert(parsed.platformMismatchWarnings.some((warning) => warning.includes("platform_mismatch")), `${platform} mismatch should be detected`);
  assert.equal(parsed.needsManualReview, true);
}

async function run(): Promise<void> {
  for (const platform of ["Klaviyo", "Attentive", "Postscript", "Omnisend"]) {
    const parsed = await parseWith(
      intelligence({ primaryPlatform: platform, platformsMentioned: [platform], platformCategory: platform === "Attentive" || platform === "Postscript" ? "SMS" : "ESP" }),
      `I can improve your ${platform} automations.`,
      `Need ${platform} lifecycle retention help for an ecommerce brand.`
    );
    assert.equal(parsed.platformPreferenceTier, "core", `${platform} should be core`);
    assert.equal(parsed.shouldSkipForPlatform, false, `${platform} should not skip for platform`);
  }

  for (const platform of ["MailerLite", "Mailchimp"]) {
    const parsed = await parseWith(
      intelligence({ primaryPlatform: platform, platformsMentioned: [platform], platformPreferenceTier: "secondary", platformFitReason: "Secondary acceptable lifecycle platform.", platformCategory: "ESP" }),
      `I can improve your ${platform} campaigns.`,
      `Need ${platform} email marketing help for ecommerce.`
    );
    assert.equal(parsed.platformPreferenceTier, "secondary", `${platform} should be secondary`);
    assert.equal(parsed.shouldSkipForPlatform, false, `${platform} should not skip for platform`);
  }

  const hubspotEcommerce = await parseWith(
    intelligence({
      primaryPlatform: "HubSpot",
      platformsMentioned: ["HubSpot", "Shopify"],
      platformCategory: "CRM",
      platformPreferenceTier: "non_core_review",
      platformFitReason: "Non-core platform, but ecommerce lifecycle email scope may still be relevant.",
      shouldSkipForPlatform: false,
      needsManualReview: true,
    }),
    "I can improve your HubSpot lifecycle campaigns for ecommerce retention.",
    "HubSpot ecommerce email automations for a Shopify store."
  );
  assert.equal(hubspotEcommerce.platformPreferenceTier, "non_core_review");
  assert.equal(hubspotEcommerce.shouldSkipForPlatform, false);
  assert.equal(hubspotEcommerce.needsManualReview, true);

  const pureHubspotAdmin = await parseWith(
    intelligence({
      primaryPlatform: "HubSpot",
      platformsMentioned: ["HubSpot"],
      platformCategory: "CRM",
      platformPreferenceTier: "non_core_review",
      platformFitReason: "Pure CRM admin work with weak ecommerce retention fit.",
      shouldSkipForPlatform: true,
      skipReason: "Pure HubSpot CRM/admin work, not ecommerce lifecycle retention.",
      businessType: "B2B SaaS",
      taskType: "CRM admin cleanup",
      needsManualReview: true,
    }),
    "I can clean up your HubSpot CRM properties and admin workflows.",
    "Need HubSpot CRM admin: dedupe properties, clean pipeline stages, and update dashboards."
  );
  assert.equal(pureHubspotAdmin.platformPreferenceTier, "non_core_review");
  assert.equal(pureHubspotAdmin.shouldSkipForPlatform, true);
  assert.match(pureHubspotAdmin.skipReason, /CRM\/admin|admin/i);

  const brevoEcommerce = await parseWith(
    intelligence({
      primaryPlatform: "Brevo",
      platformsMentioned: ["Brevo", "Shopify"],
      platformCategory: "ESP",
      platformPreferenceTier: "non_core_review",
      platformFitReason: "Non-core ESP; ecommerce automation scope is relevant but should be reviewed.",
      shouldSkipForPlatform: false,
      needsManualReview: true,
    }),
    "I can improve your Brevo welcome and abandoned cart automations.",
    "Need Brevo automations for a beauty ecommerce store."
  );
  assert.equal(brevoEcommerce.platformPreferenceTier, "non_core_review");
  assert.equal(brevoEcommerce.shouldSkipForPlatform, false);
  assert.equal(brevoEcommerce.needsManualReview, true);

  const hubspotToKlaviyo = validateJobIntelligence(intelligence({
    primaryPlatform: "Klaviyo",
    platformsMentioned: ["HubSpot", "Klaviyo", "Shopify"],
    platformPreferenceTier: "core",
    platformFitReason: "Migration into core Klaviyo should not be skipped for source platform.",
    shouldSkipForPlatform: false,
    taskType: "platform migration",
    clientGoal: "Migrate from HubSpot to Klaviyo",
  }), "I can migrate your lifecycle program from HubSpot to Klaviyo and validate Shopify events.");
  assert.equal(hubspotToKlaviyo.valid, true);
  assert.equal(hubspotToKlaviyo.intelligence?.platformPreferenceTier, "core");
  assert.equal(hubspotToKlaviyo.intelligence?.shouldSkipForPlatform, false);
  assert.equal(hubspotToKlaviyo.intelligence?.platformMismatchWarnings.length, 0);

  const klaviyoToHubspot = validateJobIntelligence(intelligence({
    primaryPlatform: "HubSpot",
    platformsMentioned: ["Klaviyo", "HubSpot"],
    platformCategory: "CRM",
    platformPreferenceTier: "non_core_review",
    platformFitReason: "Migration away from core Klaviyo into non-core HubSpot needs careful review.",
    shouldSkipForPlatform: true,
    skipReason: "Migration away from core Klaviyo into non-core HubSpot with CRM-heavy scope.",
    taskType: "platform migration",
    needsManualReview: true,
  }), "I can help migrate from Klaviyo to HubSpot, preserving lifecycle logic where useful.");
  assert.equal(klaviyoToHubspot.valid, true);
  assert.equal(klaviyoToHubspot.intelligence?.platformPreferenceTier, "non_core_review");
  assert.equal(klaviyoToHubspot.intelligence?.needsManualReview, true);

  await assertMismatch("HubSpot", "CRM");
  await assertMismatch("Customer.io", "ESP");
  await assertMismatch("Omnisend", "ESP");
  await assertMismatch("Brevo", "ESP");

  const klaviyo = await parseWith(
    intelligence({ primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo", "Shopify"], platformCategory: "ESP", ecommerceVertical: "fashion" }),
    "I can audit your Klaviyo flows and prioritize revenue leaks.",
    "Need Klaviyo flows for fashion ecommerce."
  );
  assert.equal(klaviyo.primaryPlatform, "Klaviyo");
  assert.equal(klaviyo.platformMismatchWarnings.length, 0);

  const migrationContext = detectPlatformMismatchWarnings("Brevo", ["Brevo", "Klaviyo", "Shopify"], "I can support a migration from Klaviyo to Brevo and validate Shopify events.");
  assert.equal(migrationContext.length, 0);
  const migration = validateJobIntelligence(intelligence({
    primaryPlatform: "Brevo",
    platformsMentioned: ["Klaviyo", "Brevo", "Shopify"],
    platformCategory: "ESP",
    platformPreferenceTier: "non_core_review",
    platformFitReason: "Migration is accurate but target platform is non-core, so review carefully.",
    shouldSkipForPlatform: false,
    taskType: "platform migration",
    clientGoal: "Migrate from Klaviyo to Brevo",
    needsManualReview: true,
  }), "I can migrate your lifecycle setup from Klaviyo to Brevo and validate Shopify events.");
  assert.equal(migration.valid, true);
  assert.deepEqual(migration.intelligence?.platformsMentioned, ["Klaviyo", "Brevo", "Shopify"]);
  assert.equal(migration.intelligence?.platformMismatchWarnings.length, 0);

  const unknownNewPlatform = validateJobIntelligence(intelligence({
    primaryPlatform: "LifecycleRocket",
    platformsMentioned: ["LifecycleRocket", "Shopify"],
    platformCategory: "unknown",
    platformPreferenceTier: "non_core_review",
    platformFitReason: "Unknown/new platform; review capabilities and fit.",
    shouldSkipForPlatform: false,
    confidence: "medium",
    needsManualReview: true,
    draftConstraints: ["Use LifecycleRocket only as named in the job; ask clarifying questions if capabilities are unclear."],
  }), "I can review your LifecycleRocket automations and map improvements carefully.");
  assert.equal(unknownNewPlatform.valid, true);
  assert.equal(unknownNewPlatform.intelligence?.primaryPlatform, "LifecycleRocket");
  assert(unknownNewPlatform.intelligence?.platformsMentioned.includes("LifecycleRocket"));
  assert.equal(unknownNewPlatform.intelligence?.platformPreferenceTier, "non_core_review");
  assert.equal(unknownNewPlatform.intelligence?.confidence, "medium");

  const noPlatform = await parseWith(
    intelligence({
      primaryPlatform: "unknown",
      platformsMentioned: [],
      platformCategory: "unknown",
      platformPreferenceTier: "unknown",
      platformFitReason: "Platform not stated.",
      shouldSkipForPlatform: false,
      ecommerceVertical: "unknown",
      proposalAngle: "Use platform-neutral language until the tool is confirmed.",
      draftConstraints: ["Do not name a specific ESP/CRM until confirmed."],
      needsManualReview: true,
      confidence: "low",
    }),
    "I can audit your email setup and keep recommendations platform-neutral until I confirm your tool.",
    "Need someone to fix emails; platform not listed."
  );
  assert.equal(noPlatform.primaryPlatform, "unknown");
  assert.equal(noPlatform.platformPreferenceTier, "unknown");
  assert.equal(noPlatform.needsManualReview, true);
  assert.match(noPlatform.proposalAngle, /platform-neutral/i);

  for (const vertical of ["beauty", "health", "supplements", "fashion", "food", "home", "SaaS", "unknown"] as const) {
    const parsed = validateJobIntelligence(intelligence({ ecommerceVertical: vertical }));
    assert.equal(parsed.intelligence?.ecommerceVertical, vertical);
  }
  assert.equal(validateJobIntelligence(intelligence({ ecommerceVertical: "wellness" })).intelligence?.ecommerceVertical, "unknown");

  const unavailable = await parseJobIntelligence({ job: job({}) }, new MockClient(intelligence(), false));
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.usedLlm, false);
  assert.equal(unavailable.intelligence?.primaryPlatform, "unknown");
  assert.equal(unavailable.intelligence?.needsManualReview, true);
  assert.match(unavailable.unavailableReason ?? "", /deterministic parser/);

  const invalid = await parseJobIntelligence({ job: job({}) }, new MockClient({ primaryPlatform: "HubSpot" }));
  assert.equal(invalid.ok, true);
  assert.equal(invalid.usedLlm, false);
  assert.equal(invalid.intelligence?.primaryPlatform, "unknown");
  assert.match(invalid.unavailableReason ?? "", /Invalid job intelligence JSON/);

  const llmError = await parseJobIntelligence({ job: job({}) }, new MockClient(new Error("network down")));
  assert.equal(llmError.ok, true);
  assert.equal(llmError.usedLlm, false);
  assert.equal(llmError.intelligence?.primaryPlatform, "unknown");
  assert.match(llmError.unavailableReason ?? "", /network down/);

  console.log("job intelligence parser tests passed");
}

run().catch((error) => {
  console.error(`job intelligence parser tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
