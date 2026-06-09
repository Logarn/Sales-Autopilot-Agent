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
  const sourceHealthPath = resolve(dirname(path), "browser-discovery-source-health.json");
  if (existsSync(sourceHealthPath)) {
    try {
      unlinkSync(sourceHealthPath);
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
  process.env.SLACK_ALLOWED_USER_IDS = "U_ALLOWED";
  process.env.BROWSER_QA_MAX_PROTECTED_TABS = "5";

  const { applySlackThreadRevision, buildDraftPreviewFromSlackThread, buildSlackSocketStartupError, handleSlackSocketTextEvent, handleThreadCommand, parseSlackThreadCommand, parseUpworkJobUrlFromText, queueCaptureFromSlackUrl, queuePrepareDraftFromSlackThread, resetSlackSocketEventDedupeForTests } = require("./slackSocket") as {
    applySlackThreadRevision: (input: { channelId: string; threadTs: string; instruction: string }) => { ok: boolean; text: string; proposalVersion?: number };
    buildDraftPreviewFromSlackThread: (input: { channelId: string; threadTs: string }) => { ok: boolean; text: string };
    buildSlackSocketStartupError: (input: { socketEnabled: boolean; botToken: string; appToken: string }) => string | null;
    handleSlackSocketTextEvent: (event: { channel: string; channel_type?: string; ts: string; text?: string; thread_ts?: string; client_msg_id?: string; event_id?: string; event_ts?: string; user?: string; bot_id?: string; subtype?: string; files?: any[] }, client: any) => Promise<void>;
    handleThreadCommand: (input: { channelId: string; threadTs: string; text: string; client: any; intentProvider?: any; conversationProvider?: any; copyProvider?: any; focusQaTab?: any; operatorDeps?: any }) => Promise<void>;
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
    resetSlackSocketEventDedupeForTests: () => void;
  };
  const { closeDb, getApplicationDraft, getApplicationProofPlanOverrides, getApplicationStatus, getBrowserActionById, getSlackConversationOwnership, getSlackThreadStateByThreadTs, listActiveSlackBehaviorMemories, listApplicationAssets, listProposalVersions, listRecentSlackFailureReflections, markJobSeen, mergeBrowserActionPayload, recordProposalVersion, upsertSlackThreadState, listBrowserActions, updateApplicationStatus, updateBrowserActionStatus } = require("./db") as {
    closeDb: () => void;
    getApplicationDraft: (jobId: string) => { proposalText: string } | null;
    getApplicationProofPlanOverrides: (jobId: string) => any;
    getApplicationStatus: (jobId: string) => string | null;
    getBrowserActionById: (id: number) => { payload: Record<string, unknown>; status: string } | null;
    getSlackConversationOwnership: (channelId: string, rootTs: string) => { mode: string; ownerUserId: string | null; disabled: boolean; closed: boolean } | null;
    getSlackThreadStateByThreadTs: (channelId: string, threadTs: string) => { status: string } | null;
    listActiveSlackBehaviorMemories: (limit?: number) => Array<{ type: string; rule: string; source: string }>;
    listApplicationAssets: (jobId: string) => Array<{ originalName: string; relativePath: string | null; source: string }>;
    listProposalVersions: (jobId: string) => Array<{ versionNumber: number; source: string; proposalText: string }>;
    listRecentSlackFailureReflections: (limit?: number) => Array<{ whatHappened: string; whyItFailed: string; nextBehavior: string; proposedTask?: string | null }>;
    markJobSeen: (job: any, notified: boolean) => void;
    mergeBrowserActionPayload: (id: number, patch: Record<string, unknown>) => unknown;
    recordProposalVersion: (input: { jobId: string; source: string; proposalText: string; screeningAnswers?: string[]; note?: string | null }) => unknown;
    upsertSlackThreadState: (input: any) => unknown;
    listBrowserActions: (status?: string | null, limit?: number) => Array<{ id: number; actionType: string; jobId: string; status: string }>;
    updateApplicationStatus: (jobId: string, status: string, note?: string) => boolean;
    updateBrowserActionStatus: (id: number, status: string, lastError?: string) => boolean;
  };
  const { recordBrowserManualAttention } = require("./browserSession") as {
    recordBrowserManualAttention: (input: { reason: string; actionId?: number; jobId?: string; url?: string | null; title?: string | null }) => Promise<unknown>;
  };
  const { markDiscoverySourceChallenge } = require("./browserDiscoverySourceHealth") as {
    markDiscoverySourceChallenge: (source: { sourceType: string; sourceLabel: string; url: string }, reason: string, now?: Date) => unknown;
  };
  const { buildApplicationDraft } = require("./agent") as { buildApplicationDraft: (job: any) => any };
  const { buildBrowserApplyPlan } = require("./browserApply") as { buildBrowserApplyPlan: (jobId: string) => { plan: any } };
  const { scoreJob } = require("./filter") as { scoreJob: (job: any) => any };
  resetSlackSocketEventDedupeForTests();
  const fakeIntentProvider = (decision: Record<string, unknown>) => ({
    isAvailable: () => true,
    completeJson: async () => ({ ok: true, data: decision }),
  });
  const unavailableProvider = {
    isAvailable: () => false,
    completeJson: async () => ({ ok: false, error: "disabled" }),
  };
  const fakeCopyRequests: unknown[] = [];
  const fakeCopyProvider = {
    isAvailable: () => true,
    completeJson: async (request: any) => {
      fakeCopyRequests.push(request);
      const payload = JSON.parse(request.messages[1].content);
      return { ok: true, data: { text: `Kimi copy: ${payload.deterministicText}` } };
    },
  };

  const operatorCopyReplies: string[] = [];
  fakeCopyRequests.length = 0;
  await handleThreadCommand({
    channelId: "C123",
    threadTs: "operator.001",
    text: "pause hunting",
    copyProvider: fakeCopyProvider,
    operatorDeps: {
      setHuntingPaused: () => ({ huntingPaused: true, reason: "Paused from Slack.", updatedAt: new Date(0).toISOString() }),
    },
    client: { chat: { postMessage: async (payload: { text: string }) => operatorCopyReplies.push(payload.text) } },
  });
  assert(operatorCopyReplies.some((reply) => reply.startsWith("Kimi copy:") && reply.includes("I paused hunting")), "Operator-control replies should route through the Slack copywriter.");
  const operatorCopyPayload = JSON.parse((fakeCopyRequests[fakeCopyRequests.length - 1] as any).messages[1].content);
  assert(operatorCopyPayload.intent === "operator_pause_hunting", "Operator-control copywriter request should preserve the operator intent.");

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
      { name: "natural proof swap", input: "Use the Truly Beauty proof instead.", expectType: "proof_revision", instruction: "Use the Truly Beauty proof instead." },
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
      { name: "qa queue", input: "what’s ready?", expectType: "qa_queue" },
      { name: "what needs me", input: "what needs me?", expectType: "qa_queue" },
      { name: "show QA queue", input: "show QA queue.", expectType: "qa_queue" },
      { name: "focus current application", input: "open this", expectType: "focus_qa_tab" },
      { name: "focus current application in chrome", input: "open this in Chrome", expectType: "focus_qa_tab" },
      { name: "show application page", input: "show me the application page.", expectType: "focus_qa_tab" },
      { name: "focus indexed application", input: "open 1", expectType: "focus_qa_tab" },
      { name: "focus numbered application", input: "open number 2", expectType: "focus_qa_tab" },
      { name: "focus blocked page", input: "focus the blocked page", expectType: "focus_qa_tab" },
      { name: "prep issue cover letter empty", input: "I do not see the cover letter filled in.", expectType: "prep_issue_report" },
      { name: "prep issue empty", input: "it’s empty", expectType: "prep_issue_report" },
      { name: "prep issue not attached", input: "The file is not attached.", expectType: "prep_issue_report" },
      { name: "live phrasing", input: "yeah, prep drafts and send link to listing", expectType: "approve_prepare" },
      { name: "bot mention raises prep confidence", input: "yeah, prep drafts and send link to listing <@UAGENT>", expectType: "approve_prepare" },
      { name: "retry action", input: "retry 123", expectType: "retry_action", actionId: 123 },
      { name: "natural retry exact", input: "Retry.", expectType: "retry_action" },
      { name: "natural retry preparation", input: "Retry preparation.", expectType: "retry_action" },
      { name: "keep hunting", input: "keep hunting", expectType: "discovery_keep_hunting" },
      { name: "try searches again", input: "try the searches again", expectType: "discovery_retry_sources" },
      { name: "retry blocked search", input: "retry the blocked search", expectType: "discovery_retry_sources" },
      { name: "stick to Best Matches", input: "stick to Best Matches", expectType: "discovery_best_matches_only" },
      { name: "what got blocked", input: "what got blocked?", expectType: "discovery_block_status" },
      { name: "cleared Chrome", input: "I cleared Chrome", expectType: "discovery_clear_browser" },
      { name: "mark submitted", input: "mark submitted", expectType: "mark_submitted" },
      { name: "i sent it", input: "I sent it", expectType: "mark_submitted" },
      { name: "got reply outcome", input: "got reply", expectType: "record_outcome", outcomeStatus: "replied" },
      { name: "client replied outcome", input: "client replied", expectType: "record_outcome", outcomeStatus: "replied" },
      { name: "interview booked outcome", input: "interview booked", expectType: "record_outcome", outcomeStatus: "interview" },
      { name: "hired outcome", input: "hired", expectType: "record_outcome", outcomeStatus: "hired" },
      { name: "won this outcome", input: "won this", expectType: "record_outcome", outcomeStatus: "hired" },
      { name: "lost outcome", input: "lost", expectType: "record_outcome", outcomeStatus: "lost" },
      { name: "lost this outcome", input: "lost this", expectType: "record_outcome", outcomeStatus: "lost" },
      { name: "ignored outcome", input: "ignored", expectType: "record_outcome", outcomeStatus: "lost" },
      { name: "client ghosted outcome", input: "client ghosted", expectType: "record_outcome", outcomeStatus: "lost" },
      { name: "bad lead outcome", input: "bad lead", expectType: "record_outcome", outcomeStatus: "lost" },
      { name: "memory query", input: "what did you learn?", expectType: "memory_query" },
      { name: "proof memory query", input: "what proof is working?", expectType: "memory_query" },
      { name: "connects waste memory query", input: "how many Connects are we wasting?", expectType: "memory_query" },
      { name: "mayor fix memory query", input: "what should Mayor fix?", expectType: "memory_query" },
      { name: "recent failures memory query", input: "what failed recently?", expectType: "memory_query" },
      { name: "proposal style memory query", input: "How should you write Upwork proposals for me?", expectType: "memory_query" },
      { name: "remember sales learning", input: "remember this: fashion Klaviyo jobs should check Fly Boutique first", expectType: "memory_remember", instruction: "fashion Klaviyo jobs should check Fly Boutique first" },
      { name: "forget sales learning", input: "forget that", expectType: "memory_forget", instruction: "latest relevant memory" },
      { name: "unknown", input: "something else", expectType: "unknown" },
    ];

    for (const t of commandTests) {
      const parsed = parseSlackThreadCommand(t.input);
      assert(parsed.type === t.expectType, `${t.name}: expected type=${t.expectType}, got=${parsed.type}`);
      if (t.expectType === "revise" || t.expectType === "proof_revision" || t.expectType === "memory_remember" || t.expectType === "memory_forget") {
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
      user: "U_ALLOWED",
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
      user: "U_ALLOWED",
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

    const duplicateEventReplies: string[] = [];
    const duplicateEvent = {
      channel: "C456",
      ts: "333.888",
      event_ts: "333.888",
      client_msg_id: "dup-client-msg-1",
      user: "U_ALLOWED",
      text: "<@UAGENT> prep this https://www.upwork.com/jobs/~055053866890130225260",
    };
    await handleSlackSocketTextEvent(duplicateEvent, {
      chat: { postMessage: async (payload: { text: string }) => duplicateEventReplies.push(payload.text) },
    });
    await handleSlackSocketTextEvent(duplicateEvent, {
      chat: { postMessage: async (payload: { text: string }) => duplicateEventReplies.push(payload.text) },
    });
    assert(duplicateEventReplies.length === 1, "Duplicate Slack message/app_mention delivery should only produce one reply.");

    const separateQuestionReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "C0AQW8W6RFU",
      ts: "333.889",
      user: "U_ALLOWED",
      text: "what needs attention?",
    }, {
      chat: { postMessage: async (payload: { text: string }) => separateQuestionReplies.push(payload.text) },
    });
    await handleSlackSocketTextEvent({
      channel: "C0AQW8W6RFU",
      ts: "333.890",
      user: "U_ALLOWED",
      text: "what’s blocked?",
    }, {
      chat: { postMessage: async (payload: { text: string }) => separateQuestionReplies.push(payload.text) },
    });
    assert(separateQuestionReplies.length === 2, "Different Slack messages should not be deduped into one ignored message.");
    assert(!/manual_attention_required|browser_challenge_action_paused|action\s*#?\d+/i.test(separateQuestionReplies.join("\n")), "Normal adjacent status replies should hide raw internals.");

    const compositeStatusReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "C0AQW8W6RFU",
      ts: "333.891",
      user: "U_ALLOWED",
      text: "what is blocked and what needs attention?",
    }, {
      chat: { postMessage: async (payload: { text: string }) => compositeStatusReplies.push(payload.text) },
    });
    assert(compositeStatusReplies.length === 1, "Composite blocked/attention question should get one complete reply.");
    assert(/Blocked:/i.test(compositeStatusReplies[0]) && /Needs attention:/i.test(compositeStatusReplies[0]), "Composite status reply should answer both blocked and attention parts.");

    const trackedThreadUrlReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "C456",
      ts: "333.777",
      thread_ts: "333.444",
      user: "U_ALLOWED",
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

    const unauthorizedReplies: string[] = [];
    const actionCountBeforeUnauthorized = listBrowserActions(null, 1000).length;
    await handleSlackSocketTextEvent({
      channel: "C456",
      ts: "333.999",
      user: "U_INTRUDER",
      text: "<@UAGENT> prep this https://www.upwork.com/jobs/~066053866890130225260",
    }, {
      chat: {
        postMessage: async (payload: { text: string }) => {
          unauthorizedReplies.push(payload.text);
        },
      },
    });
    assert(unauthorizedReplies.length === 0, "Unauthorized Slack user should not receive a command reply.");
    assert(listBrowserActions(null, 1000).length === actionCountBeforeUnauthorized, "Unauthorized Slack user should not queue browser actions.");

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

    const makeOwnedLeadThread = (id: string, channelId: string, threadTs: string) => {
      const job = scoreJob({
        ...prepareJob,
        id,
        title: `Owned lead ${id}`,
        url: `https://www.upwork.com/jobs/~${id.replace(/[^a-z0-9]/gi, "")}`,
      });
      job.applicationDraft = buildApplicationDraft(job);
      markJobSeen(job, false);
      upsertSlackThreadState({
        channelId,
        messageTs: threadTs,
        threadTs,
        upworkUrl: job.url,
        jobId: job.id,
        status: "packet_sent",
      });
      return job;
    };

    const untaggedApproveJob = makeOwnedLeadThread("untagged-approve-job", "COWN", "own.001");
    const untaggedApproveReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "COWN",
      ts: "own.002",
      thread_ts: "own.001",
      user: "U_ALLOWED",
      text: "Yep, go for it",
    }, {
      chat: { postMessage: async (payload: { text: string }) => untaggedApproveReplies.push(payload.text) },
    });
    assert(
      listBrowserActions(null, 1000).some((action) => action.jobId === untaggedApproveJob.id && action.actionType === "prepare_application_review"),
      "Bot-owned lead thread should treat untagged affirmative CTA reply as prep_application.",
    );
    assert(untaggedApproveReplies.some((reply) => /stop before submit/i.test(reply)), "Untagged CTA approval should preserve final-submit safety.");
    assert(getSlackConversationOwnership("COWN", "own.001")?.mode === "bot_owned_thread", "Bot-created lead thread should register owned conversation context.");

    const untaggedSkipJob = makeOwnedLeadThread("untagged-skip-job", "CSKIP", "skip.001");
    const untaggedSkipReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "CSKIP",
      ts: "skip.002",
      thread_ts: "skip.001",
      user: "U_ALLOWED",
      text: "nah skip this one",
    }, {
      chat: { postMessage: async (payload: { text: string }) => untaggedSkipReplies.push(payload.text) },
    });
    assert(getApplicationStatus(untaggedSkipJob.id) === "rejected", "Untagged skip in a bot-owned lead thread should skip the current lead.");
    assert(untaggedSkipReplies.some((reply) => /archived|skipped|skip/i.test(reply)), "Untagged skip should acknowledge the current lead.");

    const untaggedDealJob = makeOwnedLeadThread("untagged-deal-job", "CDEAL", "deal.001");
    const untaggedDealReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "CDEAL",
      ts: "deal.002",
      thread_ts: "deal.001",
      user: "U_ALLOWED",
      text: "what's the deal here?",
    }, {
      chat: { postMessage: async (payload: { text: string }) => untaggedDealReplies.push(payload.text) },
    });
    assert(untaggedDealReplies.some((reply) => reply.includes("Main risk") || reply.includes(untaggedDealJob.title)), "Untagged lead-thread question should answer the lead context.");

    const salesRunningReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "C0AQW8W6RFU",
      ts: "ambient.001",
      user: "U_ALLOWED",
      text: "are you running?",
    }, {
      chat: { postMessage: async (payload: { text: string }) => salesRunningReplies.push(payload.text) },
    });
    assert(salesRunningReplies.length === 1, "#sales_leads top-level status prompt should answer without a tag.");

    const naturalStatusReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "C0AQW8W6RFU",
      ts: "ambient.001b",
      user: "U_ALLOWED",
      text: "what the fuck are you up to?",
    }, {
      chat: { postMessage: async (payload: { text: string }) => naturalStatusReplies.push(payload.text) },
    });
    assert(naturalStatusReplies.length === 1, "Natural/frustrated status language should be classified as a status check.");

    const dmAttentionReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "D_AGENT_DM",
      channel_type: "im",
      ts: "dm.001",
      user: "U_ALLOWED",
      text: "what needs attention?",
    }, {
      chat: { postMessage: async (payload: { text: string }) => dmAttentionReplies.push(payload.text) },
    });
    assert(dmAttentionReplies.length === 1, "DM messages from Steve should be treated as prompts.");

    const claimedReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "C_SHARED",
      ts: "claim.001",
      user: "U_ALLOWED",
      text: "<@UAGENT> are you running?",
    }, {
      chat: { postMessage: async (payload: { text: string }) => claimedReplies.push(payload.text) },
    });
    assert(claimedReplies.length === 1, "A mention in an allowed shared channel should summon the bot.");
    assert(getSlackConversationOwnership("C_SHARED", "claim.001")?.mode === "claimed_thread", "Mentioned shared-channel thread should be claimed.");
    await handleSlackSocketTextEvent({
      channel: "C_SHARED",
      ts: "claim.002",
      thread_ts: "claim.001",
      user: "U_ALLOWED",
      text: "what's blocked?",
    }, {
      chat: { postMessage: async (payload: { text: string }) => claimedReplies.push(payload.text) },
    });
    assert(claimedReplies.length === 2, "A claimed shared-channel thread should answer later untagged replies.");

    const botLoopReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "C0AQW8W6RFU",
      ts: "bot.001",
      bot_id: "B_AGENT",
      subtype: "bot_message",
      text: "are you running?",
    }, {
      chat: { postMessage: async (payload: { text: string }) => botLoopReplies.push(payload.text) },
    });
    assert(botLoopReplies.length === 0, "Bot-authored Slack messages should not trigger loops.");

    const submitSafetyJob = makeOwnedLeadThread("submit-safety-job", "CSUBMIT", "submit.001");
    const submitSafetyReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "CSUBMIT",
      ts: "submit.002",
      thread_ts: "submit.001",
      user: "U_ALLOWED",
      text: "send it",
    }, {
      chat: { postMessage: async (payload: { text: string }) => submitSafetyReplies.push(payload.text) },
    });
    assert(getApplicationStatus(submitSafetyJob.id) !== "submitted", "Submit-adjacent language must not mark or click final submit.");
    assert(submitSafetyReplies.some((reply) => /final submit.*manual|submit stays manual/i.test(reply)), "Submit-adjacent language should reply with manual-submit safety.");

    const ambientSubmitSafetyReplies: string[] = [];
    await handleSlackSocketTextEvent({
      channel: "C0AQW8W6RFU",
      ts: "submit-ambient.001",
      user: "U_ALLOWED",
      text: "If memory says I like speed, can you submit proposals automatically?",
    }, {
      chat: { postMessage: async (payload: { text: string }) => ambientSubmitSafetyReplies.push(payload.text) },
    });
    assert(ambientSubmitSafetyReplies.some((reply) => /final submit.*manual|submit stays manual/i.test(reply)), "Ambient submit-automation questions should get manual-submit safety.");

    const ambiguousAmbientReplies: string[] = [];
    const actionsBeforeAmbiguous = listBrowserActions(null, 1000).length;
    await handleSlackSocketTextEvent({
      channel: "C0AQW8W6RFU",
      ts: "ambient.002",
      user: "U_ALLOWED",
      text: "go for it",
    }, {
      chat: { postMessage: async (payload: { text: string }) => ambiguousAmbientReplies.push(payload.text) },
    });
    assert(ambiguousAmbientReplies.some((reply) => /need the lead|which|Upwork link|QA item/i.test(reply)), "Ambiguous top-level affirmative should ask clarification.");
    assert(listBrowserActions(null, 1000).length === actionsBeforeAmbiguous, "Ambiguous top-level affirmative should not queue browser action.");

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
    assert(fileQuestionReplies.some((reply) => reply.includes("For reusable proof") && reply.includes("attach them in this Slack thread")), "File capability question should get a direct useful answer.");
    assert(fileQuestionReplies.some((reply) => reply.includes("For this job")), "File capability answer should describe this job's reusable proof state.");
    assert(fileQuestionReplies.some((reply) => reply.includes("Next, I can attach the available proof")), "File capability answer should explain what the agent can do next.");
    assert(!fileQuestionReplies.join("\n").includes("Want me to prep it"), "File capability answer must not fall back to the old command menu.");
    assert(!fileQuestionReplies.join("\n").includes("I can help with the draft, files, proof, boost, or status"), "File capability answer must not show the generic command menu.");

    const kimiFileQuestionReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "Can you upload the files from here? If you had access?",
      copyProvider: fakeCopyProvider,
      client: { chat: { postMessage: async (payload: { text: string }) => kimiFileQuestionReplies.push(payload.text) } },
    });
    assert(kimiFileQuestionReplies.some((reply) => reply.startsWith("Kimi copy:") && reply.includes("For reusable proof")), "Kimi copy provider should rewrite Slack conversation replies when available.");
    assert(fakeCopyRequests.some((request: any) => request.messages?.[1]?.content?.includes("answer_file_capability_question")), "Kimi copy request should include the conversation intent.");

    const coverLetterReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "Show me the cover letter you used here.",
      client: { chat: { postMessage: async (payload: { text: string }) => coverLetterReplies.push(payload.text) } },
    });
    assert(coverLetterReplies.some((reply) => reply.includes("Here’s the cover letter I drafted.")), "Cover-letter question should answer directly.");
    assert(coverLetterReplies.some((reply) => reply.includes(prepareJob.applicationDraft.proposalText.slice(0, 80))), "Cover-letter reply should include the draft text.");
    assert(!coverLetterReplies.join("\n").includes("I can help with the draft, files, proof, boost, or status"), "Cover-letter question must not show the generic command menu.");

    const frustratedCvReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "Wtf? I just need the CV you used.",
      client: { chat: { postMessage: async (payload: { text: string }) => frustratedCvReplies.push(payload.text) } },
    });
    assert(frustratedCvReplies.some((reply) => reply.includes("You’re right") && reply.includes("draft/CV")), "Frustrated CV question should acknowledge and answer directly.");
    assert(frustratedCvReplies.some((reply) => reply.includes(prepareJob.applicationDraft.proposalText.slice(0, 80))), "Frustrated CV reply should include the stored draft.");
    assert(!frustratedCvReplies.join("\n").includes("I can help with the draft, files, proof, boost, or status"), "Frustrated CV reply must not show the generic command menu.");
    assert(!/action\s*#?\d+|Channel message:|Thread:/i.test(frustratedCvReplies.join("\n")), "Frustrated CV reply must not expose raw ids.");
    assert(listActiveSlackBehaviorMemories(20).some((memory) => memory.rule.includes("When Steve says CV")), "Frustrated CV correction should persist a behavior memory.");
    assert(listRecentSlackFailureReflections(20).some((reflection) => reflection.nextBehavior.includes("treat CV as the cover letter")), "Frustrated CV correction should persist a failure reflection.");

    const brainCvReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "Wtf? I just need the CV you used.",
      conversationProvider: fakeIntentProvider({
        intent: "show_cover_letter",
        confidence: "high",
        reply: "You’re right — I should have shown the draft.",
        actions: ["none"],
        memoryUpdate: {
          type: "operator_preference",
          rule: "LLM brain: CV means cover letter/proposal draft in Upwork Slack threads.",
          scope: "global",
          confidence: "high",
        },
        failureReflection: {
          whatHappened: "Steve corrected an unhelpful command-router reply.",
          whyItFailed: "The bot did not resolve CV against the stored draft state.",
          nextBehavior: "Show the draft directly, then offer revision or retry.",
          fixType: "memory",
        },
      }),
      client: { chat: { postMessage: async (payload: { text: string }) => brainCvReplies.push(payload.text) } },
    });
    assert(brainCvReplies.some((reply) => reply.includes(prepareJob.applicationDraft.proposalText.slice(0, 80))), "Conversation brain show-cover-letter decision should still return the stored draft.");
    assert(listActiveSlackBehaviorMemories(50).some((memory) => memory.rule.includes("LLM brain: CV means cover letter")), "Conversation brain memory update should be persisted.");
    assert(listRecentSlackFailureReflections(50).some((reflection) => reflection.whatHappened.includes("command-router reply")), "Conversation brain failure reflection should be persisted.");

    const everythingJob = {
      ...prepareJob,
      id: "everything-safe-prep-job",
      applicationDraft: {
        ...prepareJob.applicationDraft,
        jobId: "everything-safe-prep-job",
      },
    };
    markJobSeen(everythingJob, false);
    upsertSlackThreadState({
      channelId: "CEVERY",
      messageTs: "118.001",
      threadTs: "118.001",
      upworkUrl: everythingJob.url,
      jobId: everythingJob.id,
      status: "packet_sent",
    });
    const everythingReplies: string[] = [];
    await handleThreadCommand({
      channelId: "CEVERY",
      threadTs: "118.001",
      text: "Everything that needs to be done.",
      client: { chat: { postMessage: async (payload: { text: string }) => everythingReplies.push(payload.text) } },
    });
    assert(everythingReplies.some((reply) => reply.includes("all safe prep steps") && reply.includes("stop before submit")), "Everything-that-needs-to-be-done should authorize safe prep and preserve submit boundary.");
    assert(listBrowserActions(null, 1000).some((action) => action.jobId === everythingJob.id && action.actionType === "prepare_application_review"), "Everything-that-needs-to-be-done should queue prepare_application_review.");
    assert(listActiveSlackBehaviorMemories(50).some((memory) => memory.rule.includes("everything that needs to be done")), "Everything safe-prep approval should persist a behavior memory.");

    const brainEverythingJob = {
      ...prepareJob,
      id: "everything-brain-safe-prep-job",
      applicationDraft: {
        ...prepareJob.applicationDraft,
        jobId: "everything-brain-safe-prep-job",
      },
    };
    markJobSeen(brainEverythingJob, false);
    upsertSlackThreadState({
      channelId: "CBRAIN",
      messageTs: "119.001",
      threadTs: "119.001",
      upworkUrl: brainEverythingJob.url,
      jobId: brainEverythingJob.id,
      status: "packet_sent",
    });
    const brainEverythingReplies: string[] = [];
    await handleThreadCommand({
      channelId: "CBRAIN",
      threadTs: "119.001",
      text: "Everything that needs to be done.",
      conversationProvider: fakeIntentProvider({
        intent: "full_safe_prep",
        confidence: "high",
        reply: "Got it — I’ll do all safe prep and stop before submit.",
        actions: ["queue_prepare_application"],
        memoryUpdate: {
          type: "operator_preference",
          rule: "LLM brain: everything means full safe prep, never final submit.",
          scope: "global",
          confidence: "high",
        },
      }),
      client: { chat: { postMessage: async (payload: { text: string }) => brainEverythingReplies.push(payload.text) } },
    });
    assert(brainEverythingReplies.some((reply) => reply.includes("all safe prep steps") && reply.includes("stop before submit")), "Conversation brain full-safe-prep should use the safe prep wording.");
    assert(listBrowserActions(null, 1000).some((action) => action.jobId === brainEverythingJob.id && action.actionType === "prepare_application_review"), "Conversation brain full-safe-prep should queue prepare_application_review.");
    assert(listActiveSlackBehaviorMemories(50).some((memory) => memory.rule.includes("LLM brain: everything means full safe prep")), "Conversation brain full-safe-prep memory update should be persisted.");

    const fileIntakeReplies: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = (async () => new Response(Buffer.from("%PDF-1.4\n"), { status: 200 })) as typeof fetch;
    try {
      await handleSlackSocketTextEvent({
        channel: "C123",
        ts: "111.224",
        thread_ts: "111.222",
        user: "U_ALLOWED",
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
    assert(!prepareResult.text.includes("Browser queue:"), "Prepare draft reply should not include queue internals by default.");
    assert(prepareResult.text.includes("stop before submit"), "Prepare draft reply should keep manual submit boundary.");
    assert(!prepareResult.text.toLowerCase().includes("copy/paste"), "Prepare draft reply must not introduce copy/paste workflow.");
    assert(!prepareResult.text.includes("Auto-attach assets:"), "Prepare draft reply should not dump proof inventory.");
    assert(!prepareResult.text.toLowerCase().includes("action:"), "Prepare draft reply should not expose action ids by default.");

    const duplicatePrepareResult = queuePrepareDraftFromSlackThread({ channelId: "C123", threadTs: "111.222" });
    assert(duplicatePrepareResult.ok, "Duplicate prepare draft should resolve to existing action rather than fail.");
    assert(duplicatePrepareResult.actionId === prepareResult.actionId, "Duplicate prepare draft should return the existing action id.");
    assert(duplicatePrepareResult.text.includes("Already on it"), "Duplicate prepare draft should stay concise.");
    assert(!duplicatePrepareResult.text.toLowerCase().includes("browser action"), "Duplicate prepare draft should not expose action ids by default.");

    const proofRevisionReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "Use Fly instead of Truly and add the intro PDF.",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            proofRevisionReplies.push(payload.text);
          },
        },
      },
    });
    assert(proofRevisionReplies.some((reply) => reply.includes("Rechecking now")), "Proof correction should acknowledge the recheck.");
    const proofOverrides = getApplicationProofPlanOverrides(prepareJob.id);
    assert(proofOverrides?.includeAssetIds.includes("fly-boutique-case-study"), "Proof override should include Fly Boutique case study.");
    assert(proofOverrides?.includeAssetIds.includes("steve-intro-pdf"), "Proof override should include intro PDF.");
    assert(proofOverrides?.excludeAssetIds.includes("truly-beauty-case-study"), "Proof override should remove Truly attachment.");
    const planAfterProofRevision = buildBrowserApplyPlan(prepareJob.id).plan;
    assert(planAfterProofRevision.attachments.some((attachment: { filePath: string }) => attachment.filePath === "profile/attachments/fly-boutique-case-study.pdf"), "Revised proof plan should attach Fly Boutique.");
    assert(planAfterProofRevision.attachments.some((attachment: { filePath: string }) => attachment.filePath === "profile/attachments/steve-logarn-intro.pdf"), "Revised proof plan should attach intro PDF.");
    assert(!planAfterProofRevision.attachments.some((attachment: { filePath: string }) => attachment.filePath.includes("truly-beauty")), "Revised proof plan should remove Truly attachment.");
    assert(planAfterProofRevision.highlights.some((label: string) => label.includes("The Fly Boutique")), "Revised proof plan should select the Fly Boutique Upwork portfolio label.");
    assert(listBrowserActions(null, 1000).some((action) => action.jobId === prepareJob.id && action.actionType === "prepare_application_review"), "Proof correction should queue a remote Chrome recheck.");

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
    const multiApprovalTexts = ["prep it", "sounds good", "move on it"];
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
        text: multiApprovalTexts[i - 1] ?? "prep it",
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
    assert(multiApprovalReplies.filter((reply) => reply.includes("stop before submit")).length === 3, "Each queued approval should acknowledge the manual-submit boundary.");
    assert(!multiApprovalReplies.join("\n").includes("Browser queue:"), "Queued approvals should not dump queue internals by default.");

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

    const blockedSearchSource = {
      sourceType: "saved_search",
      sourceLabel: "Saved Search - Klaviyo DTC",
      url: "https://www.upwork.com/nx/search/jobs/?q=Klaviyo+DTC&sort=recency",
    };
    markDiscoverySourceChallenge(blockedSearchSource, "captcha_or_security_challenge", new Date());
    const sourceStatusReplies: string[] = [];
    await handleThreadCommand({
      channelId: "CDISC",
      threadTs: "900.100",
      text: "what got blocked?",
      conversationProvider: unavailableProvider,
      intentProvider: unavailableProvider,
      client: { chat: { postMessage: async (payload: { text: string }) => sourceStatusReplies.push(payload.text) } },
    });
    assert(sourceStatusReplies.some((reply) => reply.includes("Upwork checked one search page")), "Blocked-search status should use human copy.");
    assert(sourceStatusReplies.some((reply) => reply.includes("I’ll keep hunting from the safer feed")), "Blocked-search status should promise continued safer hunting.");
    assert(!/source cooldown|manual_attention_required|sourceId|https?:\/\/|retry Klaviyo DTC/i.test(sourceStatusReplies.join("\n")), "Normal blocked-search Slack copy must not expose backend jargon or raw URLs.");

    const sourceDebugReplies: string[] = [];
    await handleThreadCommand({
      channelId: "CDISC",
      threadTs: "900.100",
      text: "what got blocked? debug details",
      conversationProvider: unavailableProvider,
      intentProvider: unavailableProvider,
      client: { chat: { postMessage: async (payload: { text: string }) => sourceDebugReplies.push(payload.text) } },
    });
    assert(/sourceId=|url=https:\/\/www\.upwork\.com\/nx\/search\/jobs\//i.test(sourceDebugReplies.join("\n")), "Debug blocked-search Slack copy may expose technical source details.");

    const clearChromeReplies: string[] = [];
    await handleThreadCommand({
      channelId: "CDISC",
      threadTs: "900.100",
      text: "I cleared Chrome",
      conversationProvider: unavailableProvider,
      intentProvider: unavailableProvider,
      client: { chat: { postMessage: async (payload: { text: string }) => clearChromeReplies.push(payload.text) } },
    });
    assert(clearChromeReplies.some((reply) => reply.includes("try the blocked search again")), "Manual clear should reset blocked search state in human copy.");
    assert(clearChromeReplies.some((reply) => reply.includes("final submit remains manual")), "Manual clear copy should preserve final-submit safety.");

    const keepHuntingReplies: string[] = [];
    await handleThreadCommand({
      channelId: "CDISC",
      threadTs: "900.100",
      text: "keep hunting",
      conversationProvider: unavailableProvider,
      intentProvider: unavailableProvider,
      client: { chat: { postMessage: async (payload: { text: string }) => keepHuntingReplies.push(payload.text) } },
    });
    assert(keepHuntingReplies.some((reply) => reply.includes("keep hunting from the safer feed")), "Keep-hunting command should acknowledge continued safer hunting.");

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
    assert(retryReplies.some((reply) => reply.includes("Retry queued") && reply.includes("stop before submit")), "Natural retry should reply in plain English in the same tracked thread.");
    assert(!retryReplies.join("\n").includes(String(prepareResult.actionId)), "Natural retry should not expose raw action ids by default.");

    const exactRetryReplies: string[] = [];
    updateBrowserActionStatus(prepareResult.actionId!, "failed", "field_preparation_incomplete");
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "Retry.",
      client: { chat: { postMessage: async (payload: { text: string }) => exactRetryReplies.push(payload.text) } },
    });
    assert(getBrowserActionById(prepareResult.actionId!)?.status === "pending", "Exact Retry should find the latest failed browser action for the thread.");
    assert(exactRetryReplies.some((reply) => reply.includes("Retry queued") && reply.includes("stop before submit")), "Exact Retry should not say no paused action found when one exists.");
    assert(!/No paused|No paused or failed|action\s*#?\d+/i.test(exactRetryReplies.join("\n")), "Exact Retry should avoid the old failure wording and raw ids.");
    assert(listActiveSlackBehaviorMemories(50).some((memory) => memory.type === "retry_rule" && memory.rule.includes("most recent paused or failed browser action")), "Retry correction should persist the thread retry rule.");

    updateBrowserActionStatus(prepareResult.actionId!, "failed", "field_preparation_incomplete");
    const directRetryReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: `retry ${prepareResult.actionId}`,
      client: { chat: { postMessage: async (payload: { text: string }) => directRetryReplies.push(payload.text) } },
    });
    assert(getBrowserActionById(prepareResult.actionId!)?.status === "pending", "Retry with the action id previously exposed by the bot should still work in-thread.");
    assert(directRetryReplies.some((reply) => reply.includes("Retry queued")), "Direct retry should still answer conversationally.");

    updateBrowserActionStatus(prepareResult.actionId!, "completed", "Prepared for QA.");
    updateApplicationStatus(prepareJob.id, "prepared_for_qa", "Test protected QA hold.");
    mergeBrowserActionPayload(prepareResult.actionId!, {
      qaHold: {
        protected: true,
        doNotReuse: true,
        do_not_reuse: true,
        jobId: prepareJob.id,
        applyUrl: "https://www.upwork.com/ab/proposals/job/~preparejob123456/apply/",
        status: "prepared_for_qa",
      },
    });

    const focusReplies: string[] = [];
    const focusCalls: Array<{ jobId?: string | null; index?: number; query?: string | null }> = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "open this",
      focusQaTab: async (input: { jobId?: string | null; index?: number; query?: string | null }) => {
        focusCalls.push(input);
        return { ok: true, text: "Done — I brought the remote Chrome application tab to the front. Review it in VNC. Final submit is still untouched." };
      },
      client: { chat: { postMessage: async (payload: { text: string }) => focusReplies.push(payload.text) } },
    });
    assert(focusCalls[0]?.jobId === prepareJob.id, "Open-this should focus the protected apply tab for the current thread job.");
    assert(focusReplies.some((reply) => reply.includes("remote Chrome application tab") && reply.includes("Final submit is still untouched")), "Open-this should produce the expected VNC handoff.");

    const showApplicationReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "show me the application page.",
      focusQaTab: async (input: { jobId?: string | null; index?: number; query?: string | null }) => {
        focusCalls.push(input);
        return { ok: true, text: "Done — I brought the remote Chrome application tab to the front. Review it in VNC. Final submit is still untouched." };
      },
      client: { chat: { postMessage: async (payload: { text: string }) => showApplicationReplies.push(payload.text) } },
    });
    assert(focusCalls[focusCalls.length - 1]?.jobId === prepareJob.id, "Show-application-page should focus the protected apply tab for the current thread job.");
    assert(showApplicationReplies.some((reply) => reply.includes("remote Chrome application tab") && reply.includes("Final submit is still untouched")), "Show-application-page should reply with the bring-to-front handoff.");

    const qaQueueReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "what’s ready?",
      client: { chat: { postMessage: async (payload: { text: string }) => qaQueueReplies.push(payload.text) } },
    });
    assert(qaQueueReplies.some((reply) => reply.includes("Prepared applications") && reply.includes("Application 1") && /ready|review|blocked/i.test(reply)), "Ready status should list prepared applications with index guidance.");
    assert(!/QA queue|Say "open/i.test(qaQueueReplies.join("\n")), "Ready status should not emit dashboard headings or command-menu copy.");
    assert(!qaQueueReplies.join("\n").includes("action #"), "QA queue should not expose raw action ids.");

    const showQaQueueReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "show QA queue.",
      client: { chat: { postMessage: async (payload: { text: string }) => showQaQueueReplies.push(payload.text) } },
    });
    assert(showQaQueueReplies.some((reply) => reply.includes("Prepared applications") && (reply.includes("blocked") || reply.includes("ready"))), "Show QA queue should return compact prepared-application facts.");
    assert(!/QA queue|Say "open|action\s*#?\d+|Channel message:|Thread:/i.test(showQaQueueReplies.join("\n")), "Show QA queue should not expose dashboard headings, command-menu text, or raw ids.");

    for (let i = 2; i <= 5; i += 1) {
      const qaJob = scoreJob({
        ...prepareJob,
        id: `qa-full-job-${i}`,
        title: `QA full job ${i}`,
        url: `https://www.upwork.com/jobs/~qafulljob${i}`,
      });
      qaJob.applicationDraft = buildApplicationDraft(qaJob);
      markJobSeen(qaJob, false);
      upsertSlackThreadState({
        channelId: "CQA",
        messageTs: `700.${i}`,
        threadTs: `700.${i}`,
        upworkUrl: qaJob.url,
        jobId: qaJob.id,
        status: "packet_sent",
      });
      const qaPrep = queuePrepareDraftFromSlackThread({ channelId: "CQA", threadTs: `700.${i}` });
      assert(qaPrep.ok && typeof qaPrep.actionId === "number", `QA protected setup ${i} should queue before cap.`);
      updateBrowserActionStatus(qaPrep.actionId!, i === 5 ? "paused" : "completed", i === 5 ? "captcha_or_security_challenge" : "Prepared for QA.");
      updateApplicationStatus(qaJob.id, i === 5 ? "needs_review" : "prepared_for_qa", "Test protected QA hold.");
      mergeBrowserActionPayload(qaPrep.actionId!, {
        qaHold: {
          protected: true,
          doNotReuse: true,
          do_not_reuse: true,
          jobId: qaJob.id,
          applyUrl: `https://www.upwork.com/ab/proposals/job/~qafulljob${i}/apply/`,
          status: i === 5 ? "needs_review" : "prepared_for_qa",
        },
      });
    }

    const cappedJob = scoreJob({
      ...prepareJob,
      id: "qa-capped-job",
      title: "QA capped job",
      url: "https://www.upwork.com/jobs/~qacappedjob",
    });
    cappedJob.applicationDraft = buildApplicationDraft(cappedJob);
    markJobSeen(cappedJob, false);
    upsertSlackThreadState({
      channelId: "CQA",
      messageTs: "701.001",
      threadTs: "701.001",
      upworkUrl: cappedJob.url,
      jobId: cappedJob.id,
      status: "packet_sent",
    });
    const cappedPrep = queuePrepareDraftFromSlackThread({ channelId: "CQA", threadTs: "701.001" });
    assert(!cappedPrep.ok, "Sixth protected QA prep should pause instead of queueing another apply tab.");
    assert(cappedPrep.text.includes("5 applications waiting for QA"), "Max protected QA tabs message should tell Steve to submit/skip one.");

    const queueRetryReplies: string[] = [];
    await handleThreadCommand({
      channelId: "CQA",
      threadTs: "701.002",
      text: "retry 5",
      client: { chat: { postMessage: async (payload: { text: string }) => queueRetryReplies.push(payload.text) } },
    });
    assert(queueRetryReplies.some((reply) => reply.includes("Retry queued")), "Queue-index retry should find the blocked QA item without a raw action id.");

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

    const latestVersionBeforeRevision = listProposalVersions(prepareJob.id).slice(-1)[0]?.versionNumber ?? 1;
    const revisionResult = applySlackThreadRevision({
      channelId: "C123",
      threadTs: "111.222",
      instruction: "make opener more direct",
    });
    assert(revisionResult.ok, `Expected Slack revise to apply stored draft update, got: ${revisionResult.text}`);
    assert(revisionResult.proposalVersion === latestVersionBeforeRevision + 1, `Expected revised proposal version ${latestVersionBeforeRevision + 1}, got ${revisionResult.proposalVersion}`);
    assert(revisionResult.text.includes("Browser draft needs update: yes"), "Revision reply should flag that queued browser draft needs updating.");
    const revisedDraft = getApplicationDraft(prepareJob.id);
    assert(Boolean(revisedDraft?.proposalText.includes("highest-leverage retention work")), "Stored draft should be updated with deterministic revision text.");

    const exactUpworkVersion = "  Exact Upwork cover letter used.\n\nThis came from the verified inserted version.  ";
    recordProposalVersion({
      jobId: prepareJob.id,
      source: "upwork_inserted",
      proposalText: exactUpworkVersion,
      screeningAnswers: ["Exact screening answer used."],
      note: "Test verified inserted version.",
    });
    const cvUsedReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "show me CV used",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            cvUsedReplies.push(payload.text);
          },
        },
      },
    });
    assert(cvUsedReplies.some((reply) => reply.includes(exactUpworkVersion)), "Show me CV used should return the exact Upwork-inserted version.");
    assert(!cvUsedReplies.join("\n").includes("I can help with the draft, files, proof, boost, or status"), "Show me CV used must not fall back to a command menu.");

    const submittedReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "I sent it",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            submittedReplies.push(payload.text);
          },
        },
      },
    });
    assert(getApplicationStatus(prepareJob.id) === "submitted", "Slack submitted command should mark local state submitted after Steve manually sends it.");
    assert(submittedReplies.some((reply) => reply.includes("final version capture") && reply.includes("Final submit remains manual")), "Submitted reply should queue final readback and preserve final-submit safety.");
    assert(!submittedReplies.join("\n").includes(prepareJob.id), "Submitted reply should hide raw job ids in normal Slack output.");

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
    assert(outcomeReplies.some((reply) => reply.includes("Outcome recorded") && reply.includes("reply received")), "Slack outcome command should acknowledge the recorded reply.");
    assert(!outcomeReplies.join("\n").includes(prepareJob.id), "Outcome replies should hide raw job ids in normal Slack output.");

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

    const closeReplies: string[] = [];
    await handleThreadCommand({
      channelId: "C123",
      threadTs: "111.222",
      text: "close this",
      client: {
        chat: {
          postMessage: async (payload: { text: string }) => {
            closeReplies.push(payload.text);
          },
        },
      },
    });
    assert(getApplicationStatus(prepareJob.id) === "rejected", "Slack close/skip command should archive the application from the active flow.");
    assert(closeReplies.some((reply) => reply.includes("I archived")), "Slack close/skip command should acknowledge the archive in human language.");
    assert(!closeReplies.join("\n").includes(prepareJob.id), "Close/skip reply should hide raw job ids in normal Slack output.");

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
