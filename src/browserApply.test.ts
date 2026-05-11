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
  const { autoPrepareDraftForThread, decideAutoPrepareDraft } = require("./browserWorker") as {
    autoPrepareDraftForThread: (job: any, thread: { channelId: string; messageTs: string; threadTs: string }, options?: any) => { shouldQueue: boolean; category: string; note: string; actionId?: number; duplicate?: boolean };
    decideAutoPrepareDraft: (job: any, options?: any) => { shouldQueue: boolean; category: string; note: string; reason: string };
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
  const {
    acquireBrowserSession,
    buildBrowserSessionLaunchCommand,
    classifyBrowserSessionError,
  } = require("./browserSessionControl") as {
    acquireBrowserSession: (chromium: any, options: any) => Promise<{ mode: string; context: { newPage: () => Promise<unknown> }; close: () => Promise<void> }>;
    buildBrowserSessionLaunchCommand: (input: { chromeExecutablePath: string; userDataDir: string; cdpUrl: string; startUrl?: string }) => { executablePath: string; args: string[] };
    classifyBrowserSessionError: (error: unknown) => string;
  };

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
    markJobSeen(beautyJob, false);
    upsertSlackThreadState({
      channelId: "C123",
      messageTs: "111.222",
      threadTs: "111.222",
      upworkUrl: beautyJob.url,
      jobId: beautyJob.id,
      status: "packet_sent",
    });

    const beautyPlanResult = buildBrowserApplyPlan(beautyJob.id);
    assert(Boolean(beautyPlanResult.plan), "Beauty job should produce an apply plan");
    assert(beautyPlanResult.valid, `Beauty job plan should be valid, got issues: ${JSON.stringify(beautyPlanResult.issues)}`);
    assert(beautyPlanResult.plan.stopBeforeSubmit === true, "Apply plan must enforce stopBeforeSubmit=true");
    assert(
      beautyPlanResult.plan.attachments.some((item: { filePath: string }) => item.filePath === "profile/attachments/truly-beauty-case-study.pdf"),
      "Beauty job should auto-attach Truly Beauty case study",
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
    const cdpSession = await acquireBrowserSession(
      {
        connectOverCDP: async () => {
          connectOverCdpCalled = true;
          return { contexts: () => [cdpContext], close: async () => undefined };
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
