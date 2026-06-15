import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function cleanup(tempDir: string): void {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runTests(): Promise<void> {
  const tempDir = resolve(process.cwd(), "data/.tmp-e2e-dry-run");
  const proofRoot = resolve(tempDir, "proof-assets");
  cleanup(tempDir);
  mkdirSync(tempDir, { recursive: true });
  mkdirSync(proofRoot, { recursive: true });

  process.env.DB_PATH = resolve(tempDir, "jobs.db");
  process.env.BROWSER_WORKER_ENABLED = "true";
  process.env.BROWSER_DRY_RUN = "true";
  process.env.BROWSER_ARTIFACT_DIR = resolve(tempDir, "artifacts");
  process.env.PROOF_ASSET_ROOT = proofRoot;
  process.env.SLACK_BOT_TOKEN = "";
  process.env.SLACK_CHANNEL_WEBHOOK_URL = "";

  const { scoreJob } = require("./filter") as { scoreJob: (job: any) => any };
  const { buildApplicationDraft } = require("./agent") as { buildApplicationDraft: (job: any) => any };
  const { buildV3CapturePacket } = require("./slackPacketV3") as { buildV3CapturePacket: (job: any, context: any) => { text: string } };
  const { buildBrowserApplyPlan } = require("./browserApply") as { buildBrowserApplyPlan: (jobId: string) => { plan: any; valid: boolean; issues: Array<{ code: string; severity: string; message: string }> } };
  const { autoPrepareDraftForThread, decideAutoPrepareDraft, runBrowserWorker } = require("./browserWorker") as {
    autoPrepareDraftForThread: (job: any, thread: { channelId: string; messageTs: string; threadTs: string }, options?: any) => any;
    decideAutoPrepareDraft: (job: any, options?: any) => any;
    runBrowserWorker: (options?: any) => Promise<void>;
  };
  const {
    closeDb,
    enqueueBrowserActionDeduped,
    getApplicationDraft,
    getScoredJobForSlackPreview,
    listBrowserActions,
    markJobSeen,
    upsertSlackThreadState,
  } = require("./db") as {
    closeDb: () => void;
    enqueueBrowserActionDeduped: (input: any) => { id: number; duplicate: boolean };
    getApplicationDraft: (jobId: string) => any;
    getScoredJobForSlackPreview: (jobId: string) => any;
    listBrowserActions: (status?: string | null, limit?: number) => Array<any>;
    markJobSeen: (job: any, notified: boolean) => void;
    upsertSlackThreadState: (input: any) => unknown;
  };

  try {
    const e2eCaptureJobId = "022060000000000123456";
    const e2eCaptureUrl = `https://www.upwork.com/jobs/Beauty-Klaviyo-Retention_~${e2eCaptureJobId}`;
    const queuedCapture = enqueueBrowserActionDeduped({
      jobId: `manual:upwork-${e2eCaptureJobId}`,
      actionType: "capture_job_from_url",
      payload: {
        url: e2eCaptureUrl,
        canonicalJobUrl: `https://www.upwork.com/jobs/~${e2eCaptureJobId}`,
        channelId: "C999",
        messageTs: "111.222",
        threadTs: "111.222",
        source: "slack_url",
      },
    });
    assert(queuedCapture.id > 0, "capture_job_from_url should be queued");

    await runBrowserWorker({
      dryRun: true,
      headless: true,
      userDataDir: resolve(process.cwd(), "data/browser-profile"),
      chromeExecutablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      artifactDir: resolve(tempDir, "artifacts"),
      limit: 5,
      liveActionLimit: 1,
    });

    const beautyJob = scoreJob({
      id: "manual:upwork-beauty-e2e",
      title: "Klaviyo retention strategist for beauty skincare brand",
      url: "https://www.upwork.com/jobs/Beauty-Klaviyo-Retention_~beautye2e123456",
      description: "Shopify beauty brand needs Klaviyo, zero-party data, quiz segmentation, flows, campaigns, SMS retention, and repeat purchase strategy.",
      postedAt: new Date().toISOString(),
      budget: "$60-$90/hr",
      clientCountry: "United States",
      clientRating: 4.9,
      clientSpend: 150000,
      clientHireRate: 88,
      clientTotalHires: 40,
      clientFeedbackCount: 28,
      category: "Digital Marketing",
      experienceLevel: "Expert",
      connectsCost: 4,
      skills: ["Klaviyo", "Shopify", "SMS Marketing", "Retention Marketing", "Email Marketing"],
      sourceQuery: "slack_url",
    });
    beautyJob.applicationDraft = buildApplicationDraft(beautyJob);
    markJobSeen(beautyJob, false);
    upsertSlackThreadState({
      channelId: "C999",
      messageTs: "222.333",
      threadTs: "222.333",
      upworkUrl: beautyJob.url,
      jobId: beautyJob.id,
      status: "packet_sent",
    });

    const storedJob = getScoredJobForSlackPreview(beautyJob.id);
    const storedDraft = getApplicationDraft(beautyJob.id);
    assert(Boolean(storedDraft?.proposalText), "stored/generated draft should exist");

    const decision = decideAutoPrepareDraft(storedJob, {
      enabled: true,
      minScore: 80,
      maxConnects: 30,
      requireBrowserHealthy: true,
      sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
    });
    assert(decision.category === "eligible_auto_prepare", "auto-prepare category should be eligible_auto_prepare");

    const queued = autoPrepareDraftForThread(
      storedJob,
      { channelId: "C999", messageTs: "222.333", threadTs: "222.333" },
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
    );
    assert(typeof queued.actionId === "number", "prepare_application_review should be queued");

    const duplicate = autoPrepareDraftForThread(
      storedJob,
      { channelId: "C999", messageTs: "222.333", threadTs: "222.333" },
      {
        enabled: true,
        minScore: 80,
        maxConnects: 30,
        requireBrowserHealthy: true,
        sessionStatus: { state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 },
      },
    );
    assert(duplicate.category === "duplicate_existing_action", "duplicate prepare action should not be queued twice");

    const packet = buildV3CapturePacket(storedJob, {
      upworkUrl: storedJob.url,
      captureStatus: "packet_sent",
      browserCaptureActionId: queuedCapture.id,
      browserDraftStatus: queued.duplicate ? queued.duplicateStatus ?? "queued" : "queued",
      browserDraftActionId: queued.actionId,
      autoPrepareNote: queued.note,
      requiredConnects: storedJob.applicationDraft?.connectsStrategy?.sourceBackedConnects?.requiredConnects ?? storedJob.applicationDraft?.suggestedConnects,
      suggestedBoostConnects: storedJob.applicationDraft?.suggestedBoostConnects,
      suggestedBid: storedJob.applicationDraft?.suggestedBid ?? "n/a",
      applicationQuestions: ["How would you improve our Klaviyo revenue mix?"],
      questionAnswers: ["I would start with segmentation quality, zero-party data capture, and what is happening between first purchase and second purchase."],
    });

    assert(!packet.text.includes("Truly Beauty"), "default lead alert should not include proof inventory");
    assert(!packet.text.includes("Status: File missing locally - manual upload needed"), "default lead alert should not include proof availability diagnostics");
    assert(!packet.text.toLowerCase().includes("copy/paste"), "packet should not include copy/paste instruction");

    const prepareActionsBeforeWorker = listBrowserActions(null, 20).filter((action) => action.actionType === "prepare_application_review" && action.jobId === storedJob.id);
    assert(prepareActionsBeforeWorker.length === 1, "prepare_application_review should be queued exactly once");

    await runBrowserWorker({
      dryRun: true,
      headless: true,
      userDataDir: resolve(process.cwd(), "data/browser-profile"),
      chromeExecutablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      artifactDir: resolve(tempDir, "artifacts"),
      limit: 5,
      liveActionLimit: 1,
    });

    const planResult = buildBrowserApplyPlan(storedJob.id);
    assert(planResult.valid, "apply plan should stay valid when proof is represented by an Upwork portfolio item instead of a missing file attachment");
    assert(!planResult.issues.some((issue: any) => issue.code === "required_attachment_missing_locally"), "portfolio-backed proof should not create a missing attachment blocker");
    assert(planResult.plan.highlights.some((label: string) => label.includes("Truly Beauty")), "apply plan should preserve the selected Truly Beauty Upwork portfolio highlight");
    assert(planResult.plan.attachments.length === 0, "apply plan should not duplicate a portfolio proof as a file attachment");
    assert(planResult.plan.stopBeforeSubmit === true, "apply plan must include stopBeforeSubmit=true");
    assert(planResult.plan.screeningAnswers.length > 0, "apply plan should persist structured screening answers across the browser queue boundary");
    assert(planResult.plan.connectsStrategy.decision === "safe_apply", "apply plan should preserve the safe Connects strategy after reload");

    const diagnosticsPath = resolve(tempDir, "artifacts", `browser-action-${queued.actionId}-prepare_application_review-apply-diagnostics.json`);
    const diagnostics = JSON.parse(readFileSync(diagnosticsPath, "utf8"));
    assert(diagnostics.final_submit_blocked !== false, "final_submit_blocked should remain true in diagnostics");
    assert(diagnostics.connectsDecision === "safe_apply", "diagnostics should report the persisted safe Connects decision");
    assert(!diagnostics.validationIssues.some((issue: any) => issue.code === "required_attachment_missing_locally"), "diagnostics should not report an attachment blocker for portfolio-backed proof");

    console.log(JSON.stringify({
      captureQueued: queuedCapture,
      storedDraftExists: true,
      autoPrepareDecision: decision,
      queuedPrepareAction: queued,
      duplicatePrepareAction: duplicate,
      packetExcerpt: packet.text.split("\n\n").slice(0, 8),
      applyPlanSummary: {
        coverLetterPresent: Boolean(planResult.plan.coverLetter),
        coverLetterLength: planResult.plan.coverLetter.length,
        screeningAnswerCount: planResult.plan.screeningAnswers.length,
        rate: planResult.plan.rate,
        connects: planResult.plan.connects,
        attachments: planResult.plan.attachments.map((item: any) => item.filePath),
        stopBeforeSubmit: planResult.plan.stopBeforeSubmit,
        finalSubmitBlocked: diagnostics.final_submit_blocked,
      },
    }, null, 2));

    console.log("e2e dry-run smoke tests passed");
  } finally {
    closeDb();
    cleanup(tempDir);
  }
}

if (require.main === module) {
  runTests().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`e2e dry-run smoke tests failed: ${message}`);
    process.exitCode = 1;
  });
}
