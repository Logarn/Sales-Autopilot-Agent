import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
  const tempDir = resolve(process.cwd(), "data/.tmp-browser-apply");
  const tempDb = resolve(tempDir, "jobs.db");
  const proofRoot = resolve(process.cwd(), "data/.tmp-browser-apply-proof-assets");
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(proofRoot, { recursive: true, force: true });
  process.env.DB_PATH = tempDb;
  process.env.PROOF_ASSET_ROOT = proofRoot;
  process.env.DISCOVERY_SLACK_CHANNEL_ID = "C123";
  process.env.SLACK_BOT_TOKEN = "";
  process.env.SLACK_CHANNEL_WEBHOOK_URL = "";
  const genericKlaviyoScreenshotPath = resolve(proofRoot, "profile/screenshots/hangaritas-klaviyo-performance.png");
  mkdirSync(dirname(genericKlaviyoScreenshotPath), { recursive: true });
  writeFileSync(genericKlaviyoScreenshotPath, "png");

  const { buildApplicationDraft } = require("./agent") as {
    buildApplicationDraft: (job: any) => any;
  };
  const { scoreJob } = require("./filter") as {
    scoreJob: (job: any) => any;
  };
  const {
    markJobSeen,
    closeDb,
    getBrowserActionById,
    listBrowserActions,
    registerApplicationAsset,
    upsertSlackThreadState,
  } = require("./db") as {
    markJobSeen: (job: any, notified: boolean) => void;
    closeDb: () => void;
    getBrowserActionById: (id: number) => any;
    listBrowserActions: (status?: any, limit?: number) => any[];
    registerApplicationAsset: (input: any) => unknown;
    upsertSlackThreadState: (input: any) => unknown;
  };
  const { buildBrowserApplyPlan } = require("./browserApply") as {
    buildBrowserApplyPlan: (jobId: string) => { plan: any; valid: boolean; issues: Array<{ severity: string; code: string; message: string }> };
  };
  const { autoPrepareDraftForThread, autoQueuePrepareDraft, buildCaptureCompletionStatus, decideAutoPrepareDraft, detectStateWithDiagnostics, getActionUrl, getRequiredSkippedFields, isCaptureBlockedState, postDiscoveryCapturePacket, postPrepareDraftStatus, postV3CapturePacketToThread, selectPageForBrowserAction, settlePageAndDetect, verifyApplyPageConnects, verifyApplyPreparationOnPage } = require("./browserWorker") as {
    autoPrepareDraftForThread: (job: any, thread: { channelId: string; messageTs: string; threadTs: string }, options?: any) => { shouldQueue: boolean; category: string; note: string; actionId?: number; duplicate?: boolean };
    autoQueuePrepareDraft: (job: any, options?: any, thread?: { channelId: string; messageTs: string; threadTs: string } | null) => { shouldQueue: boolean; category: string; note: string; actionId?: number; duplicate?: boolean; duplicateStatus?: string | null };
    buildCaptureCompletionStatus: (input: { hasThreadContext: boolean; packetPosted: boolean; discoverySlackStatus?: "not_discovery" | "missing_channel" | "post_failed" | "posted" }) => string;
    decideAutoPrepareDraft: (job: any, options?: any) => { shouldQueue: boolean; category: string; note: string; reason: string };
    detectStateWithDiagnostics: (snapshot: { url: string; title: string; textExcerpt: string }, action: any) => { state: string; source: string; matchedText?: string; summary: string };
    getActionUrl: (action: any) => string | null;
    getRequiredSkippedFields: (fields: { skippedFields: string[]; fieldVerification?: Array<{ field: string; status: string; detail: string }> }) => string[];
    isCaptureBlockedState: (state: string) => boolean;
    postDiscoveryCapturePacket: (input: any, deps?: {
      postChannelMessage?: (params: any) => Promise<{ ok: boolean; ts?: string; channel?: string }>;
      postThreadMessage?: (params: any) => Promise<boolean>;
      postWebhookMessage?: (params: any) => Promise<boolean>;
      copyProvider?: any;
    }) => Promise<{ status: "not_discovery" | "missing_channel" | "post_failed" | "posted"; outcome: "not_needed" | "posted" | "failed"; thread?: { channelId: string; messageTs: string; threadTs: string } }>;
    postPrepareDraftStatus: (input: any, deps?: {
      postThreadMessage?: (params: any) => Promise<boolean>;
      postChannelMessage?: (params: any) => Promise<{ ok: boolean; ts?: string; channel?: string }>;
      postWebhookMessage?: (params: any) => Promise<boolean>;
      copyProvider?: any;
    }) => Promise<"posted" | "skipped" | "failed">;
    postV3CapturePacketToThread: (job: any, thread: { channelId: string; messageTs: string; threadTs: string }, context: any, postThreadMessage?: (params: any) => Promise<boolean>) => Promise<"posted" | "skipped" | "failed">;
    selectPageForBrowserAction: (context: { pages?: () => Array<{ url: () => string }>; newPage: () => Promise<any> }, targetUrl: string, options?: { protectedApplyUrls?: string[] }) => Promise<{ page: any; reusedExistingPage: boolean; reason: string }>;
    settlePageAndDetect: (page: any, action: any) => Promise<{ snapshot: any; bodyText: string; detection: { state: string; source: string; matchedText?: string }; samples: Array<any> }>;
    verifyApplyPageConnects: (plan: any, bodyText: string) => Array<{ severity: string; code: string; message: string }>;
    verifyApplyPreparationOnPage: (input: { page: any; plan: any; fields: { attemptedFields: string[]; skippedFields: string[]; manualFields: string[] }; bodyText: string }) => Promise<Array<{ field: string; status: string; detail: string; expected?: string; actual?: string }>>;
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
    needsManualReview: true,
    confidence: "medium",
    ...overrides,
  });

  function fakeApplyPage(input: {
    url?: string;
    visibleText?: string;
    inputValues?: string[];
    fields?: Array<{
      value: string;
      kind?: "input" | "textarea";
      type?: string;
      label?: string;
      id?: string;
      name?: string;
      ariaLabel?: string;
      placeholder?: string;
      dataTest?: string;
      checked?: boolean;
      files?: string[];
    }>;
    checkedLabels?: string[];
    fileNames?: string[];
    attachmentRows?: string[];
    selectedHighlightLabels?: string[];
    actionLabels?: string[];
  }) {
    const makeElement = (field: {
      value: string;
      kind?: "input" | "textarea";
      type?: string;
      label?: string;
      id?: string;
      name?: string;
      ariaLabel?: string;
      placeholder?: string;
      dataTest?: string;
      checked?: boolean;
      files?: string[];
    }) => ({
      value: field.value,
      checked: field.checked ?? false,
      type: field.type ?? "text",
      name: field.name ?? null,
      tagName: field.kind === "textarea" ? "TEXTAREA" : "INPUT",
      files: (field.files ?? []).map((name) => ({ name })),
      getAttribute: (name: string) => {
        if (name === "type") return field.type ?? null;
        if (name === "id") return field.id ?? null;
        if (name === "name") return field.name ?? null;
        if (name === "aria-label") return field.ariaLabel ?? null;
        if (name === "placeholder") return field.placeholder ?? null;
        if (name === "data-test") return field.dataTest ?? null;
        return null;
      },
      closest: () => field.label ? ({ textContent: field.label }) : null,
    });
    const page = {
      url: () => input.url ?? "https://www.upwork.com/ab/proposals/job/~beautyjob123456/apply/",
      locator: () => ({ first: () => ({ textContent: async () => input.visibleText ?? "" }) }),
      evaluate: async function (this: unknown, fn: (() => unknown) | string) {
        if (this !== page) {
          throw new Error("page.evaluate must be called with the page binding preserved");
        }
        const holder = globalThis as unknown as { document?: unknown; scrollTo?: (x: number, y: number) => void };
        const previousDocument = holder.document;
        const previousScrollTo = holder.scrollTo;
        const inputElements = input.fields
          ? input.fields.map(makeElement)
          : (input.inputValues ?? []).map((value) => makeElement({
              value,
              kind: value.length > 40 ? "textarea" : "input",
              ariaLabel: /^\$?\d+(?:\.\d+)?$/.test(value) ? "Hourly rate" : undefined,
            }));
        const checkedElements = (input.checkedLabels ?? []).map((label) => ({
          value: "",
          checked: true,
          type: "checkbox",
          tagName: "INPUT",
          name: null,
          files: [],
          getAttribute: (name: string) => name === "aria-label" ? label : null,
          closest: () => ({ textContent: label }),
        }));
        const fileElements = (input.fileNames ?? []).map((name) => ({
          value: "",
          checked: false,
          type: "file",
          tagName: "INPUT",
          name: null,
          files: [{ name }],
          getAttribute: () => null,
          closest: () => null,
        }));
        const actionElements = [
          ...(input.attachmentRows ?? []).map((name) => ({
            value: "",
            checked: false,
            type: "button",
            tagName: "BUTTON",
            name: null,
            files: [],
            textContent: "",
            getAttribute: (attributeName: string) => attributeName === "aria-label" ? `Delete attachment ${name}` : null,
            closest: () => null,
          })),
          ...(input.actionLabels ?? []).map((label) => ({
            value: "",
            checked: false,
            type: "button",
            tagName: "BUTTON",
            name: null,
            files: [],
            textContent: label,
            getAttribute: () => null,
            closest: () => null,
          })),
        ];
        holder.document = {
          body: { innerText: [input.visibleText ?? "", ...(input.selectedHighlightLabels ?? [])].filter(Boolean).join("\n") },
          querySelectorAll: (selector: string) => {
            const allElements = [...inputElements, ...checkedElements, ...fileElements];
            if (selector === "textarea") return allElements.filter((element) => element.tagName === "TEXTAREA");
            if (selector === "input") return allElements.filter((element) => element.tagName === "INPUT");
            if (selector.startsWith("input[type='")) {
              const type = selector.slice("input[type='".length, -2);
              return allElements.filter((element) => element.tagName === "INPUT" && element.type === type);
            }
            if (selector.startsWith("label[for=")) return [];
            if (selector === "[role='combobox']") return [];
            if (selector === "button") return actionElements;
            if (selector === "a[role='button']") return [];
            return allElements;
          },
        };
        holder.scrollTo = () => undefined;
        try {
          if (typeof fn === "string") {
            return (0, eval)(fn);
          }
          return fn();
        } finally {
          holder.document = previousDocument;
          holder.scrollTo = previousScrollTo;
        }
      },
    };
    return page;
  }

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
    beautyJob.applicationDraft.structuredProposal.clientRequestAnswers = [
      "Approach: I would audit the account, prioritize the largest lifecycle leaks, then rebuild the flows/campaign process around repeat purchase.",
      "Availability: I can start with a short diagnostic pass, then move into prioritized execution.",
    ];
    beautyJob.applicationDraft.suggestedBoostConnects = 18;
    beautyJob.applicationDraft.connectsStrategy = {
      ...(beautyJob.applicationDraft.connectsStrategy ?? {
        decision: "safe_apply",
        requiredConnects: 4,
        suggestedBoostConnects: 0,
        totalConnects: 4,
        expectedValueScore: 80,
        reasons: [],
        risks: [],
      }),
      suggestedBoostConnects: 18,
      totalConnects: (beautyJob.applicationDraft.connectsStrategy?.requiredConnects ?? 4) + 18,
      sourceBackedConnects: {
        requiredConnects: 4,
        boostConnects: 18,
        totalConnects: 22,
        confidence: "high",
        sourceText: "Required for proposal: 4 Connects",
        sourceLocation: "job detail",
        extractionMethod: "deterministic_visible_text",
      },
    };
    beautyJob.applicationDraft.connectsWarnings.push("Connects evidence: captured required Connects from Upwork job detail.");
    beautyJob.applicationDraft.jobIntelligence = klaviyoIntel();
    markJobSeen(beautyJob, false);

    const unknownConnectsJob = scoreJob({
      id: "unknown-connects-job-1",
      title: "Klaviyo lifecycle strategy for SaaS onboarding emails",
      url: "https://www.upwork.com/jobs/~unknownconnects123456",
      description: "Need Klaviyo lifecycle strategy, segmentation, onboarding emails, and retention messaging for a subscription SaaS audience.",
      postedAt: new Date().toISOString(),
      budget: "$70-$95/hr",
      clientCountry: "United States",
      clientRating: 5,
      clientSpend: 200000,
      clientHireRate: 90,
      clientTotalHires: 40,
      clientFeedbackCount: 30,
      category: "Digital Marketing",
      experienceLevel: "Expert",
      connectsCost: 0,
      connects: {
        requiredConnects: null,
        boostConnects: null,
        totalConnects: null,
        confidence: "unknown",
        sourceText: null,
        sourceLocation: null,
        extractionMethod: "not_found",
      },
      skills: ["Klaviyo", "Lifecycle Marketing", "Email Marketing"],
      sourceQuery: "manual",
    });
    unknownConnectsJob.applicationDraft = buildApplicationDraft(unknownConnectsJob);
    unknownConnectsJob.applicationDraft.connectsStrategy = {
      decision: "manual_review",
      requiredConnects: null,
      suggestedBoostConnects: 0,
      totalConnects: null,
      expectedValueScore: 80,
      sourceBackedConnects: unknownConnectsJob.connects,
      reasons: ["Strong fit; verify Connects on the apply page."],
      risks: ["Required Connects are unknown from visible source text."],
    };
    unknownConnectsJob.applicationDraft.selectedPortfolioItems = [];
    unknownConnectsJob.applicationDraft.structuredProposal.browserFillNotes.rate = "$85/hr";
    unknownConnectsJob.applicationDraft.jobIntelligence = klaviyoIntel();
    markJobSeen(unknownConnectsJob, false);
    const unknownConnectsPlan = buildBrowserApplyPlan(unknownConnectsJob.id);
    assert(Boolean(unknownConnectsPlan.plan), "Unknown-Connects job should still build an apply-page verification plan");
    assert(unknownConnectsPlan.valid, "Unknown Connects alone should not block opening the apply page for verification");
    assert(
      unknownConnectsPlan.issues.some((issue) => issue.code === "connects_apply_page_verification_required" && issue.severity === "warning"),
      "Unknown Connects should be represented as apply-page verification warning",
    );
    assert(
      unknownConnectsPlan.plan.manualFields.includes("connects"),
      "Unknown Connects should remain a manual/review field until verified on the apply page",
    );

    unknownConnectsJob.applicationDraft.connectsStrategy = {
      ...unknownConnectsJob.applicationDraft.connectsStrategy,
      decision: "skip",
      expectedValueScore: 21,
      risks: ["Required Connects are unknown from visible source text.", "Expected value is too weak to spend Connects without a source-backed required cost."],
    };
    const unknownConnectsSkipPlan = buildBrowserApplyPlan(unknownConnectsJob.id);
    assert(unknownConnectsSkipPlan.valid, "Unknown Connects with a skip decision should still allow opening the apply page for bottom-of-page verification");
    assert(
      unknownConnectsSkipPlan.issues.some((issue) => issue.code === "connects_apply_page_verification_required" && issue.severity === "warning"),
      "Unknown Connects skip decision should be represented as an apply-page verification warning",
    );

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
      { channelId: "C123", messageTs: "111.333", threadTs: "111.333" },
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
      id: "beauty-job-manual-review-discovery-v1",
      applicationDraft: {
        ...beautyJob.applicationDraft,
        jobId: "beauty-job-manual-review-discovery-v1",
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
          note: "Manual review required before browser work.",
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
    assert(webhookPostedText.includes("*Hot take:*"), "Review-needed lead should keep SDR packet fallback copy when no LLM provider is available");
    assert(webhookPostedText.includes("*Recommendation:* maybe"), "Review-needed lead should include a maybe recommendation");
    assert(webhookPostedText.includes("*Connects/boost:*"), "Review-needed lead should include Connects/boost guidance");
    assert(webhookPostedText.includes(manualReviewJob.url), "Review-needed lead should include the Upwork link");
    assert(webhookPostedText.includes("stop before submit"), "Review-needed lead should preserve the final-submit boundary");
    assert(webhookPostedText.includes("If you want this prepared, just say so naturally"), "Review-needed lead should ask for a natural clear next action");
    assert(!/Reply .*prep it/i.test(webhookPostedText), "Review-needed lead should not require an exact prep command");
    assert(!webhookPostedText.includes("Available replies"), "Normal lead alert should not include a command menu");
    assert(!webhookPostedText.includes("Debug:"), "Normal lead alert should not include debug lines");
    for (const noisy of ["manual review", "platformEligibility", "lead decision", "packet", "source context", "action id"]) {
      assert(!webhookPostedText.toLowerCase().includes(noisy.toLowerCase()), `Normal lead alert should hide ${noisy}`);
    }

    webhookPostedText = "";
    const normalDiscoveryJob = {
      ...beautyJob,
      id: "beauty-job-normal-discovery-v1",
      applicationDraft: {
        ...beautyJob.applicationDraft,
        jobId: "beauty-job-normal-discovery-v1",
        jobIntelligence: klaviyoIntel(),
      },
    };
    const normalDiscovery = await postDiscoveryCapturePacket(
      {
        action: {
          id: 502,
          jobId: normalDiscoveryJob.id,
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
        scored: normalDiscoveryJob,
        upworkUrl: normalDiscoveryJob.url,
        applicationQuestions: [],
        questionAnswers: [],
        autoPrepareDecision: {
          shouldQueue: false,
          category: "blocked_no_manual_override",
          reason: "no thread context",
          note: "Lead capture ready for review.",
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
    assert(webhookPostedText.includes("If you want this prepared, just say so naturally"), "Post-to-Slack lead should use natural CTA copy when prep is not queued");
    assert(!/Next:.*(?:preparing|queued)/i.test(webhookPostedText), "Post-to-Slack lead must not claim prep started without a queued action");
    assert(!webhookPostedText.includes("Screening answers"), "Initial lead alert must not include screening answers");
    assert(!webhookPostedText.includes("Proposal preview"), "Initial lead alert must not include proposal preview");

    const kimiLeadRequests: any[] = [];
    let kimiLeadText = "";
    const kimiLeadJob = {
      ...beautyJob,
      id: "beauty-job-kimi-lead-copy-v1",
      applicationDraft: {
        ...beautyJob.applicationDraft,
        jobId: "beauty-job-kimi-lead-copy-v1",
        jobIntelligence: klaviyoIntel(),
      },
    };
    const kimiLeadDiscovery = await postDiscoveryCapturePacket(
      {
        action: {
          id: 5021,
          jobId: kimiLeadJob.id,
          actionType: "capture_job_from_url",
          status: "pending",
          attempts: 0,
          payload: {
            url: kimiLeadJob.url,
            discovery: {
              sourceType: "best_matches",
              sourceLabel: "Best Matches",
            },
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        scored: kimiLeadJob,
        upworkUrl: kimiLeadJob.url,
        applicationQuestions: [],
        questionAnswers: [],
        autoPrepareDecision: {
          shouldQueue: true,
          category: "eligible_auto_prepare",
          reason: "eligible",
          note: "Strong fit. I’m preparing the Upwork draft now. Final submit remains manual.",
          actionId: 5021,
          duplicate: false,
        },
      },
      {
        copyProvider: {
          isAvailable: () => true,
          completeJson: async (request: any) => {
            kimiLeadRequests.push(request);
            return {
              ok: true,
              data: {
                text: [
                  "*Hot take:* <@U0A2X5BCNKC> <@U0AHJFYV42K> Kimi-written lead says this one is worth a real shot.",
                  "*Why it fits:* Klaviyo retention work for a beauty ecommerce brand.",
                  "*Proof angle:* Lead with Truly Beauty case study.",
                  "*Risks/watchouts:* Keep an eye on client quality.",
                  "*Connects/boost:* 4 required; no boost suggested from visible data.",
                  "*Recommendation:* prep",
                  "*Next:* Review it in VNC when ready; I’ll stop before submit.",
                  kimiLeadJob.url,
                ].join("\n"),
              },
            };
          },
        },
        postChannelMessage: async (payload) => {
          kimiLeadText = String(payload.text ?? "");
          return { ok: true, ts: "999.110", channel: "C123" };
        },
      },
    );
    assert(kimiLeadDiscovery.status === "posted", "Lead packet should still post through the normal discovery Slack path.");
    assert(kimiLeadText.includes("Kimi-written lead"), "Lead packet should use Kimi copy when the provider is available and safe.");
    assert(kimiLeadText.includes("*Recommendation:* prep"), "Kimi lead packet should preserve SDR recommendation formatting.");
    assert(kimiLeadRequests.some((request) => request.messages?.[1]?.content?.includes("\"path\":\"lead_packet\"")), "Lead packet copy request should use the lead_packet path.");
    assert(kimiLeadRequests.some((request) => JSON.stringify(request).includes("Operating constitution from soul.md")), "Lead packet copy request should include soul.md context.");
    assert(kimiLeadText.includes("stop before submit"), "Lead packet copy must preserve final-submit safety wording.");

    let queuedPrepPostAttempted = false;
    const queuedPrepJob = {
      ...beautyJob,
      id: "beauty-job-queued-prep-discovery-v1",
      applicationDraft: {
        ...beautyJob.applicationDraft,
        jobId: "beauty-job-queued-prep-discovery-v1",
        jobIntelligence: klaviyoIntel(),
      },
    };
    const queuedPrepDiscovery = await postDiscoveryCapturePacket(
      {
        action: {
          id: 5022,
          jobId: queuedPrepJob.id,
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
        scored: queuedPrepJob,
        upworkUrl: queuedPrepJob.url,
        applicationQuestions: [],
        questionAnswers: [],
        autoPrepareDecision: {
          shouldQueue: true,
          category: "eligible_auto_prepare",
          reason: "eligible",
          note: "Strong fit. I’m preparing the Upwork draft now. Final submit remains manual.",
          actionId: 777,
          duplicate: false,
        },
      },
      {
        postChannelMessage: async () => {
          queuedPrepPostAttempted = true;
          return { ok: true, ts: "999.111", channel: "C123" };
        },
        postWebhookMessage: async () => {
          queuedPrepPostAttempted = true;
          return true;
        },
      },
    );
    assert(queuedPrepDiscovery.status === "posted", "Discovery lead Slack packet should still post as Touchpoint 1 when prep is queued");
    assert(queuedPrepDiscovery.outcome === "posted", "Touchpoint 1 lead alert should count as posted");
    assert(queuedPrepPostAttempted, "Queued autonomous prep must not suppress the capture-time lead alert");

    const threadJob = {
      ...beautyJob,
      id: "beauty-job-thread-v1",
      applicationDraft: {
        ...beautyJob.applicationDraft,
        jobId: "beauty-job-thread-v1",
        jobIntelligence: klaviyoIntel(),
      },
    };
    markJobSeen(threadJob, false);
    const threadAutoPrepare = autoQueuePrepareDraft(
      threadJob,
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
      null,
    );
    let parentPostCount = 0;
    let threadReplyCount = 0;
    const threadDiscovery = await postDiscoveryCapturePacket(
      {
        action: {
          id: 5023,
          jobId: threadJob.id,
          actionType: "capture_job_from_url",
          status: "pending",
          attempts: 0,
          payload: {
            url: threadJob.url,
            discovery: { sourceType: "best_matches", sourceLabel: "Best Matches" },
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        scored: threadJob,
        upworkUrl: threadJob.url,
        applicationQuestions: [],
        questionAnswers: [],
        autoPrepareDecision: threadAutoPrepare,
      },
      {
        postChannelMessage: async () => {
          parentPostCount += 1;
          return { ok: true, ts: "999.222", channel: "C123" };
        },
        postThreadMessage: async () => {
          threadReplyCount += 1;
          return true;
        },
      },
    );
    assert(threadDiscovery.thread?.threadTs === "999.222", "Touchpoint 1 should create the parent Slack thread for a new job");
    assert(parentPostCount === 1, "High-quality lead should create one parent Slack message");
    assert(threadReplyCount === 0, "First lead alert should not be a thread reply");
    const boundPrepareAction = getBrowserActionById(threadAutoPrepare.actionId!);
    assert(boundPrepareAction?.payload.threadTs === "999.222", "Auto-prep action should be bound to the parent Slack thread");
    assert(boundPrepareAction?.payload.channelId === "C123", "Auto-prep action should carry channel context for Touchpoint 2 thread replies");

    const repeatThreadDiscovery = await postDiscoveryCapturePacket(
      {
        action: {
          id: 5024,
          jobId: threadJob.id,
          actionType: "capture_job_from_url",
          status: "pending",
          attempts: 0,
          payload: {
            url: threadJob.url,
            discovery: { sourceType: "best_matches", sourceLabel: "Best Matches" },
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        scored: threadJob,
        upworkUrl: threadJob.url,
        applicationQuestions: [],
        questionAnswers: [],
        autoPrepareDecision: {
          ...threadAutoPrepare,
          duplicate: true,
          duplicateStatus: "pending",
        },
      },
      {
        postChannelMessage: async () => {
          parentPostCount += 1;
          return { ok: true, ts: "999.333", channel: "C123" };
        },
        postThreadMessage: async (payload) => {
          threadReplyCount += 1;
          assert(payload.threadTs === "999.222", "Repeated updates for a job should reuse the original thread");
          return true;
        },
      },
    );
    assert(repeatThreadDiscovery.status === "posted", "Repeated lead update should post into existing thread");
    assert(parentPostCount === 1, "Repeated updates for same job must not create another parent message");
    assert(threadReplyCount === 1, "Repeated updates for same job should be thread replies");

    webhookPostedText = "";
    const connectsManualReviewJob = {
      ...beautyJob,
      id: "beauty-job-connects-manual-review-discovery-v1",
      score: 84,
      scoreBreakdown: {
        ...beautyJob.scoreBreakdown,
        clientQualityScore: { score: 46, reasons: ["Thin client history"], risks: ["Limited spend"] },
        finalScore: 84,
      },
      applicationDraft: {
        ...beautyJob.applicationDraft,
        jobId: "beauty-job-connects-manual-review-discovery-v1",
        connectsStrategy: {
          decision: "manual_review",
          requiredConnects: 16,
          suggestedBoostConnects: 0,
          totalConnects: 16,
          expectedValueScore: 62,
          reasons: ["Client quality supports some spend."],
          risks: ["Total Connects require review before applying."],
        },
        jobIntelligence: klaviyoIntel({
          primaryPlatform: "Mailchimp",
          platformsMentioned: ["Mailchimp"],
          platformPreferenceTier: "secondary",
          platformFitReason: "Mailchimp is approved but spend needs review.",
        }),
      },
    };
    const connectsManualReviewDiscovery = await postDiscoveryCapturePacket(
      {
        action: {
          id: 5021,
          jobId: connectsManualReviewJob.id,
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
        scored: connectsManualReviewJob,
        upworkUrl: connectsManualReviewJob.url,
        applicationQuestions: [],
        questionAnswers: [],
        autoPrepareDecision: {
          shouldQueue: false,
          category: "blocked_no_manual_override",
          reason: "no thread context",
          note: "Connects spend review required.",
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
    assert(connectsManualReviewDiscovery.status === "posted", "Eligible connects-manual-review discovery lead should post");
    assert(connectsManualReviewDiscovery.outcome === "posted", "Eligible connects-manual-review discovery lead should count as posted");
    assert(webhookPostedText.includes("If you want this prepared, just say so naturally"), "Connects review-needed lead should ask for a natural clear next action");
    assert(!/Reply .*prep it/i.test(webhookPostedText), "Connects review-needed lead should not require an exact prep command");
    for (const noisy of ["manual review", "platformEligibility", "lead decision", "packet", "source context", "action id"]) {
      assert(!webhookPostedText.toLowerCase().includes(noisy.toLowerCase()), `Connects lead alert should hide ${noisy}`);
    }

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
    assert(beautyPlanResult.valid, "Beauty job plan should stay valid when proof is selected via Upwork portfolio instead of a missing local file");
    assert(beautyPlanResult.plan.stopBeforeSubmit === true, "Apply plan must enforce stopBeforeSubmit=true");
    assert(beautyPlanResult.plan.finalPreparationDiagnostics.stopBeforeSubmit === true, "Final-prep diagnostics must also enforce stopBeforeSubmit=true");
    assert(beautyPlanResult.plan.coverLetter.length > 0, "Apply plan should expose a browser-fill cover letter");
    assert(!/profile\/attachments|\.pdf\b|\.png\b|\.jpe?g\b/i.test(beautyPlanResult.plan.coverLetter), "Cover letter should not leak proof filenames or local attachment paths");
    assert(beautyPlanResult.plan.finalPreparationDiagnostics.coverLetter.present, "Final-prep diagnostics should report cover letter readiness");
    assert(beautyPlanResult.plan.screeningAnswers.length > 0, "Apply plan should expose screening answers when the draft contains them");
    assert(beautyPlanResult.plan.finalPreparationDiagnostics.screeningAnswers.count === beautyPlanResult.plan.screeningAnswers.length, "Final-prep diagnostics should count screening answers");
    assert(beautyPlanResult.plan.rate === "$50/hr", "Apply plan should anchor hourly rate inside the client's visible budget range");
    assert(beautyPlanResult.plan.connects.required === 4, "Apply plan should expose required Connects");
    assert(beautyPlanResult.plan.connects.boost === 0, "Apply plan must leave optional boost unset without explicit approval");
    assert(beautyPlanResult.plan.connectsStrategy.suggestedBoostConnects === 0, "Connects strategy snapshot should also leave boost unset");
    assert(beautyPlanResult.plan.connectsStrategy.sourceBackedConnects?.boostConnects === null, "Source-backed Connects should not imply an auto-set boost");
    assert(
      beautyPlanResult.issues.some((issue) => issue.code === "boost_requires_explicit_approval" && issue.severity === "warning"),
      "Suggested boost should be downgraded to an explicit-approval warning",
    );
    assert(beautyPlanResult.plan.finalPreparationDiagnostics.connects.total === beautyPlanResult.plan.connects.total, "Final-prep diagnostics should expose Connects totals");
    assert(
      beautyPlanResult.plan.connectsEvidence.some((line: string) => line.includes("captured required Connects")),
      "Apply plan should expose Connects evidence when available",
    );
    assert(
      !beautyPlanResult.plan.attachments.some((item: { filePath: string }) => item.filePath === "profile/attachments/truly-beauty-case-study.pdf"),
      "Beauty job should not attach Truly Beauty file when the matching Upwork portfolio item is selected",
    );
    assert(!beautyPlanResult.plan.filesAttached.includes("profile/attachments/truly-beauty-case-study.pdf"), "Apply plan should not duplicate portfolio proof as a file attachment");
    assert(!beautyPlanResult.plan.missingLocalAssets.includes("profile/attachments/truly-beauty-case-study.pdf"), "Portfolio-only proof should not create a missing local file blocker");
    assert(!beautyPlanResult.plan.missingFiles.includes("profile/attachments/truly-beauty-case-study.pdf"), "Portfolio-only proof should not expose missing files");
    assert(beautyPlanResult.plan.proofHighlights.length > 0, "Apply plan should expose proof highlights");
    assert(beautyPlanResult.plan.portfolioHighlights.some((line: string) => line.includes("Truly Beauty")), "Apply plan should expose portfolio highlights");
    assert(!beautyPlanResult.plan.portfolioHighlights.some((line: string) => /profile\/attachments|\.pdf\b|\.png\b|\.jpe?g\b/i.test(line)), "Portfolio highlights should use display labels, not proof filenames");
    assert(!beautyPlanResult.plan.finalPreparationDiagnostics.proofHighlights.some((line: string) => /profile\/attachments|\.pdf\b|\.png\b|\.jpe?g\b/i.test(line)), "Final-prep proof highlights should not leak proof filenames");
    assert(beautyPlanResult.plan.profileHighlights.length > 0, "Apply plan should expose profile highlights");
    assert(!beautyPlanResult.plan.manualFields.includes("attachments"), "Portfolio-only proof should not add attachments to manual fields");
    assert(beautyPlanResult.plan.manualFields.includes("finalSubmit"), "Final submit should remain a manual field");
    assert(
      !beautyPlanResult.plan.finalPreparationDiagnostics.blockers.some((line: string) => line.includes("required_attachment_missing_locally")),
      "Portfolio-only proof should not create an attachment blocker",
    );
    assert(
      !beautyPlanResult.issues.some((issue) => issue.code === "required_attachment_missing_locally" && issue.severity === "error"),
      "Portfolio-only proof should not require a local file",
    );
    assert(
      !beautyPlanResult.plan.attachments.some((item: { filePath: string }) => item.filePath.includes("dr-rachael")),
      "Unsafe Dr. Rachael assets must not auto-attach for beauty job",
    );
    assert(beautyPlanResult.plan.manualReviewAssets.every((item: string) => !item.includes("figma.com")), "Figma links must not appear in auto/manual asset list");
    assert(beautyPlanResult.plan.highlights.every((item: string) => !/generated|revenue|sales|repeat purchase|click rate/i.test(item)), "Highlight selection should contain actionable Upwork portfolio labels, not proof result copy");

    const lowBudgetKlaviyoJob = scoreJob({
      id: "low-budget-klaviyo-job-1",
      title: "Email Marketing Specialist (Klaviyo)",
      url: "https://www.upwork.com/jobs/~lowbudgetklaviyo123456",
      description: "Fast-growing ecommerce brand needs Klaviyo flows, campaign calendar, segmentation, A/B testing, reporting, and examples of campaigns or flows with results. To apply, include examples, your first 30 day approach, availability, and hourly rate. Bonus: mental wellness, health, or digital-product category experience.",
      postedAt: new Date().toISOString(),
      budget: "$5.00 - $10.00 Hourly range",
      clientCountry: "United States",
      clientRating: 4.8,
      clientSpend: 50000,
      clientHireRate: 75,
      clientTotalHires: 20,
      clientFeedbackCount: 12,
      category: "Email Marketing",
      experienceLevel: "Intermediate",
      connectsCost: 17,
      skills: ["Klaviyo", "Email Marketing", "Shopify", "Lifecycle Marketing"],
      sourceQuery: "manual",
    });
    lowBudgetKlaviyoJob.applicationDraft = buildApplicationDraft(lowBudgetKlaviyoJob);
    lowBudgetKlaviyoJob.applicationDraft.status = "approved";
    lowBudgetKlaviyoJob.applicationDraft.jobIntelligence = klaviyoIntel({
      ecommerceVertical: "generic ecommerce",
      taskType: "Klaviyo flows and campaigns",
      clientGoal: "Own lifecycle marketing and reporting",
    });
    markJobSeen(lowBudgetKlaviyoJob, false);
    const lowBudgetPlanResult = buildBrowserApplyPlan(lowBudgetKlaviyoJob.id);
    assert(lowBudgetKlaviyoJob.applicationDraft.suggestedBid === "$15/hr", "Low-budget hourly jobs should anchor near the client cap instead of using $35/hr");
    assert(lowBudgetPlanResult.plan.rate === "$15/hr", "Apply plan should expose the budget-anchored hourly rate");
    assert(!/Portfolio\.pdf|Lifely\.pdf|Case Study\.pdf/i.test(lowBudgetKlaviyoJob.applicationDraft.proposalText), "Generated proposal should not leak raw proof filenames");
    assert(
      !lowBudgetPlanResult.plan.attachments.some((item: { filePath: string }) => /dr-rachael|endurance-wellness/i.test(item.filePath)),
      "Bonus-only health/wellness text must not select health-specific attachments",
    );
    assert(
      lowBudgetPlanResult.plan.attachments.length <= 1 &&
      lowBudgetPlanResult.plan.attachments.some((item: { filePath: string }) => item.filePath === "profile/screenshots/hangaritas-klaviyo-performance.png"),
      "Generic Klaviyo proof requests should plan one Klaviyo screenshot instead of multiple portfolio highlights",
    );
    assert(lowBudgetPlanResult.plan.highlights.length === 4, "Generic Klaviyo proof requests should fill the four Upwork portfolio slots without replacing the screenshot proof");
    assert(lowBudgetPlanResult.plan.portfolioHighlights.some((line: string) => line.includes("Truly Beauty")), "Generic Klaviyo proof requests should include approved Upwork portfolio highlights");

    const ingestedRelativePath = "slack-intake/beauty-job-1/truly-beauty-case-study.pdf";
    const ingestedAbsolutePath = resolve(proofRoot, ingestedRelativePath);
    mkdirSync(dirname(ingestedAbsolutePath), { recursive: true });
    writeFileSync(ingestedAbsolutePath, "pdf");
    registerApplicationAsset({
      jobId: beautyJob.id,
      source: "slack",
      sourceFileId: "FTRULY",
      originalName: "truly-beauty-case-study.pdf",
      relativePath: ingestedRelativePath,
      mimeType: "application/pdf",
      sizeBytes: 3,
      proofType: "file",
      attachPolicy: "auto_attach",
    });
    const beautyPlanAfterSlackUpload = buildBrowserApplyPlan(beautyJob.id);
    assert(
      !beautyPlanAfterSlackUpload.plan.attachments.some((item: { filePath: string }) => item.filePath === ingestedRelativePath),
      "Slack-ingested file should not be attached when the same proof is already represented by an Upwork portfolio item.",
    );
    assert(
      !beautyPlanAfterSlackUpload.plan.missingLocalAssets.includes("profile/attachments/truly-beauty-case-study.pdf"),
      "Portfolio-selected proof should not carry a missing file blocker.",
    );

    const prepareReply = buildPrepareDraftQueueReply({
      jobId: beautyJob.id,
      threadTitle: beautyJob.title,
      upworkUrl: beautyJob.url,
      actionId: 99,
      duplicate: false,
      duplicateStatus: null,
    });
    assert(prepareReply.includes("ready for QA"), "Prepare reply should be a concise acknowledgement");
    assert(prepareReply.includes("stop before submit"), "Prepare reply should keep manual submit boundary");
    assert(!prepareReply.toLowerCase().includes("copy/paste"), "Prepare reply must not introduce copy/paste workflow");
    assert(!prepareReply.includes("Auto-attach assets:"), "Prepare reply should not dump proof inventory");
    assert(!prepareReply.toLowerCase().includes("action:"), "Prepare reply should not expose action ids by default");

    const verificationPlan = {
      ...beautyPlanResult.plan,
      attachments: [],
      highlights: ["Klaviyo retention proof"],
      missingLocalAssets: [],
      connects: { ...beautyPlanResult.plan.connects, required: 8, boost: 0, total: 8 },
      connectsStrategy: { ...beautyPlanResult.plan.connectsStrategy, decision: "safe_apply", sourceBackedConnects: { requiredConnects: 8, boostConnects: null, totalConnects: null, confidence: "high", sourceText: "Required for proposal: 8 Connects", sourceLocation: "line 1", extractionMethod: "deterministic_visible_text" } },
    };
    const unknownOnlySkipPlan = {
      ...verificationPlan,
      connects: { ...verificationPlan.connects, required: null, boost: null, total: null, approvalRequired: true },
      connectsStrategy: {
        ...verificationPlan.connectsStrategy,
        decision: "skip",
        requiredConnects: null,
        suggestedBoostConnects: 0,
        totalConnects: null,
        expectedValueScore: 21,
        sourceBackedConnects: {
          requiredConnects: null,
          boostConnects: null,
          totalConnects: null,
          confidence: "unknown",
          sourceText: null,
          sourceLocation: null,
          extractionMethod: "not_found",
        },
        risks: [
          "Required Connects are unknown from visible source text.",
          "Expected value is too weak to spend Connects without a source-backed required cost.",
        ],
      },
      validationIssues: [
        { severity: "warning", code: "required_connects_unknown_apply_page_verification", message: "Required Connects are not source-backed yet." },
        { severity: "warning", code: "connects_apply_page_verification_required", message: "Verify on apply page." },
      ],
    };
    const unknownOnlyConnectsIssues = verifyApplyPageConnects(unknownOnlySkipPlan, "Required for proposal: 8 Connects\nSend for 8 Connects");
    assert(unknownOnlyConnectsIssues.length === 0, "Once bottom-of-page Connects are readable, unknown-only Connects skip should clear");
    assert(unknownOnlySkipPlan.connects.required === 8, "Verified required Connects should be copied into the plan");
    assert(unknownOnlySkipPlan.connectsStrategy.decision === "safe_apply", "Unknown-only Connects skip should become safe prep after verification");
    assert(
      getRequiredSkippedFields({
        skippedFields: ["rate"],
        fieldVerification: [{ field: "rate", status: "verified", detail: "Fixed-price bid field is present." }],
      }).length === 0,
      "Skipped rate fill should not block when fixed-price rate readback verified.",
    );
    assert(
      getRequiredSkippedFields({
        skippedFields: ["rate"],
        fieldVerification: [{ field: "rate", status: "attempted_unverified", detail: "Rate did not verify." }],
      }).includes("rate"),
      "Skipped rate fill should still block when rate readback did not verify.",
    );

    const fixedPriceVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({
        visibleText: "Fixed-price\nWhat is the full amount you'd like to bid for this job?\nHow long will this project take?\nLess than 1 month\nAdditional details\nRequired for proposal: 9 Connects\nSend for 9 Connects",
        fields: [
          { kind: "textarea", value: verificationPlan.coverLetter },
          { kind: "input", type: "text", id: "charged-amount-id", label: "Bid", dataTest: "currency-input", value: "$10.00" },
          { kind: "input", type: "file", value: "C:\\fakepath\\hangaritas-klaviyo-performance.png", files: ["hangaritas-klaviyo-performance.png"] },
        ],
      }),
      plan: {
        ...verificationPlan,
        rate: "$10.82/hr",
        screeningAnswers: ["Planned answer that should not block when no screening field exists."],
        attachments: [
          {
            id: "profile/screenshots/hangaritas-klaviyo-performance.png",
            name: "Hangaritas Klaviyo Performance",
            filePath: "profile/screenshots/hangaritas-klaviyo-performance.png",
            sensitivity: "approved_external",
          },
        ],
        connects: { ...verificationPlan.connects, required: 9, total: 9 },
      },
      fields: { attemptedFields: ["coverLetter", "rate", "attachments"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Fixed-price\nRequired for proposal: 9 Connects\nSend for 9 Connects",
    });
    assert(fixedPriceVerification.find((item) => item.field === "coverLetter")?.status === "verified", "Fixed-price application should verify the filled cover letter.");
    assert(fixedPriceVerification.find((item) => item.field === "rate")?.status === "verified", "Fixed-price bid field should satisfy rate/bid verification.");
    assert(fixedPriceVerification.find((item) => item.field === "screeningAnswers")?.status === "skipped_by_strategy", "Absent screening fields should not block fixed-price applications.");
    assert(fixedPriceVerification.find((item) => item.field === "attachments")?.status === "verified", "Uploaded attachment filename should verify.");
    assert(fixedPriceVerification.find((item) => item.field === "finalSubmit")?.status === "skipped_by_strategy", "Final submit must remain untouched.");

    const incompleteFixedPriceVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({
        visibleText: "Fixed-price\nBy milestone\nMilestone 1 Amount\n$0.00\nHow long will this project take?\nSelect a duration\nAdditional details\nRequired for proposal: 9 Connects\nSend for 9 Connects",
        fields: [
          { kind: "textarea", value: verificationPlan.coverLetter },
          { kind: "input", type: "text", id: "milestone-amount-1", label: "Milestone 1 Amount", dataTest: "currency-input", value: "$0.00" },
        ],
      }),
      plan: {
        ...verificationPlan,
        rate: "$10.82/hr",
        screeningAnswers: [],
        attachments: [],
        connects: { ...verificationPlan.connects, required: 9, total: 9 },
      },
      fields: { attemptedFields: ["coverLetter", "rate"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Fixed-price\nRequired for proposal: 9 Connects\nSend for 9 Connects",
    });
    assert(incompleteFixedPriceVerification.find((item) => item.field === "rate")?.status === "attempted_unverified", "Fixed-price $0.00 without duration must not verify as ready.");
    assert(Boolean(incompleteFixedPriceVerification.find((item) => item.field === "rate")?.detail.includes("positive fixed-price amount")), "Incomplete fixed-price terms should name the missing positive amount.");
    assert(Boolean(incompleteFixedPriceVerification.find((item) => item.field === "rate")?.detail.includes("project duration")), "Incomplete fixed-price terms should name the missing duration.");

    const emptyCoverVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({ visibleText: "Required for proposal: 8 Connects\nSend for 8 Connects\nAdd a portfolio project\nAdd a certificate", inputValues: ["", "$35"], checkedLabels: [], fileNames: [] }),
      plan: verificationPlan,
      fields: { attemptedFields: ["coverLetter", "rate"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects\nSend for 8 Connects",
    });
    assert(emptyCoverVerification.find((item) => item.field === "coverLetter")?.status === "attempted_unverified", "Cover letter must not verify when the field remains empty.");
    assert(emptyCoverVerification.find((item) => item.field === "requiredConnects")?.status === "verified", "Apply-page required Connects should verify separately from boost.");
    assert(emptyCoverVerification.find((item) => item.field === "boostConnects")?.detail === "No boost set.", "No boost should be reported honestly when none is set.");
    assert(emptyCoverVerification.find((item) => item.field === "profileHighlights")?.status === "attempted_unverified", "Add portfolio/certificate UI should be treated as a selector entry point, not immediate unavailable proof.");

    const applyPageConnectsOnlyVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({
        visibleText: "This proposal requires 9 Connects\nWhen you submit this proposal, you'll have 522 Connects remaining.\nSend for 9 Connects",
        inputValues: [verificationPlan.coverLetter, "$50"],
      }),
      plan: {
        ...verificationPlan,
        highlights: [],
        connects: { ...verificationPlan.connects, required: null, boost: 0, total: null, approvalRequired: true },
      },
      fields: { attemptedFields: ["coverLetter", "rate"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "This proposal requires 9 Connects\nSend for 9 Connects",
    });
    assert(applyPageConnectsOnlyVerification.find((item) => item.field === "requiredConnects")?.status === "verified", "Visible apply-page Connects should verify even when the stored draft started unknown.");
    assert(applyPageConnectsOnlyVerification.find((item) => item.field === "requiredConnects")?.actual === "9", "Verified required Connects should report the visible bottom-of-page value.");

    const unsafeBoostVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({ visibleText: "Required for proposal: 8 Connects\nBoost: 80 Connects", inputValues: [verificationPlan.coverLetter, "80"] }),
      plan: { ...verificationPlan, connects: { ...verificationPlan.connects, boost: 80, total: 88 } },
      fields: { attemptedFields: ["coverLetter", "connectsBoost"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects\nBoost: 80 Connects",
    });
    assert(unsafeBoostVerification.find((item) => item.field === "boostConnects")?.status === "blocked_by_upwork_ui", "Boost Connects above 50 must never be reported as safe/set.");

    const visibleTableOnlyBoostVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({ visibleText: "Required for proposal: 8 Connects\n#4 bid 12 Connects", inputValues: [verificationPlan.coverLetter] }),
      plan: { ...verificationPlan, connects: { ...verificationPlan.connects, boost: 12, total: 20 } },
      fields: { attemptedFields: ["coverLetter", "connectsBoost"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects\n#4 bid 12 Connects",
    });
    assert(
      visibleTableOnlyBoostVerification.find((item) => item.field === "boostConnects")?.status === "attempted_unverified",
      "Visible boost table text must not be treated as proof that the boost field was set.",
    );

    const unsetBoostVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({ visibleText: "Required for proposal: 8 Connects\n#4 bid 12 Connects", inputValues: [verificationPlan.coverLetter] }),
      plan: { ...verificationPlan, connects: { ...verificationPlan.connects, boost: 0, total: 8 } },
      fields: { attemptedFields: ["coverLetter"], skippedFields: ["connectsBoost"], manualFields: ["connects", "finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects\n#4 bid 12 Connects",
    });
    assert(unsetBoostVerification.find((item) => item.field === "boostConnects")?.status === "skipped_by_strategy", "Visible boost table should stay unset unless explicitly approved.");

    const pollutedApplyVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({
        visibleText: "Required for proposal: 8 Connects\nSend for 8 Connects",
        fields: [
          { kind: "textarea", label: "Cover letter", value: verificationPlan.coverLetter },
          { kind: "input", type: "hidden", name: "question-1", value: "1" },
          { kind: "input", type: "radio", label: "Yes", name: "screening-radio", value: "true", checked: true },
          { kind: "input", type: "hidden", name: "question-id", value: "1828757710371885667" },
          { kind: "input", ariaLabel: "Hourly rate", dataTest: "currency-input", value: "3535" },
        ],
      }),
      plan: { ...verificationPlan, rate: "$35/hr" },
      fields: { attemptedFields: ["coverLetter", "screeningAnswers:2", "rate"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects\nSend for 8 Connects",
    });
    assert(pollutedApplyVerification.find((item) => item.field === "coverLetter")?.status === "verified", "Cover letter should still verify from its textarea.");
    assert(pollutedApplyVerification.find((item) => item.field === "screeningAnswers")?.status === "skipped_by_strategy", "Radio/hidden field values must not verify screening answers.");
    assert(pollutedApplyVerification.find((item) => item.field === "rate")?.status === "attempted_unverified", "Concatenated stale rate values like 3535 must not verify as a $35 bid.");

    writeFileSync(resolve(proofRoot, "package.json"), "{}");
    const verifiedApplyVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({
        visibleText: "Required for proposal: 8 Connects\nSend for 8 Connects\npackage.json",
        inputValues: [verificationPlan.coverLetter, ...verificationPlan.screeningAnswers, "$50"],
        checkedLabels: ["Klaviyo retention proof"],
        fileNames: ["package.json"],
      }),
      plan: {
        ...verificationPlan,
        attachments: [{ id: "truly", name: "Truly Beauty case study", filePath: "package.json", sensitivity: "approved_external" }],
      },
      fields: { attemptedFields: ["coverLetter", "screeningAnswers:2", "rate", "attachments", "highlights"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects\nSend for 8 Connects",
    });
    assert(verifiedApplyVerification.find((item) => item.field === "coverLetter")?.status === "verified", "Cover letter should verify after fill when intended text is present.");
    assert(verifiedApplyVerification.find((item) => item.field === "screeningAnswers")?.status === "verified", "Screening answers should verify after fill when answer text is present.");
    assert(verifiedApplyVerification.find((item) => item.field === "rate")?.status === "verified", "Rate should verify only when the visible rate field contains the planned bid.");
    assert(verifiedApplyVerification.find((item) => item.field === "attachments")?.status === "verified", "Attachments should verify when uploaded file names are visible.");
    assert(verifiedApplyVerification.find((item) => item.field === "profileHighlights")?.status === "verified", "Profile highlights should verify only when checked labels are visible.");
    assert(verifiedApplyVerification.find((item) => item.field === "pageStructure")?.status === "verified", "Known apply-page structure should verify before ready status.");
    assert(verifiedApplyVerification.find((item) => item.field === "finalSubmitButton")?.status === "verified", "Final submit button should be detected but not clicked.");
    assert(Boolean(verifiedApplyVerification.find((item) => item.field === "attachments")?.detail.includes("package.json")), "Attachment verification should name verified files.");
    assert(Boolean(verifiedApplyVerification.find((item) => item.field === "profileHighlights")?.detail.includes("Klaviyo retention proof")), "Portfolio/profile verification should name verified labels.");

    const truncatedLifelyVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({
        visibleText: "Required for proposal: 8 Connects\nProfile highlights\nPortfolio\n4 - How Lifely Transformed Their Retention M...\nSkills: Email Deliverability, List Building\nBoost your proposal\nSend for 8 Connects",
        inputValues: [verificationPlan.coverLetter, "$50"],
      }),
      plan: { ...verificationPlan, screeningAnswers: [], attachments: [], highlights: ["How Lifely Transformed Their Retention Marketing"] },
      fields: { attemptedFields: ["coverLetter", "rate", "highlights"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects\nSend for 8 Connects",
    });
    assert(truncatedLifelyVerification.find((item) => item.field === "profileHighlights")?.status === "verified", "Upwork-truncated selected Lifely portfolio title should verify in browser diagnostics.");

    const selectedButtonsOnlyVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({
        visibleText: "Required for proposal: 8 Connects\nProfile highlights\nBoost your proposal\nSend for 8 Connects",
        inputValues: [verificationPlan.coverLetter, "$50"],
        actionLabels: ["Selected", "Selected", "Selected", "Selected", "Send for 8 Connects"],
      }),
      plan: {
        ...verificationPlan,
        screeningAnswers: [],
        attachments: [],
        highlights: ["The Fly Boutique", "Steve's Design Case Studies", "From $250k to $1.2 Million In 12 Months / Truly Beauty", "How Lifely Transformed Their Retention Marketing"],
      },
      fields: { attemptedFields: ["coverLetter", "rate", "highlights"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects\nSend for 8 Connects",
    });
    assert(
      selectedButtonsOnlyVerification.find((item) => item.field === "profileHighlights")?.status === "verified",
      "Four Upwork Selected controls should verify four planned profile highlights even when names are hidden.",
    );

    const uncommittedSelectedButtonsVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({
        visibleText: "Required for proposal: 8 Connects\nProfile highlights\nAdd profile highlights\nHighlights (4/4)\nBoost your proposal\nSend for 8 Connects",
        inputValues: [verificationPlan.coverLetter, "$50"],
        actionLabels: ["Selected", "Selected", "Selected", "Selected", "Select highlight", "Add to highlights", "Send for 8 Connects"],
      }),
      plan: {
        ...verificationPlan,
        screeningAnswers: [],
        attachments: [],
        highlights: ["The Fly Boutique", "Steve's Design Case Studies", "From $250k to $1.2 Million In 12 Months / Truly Beauty", "How Lifely Transformed Their Retention Marketing"],
      },
      fields: { attemptedFields: ["coverLetter", "rate", "highlights"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects\nSend for 8 Connects",
    });
    assert(
      uncommittedSelectedButtonsVerification.find((item) => item.field === "profileHighlights")?.status !== "verified",
      "Selected controls inside an open picker must not verify until Add to highlights commits them.",
    );

    const duplicateAttachmentVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({
        visibleText: "Required for proposal: 8 Connects\nSend for 8 Connects\npackage.json\npackage.json",
        inputValues: [verificationPlan.coverLetter, "$50"],
        attachmentRows: ["package.json", "package.json"],
      }),
      plan: {
        ...verificationPlan,
        screeningAnswers: [],
        highlights: [],
        attachments: [{ id: "truly", name: "Truly Beauty case study", filePath: "package.json", sensitivity: "approved_external" }],
      },
      fields: { attemptedFields: ["coverLetter", "rate", "attachments"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects\nSend for 8 Connects",
    });
    assert(duplicateAttachmentVerification.find((item) => item.field === "attachments")?.status === "attempted_unverified", "Duplicate visible attachment rows must not verify.");

    const modalOnlyPortfolioVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({
        visibleText: "Required for proposal: 8 Connects\nProfile highlights\nAdd a portfolio project\nAdd a certificate\nBoost your proposal\nKlaviyo retention proof\nSend for 8 Connects",
        inputValues: [verificationPlan.coverLetter, "$50"],
      }),
      plan: { ...verificationPlan, screeningAnswers: [], attachments: [], highlights: ["Klaviyo retention proof"] },
      fields: { attemptedFields: ["coverLetter", "rate", "highlights"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects\nSend for 8 Connects",
    });
    assert(modalOnlyPortfolioVerification.find((item) => item.field === "profileHighlights")?.status === "attempted_unverified", "Portfolio names outside selected highlight evidence must not verify.");

    const missingSubmitVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({
        visibleText: "Required for proposal: 8 Connects\nCover letter\nHourly rate",
        inputValues: [verificationPlan.coverLetter, ...verificationPlan.screeningAnswers, "$50"],
      }),
      plan: verificationPlan,
      fields: { attemptedFields: ["coverLetter", "screeningAnswers:2", "rate"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects",
    });
    assert(missingSubmitVerification.find((item) => item.field === "finalSubmitButton")?.status === "attempted_unverified", "Missing final submit control must fail closed instead of reporting ready.");

    const missingFileVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({ visibleText: "Required for proposal: 8 Connects", inputValues: [verificationPlan.coverLetter], fileNames: [] }),
      plan: {
        ...verificationPlan,
        attachments: [{ id: "missing", name: "Missing case study", filePath: "profile/attachments/missing-case-study.pdf", sensitivity: "approved_external" }],
      },
      fields: { attemptedFields: ["coverLetter", "attachments"], skippedFields: [], manualFields: ["attachments", "finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects",
    });
    assert(missingFileVerification.find((item) => item.field === "attachments")?.status === "missing_local_file", "Missing local files must be reported honestly.");

    const tabMismatchVerification = await verifyApplyPreparationOnPage({
      page: fakeApplyPage({ url: "https://www.upwork.com/ab/proposals/job/~differentjob123456/apply/", visibleText: "Required for proposal: 8 Connects", inputValues: [verificationPlan.coverLetter] }),
      plan: verificationPlan,
      fields: { attemptedFields: ["coverLetter"], skippedFields: [], manualFields: ["finalSubmit"] },
      bodyText: "Required for proposal: 8 Connects",
    });
    assert(tabMismatchVerification.find((item) => item.field === "targetTab")?.status === "attempted_unverified", "Tab mismatch must not produce false apply-prep success.");

    let prepCompletionText = "";
    const prepCompletionPost = await postPrepareDraftStatus(
      {
        thread: { channelId: "C123", messageTs: "999.222", threadTs: "999.222" },
        heading: "✅ Upwork application page prepared for final manual submit for browser action #707.",
        diagnostics: {
          actionId: 707,
          jobId: beautyJob.id,
          jobTitle: beautyJob.title,
          actionType: "prepare_application_review",
          sourceUrl: beautyJob.url,
          applyUrl: `${beautyJob.url}/apply`,
          intendedAction: "Open Upwork apply page, prepare fields for human review, and stop before submit.",
          state: "apply_page_loaded",
          stopBeforeSubmit: true,
          validationIssues: [],
          coverLetterPresent: true,
          coverLetterLength: 220,
          coverLetterPreview: "Hi there - I can help turn these Klaviyo campaign emails into a tighter retention sequence.",
          screeningAnswersCount: 2,
          screeningAnswers: ["I would audit the current segments, then prioritize flows by revenue impact.", "I can start with a quick QA pass and implementation plan."],
          rate: "$72/hr",
          requiredConnects: 4,
          boostConnects: 0,
          totalConnects: 4,
          connectsDecision: "safe_apply",
          connectsExpectedValue: 88,
          selectedAttachments: ["Truly Beauty case study"],
          manualReviewAssets: [],
          mentionOnlyProof: [],
          proofAvailability: ["Truly Beauty case study: ready"],
          figmaRecommendations: [],
          videoRecommendations: [],
          manualReviewWarnings: [],
          missingLocalAssets: [],
          skippedAttachments: [],
          selectedHighlights: [],
          warnings: [],
          attemptedFields: ["cover letter", "screening answers", "rate"],
          skippedFields: [],
          manualFields: [],
          fieldVerification: [
            { field: "targetTab", status: "verified", detail: "Apply tab matches target job URL." },
            { field: "coverLetter", status: "verified", detail: "Cover letter field contains the intended text." },
            { field: "screeningAnswers", status: "verified", detail: "2/2 screening answers are present." },
            { field: "rate", status: "verified", detail: "Rate field contains 72." },
            { field: "requiredConnects", status: "verified", detail: "Required Connects verified as 4." },
            { field: "boostConnects", status: "skipped_by_strategy", detail: "No boost set." },
            { field: "attachments", status: "verified", detail: "1/1 uploaded files are visible." },
            { field: "profileHighlights", status: "skipped_by_strategy", detail: "No profile highlights selected by strategy." },
            { field: "finalSubmit", status: "skipped_by_strategy", detail: "Final submit/send button was intentionally not clicked." },
          ],
          verifiedFields: ["targetTab", "coverLetter", "screeningAnswers", "rate", "requiredConnects", "attachments"],
          unverifiedFields: [],
          unavailableFields: [],
          missingFileFields: [],
          blockedByUiFields: [],
          skippedByStrategyFields: ["boostConnects", "profileHighlights", "finalSubmit"],
        },
      },
      {
        postThreadMessage: async (payload) => {
          assert(payload.channel === "C123", "Touchpoint 2 should use the original lead channel");
          assert(payload.threadTs === "999.222", "Touchpoint 2 should post under the original lead thread");
          prepCompletionText = String(payload.text ?? "");
          return true;
        },
      },
    );
    assert(prepCompletionPost === "posted", "Prepared browser application should post final-review Slack thread reply");
    assert(prepCompletionText.includes("✅ *Ready for QA*"), "Prep completion alert should use concise ready-for-QA wording");
    assert(prepCompletionText.includes("remote Chrome"), "Prep completion alert should say the draft is in remote Chrome");
    assert(prepCompletionText.includes("VNC"), "Prep completion alert should direct QA to remote Chrome/VNC");
    assert(!prepCompletionText.includes("Safari"), "Prep completion alert should not push URL copy/paste into local Safari");
    assert(!prepCompletionText.includes("*Apply URL:*"), "Prep completion alert should not require URL copy/paste into VNC");
    assert(prepCompletionText.includes("• *Cover letter:* filled"), "Prep completion alert should only claim filled cover letter when verified");
    assert(prepCompletionText.includes("• *Screening answers:* filled"), "Prep completion alert should summarize verified screening answers compactly");
    assert(prepCompletionText.includes("• *Proof files:* attached: Truly Beauty case study"), "Prep completion alert should include verified proof files checklist item.");
    assert(prepCompletionText.includes("• *Portfolio highlights:* none"), "Prep completion alert should include portfolio checklist item.");
    assert(!prepCompletionText.includes("*Cover letter draft:*"), "Prep completion alert should keep QA handoff compact; draft is available by asking in Slack.");
    assert(!prepCompletionText.includes("*Screening answers filled:*"), "Prep completion alert should keep QA handoff compact.");
    assert(prepCompletionText.includes("• *Connects:* 4 required"), "Prep completion alert should summarize Connects");
    assert(prepCompletionText.includes("• *Boost:* not set yet"), "Prep completion alert should report no boost set honestly");
    assert(!prepCompletionText.includes("*Proof verified:*"), "Prep completion alert should not merge proof files and portfolio highlights into an ambiguous proof status");
    assert(!prepCompletionText.includes("*Proof I used:*"), "Prep completion alert must not use old proof wording");
    assert(prepCompletionText.includes("You can correct proof here in Slack"), "Prep completion alert should explain natural proof corrections");
    assert(prepCompletionText.includes("Nothing submitted: I did not click the final Upwork submit button."), "Prep completion alert should explicitly say nothing was submitted.");
    assert(prepCompletionText.includes("• *Final submit:* untouched — nothing submitted"), "Prep completion alert should include final-submit checklist item.");
    assert(prepCompletionText.includes("manually click *Send for 4 Connects*"), "Prep completion alert should preserve final submit safety");
    assert(!prepCompletionText.includes("Fields filled:"), "Prep completion alert should not include internal field inventory");
    assert(!prepCompletionText.includes("Auto-attach assets:"), "Prep completion alert should not include exhaustive proof inventory");
    for (const noisy of ["manual review", "platformEligibility", "lead decision", "packet", "source context", "action id"]) {
      assert(!prepCompletionText.toLowerCase().includes(noisy.toLowerCase()), `Prep completion alert should hide ${noisy}`);
    }

    const blockedPrepDiagnostics = {
      actionId: 708,
      jobId: beautyJob.id,
      jobTitle: beautyJob.title,
      actionType: "prepare_application_review",
      sourceUrl: beautyJob.url,
      applyUrl: `${beautyJob.url}/apply`,
      intendedAction: "Open Upwork apply page, prepare fields for human review, and stop before submit.",
      state: "field_preparation_incomplete",
      stopBeforeSubmit: true,
      validationIssues: [
        {
          severity: "error",
          code: "required_attachment_missing_locally",
          message: "profile/attachments/truly-beauty-case-study.pdf is selected for browser preparation but is missing locally.",
        },
      ],
      coverLetterPresent: true,
      coverLetterLength: 220,
      coverLetterPreview: "Hi there - I can help with Klaviyo retention work.",
      screeningAnswersCount: 2,
      screeningAnswers: ["I would audit the current lifecycle setup.", "I would prioritize high-impact flows first."],
      rate: "$72/hr",
      requiredConnects: 4,
      boostConnects: 0,
      totalConnects: 4,
      connectsDecision: "safe_apply",
      connectsExpectedValue: 88,
      selectedAttachments: ["Truly Beauty case study"],
      manualReviewAssets: [],
      mentionOnlyProof: [],
      proofAvailability: ["Truly Beauty case study: missing locally"],
      figmaRecommendations: [],
      videoRecommendations: [],
      manualReviewWarnings: [],
      missingLocalAssets: ["profile/attachments/truly-beauty-case-study.pdf"],
      skippedAttachments: [],
      selectedHighlights: ["Klaviyo retention proof"],
      warnings: ["[error] required_attachment_missing_locally: missing selected attachment"],
      attemptedFields: ["screening answers"],
      skippedFields: ["coverLetter", "rate"],
      manualFields: ["attachments", "finalSubmit"],
      fieldVerification: [
        { field: "targetTab", status: "verified", detail: "Apply tab matches target job URL." },
        { field: "coverLetter", status: "blocked_by_upwork_ui", detail: "Cover letter field was not filled by the Upwork UI." },
        { field: "screeningAnswers", status: "attempted_unverified", detail: "0/2 screening answers verified; remaining answers need QA." },
        { field: "rate", status: "blocked_by_upwork_ui", detail: "Rate field was not fillable." },
        { field: "requiredConnects", status: "verified", detail: "Required Connects verified as 4." },
        { field: "boostConnects", status: "skipped_by_strategy", detail: "No boost set." },
        { field: "attachments", status: "missing_local_file", detail: "Missing local files: profile/attachments/truly-beauty-case-study.pdf" },
        { field: "finalSubmit", status: "skipped_by_strategy", detail: "Final submit/send button was intentionally not clicked." },
      ],
      verifiedFields: ["targetTab", "requiredConnects"],
      unverifiedFields: ["screeningAnswers"],
      unavailableFields: [],
      missingFileFields: ["attachments"],
      blockedByUiFields: ["coverLetter", "rate"],
      skippedByStrategyFields: ["boostConnects", "finalSubmit"],
    };

    let blockedPrepCompletionText = "";
    const blockedPrepCompletionPost = await postPrepareDraftStatus(
      {
        thread: { channelId: "C123", messageTs: "999.222", threadTs: "999.222" },
        heading: "⚠️ Draft preparation paused for browser action #708.",
        diagnostics: blockedPrepDiagnostics,
      },
      {
        postThreadMessage: async (payload) => {
          assert(payload.channel === "C123", "Job-specific blocker should use the original lead channel");
          assert(payload.threadTs === "999.222", "Job-specific blocker should post under the original lead thread");
          blockedPrepCompletionText = String(payload.text ?? "");
          return true;
        },
      },
    );
    assert(blockedPrepCompletionPost === "posted", "Blocked browser application diagnostics should post into the job thread");
    assert(blockedPrepCompletionText.includes("⚠️ *Needs QA in Upwork*"), "Blocked prep diagnostics should use human blocker heading");
    assert(!blockedPrepCompletionText.includes("filled the cover letter"), "Blocked prep diagnostics must not claim the cover letter was filled unless verified.");
    assert(blockedPrepCompletionText.includes("• *Cover letter:* blocked by Upwork UI"), "Blocked prep diagnostics should describe page readback without claiming verification.");
    assert(blockedPrepCompletionText.includes("• *Proof files:* planned: Truly Beauty case study"), "Blocked prep diagnostics should separate proof files from portfolio status.");
    assert(blockedPrepCompletionText.includes("truly-beauty-case-study.pdf"), "Blocked prep diagnostics should list the missing file name");
    assert(blockedPrepCompletionText.includes("reply “retry”"), "Blocked prep diagnostics should give a concise next step");
    assert(blockedPrepCompletionText.includes("Nothing submitted: I did not click the final Upwork submit button."), "Blocked prep diagnostics should explicitly say nothing was submitted.");
    assert(!blockedPrepCompletionText.includes("*Proof I used:*"), "Blocked prep diagnostics must not use verified/used proof wording.");
    assert(!blockedPrepCompletionText.includes("Stop before submit:"), "Blocked prep diagnostics should not include internal submit-guard debug lines");
    for (const noisy of ["manual review", "platformEligibility", "lead decision", "packet", "source context", "action id"]) {
      assert(!blockedPrepCompletionText.toLowerCase().includes(noisy.toLowerCase()), `Blocked prep alert should hide ${noisy}`);
    }

    const kimiQaRequests: any[] = [];
    let kimiQaHandoffText = "";
    const kimiQaPost = await postPrepareDraftStatus(
      {
        thread: { channelId: "C123", messageTs: "999.444", threadTs: "999.444" },
        heading: "⚠️ Draft preparation paused for browser action #708.",
        diagnostics: blockedPrepDiagnostics,
      },
      {
        copyProvider: {
          isAvailable: () => true,
          completeJson: async (request: any) => {
            kimiQaRequests.push(request);
            const payload = JSON.parse(request.messages[1].content);
            return { ok: true, data: { text: `Kimi QA:\n${payload.deterministicText}\nFinal submit remains manual.` } };
          },
        },
        postThreadMessage: async (payload) => {
          kimiQaHandoffText = String(payload.text ?? "");
          return true;
        },
      },
    );
    assert(kimiQaPost === "posted", "Kimi QA handoff should still post through the normal Slack path.");
    assert(kimiQaHandoffText.startsWith("Kimi QA:"), "QA handoff should use Kimi copy when the provider is available and safe.");
    assert(kimiQaRequests.some((request) => request.messages?.[1]?.content?.includes("\"path\":\"qa_handoff\"")), "Kimi QA handoff request should use the qa_handoff path.");
    assert(kimiQaRequests.some((request) => JSON.stringify(request).includes("Operating constitution from soul.md")), "Kimi QA handoff request should include soul.md context.");
    assert(kimiQaHandoffText.includes("*Proof files:*"), "Kimi QA handoff must preserve proof file status wording.");
    assert(kimiQaHandoffText.includes("*Portfolio highlights:*"), "Kimi QA handoff must preserve portfolio status wording.");
    assert(kimiQaHandoffText.includes("• *Final submit:* untouched — nothing submitted"), "Kimi QA handoff must preserve final-submit untouched.");

    let globalBlockerText = "";
    const globalBlockerPost = await postPrepareDraftStatus(
      {
        thread: null,
        heading: "⚠️ Browser session paused before application preparation.",
        diagnostics: blockedPrepDiagnostics,
      },
      {
        postWebhookMessage: async (payload) => {
          globalBlockerText = String(payload.text ?? "");
          return true;
        },
      },
    );
    assert(globalBlockerPost === "posted", "Global blocker without job thread may post as a standalone alert");
    assert(globalBlockerText.includes("⚠️ *Needs QA in Upwork*"), "Standalone global blocker should stay concise");

    const connectsMissingDiagnostics = {
      ...blockedPrepDiagnostics,
      actionId: 709,
      jobId: "manual:upwork-connects-hidden",
      state: "connects_not_verified",
      validationIssues: [
        {
          severity: "warning",
          code: "required_connects_unverified_on_apply_page",
          message: "Required Connects were not visible on the apply page yet; leave boost unset and verify Connects during QA.",
        },
      ],
      missingLocalAssets: [],
      warnings: ["[warning] required_connects_unverified_on_apply_page: Required Connects were not visible on the apply page yet."],
      requiredConnects: null,
      boostConnects: 0,
      totalConnects: null,
      connectsDecision: "manual_review",
      connectsConfidence: "unknown",
      attemptedFields: ["coverLetter", "rate", "attachments", "highlights"],
      skippedFields: [],
      manualFields: ["finalSubmit"],
      fieldVerification: [
        { field: "targetTab", status: "verified", detail: "Apply tab matches target job URL." },
        { field: "coverLetter", status: "verified", detail: "Cover letter field contains the intended text." },
        { field: "screeningAnswers", status: "verified", detail: "2/2 screening answers are present." },
        { field: "rate", status: "verified", detail: "Rate field contains $72/hr." },
        { field: "requiredConnects", status: "attempted_unverified", detail: "Required Connects are still unknown." },
        { field: "boostConnects", status: "skipped_by_strategy", detail: "No boost set." },
        { field: "attachments", status: "attempted_unverified", detail: "File upload was attempted but not verified." },
        { field: "profileHighlights", status: "attempted_unverified", detail: "Portfolio selector entry is visible, but selected proof is not verified yet." },
        { field: "finalSubmit", status: "skipped_by_strategy", detail: "Final submit/send button was intentionally not clicked." },
      ],
      verifiedFields: ["targetTab", "coverLetter", "screeningAnswers", "rate"],
      unverifiedFields: ["requiredConnects", "attachments", "profileHighlights"],
      unavailableFields: [],
      missingFileFields: [],
      blockedByUiFields: [],
      skippedByStrategyFields: ["boostConnects", "finalSubmit"],
    };
    let connectsCopyText = "";
    const connectsCopyPost = await postPrepareDraftStatus(
      {
        thread: { channelId: "C123", messageTs: "999.333", threadTs: "999.333" },
        heading: "⚠️ Draft preparation paused.",
        diagnostics: connectsMissingDiagnostics,
      },
      {
        postThreadMessage: async (payload) => {
          connectsCopyText = String(payload.text ?? "");
          return true;
        },
      },
    );
    assert(connectsCopyPost === "posted", "Connects-not-verified handoff should post into the job thread.");
    assert(connectsCopyText.includes("I couldn’t verify the Connects cost yet"), "Missing required Connects should use connects-not-verified copy.");
    assert(connectsCopyText.includes("Connects:* not verified") || connectsCopyText.includes("Connects:* unknown"), "Connects should be marked not verified, not claimed.");
    assert(connectsCopyText.includes("Boost:* not set yet"), "Unknown Connects should prevent boost.");
    assert(connectsCopyText.includes("Proof files:* planned:"), "Unverified proof file should stay planned.");
    assert(connectsCopyText.includes("Nothing submitted: I did not click the final Upwork submit button."), "Connects-not-verified handoff should say nothing was submitted.");
    assert(connectsCopyText.includes("• *Final submit:* untouched — nothing submitted"), "Connects-not-verified handoff should preserve final-submit safety.");
    assert(connectsCopyText.includes("“open it”"), "Connects-not-verified handoff should offer tab focus.");
    assert(!connectsCopyText.includes("clear the remote Chrome issue"), "Connects-not-verified copy should not tell Steve to clear Chrome.");
    assert(!/field_preparation_incomplete|manual_attention_required|manual browser attention|manual:upwork/i.test(connectsCopyText), "Connects-not-verified copy should hide backend state and raw job ids.");

    const connectsKimiRequests: any[] = [];
    await postPrepareDraftStatus(
      {
        thread: { channelId: "C123", messageTs: "999.444", threadTs: "999.444" },
        heading: "⚠️ Draft preparation paused.",
        diagnostics: connectsMissingDiagnostics,
      },
      {
        copyProvider: {
          isAvailable: () => true,
          completeJson: async (request: any) => {
            connectsKimiRequests.push(request);
            const payload = JSON.parse(request.messages[1].content);
            return { ok: true, data: { text: payload.deterministicText } };
          },
        },
        postThreadMessage: async () => true,
      },
    );
    const connectsKimiPayload = JSON.parse(connectsKimiRequests[0].messages[1].content);
    assert(connectsKimiPayload.context.blockerType === "connects_not_verified", "LLM copywriter should receive structured connects-not-verified facts.");
    assert(connectsKimiPayload.context.connectsVerified === false, "LLM copywriter should receive authoritative Connects verification state.");
    assert(connectsKimiPayload.context.boostVerified === false, "LLM copywriter should receive authoritative boost verification state.");

    const browserChallengeDiagnostics = {
      ...connectsMissingDiagnostics,
      state: "captcha_or_security_challenge",
      requiredConnects: null,
      validationIssues: [],
      fieldVerification: [
        { field: "targetTab", status: "attempted_unverified", detail: "Upwork showed a browser check." },
        { field: "finalSubmit", status: "skipped_by_strategy", detail: "Final submit/send button was intentionally not clicked." },
      ],
      verifiedFields: [],
      unverifiedFields: ["targetTab"],
      skippedByStrategyFields: ["finalSubmit"],
    };
    let browserChallengeText = "";
    await postPrepareDraftStatus(
      {
        thread: { channelId: "C123", messageTs: "999.555", threadTs: "999.555" },
        heading: "⚠️ Draft preparation paused.",
        diagnostics: browserChallengeDiagnostics,
      },
      {
        postThreadMessage: async (payload) => {
          browserChallengeText = String(payload.text ?? "");
          return true;
        },
      },
    );
    assert(browserChallengeText.includes("Upwork is asking for a browser check"), "Actual security challenges should keep browser-check copy.");
    assert(browserChallengeText.includes("clear it in remote Chrome"), "Actual security challenges should ask Steve to clear Chrome.");
    assert(!/captcha_or_security_challenge|manual_attention_required|manual:upwork/i.test(browserChallengeText), "Browser-check copy should hide raw challenge state.");
    let duplicateBrowserChallengePosts = 0;
    const duplicateBrowserChallengePost = await postPrepareDraftStatus(
      {
        thread: { channelId: "C123", messageTs: "999.555", threadTs: "999.555" },
        heading: "⚠️ Draft preparation paused.",
        diagnostics: browserChallengeDiagnostics,
      },
      {
        postThreadMessage: async () => {
          duplicateBrowserChallengePosts += 1;
          return true;
        },
      },
    );
    assert(duplicateBrowserChallengePost === "skipped", "Repeated browser-check QA handoff should be suppressed for the same incident.");
    assert(duplicateBrowserChallengePosts === 0, "Suppressed browser-check QA handoff must not post another Slack message.");

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
    assert(!designPlanResult.plan.attachments.some((item: { filePath: string }) => item.filePath === "profile/attachments/design-case-studies-steve-logarn.pdf"), "Design job should not attach the same proof file when the Upwork portfolio item is selected");
    assert(designPlanResult.plan.portfolioHighlights.some((line: string) => line.includes("Design Case Studies")), "Design job should select design case studies through Upwork portfolio");
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

    const autonomousBeautyJob = {
      ...beautyJob,
      id: "beauty-job-autonomous-v1",
      applicationDraft: {
        ...beautyJob.applicationDraft,
        jobId: "beauty-job-autonomous-v1",
        jobIntelligence: klaviyoIntel(),
      },
    };
    const autonomousAutoPrepare = autoQueuePrepareDraft(
      autonomousBeautyJob,
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
      null,
    );
    assert(typeof autonomousAutoPrepare.actionId === "number", "Qualified discovery capture should auto-queue prepare action without Slack thread context");
    const autonomousAction = getBrowserActionById(autonomousAutoPrepare.actionId!);
    assert(autonomousAction?.actionType === "prepare_application_review", "Autonomous auto-prep should queue prepare_application_review");
    assert(autonomousAction?.payload.autoPrepareSource === "autonomous_discovery_capture", "Autonomous auto-prep action should record its source");
    assert(!autonomousAction?.payload.channelId, "Autonomous auto-prep should not require Slack thread context");

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

    const unknownConnectsAutoDecision = decideAutoPrepareDraft(
      {
        ...beautyJob,
        connectsCost: 0,
        connects: {
          requiredConnects: null,
          boostConnects: null,
          totalConnects: null,
          confidence: "unknown",
          sourceText: null,
          sourceLocation: null,
          extractionMethod: "not_found",
        },
        applicationDraft: {
          ...beautyJob.applicationDraft,
          suggestedConnects: 0,
          suggestedBoostConnects: 0,
          connectsStrategy: {
            ...beautyJob.applicationDraft.connectsStrategy,
            decision: "skip",
            requiredConnects: null,
            suggestedBoostConnects: 0,
            totalConnects: null,
            expectedValueScore: 21,
            sourceBackedConnects: {
              requiredConnects: null,
              boostConnects: null,
              totalConnects: null,
              confidence: "unknown",
              sourceText: null,
              sourceLocation: null,
              extractionMethod: "not_found",
            },
            risks: [
              "Required Connects are unknown from visible source text.",
              "Expected value is too weak to spend Connects without a source-backed required cost.",
            ],
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
    assert(unknownConnectsAutoDecision.shouldQueue, "Unknown Connects alone must route to apply-page verification instead of skipping auto-prep");
    assert(unknownConnectsAutoDecision.category === "eligible_auto_prepare", "Unknown Connects should still be eligible for prep-only verification");

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
    const ineligibleQueued = autoQueuePrepareDraft(
      {
        ...beautyJob,
        id: "beauty-job-ineligible-v1",
        applicationDraft: {
          ...beautyJob.applicationDraft,
          jobId: "beauty-job-ineligible-v1",
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
      null,
    );
    assert(!ineligibleQueued.actionId, "Ineligible discovery lead should not queue prepare action");

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
    const manualReviewQueued = autoQueuePrepareDraft(
      {
        ...beautyJob,
        id: "beauty-job-manual-review-v1",
        title: "DTC retention strategist (platform not specified)",
        description: "Need ecommerce lifecycle retention support across email and SMS.",
        applicationDraft: {
          ...beautyJob.applicationDraft,
          jobId: "beauty-job-manual-review-v1",
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
      null,
    );
    assert(!manualReviewQueued.actionId, "Manual-review discovery lead should not queue prepare action in v1");
    assert(!listBrowserActions(null, 500).some((action) => action.jobId === "beauty-job-manual-review-v1" && action.actionType === "prepare_application_review"), "Manual-review lead should not create a prepare action");

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
    const redFlagQueued = autoQueuePrepareDraft(
      {
        ...beautyJob,
        id: "beauty-job-red-flag-v1",
        applicationDraft: { ...beautyJob.applicationDraft, jobId: "beauty-job-red-flag-v1", redFlags: ["Needs account verification before work can start"] },
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
      null,
    );
    assert(!redFlagQueued.actionId, "Hard-red-flag discovery lead should not queue prepare action");

    const duplicateReply = buildPrepareDraftQueueReply({
      jobId: beautyJob.id,
      threadTitle: beautyJob.title,
      upworkUrl: beautyJob.url,
      actionId: 99,
      duplicate: true,
      duplicateStatus: "paused",
    });
    assert(duplicateReply.includes("Already on it"), "Duplicate prepare reply should stay concise");
    assert(!duplicateReply.toLowerCase().includes("browser action"), "Duplicate prepare reply should not expose action ids by default");

    const launchCommand = buildBrowserSessionLaunchCommand({
      chromeExecutablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir: "./data/browser-profile",
      cdpUrl: "http://127.0.0.1:9222",
      startUrl: "https://www.upwork.com",
    });
    assert(launchCommand.args.some((arg: string) => arg.includes("--remote-debugging-port=9222")), "Browser session command should enable remote debugging");
    assert(launchCommand.args.includes("--remote-debugging-address=127.0.0.1"), "Browser session command should keep CDP local-only");

    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/mock", Browser: "Chrome/136" }),
    } as Response);

    const cdpContext = { newPage: async () => ({}) };
    let connectOverCdpCalled = false;
    let connectOverCdpArgCount = 0;
    let newContextCalled = false;
    let cdpDisconnectCalled = false;
    let cdpCloseCalled = false;
    const cdpSession = await acquireBrowserSession(
      {
        connectOverCDP: async (...args: unknown[]) => {
          connectOverCdpCalled = true;
          connectOverCdpArgCount = args.length;
          return {
            contexts: () => [cdpContext],
            newContext: async () => { newContextCalled = true; throw new Error("new context should not be used in cdp mode"); },
            disconnect: async () => { cdpDisconnectCalled = true; },
            close: async () => { cdpCloseCalled = true; },
          };
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
    await cdpSession.close();
    assert(cdpDisconnectCalled, "CDP close should disconnect Playwright from the visible browser");
    assert(!cdpCloseCalled, "CDP close must not close the visible browser or prepared application tabs");

    let cdpWithoutDisconnectCloseCalled = false;
    const cdpWithoutDisconnectSession = await acquireBrowserSession(
      {
        connectOverCDP: async () => ({
          contexts: () => [cdpContext],
          close: async () => { cdpWithoutDisconnectCloseCalled = true; },
        }),
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
    await cdpWithoutDisconnectSession.close();
    assert(cdpWithoutDisconnectCloseCalled, "CDP close should close the Playwright CDP connection when disconnect is unavailable");

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

    const feedPage = {
      url: () => "https://www.upwork.com/nx/find-work/best-matches/",
    };
    const activeWorkPage = {
      url: () => "https://www.upwork.com/jobs/~022054111111111111111",
    };
    let openedExtraTab = false;
    const reusedWorkTab = await selectPageForBrowserAction(
      {
        pages: () => [feedPage, activeWorkPage],
        newPage: async () => {
          openedExtraTab = true;
          return { url: () => "about:blank" };
        },
      },
      "https://www.upwork.com/jobs/~022054222222222222222",
    );
    assert(reusedWorkTab.page === activeWorkPage, "CDP page selection should reuse the active work tab instead of opening endless job tabs");
    assert(openedExtraTab === false, "CDP page selection should not open another job tab when a work tab exists");
    assert(/single active work tab/.test(reusedWorkTab.reason), "CDP page selection should explain active work-tab reuse");

    const protectedApplyPage = {
      url: () => "https://www.upwork.com/ab/proposals/job/~022054333333333333333/apply/",
    };
    const protectedOpenedNewTab = { value: false };
    const protectedSelection = await selectPageForBrowserAction(
      {
        pages: () => [feedPage, protectedApplyPage],
        newPage: async () => {
          protectedOpenedNewTab.value = true;
          return { url: () => "about:blank" };
        },
      },
      "https://www.upwork.com/jobs/~022054444444444444444",
      { protectedApplyUrls: ["https://www.upwork.com/ab/proposals/job/~022054333333333333333/apply/"] },
    );
    assert(protectedOpenedNewTab.value, "A prepared-for-QA apply tab must not be reused for another job");
    assert(protectedSelection.page !== protectedApplyPage, "Protected apply page should remain available for QA");
    assert(/protected/.test(protectedSelection.reason), "Protected-tab selection should explain why a new page was opened");

    const sameProtectedSelection = await selectPageForBrowserAction(
      {
        pages: () => [feedPage, protectedApplyPage],
        newPage: async () => {
          throw new Error("same protected target should reuse the matching apply page");
        },
      },
      "https://www.upwork.com/jobs/~022054333333333333333",
      { protectedApplyUrls: ["https://www.upwork.com/ab/proposals/job/~022054333333333333333/apply/"] },
    );
    assert(sameProtectedSelection.page === protectedApplyPage, "The original protected job should still reuse its own apply page for re-checks");

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

    const openApplyOnJobDetailDetection = detectStateWithDiagnostics(
      {
        url: "https://www.upwork.com/jobs/Beauty-Klaviyo-Retention_~beautye2e123456",
        title: "Klaviyo retention strategist for beauty skincare brand",
        textExcerpt: "This is the job detail page, not the proposal apply page.",
      },
      { id: 7, jobId: beautyJob.id, actionType: "open_apply_page", payload: { url: "https://www.upwork.com/ab/proposals/job/~beautye2e123456/apply/" } },
    );
    assert(openApplyOnJobDetailDetection.state === "job_page_loaded", "open_apply_page must not report apply_page_loaded while still on the job detail URL");
    assert(openApplyOnJobDetailDetection.source === "url", "open_apply_page job-detail fallback should be URL-evidence based, not action-type based");

    const openApplyOnApplyUrlDetection = detectStateWithDiagnostics(
      {
        url: "https://www.upwork.com/ab/proposals/job/~beautye2e123456/apply/",
        title: "Submit a Proposal - Upwork",
        textExcerpt: "Cover letter Hourly rate Required for proposal: 8 Connects",
      },
      { id: 8, jobId: beautyJob.id, actionType: "open_apply_page", payload: { url: "https://www.upwork.com/ab/proposals/job/~beautye2e123456/apply/" } },
    );
    assert(openApplyOnApplyUrlDetection.state === "apply_page_loaded", "open_apply_page should report apply_page_loaded when the actual apply URL is visible");
    assert(openApplyOnApplyUrlDetection.source === "url", "Apply page detection must be based on visible URL evidence");
    assert(
      getActionUrl({ id: 9, jobId: "manual:upwork-022066462765976847859", actionType: "open_apply_page", payload: { url: "https://www.upwork.com/ab/proposals/job/~022066462765976847859/apply/" } }) === "https://www.upwork.com/ab/proposals/job/~022066462765976847859/apply/",
      "open_apply_page must preserve the payload apply URL instead of canonicalizing it back to the job detail URL",
    );

    const challengeWordInJobDetection = detectStateWithDiagnostics(
      {
        url: "https://www.upwork.com/jobs/Beauty-Klaviyo-Retention_~beautye2e123456",
        title: "Upwork",
        textExcerpt: "The challenge is improving repeat purchase and lifecycle email performance for a Shopify beauty brand.",
      },
      settlingAction,
    );
    assert(challengeWordInJobDetection.state === "captured", "A normal job description using the word challenge should not be classified as a security challenge");

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
    rmSync(proofRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runTests().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`browser apply profile tests failed: ${message}`);
    process.exitCode = 1;
  });
}
