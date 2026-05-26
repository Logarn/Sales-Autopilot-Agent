import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function cleanupDatabase(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore cleanup failures
    }
  }
}

async function runTests(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-browser-apply.db");
  cleanupDatabase(tempDb);
  process.env.DB_PATH = tempDb;

  const { buildApplicationDraft } = require("./agent") as {
    buildApplicationDraft: (job: any) => any;
  };
  const { scoreJob } = require("./filter") as {
    scoreJob: (job: any) => any;
  };
  const {
    markJobSeen,
    closeDb,
    upsertSlackThreadState,
  } = require("./db") as {
    markJobSeen: (job: any, notified: boolean) => void;
    closeDb: () => void;
    upsertSlackThreadState: (input: any) => unknown;
  };
  const { buildBrowserApplyPlan } = require("./browserApply") as {
    buildBrowserApplyPlan: (jobId: string) => { plan: any; valid: boolean; issues: Array<{ severity: string; code: string; message: string }> };
  };
  const { autoPrepareDraftForThread, buildCaptureCompletionStatus, decideAutoPrepareDraft, detectStateWithDiagnostics, isCaptureBlockedState, postDiscoveryCapturePacket, postV3CapturePacketToThread, selectPageForBrowserAction, settlePageAndDetect } = require("./browserWorker") as {
    autoPrepareDraftForThread: (job: any, thread: { channelId: string; messageTs: string; threadTs: string }, options?: any) => { shouldQueue: boolean; category: string; note: string; actionId?: number; duplicate?: boolean };
    buildCaptureCompletionStatus: (input: { hasThreadContext: boolean; packetPosted: boolean; discoverySlackStatus?: "not_discovery" | "missing_channel" | "post_failed" | "posted" }) => string;
    decideAutoPrepareDraft: (job: any, options?: any) => { shouldQueue: boolean; category: string; note: string; reason: string };
    detectStateWithDiagnostics: (snapshot: { url: string; title: string; textExcerpt: string }, action: any) => { state: string; source: string; matchedText?: string; summary: string };
    isCaptureBlockedState: (state: string) => boolean;
    postDiscoveryCapturePacket: (input: any, deps?: {
      postChannelMessage?: (params: any) => Promise<{ ok: boolean; ts?: string; channel?: string }>;
      postWebhookMessage?: (params: any) => Promise<boolean>;
    }) => Promise<{ status: "not_discovery" | "missing_channel" | "post_failed" | "posted"; outcome: "not_needed" | "posted" | "failed"; thread?: { channelId: string; messageTs: string; threadTs: string } }>;
    postV3CapturePacketToThread: (job: any, thread: { channelId: string; messageTs: string; threadTs: string }, context: any, postThreadMessage?: (params: any) => Promise<boolean>) => Promise<"posted" | "skipped" | "failed">;
    selectPageForBrowserAction: (context: { pages?: () => Array<{ url: () => string }>; newPage: () => Promise<any> }, targetUrl: string) => Promise<{ page: any; reusedExistingPage: boolean; reason: string }>;
    settlePageAndDetect: (page: any, action: any) => Promise<{ snapshot: any; bodyText: string; detection: { state: string; source: string; matchedText?: string }; samples: Array<any> }>;
  };
  const { buildPrepareDraftQueueReply } = require("./slackSocket") as {
    buildPrepareDraftQueueReply: (input: {
      jobId: string;
      threadTitle: string;
      upworkUrl: string;
      actionId: number;
      duplicate: boolean;
      duplicateStatus?: string | null;
    }) => string;
  };
  assert(buildCaptureCompletionStatus({ hasThreadContext: true, packetPosted: true }) === "Capture completed and lead message posted to Slack thread.", "Thread capture should report Slack lead message posted only after post succeeds");
  assert(buildCaptureCompletionStatus({ hasThreadContext: false, packetPosted: false }) === "Capture completed; no Slack thread context available, lead message not posted.", "Threadless capture should not claim Slack lead message was posted");
  assert(buildCaptureCompletionStatus({ hasThreadContext: true, packetPosted: false }) === "Capture completed; Slack lead message was not posted.", "Unposted lead message with thread context should not claim Slack lead message was posted");
  assert(buildCaptureCompletionStatus({ hasThreadContext: false, packetPosted: false, discoverySlackStatus: "missing_channel" }) === "Capture completed; no discovery Slack channel configured, lead message not posted.", "Discovery capture should report missing discovery channel accurately");
  assert(buildCaptureCompletionStatus({ hasThreadContext: false, packetPosted: true, discoverySlackStatus: "posted" }) === "Capture completed and discovery lead message posted to Slack channel.", "Discovery capture should report channel lead message when posted");

  const {
    acquireBrowserSession,
    buildBrowserSessionLaunchCommand,
    classifyBrowserSessionError,
  } = require("./browserSessionControl") as {
    acquireBrowserSession: (chromium: any, options: any) => Promise<{ mode: string; context: { newPage: () => Promise<unknown> }; close: () => Promise<void> }>;
    buildBrowserSessionLaunchCommand: (input: { chromeExecutablePath: string; userDataDir: string; cdpUrl: string; startUrl?: string }) => { executablePath: string; args: string[] };
    classifyBrowserSessionError: (error: unknown) => string;
  };

  const klaviyoIntel = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: "1.0",
    primaryPlatform: "Klaviyo",
    platformsMentioned: ["Klaviyo"],
    platformCategory: "ESP",
    platformPreferenceTier: "core",
    platformFitReason: "Klaviyo is the stated platform.",
    shouldSkipForPlatform: false,
    skipReason: "",
    businessType: "DTC ecommerce",
    ecommerceVertical: "beauty",
    jobCategory: "Lifecycle marketing",
    taskType: "Klaviyo retention flows and campaigns",
    requiredSkills: ["Klaviyo", "Email Marketing", "SMS Marketing"],
    clientGoal: "Increase repeat purchase and retention revenue",
    redFlags: [],
    fitScoreReasoning: "Strong DTC lifecycle fit.",
    proposalAngle: "Lead with retention audit and priority lifecycle fixes.",
    proofRecommendations: [],
    draftConstraints: [],
    platformMismatchWarnings: [],
    needsManualReview: false,
    confidence: "high",
    ...overrides,
  });

  const manualReviewIntel = (overrides: Record<string, unknown> = {}) => klaviyoIntel({
    primaryPlatform: "unknown",
    platformsMentioned: [],
    platformPreferenceTier: "unknown",
    platformFitReason: "Platform needs manual review, but DTC lifecycle fit is strong.",
    businessType: "DTC ecommerce",
    ecommerceVertical: "beauty",
    taskType: "Lifecycle email and SMS retention strategy",
    clientGoal: "Increase repeat purchase and retention revenue",
    confidence: "medium",
    ...overrides,
  });

  try {
    const beautyJob = scoreJob({
      id: "beauty-job-1",
      title: "Klaviyo retention strategist for beauty skincare brand",
      url: "https://www.upwork.com/jobs/~beautyjob123456",
      description: "Shopify beauty brand needs Klaviyo, quiz segmentation, zero-party data, flows, campaigns, and SMS retention support.",
      postedAt: new Date().toISOString(),
      budget: "$50-$75/hr",
      clientCountry: "United States",
      clientRating: 4.9,
      clientSpend: 150000,
      clientHireRate: 85,
      clientTotalHires: 30,
      clientFeedbackCount: 20,
      category: "Digital Marketing",
      experienceLevel: "Expert",
      connectsCost: 4,
      skills: ["Klaviyo", "Shopify", "SMS Marketing", "Retention Marketing"],
      sourceQuery: "manual",
    });
    beautyJob.applicationDraft = buildApplicationDraft(beautyJob);
    beautyJob.applicationDraft.jobIntelligence = klaviyoIntel();
    markJobSeen(beautyJob, false);
    upsertSlackThreadState({
      channelId: "C123",
      messageTs: "111.222",
      threadTs: "111.222",
      upworkUrl: beautyJob.url,
      jobId: beautyJob.id,
      status: "packet_sent",
    });

    let threadPostCalled = false;
    const postedStatus = await postV3CapturePacketToThread(
      beautyJob,
      { channelId: "C123", messageTs: "111.222", threadTs: "111.222" },
      { upworkUrl: beautyJob.url, captureStatus: "packet_sent" },
      async () => {
        threadPostCalled = true;
        return true;
      },
    );
    assert(postedStatus === "posted", "Thread packet helper should report posted when Slack thread post succeeds");
    assert(threadPostCalled, "Eligible thread packet should call Slack post helper");

    const failedThreadStatus = await postV3CapturePacketToThread(
      beautyJob,
      { channelId: "C123", messageTs: "111.222", threadTs: "111.222" },
      { upworkUrl: beautyJob.url, captureStatus: "packet_sent" },
      async () => false,
    );
    assert(failedThreadStatus === "failed", "Thread packet helper should report failed when Slack post fails");

    threadPostCalled = false;
    const skippedThreadStatus = await postV3CapturePacketToThread(
      {
        ...beautyJob,
        applicationDraft: {
          ...beautyJob.applicationDraft,
          jobIntelligence: klaviyoIntel({
            primaryPlatform: "HubSpot",
            platformsMentioned: ["HubSpot"],
            platformPreferenceTier: "non_core_review",
            shouldSkipForPlatform: true,
            skipReason: "HubSpot CRM admin without ecommerce lifecycle scope.",
            businessType: "B2B SaaS",
            ecommerceVertical: "SaaS",
            taskType: "CRM cleanup",
            clientGoal: "Organize contacts",
          }),
        },
      },
      { channelId: "C123", messageTs: "111.222", threadTs: "111.222" },
      { upworkUrl: beautyJob.url, captureStatus: "packet_sent" },
      async () => {
        threadPostCalled = true;
        return true;
      },
    );
    assert(skippedThreadStatus === "skipped", "Thread packet helper should report skipped when lead decision rejects posting");
    assert(!threadPostCalled, "Skipped thread packet must not call Slack post helper");

    let webhookPostedText = "";
    const manualReviewJob = {
      ...beautyJob,
      applicationDraft: {
        ...beautyJob.applicationDraft,
        jobIntelligence: manualReviewIntel(),
      },
    };
    const manualReviewDiscovery = await postDiscoveryCapturePacket(
      {
        action: {
          id: 501,
          jobId: manualReviewJob.id,
          actionType: "capture_job_from_url",
          status: "pending",
          attempts: 0,
          payload: {
            url: manualReviewJob.url,
            discovery: {
              sourceType: "best_matches",
              sourceLabel: "Best Matches",
            },
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        scored: manualReviewJob,
        upworkUrl: manualReviewJob.url,
        applicationQuestions: [],
        questionAnswers: [],
        autoPrepareDecision: {
          shouldQueue: false,
          category: "blocked_no_manual_override",
          reason: "no thread context",
          note: "Not auto-preparing because no Slack thread context was available for browser staging.",
        },
      },
      {
        postChannelMessage: async () => ({ ok: false }),
        postWebhookMessage: async (payload) => {
          webhookPostedText = String(payload.text ?? "");
          return true;
        },
      },
    );
    assert(manualReviewDiscovery.status === "posted", "Manual-review discovery lead should post via webhook fallback");
    assert(manualReviewDiscovery.outcome === "posted", "Manual-review discovery lead should report posted outcome");
    assert(webhookPostedText.includes("*Recommended action:* Manual platform review before draft prep"), "Manual-review lead should keep manual review wording in Slack");

    webhookPostedText = "";
    const normalDiscovery = await postDiscoveryCapturePacket(
      {
        action: {
          id: 502,
          jobId: beautyJob.id,
          actionType: "capture_job_from_url",
          status: "pending",
          attempts: 0,
          payload: {
            url: beautyJob.url,
            discovery: {
              sourceType: "recent_jobs",
              sourceLabel: "Recent Jobs",
            },
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        scored: {
          ...beautyJob,
          applicationDraft: {
            ...beautyJob.applicationDraft,
            jobIntelligence: klaviyoIntel(),
          },
        },
        upworkUrl: beautyJob.url,
        applicationQuestions: [],
        questionAnswers: [],
        autoPrepareDecision: {
          shouldQueue: false,
          category: "blocked_no_manual_override",
          reason: "no thread context",
          note: "Not auto-preparing because no Slack thread context was available for browser staging.",
        },
      },
      {
        postChannelMessage: async () => ({ ok: false }),
        postWebhookMessage: async (payload) => {
          webhookPostedText = String(payload.text ?? "");
          return true;
        },
      },
    );
    assert(normalDiscovery.status === "posted", "Eligible discovery lead should post");
    assert(webhookPostedText.includes("*Recommended action:* Review lead"), "Post-to-Slack lead should keep standard review wording");

    let skippedWebhookCalled = false;
    const ineligibleDiscovery = await postDiscoveryCapturePacket(
      {
        action: {
          id: 503,
          jobId: beautyJob.id,
          actionType: "capture_job_from_url",
          status: "pending",
          attempts: 0,
          payload: {
            url: beautyJob.url,
            discovery: {
              sourceType: "best_matches",
              sourceLabel: "Best Matches",
            },
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        scored: {
          ...beautyJob,
          applicationDraft: {
            ...beautyJob.applicationDraft,
            jobIntelligence: klaviyoIntel({
              primaryPlatform: "HubSpot",
              platformsMentioned: ["HubSpot"],
              platformPreferenceTier: "non_core_review",
              shouldSkipForPlatform: true,
              skipReason: "HubSpot CRM admin without ecommerce lifecycle scope.",
              businessType: "B2B SaaS",
              ecommerceVertical: "SaaS",
              taskType: "CRM cleanup",
              clientGoal: "Organize contacts",
            }),
          },
        },
        upworkUrl: beautyJob.url,
        applicationQuestions: [],
        questionAnswers: [],
        autoPrepareDecision: {
          shouldQueue: false,
          category: "blocked_no_manual_override",
          reason: "no thread context",
          note: "Not auto-preparing because no Slack thread context was available for browser staging.",
        },
      },
      {
        postChannelMessage: async () => ({ ok: false }),
        postWebhookMessage: async () => {
          skippedWebhookCalled = true;
          return true;
        },
      },
    );
    assert(ineligibleDiscovery.status === "not_discovery", "Ineligible discovery lead should stay silent");
    assert(ineligibleDiscovery.outcome === "not_needed", "Ineligible discovery lead should not count as a posting failure");
    assert(!skippedWebhookCalled, "Ineligible discovery lead must not attempt Slack posting");

    const failedDiscovery = await postDiscoveryCapturePacket(
      {
        action: {
          id: 504,
          jobId: beautyJob.id,
          actionType: "capture_job_from_url",
          status: "pending",
          attempts: 0,
          payload: {
            url: beautyJob.url,
            discovery: {
              sourceType: "best_matches",
              sourceLabel: "Best Matches",
            },
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        scored: {
          ...beautyJob,
          applicationDraft: {
            ...beautyJob.applicationDraft,
            jobIntelligence: klaviyoIntel(),
          },
        },
        upworkUrl: beautyJob.url,
        applicationQuestions: [],
        questionAnswers: [],
        autoPrepareDecision: {
          shouldQueue: false,
          category: "blocked_no_manual_override",
          reason: "no thread context",
          note: "Not auto-preparing because no Slack thread context was available for browser staging.",
        },
      },
      {
        postChannelMessage: async () => ({ ok: false }),
        postWebhookMessage: async () => false,
      },
    );
    assert(failedDiscovery.status === "post_failed", "Failed discovery Slack post should be reported");
    assert(failedDiscovery.outcome === "failed", "Failed discovery Slack post should count as a failure");

    const beautyPlanResult = buildBrowserApplyPlan(beautyJob.id);
    assert(Boolean(beautyPlanResult.plan), "Beauty job should produce an apply plan");
    assert(beautyPlanResult.valid, `Beauty job plan should be valid, got issues: ${JSON.stringify(beautyPlanResult.issues)}`);
    assert(beautyPlanResult.plan.stopBeforeSubmit === true, "Apply plan must enforce stopBeforeSubmit=true");
    assert(
      beautyPlanResult.plan.attachments.some((item: { filePath: string }) => item.filePath === "profile/attachments/truly-beauty-case-study.pdf"),
      "Beauty job should auto-attach Truly Beauty case study",
    );
    assert(
      beautyPlanResult.plan.missingLocalAssets.includes("profile/attachments/truly-beauty-case-study.pdf"),
      "Browser draft prep should report selected assets that are missing locally",
    );
    assert(
      beautyPlanResult.plan.proofAvailability.some((line: string) => line.includes("Status: File missing locally - manual upload needed")),
      "Browser draft prep should include proof availability status lines",
    );
    assert(
      beautyPlanResult.issues.some((issue) => issue.code === "attachment_missing_locally"),
      "Missing local assets should be surfaced as warnings",
    );
    assert(
      !beautyPlanResult.plan.attachments.some((item: { filePath: string }) => item.filePath.includes("dr-rachael")),
      "Unsafe Dr. Rachael assets must not auto-attach for beauty job",
    );
    assert(beautyPlanResult.plan.manualReviewAssets.every((item: string) => !item.includes("figma.com")), "Figma links must not appear in auto/manual asset list");

    const prepareReply = buildPrepareDraftQueueReply({
      jobId: beautyJob.id,
      threadTitle: beautyJob.title,
      upworkUrl: beautyJob.url,
      actionId: 99,
      duplicate: false,
      duplicateStatus: null,
    });
    assert(prepareReply.includes("browser action #99"), "Prepare reply should include action id");
    assert(prepareReply.includes("profile/attachments/truly-beauty-case-study.pdf"), "Prepare reply should include selected auto-attach asset");
    assert(prepareReply.includes("Status: File missing locally - manual upload needed"), "Prepare reply should include clear proof availability status");
    assert(prepareReply.includes("Final submit remains manual"), "Prepare reply should keep manual submit reminder");
    assert(!prepareReply.toLowerCase().includes("copy/paste"), "Prepare reply must not introduce copy/paste workflow");

    const designJob = scoreJob({
      id: "design-job-1",
      title: "Email design + Figma specialist for DTC brand",
      url: "https://www.upwork.com/jobs/~designjob123456",
      description: "Need Figma-based email templates and campaign design support for a Shopify brand.",
      postedAt: new Date().toISOString(),
      budget: "$40-$60/hr",
      clientCountry: "Australia",
      clientRating: 4.8,
      clientSpend: 50000,
      clientHireRate: 70,
      clientTotalHires: 15,
      clientFeedbackCount: 12,
      category: "Design",
      experienceLevel: "Expert",
      connectsCost: 4,
      skills: ["Figma", "Email Design", "Klaviyo"],
      sourceQuery: "manual",
    });
    designJob.applicationDraft = buildApplicationDraft(designJob);
    markJobSeen(designJob, false);
    const designPlanResult = buildBrowserApplyPlan(designJob.id);
    assert(Boolean(designPlanResult.plan), "Design job should produce an apply plan");
    assert(designPlanResult.plan.attachments.some((item: { filePath: string }) => item.filePath === "profile/attachments/design-case-studies-steve-logarn.pdf"), "Design job should auto-attach design case studies");
    assert(designPlanResult.plan.figmaRecommendations.length > 0, "Design job should keep Figma links as recommendations only");
    assert(designPlanResult.plan.videoRecommendations.length === 0, "Design job should not add video by default");

    const autoPrepareResult = autoPrepareDraftForThread(
      beautyJob,
      { channelId: "C123", messageTs: "111.222", threadTs: "111.222" },
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
    );
    assert(typeof autoPrepareResult.actionId === "number", "High-score beauty job should auto-queue prepare action");
    assert(autoPrepareResult.category === "eligible_auto_prepare", "High-score beauty job should be eligible for auto-prepare");
    assert(autoPrepareResult.note.includes("Strong fit. I’m preparing the Upwork draft now"), "High-score auto-prepare note should explain queueing");

    const duplicateAutoPrepare = autoPrepareDraftForThread(
      beautyJob,
      { channelId: "C123", messageTs: "111.222", threadTs: "111.222" },
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
    );
    assert(duplicateAutoPrepare.category === "duplicate_existing_action", "Duplicate auto-prepare should point to the existing action");
    assert(duplicateAutoPrepare.duplicate === true, "Duplicate auto-prepare should not queue a second action");
    assert(duplicateAutoPrepare.note.includes("No duplicate was created"), "Duplicate note should explain that no duplicate was created");

    const missingIntelligenceDecision = decideAutoPrepareDraft(
      { ...beautyJob, applicationDraft: { ...beautyJob.applicationDraft, jobIntelligence: undefined } },
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
    );
    assert(!missingIntelligenceDecision.shouldQueue, "Missing job intelligence should not auto-queue browser draft prep");
    assert(missingIntelligenceDecision.category === "skipped_manual_override_available", "Missing job intelligence should require manual review");
    assert(missingIntelligenceDecision.note.includes("job intelligence and platform eligibility"), "Missing-intelligence note should explain platform review gating");

    const lowScoreDecision = decideAutoPrepareDraft(
      { ...beautyJob, score: 60 },
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
    );
    assert(!lowScoreDecision.shouldQueue, "Low-score job should not auto-queue");
    assert(lowScoreDecision.category === "skipped_manual_override_available", "Low-score job should allow manual override");
    assert(lowScoreDecision.note.includes("You can still reply `prepare draft`"), "Low-score note should allow manual override");

    const highConnectsDecision = decideAutoPrepareDraft(
      { ...beautyJob, applicationDraft: { ...beautyJob.applicationDraft, suggestedConnects: 20, suggestedBoostConnects: 20 } },
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
    );
    assert(!highConnectsDecision.shouldQueue, "High-connects job should not auto-queue");
    assert(highConnectsDecision.category === "skipped_manual_override_available", "High-connects job should allow manual override");
    assert(highConnectsDecision.note.includes("manually approve staging this one"), "High-connects note should allow manual override");

    const ineligiblePlatformDecision = decideAutoPrepareDraft(
      {
        ...beautyJob,
        applicationDraft: {
          ...beautyJob.applicationDraft,
          jobIntelligence: {
            ...beautyJob.applicationDraft.jobIntelligence,
            primaryPlatform: "HubSpot",
            platformsMentioned: ["HubSpot"],
            platformPreferenceTier: "non_core_review",
            shouldSkipForPlatform: true,
            skipReason: "HubSpot CRM admin without ecommerce lifecycle scope.",
            businessType: "B2B SaaS",
            ecommerceVertical: "SaaS",
            taskType: "CRM cleanup",
            clientGoal: "Organize contacts",
          },
        },
      },
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
    );
    assert(!ineligiblePlatformDecision.shouldQueue, "Ineligible platform should not auto-queue");
    assert(ineligiblePlatformDecision.category === "blocked_no_manual_override", "Ineligible platform should be blocked");
    assert(
      ineligiblePlatformDecision.note.includes("platform is currently ineligible") ||
      ineligiblePlatformDecision.note.includes("lead decision is skip"),
      "Ineligible platform note should explain block"
    );

    const manualReviewDecision = decideAutoPrepareDraft(
      {
        ...beautyJob,
        title: "DTC retention strategist (platform not specified)",
        description: "Need ecommerce lifecycle retention support across email and SMS.",
        applicationDraft: {
          ...beautyJob.applicationDraft,
          jobIntelligence: {
            ...beautyJob.applicationDraft.jobIntelligence,
            primaryPlatform: "unknown",
            platformsMentioned: [],
            platformPreferenceTier: "unknown",
          },
        },
      },
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
    );
    assert(!manualReviewDecision.shouldQueue, "Manual-review lead should not auto-queue");
    assert(manualReviewDecision.category === "skipped_manual_override_available", "Manual-review lead should allow manual override only");
    assert(manualReviewDecision.note.includes("manual review"), "Manual-review decision should explain review gating");

    const missingDraftDecision = decideAutoPrepareDraft(
      { ...beautyJob, applicationDraft: undefined },
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
    );
    assert(!missingDraftDecision.shouldQueue, "Missing draft should not auto-queue");
    assert(missingDraftDecision.category === "blocked_no_manual_override", "Missing draft should be a hard block");
    assert(missingDraftDecision.note.includes("Revise/regenerate the proposal first"), "Missing-draft note should explain why auto-prepare did not queue");
    assert(!missingDraftDecision.note.includes("prepare draft"), "Missing draft should not suggest manual override");

    const unhealthyDecision = decideAutoPrepareDraft(
      beautyJob,
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "manual_attention_required", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: true, alertCooldownRemainingMs: 0 },
      },
    );
    assert(!unhealthyDecision.shouldQueue, "Unhealthy browser session should not auto-queue");
    assert(unhealthyDecision.category === "blocked_no_manual_override", "Unhealthy browser session should be a hard block");
    assert(unhealthyDecision.note.includes("manual browser attention"), "Unhealthy browser note should explain why auto-prepare did not queue");
    assert(!unhealthyDecision.note.includes("prepare draft"), "Unhealthy browser note should not suggest manual override");

    const redFlagDecision = decideAutoPrepareDraft(
      {
        ...beautyJob,
        applicationDraft: { ...beautyJob.applicationDraft, redFlags: ["Needs account verification before work can start"] },
        scoreBreakdown: {
          ...beautyJob.scoreBreakdown,
          redFlagScore: { ...beautyJob.scoreBreakdown.redFlagScore, score: 20 },
          risks: ["Needs account verification before work can start"],
        },
      },
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
    );
    assert(!redFlagDecision.shouldQueue, "Hard red flag should not auto-queue");
    assert(redFlagDecision.category === "blocked_no_manual_override", "Hard red flag should be a hard block");
    assert(!redFlagDecision.note.includes("prepare draft"), "Hard red flag should not suggest manual override");

    const duplicateReply = buildPrepareDraftQueueReply({
      jobId: beautyJob.id,
      threadTitle: beautyJob.title,
      upworkUrl: beautyJob.url,
      actionId: 99,
      duplicate: true,
      duplicateStatus: "paused",
    });
    assert(duplicateReply.includes("already exists as browser action #99 (paused)"), "Duplicate prepare reply should reference existing action and status");

    const launchCommand = buildBrowserSessionLaunchCommand({
      chromeExecutablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir: "./data/browser-profile",
      cdpUrl: "http://127.0.0.1:9222",
      startUrl: "https://www.upwork.com",
    });
    assert(launchCommand.args.some((arg: string) => arg.includes("--remote-debugging-port=9222")), "Browser session command should enable remote debugging");

    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/mock", Browser: "Chrome/136" }),
    } as Response);

    const cdpContext = { newPage: async () => ({}) };
    let connectOverCdpCalled = false;
    let connectOverCdpArgCount = 0;
    let newContextCalled = false;
    const cdpSession = await acquireBrowserSession(
      {
        connectOverCDP: async (...args: unknown[]) => {
          connectOverCdpCalled = true;
          connectOverCdpArgCount = args.length;
          return { contexts: () => [cdpContext], newContext: async () => { newContextCalled = true; throw new Error("new context should not be used in cdp mode"); }, close: async () => undefined };
        },
        launchPersistentContext: async () => {
          throw new Error("launch path should not be used in cdp mode");
        },
      },
      {
        mode: "cdp",
        userDataDir: "./data/browser-profile",
        chromeExecutablePath: null,
        cdpUrl: "http://127.0.0.1:9222",
        headless: false,
      },
    );
    assert(connectOverCdpCalled, "CDP mode should use connectOverCDP path");
    assert(connectOverCdpArgCount === 1, "CDP mode should not pass context/download options to connectOverCDP");
    assert(!newContextCalled, "CDP mode should reuse the existing default context instead of creating a new one");
    assert(cdpSession.mode === "cdp", "CDP mode should preserve cdp connection mode");

    let launchPersistentCalled = false;
    const launchContext = { newPage: async () => ({}), close: async () => undefined };
    const launchSession = await acquireBrowserSession(
      {
        connectOverCDP: async () => {
          throw new Error("cdp path should not be used in launch mode");
        },
        launchPersistentContext: async () => {
          launchPersistentCalled = true;
          return launchContext;
        },
      },
      {
        mode: "launch",
        userDataDir: "./data/browser-profile",
        chromeExecutablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        cdpUrl: "http://127.0.0.1:9222",
        headless: true,
      },
    );
    assert(launchPersistentCalled, "Launch mode should preserve launchPersistentContext path");
    assert(launchSession.mode === "launch", "Launch mode should preserve launch connection mode");

    assert(classifyBrowserSessionError(new Error("ProcessSingleton lock already held")) === "browser_profile_in_use", "Profile lock error should classify as browser_profile_in_use");
    assert(classifyBrowserSessionError(new Error("connect ECONNREFUSED 127.0.0.1:9222")) === "cdp_unavailable", "Missing CDP endpoint should classify as cdp_unavailable");
    assert(classifyBrowserSessionError(new Error("browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.")) === "cdp_acquisition_failed", "CDP download/context protocol failure should classify as cdp_acquisition_failed");

    let cdpAcquireFailedClearly = false;
    try {
      await acquireBrowserSession(
        {
          connectOverCDP: async () => {
            throw new Error("browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.");
          },
          launchPersistentContext: async () => {
            throw new Error("launch path should not be used in cdp mode");
          },
        },
        {
          mode: "cdp",
          userDataDir: "./data/browser-profile",
          chromeExecutablePath: null,
          cdpUrl: "http://127.0.0.1:9222",
          headless: false,
        },
      );
    } catch (error) {
      cdpAcquireFailedClearly = /CDP acquisition failed/.test(error instanceof Error ? error.message : String(error));
    }
    assert(cdpAcquireFailedClearly, "CDP setDownloadBehavior failure should surface as a clear CDP acquisition failure");

    const matchingPage = {
      url: () => "https://www.upwork.com/jobs/Beauty-Klaviyo-Retention_~beautye2e123456",
    };
    const selectedPage = await selectPageForBrowserAction(
      {
        pages: () => [matchingPage],
        newPage: async () => ({ url: () => "about:blank" }),
      },
      "https://www.upwork.com/jobs/Beauty-Klaviyo-Retention_~beautye2e123456",
    );
    assert(selectedPage.reusedExistingPage === true, "CDP page selection should reuse an existing matching job page");
    assert(selectedPage.page === matchingPage, "CDP page selection should return the matching existing page");

    let sampleIndex = 0;
    const settlingPage = {
      goto: async () => undefined,
      url: () => (sampleIndex === 0 ? "https://www.upwork.com/ab/account-security/challenge" : "https://www.upwork.com/jobs/Beauty-Klaviyo-Retention_~beautye2e123456"),
      title: async () => (sampleIndex === 0 ? "Security Check - Upwork" : "Klaviyo retention strategist for beauty skincare brand"),
      locator: () => ({
        first: () => ({
          textContent: async () => {
            const value = sampleIndex === 0 ? "Checking if the site connection is secure" : "Job details and proposal questions";
            sampleIndex += 1;
            return value;
          },
        }),
      }),
    };
    const settlingAction = { id: 6, jobId: beautyJob.id, actionType: "capture_job_from_url", payload: { url: beautyJob.url } };
    const settled = await settlePageAndDetect(settlingPage, settlingAction);
    assert(settled.detection.state === "captured", "Settled CDP page should proceed once the job page is visible");
    assert(settled.samples[0].detection.state === "captcha_or_security_challenge", "First settle sample should report the challenge state");
    assert(settled.samples[1].detection.state === "captured", "Second settle sample should report the resolved job page state");

    const bestMatchesDetection = detectStateWithDiagnostics(
      {
        url: "https://www.upwork.com/nx/find-work/best-matches/details/~022053866890130225260?pageTitle=Job%20Details",
        title: "Upwork",
        textExcerpt: "Mailchimp E-commerce Automation Expert for Premium Skincare Webshop",
      },
      settlingAction,
    );
    assert(bestMatchesDetection.state === "captured", "Best Matches job detail modal URL should not be classified as a challenge");

    const blockedDetection = detectStateWithDiagnostics(
      {
        url: "https://www.upwork.com/ab/account-security/challenge?__cf_chl_tk=abc",
        title: "Challenge - Upwork",
        textExcerpt: "Checking if the site connection is secure",
      },
      settlingAction,
    );
    assert(blockedDetection.state === "captcha_or_security_challenge", "Challenge URL should remain blocked");
    assert(blockedDetection.source === "title" || blockedDetection.source === "body_text" || blockedDetection.source === "url", "Blocked detection should report the detector source");
    assert(blockedDetection.matchedText === "__cf_chl" || blockedDetection.matchedText === "challenge", "Challenge detection should report the matched pattern");
    assert(isCaptureBlockedState(blockedDetection.state), "Blocked capture state should suppress scoring, normal Slack packet posting, auto-prepare, and completion");

    const jobShapedRestrictedDetection = detectStateWithDiagnostics(
      {
        url: "https://www.upwork.com/jobs/~022053711714121332703?__cf_chl_rt_tk=abc",
        title: "Challenge",
        textExcerpt: "Checking your browser before accessing this page",
      },
      settlingAction,
    );
    assert(jobShapedRestrictedDetection.state === "captcha_or_security_challenge", "Job-shaped URL with restricted token must fail closed");
    assert(jobShapedRestrictedDetection.source === "url" || jobShapedRestrictedDetection.source === "title" || jobShapedRestrictedDetection.source === "body_text", "Job-shaped restricted detection should report source");
    assert(isCaptureBlockedState(jobShapedRestrictedDetection.state), "Job-shaped restricted page should be blocked before capture packet work");

    const titleOnlyRestrictedDetection = detectStateWithDiagnostics(
      {
        url: "https://www.upwork.com/jobs/~022053711714121332703",
        title: "Challenge",
        textExcerpt: "",
      },
      settlingAction,
    );
    assert(titleOnlyRestrictedDetection.state === "captcha_or_security_challenge", "Restricted title must block even on clean-looking job URL");
    assert(isCaptureBlockedState(titleOnlyRestrictedDetection.state), "Restricted title should suppress normal capture completion");

    const bodyRestrictedDetection = detectStateWithDiagnostics(
      {
        url: "https://www.upwork.com/jobs/~022053711714121332703",
        title: "Upwork",
        textExcerpt: "Security check. Verify you are human before continuing.",
      },
      settlingAction,
    );
    assert(bodyRestrictedDetection.state === "captcha_or_security_challenge", "Restricted body text must block capture");
    assert(isCaptureBlockedState(bodyRestrictedDetection.state), "Restricted body text should suppress normal capture packet posting");

    const resolvedDetection = detectStateWithDiagnostics(
      {
        url: "https://www.upwork.com/jobs/Beauty-Klaviyo-Retention_~beautye2e123456",
        title: "Klaviyo retention strategist for beauty skincare brand",
        textExcerpt: "This is the full job detail page.",
      },
      { ...settlingAction, lastError: "captcha_or_security_challenge" },
    );
    assert(resolvedDetection.state === "captured", "Resolved job URL should proceed even if the prior last_error mentioned a restricted page");
    assert(resolvedDetection.source === "url", "Resolved job URL should report URL-based detection");
    assert(!isCaptureBlockedState(resolvedDetection.state), "Clean readable job page should not be capture-blocked");

    global.fetch = originalFetch;
    console.log("browser apply profile tests passed");
  } finally {
    const { closeDb } = require("./db") as { closeDb: () => void };
    closeDb();
    cleanupDatabase(tempDb);
  }
}

if (require.main === module) {
  runTests().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`browser apply profile tests failed: ${message}`);
    process.exitCode = 1;
  });
}
