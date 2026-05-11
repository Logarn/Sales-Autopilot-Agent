import { buildV3CapturePacket } from "./slackPacketV3";
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
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(haystack: string, needle: string, label: string): void {
  assert(haystack.includes(needle), `${label}: expected ${JSON.stringify(needle)} in output`);
}

function assertNotIncludes(haystack: string, needle: string, label: string): void {
  assert(!haystack.toLowerCase().includes(needle.toLowerCase()), `${label}: unexpected ${JSON.stringify(needle)} in output`);
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
  });
  const beautyText = beautyPacket.text;

  assertIncludes(beautyText, "V3 Review Packet", "packet heading");
  assertIncludes(beautyText, beautyJob.title, "job title");
  assertIncludes(beautyText, beautyJob.url, "job url");
  assertIncludes(beautyText, "📊 Fit score", "fit score section");
  assertIncludes(beautyText, "Score components", "score components");
  assertIncludes(beautyText, "Fit reasons", "fit reasons");
  assertIncludes(beautyText, "Risks / red flags", "risk section");
  assertIncludes(beautyText, "Connects plan", "connects plan");
  assertIncludes(beautyText, "Bid / rate recommendation", "bid recommendation");
  assertIncludes(beautyText, "Proposal draft (review only)", "proposal review section");
  assertIncludes(beautyText, "Q: How would you improve our Klaviyo revenue mix?", "screening question");
  assertIncludes(beautyText, "A: I would start with segmentation quality", "screening answer");
  assertIncludes(beautyText, "Truly Beauty", "selected proof rendering");
  assertIncludes(beautyText, "profile/attachments/truly-beauty-case-study.pdf", "selected assets rendering");
  assertIncludes(beautyText, "Recommend-only assets", "recommend-only assets section");
  assertIncludes(beautyText, "Mention-only proof", "mention-only proof section");
  assertIncludes(beautyText, "Manual review warnings", "manual warnings section");
  assertIncludes(beautyText, "Browser status", "browser status section");
  assertIncludes(beautyText, "Strong fit. I’m preparing the Upwork draft now", "auto-prepare success note");
  assertIncludes(beautyText, "already being staged for review", "queued auto-prepare workflow wording");
  for (const cmd of ["status", "approve", "reject", "revise: <instruction>", "prepare draft", "retry <action-id>", "mark submitted"]) {
    assertIncludes(beautyText, cmd, `command ${cmd}`);
  }
  assertNotIncludes(beautyText, "copy/paste", "copy paste workflow");
  assertNotIncludes(beautyText, "copy the proposal", "copy proposal workflow");
  assertNotIncludes(beautyText, "Use `prepare draft` to stage", "queued auto-prepare should not imply manual prepare is required");

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
  assertNotIncludes(healthText, "Reply `prepare draft` to override", "hard block note should not suggest manual override");
  assertIncludes(healthText, "mention-only", "mention-only warning rendering");
  assertNotIncludes(healthText, "profile/attachments/dr-rachael-email-performance-report.pdf\n\n*Auto-attach assets", "sensitive health report not auto attached");

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
  assertIncludes(designText, "Figma recommendations", "figma section");
  assertIncludes(designText, "figma.com", "figma links");
  assertIncludes(designText, "Browser draft action: #45", "browser draft action id");

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
  assertIncludes(videoText, "Video recommendations", "video section");
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
  assertIncludes(missingText, "No explicit screening questions detected on capture.", "missing Q&A fallback");

  const capturedPacket = buildDeterministicOpportunityPacket(
    "Beauty Shopify Klaviyo retention role. Need help with quiz segmentation, zero-party data, campaigns, flows, and repeat purchase strategy.",
    {
      url: "https://www.upwork.com/jobs/~captured-beauty",
      source: "deterministic",
      capturedAt: new Date("2026-05-11T10:00:00.000Z"),
    },
  );
  const capturedJob = normalizedPacketToJobPosting(capturedPacket);
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
  assertIncludes(capturedText, "Truly Beauty", "captured/scored pipeline packet should include profile brain proof");
  assertIncludes(capturedText, "profile/attachments/truly-beauty-case-study.pdf", "captured/scored pipeline packet should include selected asset");
  assertIncludes(capturedText, "prepare draft", "captured/scored pipeline packet should include prepare draft workflow");
  assertNotIncludes(capturedText, "copy/paste", "captured/scored pipeline packet should not introduce copy/paste workflow");

  assert(beautyPacket.blocks.length > 0, "block kit payload should be present");

  console.log("slack packet V3 tests passed");
}

if (require.main === module) {
  try {
    runTests();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`slack packet V3 tests failed: ${message}`);
    process.exitCode = 1;
  }
}
