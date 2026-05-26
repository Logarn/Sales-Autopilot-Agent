import { buildV3CapturePacket, shouldPostLeadPacket } from "./slackPacketV3";
import { buildApplicationDraft } from "./agent";
import { scoreJob } from "./filter";
import { buildDeterministicOpportunityPacket, normalizedPacketToJobPosting } from "./normalization";
import { ScoredJob } from "./types";

function createScoredJob(overrides: Partial<ScoredJob> = {}): ScoredJob {
  return {
    id: "manual:upwork-1234567890",
    title: "Klaviyo retention strategist for beauty skincare brand",
    url: "https://www.upwork.com/jobs/~1234567890",
    description: "Shopify beauty brand needs Klaviyo, quiz segmentation, zero-party data, email and SMS lifecycle strategy.",
    postedAt: "2026-05-11T09:00:00.000Z",
    budget: "$60-$80 /hr",
    clientCountry: "United States",
    clientRating: 4.8,
    clientSpend: 120000,
    clientHireRate: 92,
    clientTotalHires: 47,
    clientFeedbackCount: 29,
    category: "Digital Marketing",
    experienceLevel: "Expert",
    connectsCost: 4,
    skills: ["Klaviyo", "Shopify", "SMS Marketing", "Retention Marketing"],
    sourceQuery: "manual",
    score: 89,
    matchLevel: "high",
    matchedKeywords: ["beauty", "Klaviyo", "retention"],
    negativeKeywords: [],
    scoreBreakdown: {
      fitScore: { score: 88, reasons: ["Strong category fit"], risks: [] },
      clientQualityScore: { score: 92, reasons: ["Strong client history"], risks: [] },
      opportunityScore: { score: 83, reasons: ["Clear scope"], risks: [] },
      redFlagScore: { score: 95, reasons: ["No serious red flags"], risks: [] },
      connectsRiskScore: { score: 90, reasons: ["Connects budget is clear"], risks: [] },
      finalScore: 89,
      reasons: ["Beauty/skincare + Klaviyo fit", "Quiz / zero-party data relevance"],
      risks: ["Need to confirm current retention baseline"],
    },
    applicationDraft: {
      jobId: "manual:upwork-1234567890",
      status: "draft",
      fitScore: 89,
      fitReasons: ["Expert retention experience"],
      redFlags: ["No major red flags"],
      suggestedBid: "$72/hr",
      suggestedConnects: 4,
      suggestedBoostConnects: 8,
      connectsWarnings: ["Boost only if budget allows"],
      selectedPortfolioItems: [],
      proposalQuality: {
        score: 92,
        issues: [],
        positiveSignals: ["Clear positioning"],
        wordCount: 220,
      },
      proposalText: "Most beauty brands are not short on sends. They are leaking repeat purchase because segmentation, flows, and subscriber intent are not doing enough work.",
      generatedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertIncludes(haystack: string, needle: string, label: string): void {
  assert(haystack.includes(needle), `${label}: expected ${JSON.stringify(needle)} in output`);
}

function assertNotIncludes(haystack: string, needle: string, label: string): void {
  assert(!haystack.toLowerCase().includes(needle.toLowerCase()), `${label}: unexpected ${JSON.stringify(needle)} in output`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label}: expected ${JSON.stringify(expected)} but received ${JSON.stringify(actual)}`);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function runTests(): void {
  const beautyJob = createScoredJob();
  const beautyPacket = buildV3CapturePacket(beautyJob, {
    upworkUrl: beautyJob.url,
    captureStatus: "packet_sent",
    browserCaptureActionId: 11,
    autoPrepareNote: "Strong fit. I’m preparing the Upwork draft now. Final submit remains manual.",
    applicationQuestions: ["How would you improve our Klaviyo revenue mix?"],
    questionAnswers: ["I would start with segmentation quality, flow timing, and what is happening between first purchase and second purchase."],
    platform: "Klaviyo",
    businessType: "DTC ecommerce",
    ecommerceVertical: "Beauty",
    platformPreferenceTier: "Core",
  });
  const beautyText = beautyPacket.text;

  assertIncludes(beautyText, "🚀 *New Upwork Lead*", "lead heading");
  assertIncludes(beautyText, "<@U0A2X5BCNKC>", "Steve mention");
  assertIncludes(beautyText, "<@U0AHJFYV42K>", "Natalie mention");
  assert(countOccurrences(beautyText, "<@U0A2X5BCNKC>") === 1, "Steve mention should appear once");
  assert(countOccurrences(beautyText, "<@U0AHJFYV42K>") === 1, "Natalie mention should appear once");
  assertNotIncludes(beautyText, "Review Packet", "no packet heading");
  assertNotIncludes(beautyText, "packet context", "no packet terminology");
  assertIncludes(beautyText, beautyJob.title, "job title");
  assertIncludes(beautyText, beautyJob.url, "job url");
  assertIncludes(beautyText, "*Fit:* 🟢 High — 89/100", "fit score");
  assertIncludes(beautyText, "*Source:* Manual Slack URL", "manual source label");
  assertIncludes(beautyText, "*Recommended action:* Manual platform review before draft prep", "recommended action");
  assertIncludes(beautyText, "🧭 *Lead context*", "lead context section");
  assertIncludes(beautyText, "• Platform: Klaviyo", "lead context platform");
  assertIncludes(beautyText, "• Platform tier: Core", "lead context tier");
  assertIncludes(beautyText, "• Business: DTC ecommerce", "lead context business");
  assertIncludes(beautyText, "• Vertical: Beauty", "lead context vertical");
  assertIncludes(beautyText, "🧠 *Why this might be a fit*", "fit section");
  assertIncludes(beautyText, "⚠️ *Watch-outs*", "watch-outs section");
  assertIncludes(beautyText, "✍️ *Draft angle*", "draft angle section");
  assertIncludes(beautyText, "Proposal preview (review only)", "proposal preview section");
  assertIncludes(beautyText, "📝 *Screening answers*", "screening section");
  assertIncludes(beautyText, "Q: How would you improve our Klaviyo revenue mix?", "screening question");
  assertIncludes(beautyText, "A: I would start with segmentation quality", "screening answer");
  assertIncludes(beautyText, "📎 *Suggested proof/assets*", "proof/assets section");
  assertIncludes(beautyText, "Truly Beauty", "selected proof rendering");
  assertIncludes(beautyText, "Truly Beauty case study", "selected assets rendering");
  assertIncludes(beautyText, "Status: File missing locally - manual upload needed", "missing proof availability status");
  assertNotIncludes(beautyText, "profile/attachments/truly-beauty-case-study.pdf", "raw asset path should be hidden");
  assertIncludes(beautyText, "💬 *Available replies*", "commands heading");
  for (const cmd of ["prepare draft", "revise: <instruction>", "skip", "status", "mark submitted"]) {
    assertIncludes(beautyText, `\`${cmd}\``, `command ${cmd}`);
  }
  assertNotIncludes(beautyText, "`retry <action-id>`", "normal lead should hide retry command");
  assertIncludes(beautyText, "*Draft note:* Strong fit. Reply `prepare draft` when ready.", "not queued draft note");
  assertNotIncludes(beautyText, "I’m preparing the Upwork draft now", "not queued message should not claim draft prep started");
  assertIncludes(beautyText, "Final submit remains manual", "manual submit language");
  assertIncludes(beautyText, "_Debug: action #11", "tiny debug footer");
  for (const internal of ["captureStrategy", "selectedPageKind", "directFallbackAttempted", "sourceContextReadable", "recencyRank", "detector diagnostics", "Browser status"]) {
    assertNotIncludes(beautyText, internal, `hidden internal ${internal}`);
  }
  assertNotIncludes(beautyText, "figma.com", "non-design beauty lead should not include Figma links");
  assertNotIncludes(beautyText, "copy/paste", "copy paste workflow");

  const discoveryText = buildV3CapturePacket(beautyJob, {
    upworkUrl: beautyJob.url,
    captureStatus: "packet_sent",
    browserCaptureActionId: 16,
    sourceType: "best_matches",
    sourceLabel: "Best Matches",
    postedAtText: "27 minutes ago",
    applicationQuestions: [],
  }).text;
  assertIncludes(discoveryText, "*Source:* Best Matches — discovered automatically", "discovery source wording");
  assertIncludes(discoveryText, "*Posted:* 27 minutes ago", "postedAtText rendering");
  assertNotIncludes(discoveryText, "Best Matches (best_matches)", "source type should not be prominent");
  assertNotIncludes(discoveryText, "recencyRank", "recency rank hidden");

  const recentSourceText = buildV3CapturePacket(beautyJob, {
    upworkUrl: beautyJob.url,
    captureStatus: "packet_sent",
    sourceType: "recent_jobs",
    sourceLabel: "Recent Jobs",
    applicationQuestions: [],
  }).text;
  assertIncludes(recentSourceText, "*Source:* Recent Jobs — discovered automatically", "recent source wording");

  const queuedDraftText = buildV3CapturePacket(beautyJob, {
    upworkUrl: beautyJob.url,
    captureStatus: "packet_sent",
    browserCaptureActionId: 17,
    browserDraftActionId: 18,
    browserDraftStatus: "queued",
    autoPrepareNote: "Strong fit. I’m preparing the Upwork draft now. Final submit remains manual.",
    applicationQuestions: [],
  }).text;
  assertIncludes(queuedDraftText, "*Recommended action:* Draft is being staged for manual review", "queued draft recommended action");
  assertIncludes(queuedDraftText, "I’m preparing the Upwork draft now", "queued draft note may say prep started");

  const healthJob = createScoredJob({
    title: "Supplements retention strategist for Klaviyo + SMS",
    description: "Need lifecycle and subscription retention help for a health supplements brand.",
    skills: ["Klaviyo", "SMS Marketing", "Subscriptions"],
  });
  const healthText = buildV3CapturePacket(healthJob, {
    upworkUrl: healthJob.url,
    captureStatus: "captured",
    autoPrepareNote: "Not auto-preparing because Upwork needs manual browser attention. Resolve the browser issue first, then use `retry <action-id>` or `status`. I did not submit anything.",
    applicationQuestions: [],
  }).text;
  assertIncludes(healthText, "Dr. Rachael Institute", "health proof rendering");
  assertIncludes(healthText, "manual browser attention", "auto-prepare blocked note rendering");
  assertIncludes(healthText, "`retry <action-id>`", "manual attention lead should show retry command");
  assertIncludes(healthText, "mention-only", "mention-only warning rendering");
  assertNotIncludes(healthText, "profile/attachments/dr-rachael-email-performance-report.pdf", "sensitive health report raw path not shown");

  const designJob = createScoredJob({
    title: "Email design + Figma specialist for DTC brand",
    description: "Need Figma-based email templates and campaign design support for Shopify brand.",
    category: "Design",
    skills: ["Figma", "Email Design", "Klaviyo"],
  });
  const designText = buildV3CapturePacket(designJob, {
    upworkUrl: designJob.url,
    captureStatus: "packet_sent",
    browserCaptureActionId: 22,
    browserDraftStatus: "pending_review",
    browserDraftActionId: 45,
    applicationQuestions: [],
  }).text;
  assertIncludes(designText, "Design Case Studies", "design proof rendering");
  assertIncludes(designText, "*Figma:*", "figma section");
  assertIncludes(designText, "figma.com", "figma links");
  assertIncludes(designText, "draft action #45", "draft action id only in debug footer");

  const videoJob = createScoredJob({
    title: "Long-term retention lead with Loom intro preferred",
    description: "Please include a short video intro or Loom if you have one.",
    skills: ["Klaviyo", "Retention Marketing"],
  });
  const videoText = buildV3CapturePacket(videoJob, {
    upworkUrl: videoJob.url,
    captureStatus: "packet_sent",
    applicationQuestions: [],
  }).text;
  assertIncludes(videoText, "*Video:*", "video section");
  assertIncludes(videoText, "youtu.be", "video link rendering");

  const missingDraftJob = createScoredJob({
    applicationDraft: undefined,
    score: 72,
    matchLevel: "medium",
    scoreBreakdown: {
      ...beautyJob.scoreBreakdown,
      finalScore: 72,
      fitScore: { ...beautyJob.scoreBreakdown.fitScore, score: 72 },
    },
  });
  const missingText = buildV3CapturePacket(missingDraftJob, {
    upworkUrl: missingDraftJob.url,
    captureStatus: "captured",
    applicationQuestions: [],
  }).text;
  assertIncludes(missingText, "Proposal draft is not yet available.", "missing draft fallback");
  assertNotIncludes(missingText, "Screening answers", "missing Q&A omitted from main message");
  assertIncludes(missingText, "• Platform: Not analyzed yet", "job intelligence unavailable fallback");

  const brevoText = buildV3CapturePacket(createScoredJob({
    title: "Brevo email automation specialist for ecommerce brand",
    applicationDraft: {
      ...beautyJob.applicationDraft!,
      jobIntelligence: {
        schemaVersion: "1.0",
        primaryPlatform: "Brevo",
        platformsMentioned: ["Brevo"],
        platformCategory: "ESP",
        platformPreferenceTier: "non_core_review",
        platformFitReason: "Brevo is a non-core ESP; review carefully before using Klaviyo-specific language.",
        shouldSkipForPlatform: false,
        skipReason: "Non-core platform but ecommerce retention scope may still be relevant.",
        businessType: "DTC ecommerce",
        ecommerceVertical: "beauty",
        jobCategory: "Email marketing",
        taskType: "Email flows / retention strategy",
        requiredSkills: ["Brevo", "Email automation"],
        clientGoal: "Improve retention automation",
        redFlags: [],
        fitScoreReasoning: "Potential retention fit but platform is non-core.",
        proposalAngle: "Stay platform-specific to Brevo unless migration is confirmed.",
        proofRecommendations: [],
        draftConstraints: ["Do not pretend this is Klaviyo."],
        platformMismatchWarnings: ["platform_mismatch: job primary platform is Brevo, but draft mentions Klaviyo."],
        needsManualReview: true,
        confidence: "medium",
      },
    },
  }), {
    upworkUrl: beautyJob.url,
    captureStatus: "packet_sent",
    applicationQuestions: [],
  }).text;
  assertIncludes(brevoText, "🚀 *New Upwork Lead*", "packet rendering remains normal when called directly");
  assertEqual(shouldPostLeadPacket(createScoredJob({
    applicationDraft: {
      ...beautyJob.applicationDraft!,
      jobIntelligence: {
        ...beautyJob.applicationDraft!.jobIntelligence!,
        primaryPlatform: "Brevo",
        platformsMentioned: ["Brevo"],
        platformPreferenceTier: "non_core_review",
      },
    },
  }), { upworkUrl: beautyJob.url, captureStatus: "packet_sent" }), false, "ineligible platform should not post");

  const qaGeneratedWarningText = buildV3CapturePacket(createScoredJob({
    title: "HubSpot lifecycle email specialist for ecommerce brand",
    applicationDraft: {
      ...beautyJob.applicationDraft!,
      proposalText: "I would start by auditing your Klaviyo flows, campaign segments, and lifecycle revenue attribution.",
      jobIntelligence: {
        schemaVersion: "1.0",
        primaryPlatform: "HubSpot",
        platformsMentioned: ["HubSpot"],
        platformCategory: "CRM",
        platformPreferenceTier: "non_core_review",
        platformFitReason: "HubSpot is non-core; review carefully.",
        shouldSkipForPlatform: false,
        skipReason: "Use HubSpot/platform-neutral language unless migration is confirmed.",
        businessType: "DTC ecommerce",
        ecommerceVertical: "home",
        jobCategory: "Lifecycle marketing",
        taskType: "CRM email automation",
        requiredSkills: ["HubSpot", "Email automation"],
        clientGoal: "Improve lifecycle automation",
        redFlags: [],
        fitScoreReasoning: "Potential lifecycle fit but platform is non-core.",
        proposalAngle: "Stay grounded in HubSpot unless migration is confirmed.",
        proofRecommendations: [],
        draftConstraints: ["Do not pretend this is Klaviyo."],
        platformMismatchWarnings: [],
        needsManualReview: true,
        confidence: "medium",
      },
    },
  }), {
    upworkUrl: beautyJob.url,
    captureStatus: "packet_sent",
    applicationQuestions: [],
  }).text;
  assertEqual(shouldPostLeadPacket(createScoredJob({
    applicationDraft: {
      ...beautyJob.applicationDraft!,
      jobIntelligence: {
        ...beautyJob.applicationDraft!.jobIntelligence!,
        primaryPlatform: "HubSpot",
        platformsMentioned: ["HubSpot"],
        platformPreferenceTier: "non_core_review",
      },
    },
  }), { upworkUrl: beautyJob.url, captureStatus: "packet_sent" }), false, "HubSpot should not post");

  const ineligibleText = buildV3CapturePacket(createScoredJob({
    title: "HubSpot lifecycle admin support",
    applicationDraft: {
      ...beautyJob.applicationDraft!,
      jobIntelligence: {
        ...beautyJob.applicationDraft!.jobIntelligence!,
        primaryPlatform: "HubSpot",
        platformsMentioned: ["HubSpot"],
        platformPreferenceTier: "non_core_review",
      },
    },
  }), {
    upworkUrl: beautyJob.url,
    captureStatus: "packet_sent",
    applicationQuestions: [],
  }).text;
  assertNotIncludes(ineligibleText, "⏭️ *Platform skipped:*", "no per-job skip Slack message should be rendered");

  const connectsManualReviewJob = createScoredJob({
    score: 84,
    scoreBreakdown: {
      ...beautyJob.scoreBreakdown,
      clientQualityScore: { score: 46, reasons: ["Thin client history"], risks: ["Limited spend"] },
      finalScore: 84,
    },
    applicationDraft: {
      ...beautyJob.applicationDraft!,
      connectsStrategy: {
        decision: "manual_review",
        requiredConnects: 16,
        suggestedBoostConnects: 0,
        totalConnects: 16,
        expectedValueScore: 62,
        reasons: ["Client quality supports some spend."],
        risks: ["Total Connects require review before applying."],
      },
      jobIntelligence: {
        ...beautyJob.applicationDraft!.jobIntelligence!,
        primaryPlatform: "Mailchimp",
        platformsMentioned: ["Mailchimp"],
        platformPreferenceTier: "secondary",
        platformFitReason: "Mailchimp is approved but spend needs review.",
      },
    },
  });
  assertEqual(
    shouldPostLeadPacket(connectsManualReviewJob, { upworkUrl: connectsManualReviewJob.url, captureStatus: "packet_sent" }),
    true,
    "eligible connects manual-review lead should still post",
  );
  const connectsManualReviewText = buildV3CapturePacket(connectsManualReviewJob, {
    upworkUrl: connectsManualReviewJob.url,
    captureStatus: "packet_sent",
    applicationQuestions: [],
  }).text;
  assertIncludes(connectsManualReviewText, "*Recommended action:* Manual platform review before draft prep", "connects manual-review lead should render manual review wording");
  assertIncludes(connectsManualReviewText, "Connects strategy: manual review", "connects manual-review lead should show spend review context");

  const capturedNormalized = buildDeterministicOpportunityPacket(
    "Beauty Shopify Klaviyo retention role. Need help with quiz segmentation, zero-party data, campaigns, flows, and repeat purchase strategy.",
    {
      url: "https://www.upwork.com/jobs/~captured-beauty",
      source: "deterministic",
      capturedAt: new Date("2026-05-11T10:00:00.000Z"),
    },
  );
  const capturedJob = normalizedPacketToJobPosting(capturedNormalized);
  const scoredCapturedJob = scoreJob({
    ...capturedJob,
    title: "Beauty Shopify Klaviyo retention role",
    description:
      "Need help with quiz segmentation, zero-party data, campaigns, flows, and repeat purchase strategy for a beauty ecommerce brand.",
    skills: ["Klaviyo", "Shopify", "Retention Marketing", "SMS Marketing"],
    category: "Digital Marketing",
  });
  scoredCapturedJob.applicationDraft = buildApplicationDraft(scoredCapturedJob);
  const capturedText = buildV3CapturePacket(scoredCapturedJob, {
    upworkUrl: scoredCapturedJob.url,
    captureStatus: "packet_sent",
    browserCaptureActionId: 77,
    applicationQuestions: ["How would you improve our subscriber quality?"],
    questionAnswers: ["I would start with list source quality, segmentation logic, and what happens after first purchase."],
  }).text;
  assertIncludes(capturedText, "Truly Beauty", "captured/scored pipeline lead should include profile brain proof");
  assertIncludes(capturedText, "Truly Beauty case study", "captured/scored pipeline lead should include selected asset label");
  assertNotIncludes(capturedText, "profile/attachments/truly-beauty-case-study.pdf", "captured/scored pipeline lead should hide selected asset path");
  assertIncludes(capturedText, "prepare draft", "captured/scored pipeline lead should include prepare draft workflow");
  assertNotIncludes(capturedText, "copy/paste", "captured/scored pipeline lead should not introduce copy/paste workflow");

  assert(beautyPacket.blocks.length > 0, "block kit payload should be present");
  assert(JSON.stringify(beautyPacket.blocks).includes("<@U0A2X5BCNKC>"), "blocks should include Steve mention in main lead message");

  console.log("slack lead message V3 tests passed");
}

if (require.main === module) {
  try {
    runTests();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`slack lead message V3 tests failed: ${message}`);
    process.exitCode = 1;
  }
}
