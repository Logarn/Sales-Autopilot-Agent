import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface TestCase {
  name: string;
  got: unknown;
  want: unknown;
}

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
  const sessionPath = resolve(dirname(path), "browser-session.json");
  if (existsSync(sessionPath)) {
    try {
      unlinkSync(sessionPath);
    } catch {
      // ignore cleanup failures
    }
  }
  const dir = dirname(path);
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

async function runTests(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-slack-socket/jobs.db");
  const proofRoot = resolve(process.cwd(), "data/.tmp-slack-socket/proof-assets");
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;
  process.env.PROOF_ASSET_ROOT = proofRoot;
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";

  const { applySlackThreadRevision, buildDraftPreviewFromSlackThread, buildSlackSocketStartupError, handleSlackSocketTextEvent, handleThreadCommand, parseSlackThreadCommand, parseUpworkJobUrlFromText, queueCaptureFromSlackUrl, queuePrepareDraftFromSlackThread } = require("./slackSocket") as {
    applySlackThreadRevision: (input: { channelId: string; threadTs: string; instruction: string }) => { ok: boolean; text: string; proposalVersion?: number };
    buildDraftPreviewFromSlackThread: (input: { channelId: string; threadTs: string }) => { ok: boolean; text: string };
    buildSlackSocketStartupError: (input: { socketEnabled: boolean; botToken: string; appToken: string }) => string | null;
    handleSlackSocketTextEvent: (event: { channel: string; ts: string; text?: string; thread_ts?: string; bot_id?: string; subtype?: string; files?: any[] }, client: any) => Promise<void>;
    handleThreadCommand: (input: { channelId: string; threadTs: string; text: string; client: any; intentProvider?: any }) => Promise<void>;
    parseSlackThreadCommand: (value: string) => {
      type: string;
      rawText: string;
      instruction?: string;
      actionId?: number;
      outcomeStatus?: string;
    };
    parseUpworkJobUrlFromText: (value: string) => { originalUrl: string; normalizedUrl: string; canonicalJobUrl: string; jobId: string } | null;
    queueCaptureFromSlackUrl: (input: { channelId: string; messageTs: string; threadTs: string; text: string }) => { parsed: any; state: any; action: any } | null;
    queuePrepareDraftFromSlackThread: (input: { channelId: string; threadTs: string }) => { ok: boolean; text: string; actionId?: number };
  };
  const { closeDb, getApplicationDraft, getApplicationStatus, getBrowserActionById, getSlackThreadStateByThreadTs, listApplicationAssets, markJobSeen, upsertSlackThreadState, listBrowserActions, updateBrowserActionStatus } = require("./db") as {
    closeDb: () => void;
    getApplicationDraft: (jobId: string) => { proposalText: string } | null;
    getApplicationStatus: (jobId: string) => string | null;
    getBrowserActionById: (id: number) => { payload: Record<string, unknown>; status: string } | null;
    getSlackThreadStateByThreadTs: (channelId: string, threadTs: string) => { status: string } | null;
    listApplicationAssets: (jobId: string) => Array<{ originalName: string; relativePath: string | null; source: string }>;
    markJobSeen: (job: any, notified: boolean) => void;
    upsertSlackThreadState: (input: any) => unknown;
    listBrowserActions: (status?: string | null, limit?: number) => Array<{ id: number; actionType: string; jobId: string; status: string }>;
    updateBrowserActionStatus: (id: number, status: string, lastError?: string) => boolean;
  };
  const { recordBrowserManualAttention } = require("./browserSession") as {
    recordBrowserManualAttention: (input: { reason: string; actionId?: number; jobId?: string; url?: string | null; title?: string | null }) => Promise<unknown>;
  };
  const { buildApplicationDraft } = require("./agent") as { buildApplicationDraft: (job: any) => any };
  const { buildBrowserApplyPlan } = require("./browserApply") as { buildBrowserApplyPlan: (jobId: string) => { plan: any } };
  const { scoreJob } = require("./filter") as { scoreJob: (job: any) => any };
  const fakeIntentProvider = (decision: Record<string, unknown>) => ({
    isAvailable: () => true,
    completeJson: async () => ({ ok: true, data: decision }),
  });

  try {
    const urlTests: TestCase[] = [
      {
        name: "parse job url from full jobs path",
        got: parseUpworkJobUrlFromText("Check this: https://www.upwork.com/jobs/~0123456789abcdef and apply"),
        want: {
          originalUrl: "https://www.upwork.com/jobs/~0123456789abcdef",
          normalizedUrl: "https://www.upwork.com/jobs/~0123456789abcdef",
          canonicalJobUrl: "https://www.upwork.com/jobs/~0123456789abcdef",
          jobId: "0123456789abcdef",
        },
      },
      {
        name: "parse job url from proposals/apply path",
        got: parseUpworkJobUrlFromText("Review this apply page: https://www.upwork.com/ab/proposals/job/~0123456789abcdef/apply/"),
        want: {
          originalUrl: "https://www.upwork.com/ab/proposals/job/~0123456789abcdef/apply/",
          normalizedUrl: "https://www.upwork.com/jobs/~0123456789abcdef",
          canonicalJobUrl: "https://www.upwork.com/jobs/~0123456789abcdef",
          jobId: "0123456789abcdef",
        },
      },
      {
        name: "parse job url from best matches details path",
        got: parseUpworkJobUrlFromText("Open https://www.upwork.com/nx/find-work/best-matches/details/~022053866890130225260?pageTitle=Job%20Details"),
        want: {
          originalUrl: "https://www.upwork.com/nx/find-work/best-matches/details/~022053866890130225260?pageTitle=Job%20Details",
          normalizedUrl: "https://www.upwork.com/jobs/~022053866890130225260",
          canonicalJobUrl: "https://www.upwork.com/jobs/~022053866890130225260",
          jobId: "022053866890130225260",
        },
      },
      {
        name: "parse job url from slug jobs path",
        got: parseUpworkJobUrlFromText("Check https://www.upwork.com/jobs/Some-Title_~022053866890130225260/ now"),
        want: {
          originalUrl: "https://www.upwork.com/jobs/Some-Title_~022053866890130225260/",
          normalizedUrl: "https://www.upwork.com/jobs/~022053866890130225260",
          canonicalJobUrl: "https://www.upwork.com/jobs/~022053866890130225260",
          jobId: "022053866890130225260",
        },
      },
      {
        name: "ignore non-upwork urls",
        got: parseUpworkJobUrlFromText("See https://example.com/jobs/~0123456789abcdef for reference."),
        want: null,
      },
      {
        name: "ignore upwork path without id",
        got: parseUpworkJobUrlFromText("Read https://www.upwork.com/jobs/"),
        want: null,
      },
    ];

    for (const t of urlTests) {
      const pass = JSON.stringify(t.got) === JSON.stringify(t.want);
      assert(pass, `${t.name}: expected ${JSON.stringify(t.want)}, got ${JSON.stringify(t.got)}`);
    }

    const commandTests: Array<{ name: string; input: string; expectType: string; instruction?: string; actionId?: number; outcomeStatus?: string }> = [
      { name: "status", input: "status", expectType: "status" },
      { name: "approve", input: "approve", expectType: "approve" },
      { name: "reject", input: "reject", expectType: "reject" },
      { name: "natural skip", input: "Skip this one.", expectType: "reject" },
      { name: "natural why picked", input: "Why did you pick this job?", expectType: "status" },
      { name: "natural red flags", input: "What are the red flags?", expectType: "status" },
      { name: "natural manual review status", input: "What still needs manual review?", expectType: "status" },
      { name: "revise with instruction", input: "revise: tighten tone", expectType: "revise", instruction: "tighten tone" },
      { name: "natural revise", input: "Make the opener sharper.", expectType: "revise", instruction: "the opener sharper." },
      { name: "natural proof swap", input: "Use the Truly Beauty proof instead.", expectType: "revise", instruction: "the Truly Beauty proof instead." },
      { name: "prepare draft", input: "prepare draft", expectType: "prepare_draft" },
      { name: "prepare proposal punctuation", input: "prepare proposal.", expectType: "prepare_draft" },
      { name: "draft preview first", input: "go ahead and prepare this - show me the draft here first", expectType: "draft_preview" },
      { name: "draft cv preview first", input: "show me the draft CV here first", expectType: "draft_preview" },
      { name: "natural proceed", input: "Please proceed with the draft", expectType: "approve_prepare" },
      { name: "natural go ahead", input: "go ahead", expectType: "approve_prepare" },
      { name: "natural prep it", input: "prep it", expectType: "approve_prepare" },
      { name: "natural looks good proceed", input: "looks good, proceed", expectType: "approve_prepare" },
      { name: "natural use this", input: "use this", expectType: "approve_prepare" },
      { name: "natural put it in Upwork", input: "put it in Upwork", expectType: "approve_prepare" },
      { name: "natural apply", input: "apply", expectType: "approve_prepare" },
      { name: "prep issue cover letter empty", input: "I do not see the cover letter filled in.", expectType: "prep_issue_report" },
      { name: "prep issue empty", input: "it’s empty", expectType: "prep_issue_report" },
      { name: "prep issue not attached", input: "The file is not attached.", expectType: "prep_issue_report" },
      { name: "live phrasing", input: "yeah, prep drafts and send link to listing", expectType: "approve_prepare" },
      { name: "bot mention raises prep confidence", input: "yeah, prep drafts and send link to listing <@UAGENT>", expectType: "approve_prepare" },
      { name: "retry action", input: "retry 123", expectType: "retry_action", actionId: 123 },
      { name: "natural retry preparation", input: "Retry preparation.", expectType: "retry_action" },
      { name: "mark submitted", input: "mark submitted", expectType: "mark_submitted" },
      { name: "got reply outcome", input: "got reply", expectType: "record_outcome", outcomeStatus: "replied" },
      { name: "client replied outcome", input: "client replied", expectType: "record_outcome", outcomeStatus: "replied" },
      { name: "interview booked outcome", input: "interview booked", expectType: "record_outcome", outcomeStatus: "interview" },
      { name: "hired outcome", input: "hired", expectType: "record_outcome", outcomeStatus: "hired" },
      { name: "lost outcome", input: "lost", expectType: "record_outcome", outcomeStatus: "lost" },
      { name: "unknown", input: "something else", expectType: "unknown" },
    ];

    for (const t of commandTests) {
      const parsed = parseSlackThreadCommand(t.input);
      assert(parsed.type === t.expectType, `${t.name}: expected type=${t.expectType}, got=${parsed.type}`);
      if (t.expectType === "revise") {
        assert(parsed.instruction === t.instruction, `${t.name}: expected instruction=${t.instruction}, got=${parsed.instruction}`);
      }
      if (t.expectType === "retry_action") {
        assert(parsed.actionId === t.actionId, `${t.name}: expected actionId=${t.actionId}, got=${parsed.actionId}`);
      }
      if (t.expectType === "record_outcome") {
        assert(parsed.outcomeStatus === t.outcomeStatus, `${t.name}: expected outcomeStatus=${t.outcomeStatus}, got=${parsed.outcomeStatus}`);
      }
    }

    const captureQueued = queueCaptureFromSlackUrl({
      channelId: "C456",
      messageTs: "333.444",
      threadTs: "333.444",
      text: "https://www.upwork.com/nx/find-work/best-matches/details/~022053866890130225260?pageTitle=Job%20Details",
    });
    assert(Boolean(captureQueued), "Supported Slack URL should queue browser capture");
    assert(captureQueued?.state.upworkUrl === "https://www.upwork.com/jobs/~022053866890130225260", "Slack intake should store canonical job URL in thread state");
    const queuedCaptureAction = captureQueued ? getBrowserActionById(captureQueued.action.id) : null;
    assert(queuedCaptureAction?.payload.originalUrl === "https://www.upwork.com/nx/find-work/best-matches/details/~022053866890130225260?pageTitle=Job%20Details", "Slack intake should keep original URL in action payload");
    assert(queuedCaptureAction?.payload.canonicalJobUrl === "https://www.upwork.com/jobs/~022053866890130225260", "Slack intake should keep canonical URL in action payload");
    assert(queuedCaptureAction?.payload.url === "https://www.upwork.com/jobs/~022053866890130225260", "Browser capture action should use canonical URL");

    const unmentionedUrlReplies: string[] = [];
    const actionCountBeforeUnmentionedUrl = listBrowserActions(null, 1000).length;
    await handleSlackSocketTextEvent({
      channel: "C456",
      ts: "333.555",
      text: "https://www.upwork.com/jobs/~033053866890130225260",
    }, {
      chat: {
        postMessage: async (payload: { text: string }) => {
          unmentionedUrlReplies.push(payload.text);
        },
      },
    });
    assert(listBrowserActions(null, 1000).length === actionCountBeforeUnmentionedUrl, "Unmentioned URL outside a tracked thread should be ignored.");
    assert(unmentionedUrlReplies.length === 0, "Unmentioned URL outside a tracked thread should not get a Slack reply.");

    const mentionedUrlReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "C456",
      ts: "333.666",
      text: "<@UAGENT> prep this https://www.upwork.com/jobs/~033053866890130225260",
    }, {
      chat: {
        postMessage: async (payload: { text: string }) => {
          mentionedUrlReplies.push(payload.text);
        },
      },
    });
    assert(mentionedUrlReplies.some((reply) => reply.includes("Got the Upwork link")), "Mentioned URL should be captured and acknowledged.");
    assert(listBrowserActions(null, 1000).some((action) => action.jobId.includes("033053866890130225260") && action.actionType === "capture_job_from_url"), "Mentioned URL should queue capture.");

    const trackedThreadUrlReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "C456",
      ts: "333.777",
      thread_ts: "333.444",
      text: "related listing https://www.upwork.com/jobs/~044053866890130225260",
    }, {
      chat: {
        postMessage: async (payload: { text: string }) => {
          trackedThreadUrlReplies.push(payload.text);
        },
      },
    });
    assert(trackedThreadUrlReplies.some((reply) => reply.includes("Got the Upwork link")), "URL inside an existing tracked thread should be captured without a fresh mention.");
    assert(listBrowserActions(null, 1000).some((action) => action.jobId.includes("044053866890130225260") && action.actionType === "capture_job_from_url"), "Tracked-thread URL should queue capture.");

    const prepareJob = scoreJob({
      id: "prepare-job-1",
      title: "Klaviyo retention strategist for beauty skincare brand",
      url: "https://www.upwork.com/jobs/~preparejob123456",
      description: "Shopify beauty brand needs Klaviyo, quiz segmentation, zero-party data, flows, campaigns, and SMS retention support.",
      postedAt: new Date().toISOString(),
      budget: "$50-$75/hr",
      clientCountry: "United States",
      clientRating: 4.9,
      clientSpend: 100000,
      clientHireRate: 80,
      clientTotalHires: 20,
      clientFeedbackCount: 12,
      category: "Digital Marketing",
      experienceLevel: "Expert",
      connectsCost: 4,
      skills: ["Klaviyo", "Shopify", "Retention Marketing"],
      sourceQuery: "manual",
    });
    prepareJob.applicationDraft = buildApplicationDraft(prepareJob);
    markJobSeen(prepareJob, false);
    upsertSlackThreadState({
      channelId: "C123",
      messageTs: "111.222",
      threadTs: "111.222",
      upworkUrl: prepareJob.url,
      jobId: prepareJob.id,
      status: "packet_sent",
    });

    const fileQuestionReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "Can you upload the files from here? If you had access?",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            fileQuestionReplies.push(payload.text);
          },
        },
      },
    });
    assert(fileQuestionReplies.some((reply) => reply.includes("Attach the PDFs/images in this thread")), "File capability question should get a direct useful answer.");
    assert(!fileQuestionReplies.join("\n").includes("Want me to prep it"), "File capability answer must not fall back to the old command menu.");

    const fileIntakeReplies: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = (async () => new Response(Buffer.from("%PDF-1.4\n"), { status: 200 })) as typeof fetch;
    try {
      await handleSlackSocketTextEvent({
        channel: "C123",
        ts: "111.224",
        thread_ts: "111.222",
        files: [{
          id: "F-DESIGN",
          name: "design-case-studies-steve-logarn.pdf",
          mimetype: "application/pdf",
          size: 12,
          url_private_download: "https://files.slack.com/files-pri/T/F-DESIGN",
        }, {
          id: "F-TRULY",
          name: "truly-beauty-case-study.pdf",
          mimetype: "application/pdf",
          size: 12,
          url_private_download: "https://files.slack.com/files-pri/T/F-TRULY",
        }],
      }, {
        chat: {
          postMessage: async (payload: { text: string }) => {
            fileIntakeReplies.push(payload.text);
          },
        },
      });
    } finally {
      global.fetch = originalFetch;
    }
    assert(fileIntakeReplies.some((reply) => reply.includes("Got 2 files") && reply.includes("design-case-studies-steve-logarn.pdf") && reply.includes("truly-beauty-case-study.pdf")), "Slack file upload should be ingested and acknowledged.");
    assert(listApplicationAssets(prepareJob.id).some((asset) => asset.originalName === "design-case-studies-steve-logarn.pdf" && asset.source === "slack"), "Slack file should be registered to the application.");
    const planAfterSlackFiles = buildBrowserApplyPlan(prepareJob.id).plan;
    assert(planAfterSlackFiles.attachments.some((attachment: { filePath: string }) => attachment.filePath.includes("slack-intake") && attachment.filePath.endsWith("truly-beauty-case-study.pdf")), "Matching Slack upload should become the attachable browser-prep file.");
    assert(!planAfterSlackFiles.missingLocalAssets.includes("profile/attachments/truly-beauty-case-study.pdf"), "Matching Slack upload should resolve the missing proof file.");

    const directDraftPreview = buildDraftPreviewFromSlackThread({ channelId: "C123", threadTs: "111.222" });
    assert(directDraftPreview.ok, "Draft preview helper should return the stored proposal without queuing browser work.");
    assert(directDraftPreview.text.includes("I have not filled the Upwork form yet."), "Draft preview must state the Upwork form has not been filled.");
    assert(directDraftPreview.text.includes("Final submit remains manual."), "Draft preview must keep final submit manual.");

    const previewReplies: string[] = [];
    const actionCountBeforePreview = listBrowserActions(null, 1000).length;
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "go ahead and prepare this - show me the draft here first",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            previewReplies.push(payload.text);
          },
        },
      },
    });
    assert(previewReplies.some((reply) => reply.includes("Draft preview for")), "Draft-preview command should post the draft in-thread.");
    assert(previewReplies.some((reply) => reply.includes("I have not filled the Upwork form yet.")), "Draft-preview command must not imply browser fill happened.");
    assert(listBrowserActions(null, 1000).length === actionCountBeforePreview, "Draft-preview command must not queue a browser preparation action.");
    assert(getSlackThreadStateByThreadTs("C123", "111.222")?.status === "draft_preview_sent", "Draft-preview command should mark the thread preview-sent.");

    const previewUseJob = {
      ...prepareJob,
      id: "preview-use-job",
      applicationDraft: {
        ...prepareJob.applicationDraft,
        jobId: "preview-use-job",
      },
    };
    markJobSeen(previewUseJob, false);
    upsertSlackThreadState({
      channelId: "CPREVIEW",
      messageTs: "222.111",
      threadTs: "222.111",
      upworkUrl: previewUseJob.url,
      jobId: previewUseJob.id,
      status: "packet_sent",
    });
    const previewUseReplies: string[] = [];
    const actionCountBeforePreviewUse = listBrowserActions(null, 1000).length;
    await handleThreadCommand({
      channelId: "CPREVIEW",
      threadTs: "222.111",
      text: "show me the draft here first",
      client: { chat: { postMessage: async (payload: { text: string }) => previewUseReplies.push(payload.text) } },
    });
    assert(listBrowserActions(null, 1000).length === actionCountBeforePreviewUse, "Draft preview should not queue browser prep on the separate preview thread.");
    await handleThreadCommand({
      channelId: "CPREVIEW",
      threadTs: "222.111",
      text: "use this",
      client: { chat: { postMessage: async (payload: { text: string }) => previewUseReplies.push(payload.text) } },
    });
    assert(
      listBrowserActions(null, 1000).some((action) => action.jobId === previewUseJob.id && action.actionType === "prepare_application_review"),
      "Use-this after a draft preview should queue Upwork browser preparation.",
    );

    const llmPrepareJob = {
      ...prepareJob,
      id: "prepare-job-llm",
      applicationDraft: {
        ...prepareJob.applicationDraft,
        jobId: "prepare-job-llm",
      },
    };
    markJobSeen(llmPrepareJob, false);
    upsertSlackThreadState({
      channelId: "C123",
      messageTs: "111.333",
      threadTs: "111.333",
      upworkUrl: llmPrepareJob.url,
      jobId: llmPrepareJob.id,
      status: "packet_sent",
    });
    const llmPrepareReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.333",
      text: "yeah, prep drafts and send link to listing <@UAGENT>",
      intentProvider: fakeIntentProvider({
        intent: "approve_prepare",
        confidence: "high",
        replyText: "Got it — I’ll prep this now and come back here when it’s ready for QA.",
      }),
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            llmPrepareReplies.push(payload.text);
          },
        },
      },
    });
    assert(llmPrepareReplies.some((reply) => reply.includes("Got it") && reply.includes("ready for QA")), "LLM approve_prepare should immediately acknowledge in-thread.");
    assert(llmPrepareReplies.some((reply) => reply.includes(llmPrepareJob.url)), "Prepare acknowledgement should include the listing link.");
    assert(!llmPrepareReplies.join("\n").toLowerCase().includes("final submit"), "Prepare acknowledgement must not imply final submit.");
    const llmQueuedActions = listBrowserActions(null, 10).filter((action) => action.actionType === "prepare_application_review" && action.jobId === llmPrepareJob.id);
    assert(llmQueuedActions.length === 1, `LLM approve_prepare should queue exactly one prepare_application_review action, got ${llmQueuedActions.length}`);

    const unmappedReplies: string[] = [];
    await handleThreadCommand({
      channelId: "CNO",
      threadTs: "999.000",
      text: "yeah, prep drafts and send link to listing",
      intentProvider: fakeIntentProvider({ intent: "approve_prepare", confidence: "high" }),
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            unmappedReplies.push(payload.text);
          },
        },
      },
    });
    assert(unmappedReplies.some((reply) => reply.includes("can’t find the job tied to this thread")), "Unmapped approve_prepare should reply with useful mapping guidance.");

    const prepareResult = queuePrepareDraftFromSlackThread({ channelId: "C123", threadTs: "111.222" });
    assert(prepareResult.ok, `Expected prepare draft queue to succeed, got: ${prepareResult.text}`);
    assert(typeof prepareResult.actionId === "number", "Prepare draft should return an action id.");
    assert(prepareResult.text.includes("Got it"), "Prepare draft reply should acknowledge natural approval concisely.");
    assert(prepareResult.text.includes("ready for QA"), "Prepare draft reply should promise a QA update.");
    assert(prepareResult.text.includes("Browser queue:"), "Prepare draft reply should include queue position/status.");
    assert(prepareResult.text.includes("stop before submit"), "Prepare draft reply should keep manual submit boundary.");
    assert(!prepareResult.text.toLowerCase().includes("copy/paste"), "Prepare draft reply must not introduce copy/paste workflow.");
    assert(!prepareResult.text.includes("Auto-attach assets:"), "Prepare draft reply should not dump proof inventory.");
    assert(!prepareResult.text.toLowerCase().includes("action:"), "Prepare draft reply should not expose action ids by default.");

    const duplicatePrepareResult = queuePrepareDraftFromSlackThread({ channelId: "C123", threadTs: "111.222" });
    assert(duplicatePrepareResult.ok, "Duplicate prepare draft should resolve to existing action rather than fail.");
    assert(duplicatePrepareResult.actionId === prepareResult.actionId, "Duplicate prepare draft should return the existing action id.");
    assert(duplicatePrepareResult.text.includes("Already on it"), "Duplicate prepare draft should stay concise.");
    assert(!duplicatePrepareResult.text.toLowerCase().includes("browser action"), "Duplicate prepare draft should not expose action ids by default.");

    updateBrowserActionStatus(prepareResult.actionId!, "paused", "field_preparation_incomplete");
    const qaIssueRecheckReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "I do not see the cover letter filled in.",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            qaIssueRecheckReplies.push(payload.text);
          },
        },
      },
    });
    assert(getBrowserActionById(prepareResult.actionId!)?.status === "pending", "Prep issue report should requeue a paused apply-page action for remote Chrome re-check.");
    assert(qaIssueRecheckReplies.some((reply) => reply.includes("re-check the apply page")), "Prep issue report should acknowledge the remote apply-page re-check.");

    const queuedActions = listBrowserActions(null, 10).filter((action) => action.actionType === "prepare_application_review" && action.jobId === prepareJob.id);
    assert(queuedActions.length === 1, `Expected exactly one queued prepare_application_review action, got ${queuedActions.length}`);

    const multiApprovalReplies: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const job = scoreJob({
        ...prepareJob,
        id: `multi-approval-job-${i}`,
        title: `Multi approval job ${i}`,
        url: `https://www.upwork.com/jobs/~multiapproval${i}`,
      });
      job.applicationDraft = buildApplicationDraft(job);
      markJobSeen(job, false);
      upsertSlackThreadState({
        channelId: "CMULTI",
        messageTs: `500.${i}`,
        threadTs: `500.${i}`,
        upworkUrl: job.url,
        jobId: job.id,
        status: "packet_sent",
      });
      await handleThreadCommand({
        channelId: "CMULTI",
        threadTs: `500.${i}`,
        text: "prep it",
        client: {
          chat: {
            postMessage: async (payload: { text: string }) => {
              multiApprovalReplies.push(payload.text);
            },
          },
        },
      });
    }
    const multiApprovalActions = listBrowserActions(null, 1000)
      .filter((action) => action.actionType === "prepare_application_review" && action.jobId.startsWith("multi-approval-job-"));
    assert(multiApprovalActions.length === 3, "Three approvals in separate Slack threads should queue three prepare_application_review actions.");
    assert(multiApprovalActions.every((action) => action.status === "pending"), "Multiple Slack approvals should queue pending browser work, not run it inline.");
    assert(multiApprovalReplies.filter((reply) => reply.includes("Browser queue:")).length === 3, "Each queued approval should acknowledge queue status.");

    await recordBrowserManualAttention({ reason: "captcha_or_security_challenge", actionId: prepareResult.actionId, jobId: prepareJob.id, url: prepareJob.url, title: "Just a moment..." });
    const blockedReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "please proceed with the draft",
      intentProvider: fakeIntentProvider({ intent: "approve_prepare", confidence: "high" }),
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            blockedReplies.push(payload.text);
          },
        },
      },
    });
    assert(blockedReplies.some((reply) => reply.includes("Quick blocker: Upwork is asking for a human check")), "Blocked prep should explain the browser blocker in-thread.");

    const issueReportReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "I do not see the cover letter filled in.",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            issueReportReplies.push(payload.text);
          },
        },
      },
    });
    assert(issueReportReplies.some((reply) => reply.includes("re-check the apply page") || reply.includes("Quick blocker")), "Prep issue report should trigger a status/recheck response instead of being ignored.");

    const retryReplies: string[] = [];
    updateBrowserActionStatus(prepareResult.actionId!, "failed", "field_preparation_incomplete");
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "Retry preparation.",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            retryReplies.push(payload.text);
          },
        },
      },
    });
    assert(getBrowserActionById(prepareResult.actionId!)?.status === "pending", "Natural retry preparation should route to the latest failed action in the thread.");
    assert(retryReplies.some((reply) => reply.includes(`Retry requested for browser action #${prepareResult.actionId}`)), "Natural retry should reply in the same tracked thread.");

    const statusReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "What are the red flags?",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            statusReplies.push(payload.text);
          },
        },
      },
    });
    assert(statusReplies.some((reply) => reply.includes("Main risk:")), "Natural risk question should resolve against the tracked job context without a raw status dump.");
    assert(!statusReplies.join("\n").includes("Channel message:"), "Natural risk/status replies should not include raw debug state.");

    const debugReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "show debug details",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            debugReplies.push(payload.text);
          },
        },
      },
    });
    assert(debugReplies.some((reply) => reply.includes("Channel message:") && reply.includes("Thread:")), "Explicit debug details should show raw thread state.");

    const revisionResult = applySlackThreadRevision({
      channelId: "C123",
      threadTs: "111.222",
      instruction: "make opener more direct",
    });
    assert(revisionResult.ok, `Expected Slack revise to apply stored draft update, got: ${revisionResult.text}`);
    assert(revisionResult.proposalVersion === 2, `Expected revised proposal version 2, got ${revisionResult.proposalVersion}`);
    assert(revisionResult.text.includes("Browser draft needs update: yes"), "Revision reply should flag that queued browser draft needs updating.");
    const revisedDraft = getApplicationDraft(prepareJob.id);
    assert(Boolean(revisedDraft?.proposalText.includes("highest-leverage retention work")), "Stored draft should be updated with deterministic revision text.");

    const outcomeReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "got reply",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            outcomeReplies.push(payload.text);
          },
        },
      },
    });
    assert(getApplicationStatus(prepareJob.id) === "replied", "Slack got reply command should update application status to replied.");
    assert(outcomeReplies.some((reply) => reply.includes("Outcome recorded") && reply.includes("replied")), "Slack outcome command should acknowledge the recorded reply.");

    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "interview booked",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            outcomeReplies.push(payload.text);
          },
        },
      },
    });
    assert(getApplicationStatus(prepareJob.id) === "interview", "Slack interview booked command should update application status to interview.");

    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "hired",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            outcomeReplies.push(payload.text);
          },
        },
      },
    });
    assert(getApplicationStatus(prepareJob.id) === "hired", "Slack hired command should update application status to hired.");

    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "lost",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            outcomeReplies.push(payload.text);
          },
        },
      },
    });
    assert(getApplicationStatus(prepareJob.id) === "lost", "Slack lost command should update application status to lost.");
    assert(getSlackThreadStateByThreadTs("C123", "111.222")?.status === "outcome_recorded", "Slack outcome command should mark the thread outcome recorded.");

    const envError = buildSlackSocketStartupError({ socketEnabled: false, botToken: "", appToken: "" });
    assert(typeof envError === "string", "Expected an error when socket mode is disabled.");
    assert(!envError!.toLowerCase().includes("xoxb") && !envError!.includes("slack-bot"), "Error output must not include tokens.");

    const missingTokens = buildSlackSocketStartupError({ socketEnabled: true, botToken: "", appToken: "" });
    assert(typeof missingTokens === "string" && missingTokens.includes("SLACK_BOT_TOKEN"), "Expected missing token message to mention SLACK_BOT_TOKEN.");
    assert(!missingTokens!.includes("xoxb") && !missingTokens!.includes("xapp"), "Missing token message should be produced without token contents.");

    console.log("slack socket parser tests passed");
  } finally {
    closeDb();
    cleanupDatabase(tempDb);
    rmSync(proofRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runTests().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`slack socket parser tests failed: ${message}`);
    process.exitCode = 1;
  });
}
