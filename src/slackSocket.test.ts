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
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;

  const { applySlackThreadRevision, buildSlackSocketStartupError, handleSlackSocketTextEvent, handleThreadCommand, parseSlackThreadCommand, parseUpworkJobUrlFromText, queueCaptureFromSlackUrl, queuePrepareDraftFromSlackThread } = require("./slackSocket") as {
    applySlackThreadRevision: (input: { channelId: string; threadTs: string; instruction: string }) => { ok: boolean; text: string; proposalVersion?: number };
    buildSlackSocketStartupError: (input: { socketEnabled: boolean; botToken: string; appToken: string }) => string | null;
    handleSlackSocketTextEvent: (event: { channel: string; ts: string; text?: string; thread_ts?: string; bot_id?: string; subtype?: string }, client: any) => Promise<void>;
    handleThreadCommand: (input: { channelId: string; threadTs: string; text: string; client: any; intentProvider?: any }) => Promise<void>;
    parseSlackThreadCommand: (value: string) => {
      type: string;
      rawText: string;
      instruction?: string;
      actionId?: number;
      outcomeStatus?: string;
      statusTopic?: string;
    };
    parseUpworkJobUrlFromText: (value: string) => { originalUrl: string; normalizedUrl: string; canonicalJobUrl: string; jobId: string } | null;
    queueCaptureFromSlackUrl: (input: { channelId: string; messageTs: string; threadTs: string; text: string }) => { parsed: any; state: any; action: any } | null;
    queuePrepareDraftFromSlackThread: (input: { channelId: string; threadTs: string }) => { ok: boolean; text: string; actionId?: number };
  };
  const { closeDb, getApplicationDraft, getApplicationStatus, getBrowserActionById, getSlackThreadStateByThreadTs, markJobSeen, mergeBrowserActionPayload, upsertSlackThreadState, listBrowserActions, updateBrowserActionStatus } = require("./db") as {
    closeDb: () => void;
    getApplicationDraft: (jobId: string) => { proposalText: string } | null;
    getApplicationStatus: (jobId: string) => string | null;
    getBrowserActionById: (id: number) => { payload: Record<string, unknown>; status: string } | null;
    getSlackThreadStateByThreadTs: (channelId: string, threadTs: string) => { status: string } | null;
    markJobSeen: (job: any, notified: boolean) => void;
    mergeBrowserActionPayload: (id: number, patch: Record<string, unknown>) => unknown;
    upsertSlackThreadState: (input: any) => unknown;
    listBrowserActions: (status?: string | null, limit?: number) => Array<{ id: number; actionType: string; jobId: string; status: string }>;
    updateBrowserActionStatus: (id: number, status: string, lastError?: string) => boolean;
  };
  const { recordBrowserManualAttention } = require("./browserSession") as {
    recordBrowserManualAttention: (input: { reason: string; actionId?: number; jobId?: string; url?: string | null; title?: string | null }) => Promise<unknown>;
  };
  const { buildApplicationDraft } = require("./agent") as { buildApplicationDraft: (job: any) => any };
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

    const commandTests: Array<{ name: string; input: string; expectType: string; instruction?: string; actionId?: number; outcomeStatus?: string; statusTopic?: string }> = [
      { name: "status", input: "status", expectType: "status", statusTopic: "summary" },
      { name: "approve", input: "approve", expectType: "approve" },
      { name: "reject", input: "reject", expectType: "reject" },
      { name: "natural skip", input: "Skip this one.", expectType: "reject" },
      { name: "natural why picked", input: "Why did you pick this job?", expectType: "status", statusTopic: "why" },
      { name: "natural red flags", input: "What are the red flags?", expectType: "status", statusTopic: "risk" },
      { name: "natural proof question", input: "What proof should we use?", expectType: "status", statusTopic: "proof" },
      { name: "natural why skip", input: "Why skip this one?", expectType: "status", statusTopic: "skip" },
      { name: "natural change question", input: "What would you change?", expectType: "status", statusTopic: "change" },
      { name: "natural manual review status", input: "What still needs manual review?", expectType: "status" },
      { name: "revise with instruction", input: "revise: tighten tone", expectType: "revise", instruction: "tighten tone" },
      { name: "natural revise", input: "Make the opener sharper.", expectType: "revise", instruction: "the opener sharper." },
      { name: "natural proof swap", input: "Use the Truly Beauty proof instead.", expectType: "revise", instruction: "the Truly Beauty proof instead." },
      { name: "prepare draft", input: "prepare draft", expectType: "prepare_draft" },
      { name: "prepare proposal punctuation", input: "prepare proposal.", expectType: "prepare_draft" },
      { name: "natural proceed", input: "Please proceed with the draft", expectType: "approve_prepare" },
      { name: "natural go ahead", input: "go ahead", expectType: "approve_prepare" },
      { name: "natural prep it", input: "prep it", expectType: "approve_prepare" },
      { name: "natural looks good proceed", input: "looks good, proceed", expectType: "approve_prepare" },
      { name: "natural apply", input: "apply", expectType: "approve_prepare" },
      { name: "prep issue cover letter empty", input: "I do not see the cover letter filled in.", expectType: "prep_issue_report" },
      { name: "prep issue generic missing", input: "I don't see it.", expectType: "prep_issue_report" },
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
      if (t.expectType === "status" && t.statusTopic) {
        assert(parsed.statusTopic === t.statusTopic, `${t.name}: expected statusTopic=${t.statusTopic}, got=${parsed.statusTopic}`);
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
    assert(mentionedUrlReplies.some((reply) => reply.includes("Captured Upwork URL for tracking")), "Mentioned URL should be captured and acknowledged.");
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
    assert(trackedThreadUrlReplies.some((reply) => reply.includes("Captured Upwork URL for tracking")), "URL inside an existing tracked thread should be captured without a fresh mention.");
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

    const noQaHoldJob = {
      ...prepareJob,
      id: "no-qa-hold-job",
      applicationDraft: {
        ...prepareJob.applicationDraft,
        jobId: "no-qa-hold-job",
      },
    };
    markJobSeen(noQaHoldJob, false);
    upsertSlackThreadState({
      channelId: "CNOQA",
      messageTs: "222.111",
      threadTs: "222.111",
      upworkUrl: noQaHoldJob.url,
      jobId: noQaHoldJob.id,
      status: "packet_sent",
    });
    const noQaHoldReplies: string[] = [];
    const noQaHoldActionsBefore = listBrowserActions(null, 1000).length;
    await handleThreadCommand({
      channelId: "CNOQA",
      threadTs: "222.111",
      text: "I don't see it.",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            noQaHoldReplies.push(payload.text);
          },
        },
      },
    });
    assert(noQaHoldReplies.some((reply) => reply.includes("protected QA tab/action")), "Generic I don't see it should ask for a protected QA action before rechecking.");
    assert(listBrowserActions(null, 1000).length === noQaHoldActionsBefore, "QA recheck should not queue a browser action when no protected QA action exists.");

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
    mergeBrowserActionPayload(prepareResult.actionId!, {
      qaHold: {
        protected: true,
        jobId: prepareJob.id,
        applyUrl: `${prepareJob.url}/apply`,
        status: "needs_review",
        state: "field_preparation_incomplete",
        reason: "needs_review",
      },
    });
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
    assert(getBrowserActionById(prepareResult.actionId!)?.payload.mode === "qa_recheck", "Prep issue report should switch the browser action into QA recheck mode.");
    assert(getBrowserActionById(prepareResult.actionId!)?.payload.readOnly === true, "Prep issue report should mark the recheck action read-only.");
    assert(qaIssueRecheckReplies.some((reply) => reply.includes("re-check remote Chrome") && reply.includes("read-only inspection")), "Prep issue report should acknowledge the read-only remote apply-page re-check.");

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
    assert(statusReplies.some((reply) => reply.includes("Red flags/risks:")), "Natural status question should resolve against the tracked job context.");

    const proofStatusReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "What proof should we use?",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            proofStatusReplies.push(payload.text);
          },
        },
      },
    });
    assert(proofStatusReplies.some((reply) => reply.includes("*Proof plan:*") && reply.includes("Why it matches:")), "Proof status question should return a focused proof plan.");

    const whyStatusReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "Why did you pick this job?",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            whyStatusReplies.push(payload.text);
          },
        },
      },
    });
    assert(whyStatusReplies.some((reply) => reply.includes("*Why this one:*") && reply.includes("Taste signal:")), "Why status question should return focused fit reasoning.");

    const changeStatusReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "What would you change?",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            changeStatusReplies.push(payload.text);
          },
        },
      },
    });
    assert(changeStatusReplies.some((reply) => reply.includes("*What I would change:*") && reply.includes("Final submit remains manual.")), "Change status question should return focused improvement guidance.");

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
  }
}

if (require.main === module) {
  runTests().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`slack socket parser tests failed: ${message}`);
    process.exitCode = 1;
  });
}
