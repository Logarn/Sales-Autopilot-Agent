import { strict as assert } from "node:assert";
import { qaProposalPlatformGrounding } from "./proposalQa";
import { JobIntelligence } from "./types";

function intelligence(overrides: Partial<JobIntelligence>): JobIntelligence {
  return {
    schemaVersion: "1.0",
    primaryPlatform: "Klaviyo",
    platformsMentioned: ["Klaviyo"],
    platformCategory: "ESP",
    platformPreferenceTier: "core",
    platformFitReason: "Core platform fit.",
    shouldSkipForPlatform: false,
    skipReason: "",
    businessType: "DTC ecommerce",
    ecommerceVertical: "beauty",
    jobCategory: "Email marketing",
    taskType: "Email flows",
    requiredSkills: ["Klaviyo"],
    clientGoal: "Improve lifecycle revenue.",
    redFlags: [],
    fitScoreReasoning: "Strong fit.",
    proposalAngle: "Keep platform-specific.",
    proofRecommendations: [],
    draftConstraints: [],
    platformMismatchWarnings: [],
    needsManualReview: false,
    confidence: "high",
    ...overrides,
  };
}

function warningMessages(result: ReturnType<typeof qaProposalPlatformGrounding>): string[] {
  return result.warnings.map((warning) => warning.message);
}

function runTests(): void {
  const hubspotWithKlaviyoDraft = qaProposalPlatformGrounding({
    intelligence: intelligence({
      primaryPlatform: "HubSpot",
      platformsMentioned: ["HubSpot"],
      platformCategory: "CRM",
      platformPreferenceTier: "non_core_review",
      needsManualReview: true,
    }),
    draftText: "I would start by auditing your Klaviyo flows and lifecycle campaigns, then rebuild segmentation around repeat purchase.",
  });
  assert.equal(hubspotWithKlaviyoDraft.ok, false);
  assert(warningMessages(hubspotWithKlaviyoDraft).some((message) => message.includes("job primary platform is HubSpot, but draft mentions Klaviyo")), "HubSpot job with Klaviyo draft should warn");

  const brevoWithKlaviyoDraft = qaProposalPlatformGrounding({
    intelligence: intelligence({
      primaryPlatform: "Brevo",
      platformsMentioned: ["Brevo"],
      platformPreferenceTier: "non_core_review",
      needsManualReview: true,
    }),
    draftText: "The first place I would look is your Klaviyo welcome and abandon cart flow logic.",
  });
  assert.equal(brevoWithKlaviyoDraft.ok, false);
  assert(warningMessages(brevoWithKlaviyoDraft).some((message) => message.includes("job primary platform is Brevo, but draft mentions Klaviyo")), "Brevo job with Klaviyo draft should warn");

  const klaviyoWithKlaviyoDraft = qaProposalPlatformGrounding({
    intelligence: intelligence({ primaryPlatform: "Klaviyo", platformsMentioned: ["Klaviyo"], platformPreferenceTier: "core" }),
    draftText: "I would start inside Klaviyo by checking flow timing, segmentation, and revenue attribution.",
  });
  assert.equal(klaviyoWithKlaviyoDraft.ok, true);
  assert.equal(klaviyoWithKlaviyoDraft.warnings.length, 0);

  const migrationDraft = qaProposalPlatformGrounding({
    intelligence: intelligence({
      primaryPlatform: "HubSpot",
      platformsMentioned: ["HubSpot", "Klaviyo"],
      platformCategory: "CRM",
      platformPreferenceTier: "non_core_review",
      needsManualReview: true,
    }),
    draftText: "If you are migrating from HubSpot to Klaviyo, I would first map the lifecycle triggers and keep the handoff clean between both platforms.",
  });
  assert(!warningMessages(migrationDraft).some((message) => /draft mentions Klaviyo/i.test(message)), "Migration/multi-platform wording should not be treated as a mismatch");

  const missingIntelligence = qaProposalPlatformGrounding({
    intelligence: null,
    draftText: "I would review the platform setup first.",
  });
  assert.equal(missingIntelligence.ok, true);
  assert.equal(missingIntelligence.warnings.length, 0);

  for (const platform of ["Klaviyo", "Attentive", "Postscript", "Omnisend"]) {
    const core = qaProposalPlatformGrounding({
      intelligence: intelligence({ primaryPlatform: platform, platformsMentioned: [platform], platformPreferenceTier: "core", needsManualReview: false }),
      draftText: `I would start in ${platform} by reviewing lifecycle automations and segmentation.`,
    });
    assert.equal(core.ok, true, `Core platform ${platform} should pass when grounded correctly`);
  }

  for (const platform of ["MailerLite", "Mailchimp"]) {
    const secondary = qaProposalPlatformGrounding({
      intelligence: intelligence({ primaryPlatform: platform, platformsMentioned: [platform], platformPreferenceTier: "secondary", needsManualReview: false }),
      draftText: `I would tighten the ${platform} automations first, then improve campaign segmentation.`,
    });
    assert.equal(secondary.ok, true, `Secondary platform ${platform} should pass when draft names the actual platform`);
  }

  for (const platform of ["Customer.io", "ActiveCampaign", "SendGrid", "Campaign Refinery", "Braze", "Iterable", "Salesforce Marketing Cloud"]) {
    const nonCoreGrounded = qaProposalPlatformGrounding({
      intelligence: intelligence({ primaryPlatform: platform, platformsMentioned: [platform], platformPreferenceTier: "non_core_review", needsManualReview: true }),
      draftText: `I would keep this grounded in ${platform} and first review the lifecycle automation setup.`,
    });
    assert(!warningMessages(nonCoreGrounded).some((message) => /draft mentions Klaviyo/i.test(message)), `Non-core platform ${platform} should not get a Klaviyo mismatch when draft is grounded correctly`);
  }

  console.log("proposal QA platform grounding tests passed");
}

runTests();
