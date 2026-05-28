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

  const { applySlackThreadRevision, buildSlackSocketStartupError, handleThreadCommand, parseSlackThreadCommand, parseUpworkJobUrlFromText, queueCaptureFromSlackUrl, queuePrepareDraftFromSlackThread } = require("./slackSocket") as {
    applySlackThreadRevision: (input: { channelId: string; threadTs: string; instruction: string }) => { ok: boolean; text: string; proposalVersion?: number };
    buildSlackSocketStartupError: (input: { socketEnabled: boolean; botToken: string; appToken: string }) => string | null;
    handleThreadCommand: (input: { channelId: string; threadTs: string; text: string; client: any }) => Promise<void>;
    parseSlackThreadCommand: (value: string) => {
      type: string;
      rawText: string;
      instruction?: string;
      actionId?: number;
    };
    parseUpworkJobUrlFromText: (value: string) => { originalUrl: string; normalizedUrl: string; canonicalJobUrl: string; jobId: string } | null;
    queueCaptureFromSlackUrl: (input: { channelId: string; messageTs: string; threadTs: string; text: string }) => { parsed: any; state: any; action: any } | null;
    queuePrepareDraftFromSlackThread: (input: { channelId: string; threadTs: string }) => { ok: boolean; text: string; actionId?: number };
  };
  const { closeDb, getApplicationDraft, getBrowserActionById, markJobSeen, upsertSlackThreadState, listBrowserActions, updateBrowserActionStatus } = require("./db") as {
    closeDb: () => void;
    getApplicationDraft: (jobId: string) => { proposalText: string } | null;
    getBrowserActionById: (id: number) => { payload: Record<string, unknown>; status: string } | null;
    markJobSeen: (job: any, notified: boolean) => void;
    upsertSlackThreadState: (input: any) => unknown;
    listBrowserActions: (status?: string | null, limit?: number) => Array<{ id: number; actionType: string; jobId: string; status: string }>;
    updateBrowserActionStatus: (id: number, status: string, lastError?: string) => boolean;
  };
  const { buildApplicationDraft } = require("./agent") as { buildApplicationDraft: (job: any) => any };
  const { scoreJob } = require("./filter") as { scoreJob: (job: any) => any };

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

    const commandTests: Array<{ name: string; input: string; expectType: string; instruction?: string; actionId?: number }> = [
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
      { name: "natural proceed", input: "Please proceed with the draft", expectType: "prepare_draft" },
      { name: "natural go ahead", input: "go ahead", expectType: "prepare_draft" },
      { name: "natural prep it", input: "prep it", expectType: "prepare_draft" },
      { name: "natural looks good proceed", input: "looks good, proceed", expectType: "prepare_draft" },
      { name: "natural apply", input: "apply", expectType: "prepare_draft" },
      { name: "retry action", input: "retry 123", expectType: "retry_action", actionId: 123 },
      { name: "natural retry preparation", input: "Retry preparation.", expectType: "retry_action" },
      { name: "mark submitted", input: "mark submitted", expectType: "mark_submitted" },
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

    const prepareResult = queuePrepareDraftFromSlackThread({ channelId: "C123", threadTs: "111.222" });
    assert(prepareResult.ok, `Expected prepare draft queue to succeed, got: ${prepareResult.text}`);
    assert(typeof prepareResult.actionId === "number", "Prepare draft should return an action id.");
    assert(prepareResult.text.includes("Got it"), "Prepare draft reply should acknowledge natural approval concisely.");
    assert(prepareResult.text.includes("ready for QA"), "Prepare draft reply should promise a QA update.");
    assert(prepareResult.text.includes("stop before submit"), "Prepare draft reply should keep manual submit boundary.");
    assert(!prepareResult.text.toLowerCase().includes("copy/paste"), "Prepare draft reply must not introduce copy/paste workflow.");
    assert(!prepareResult.text.includes("Auto-attach assets:"), "Prepare draft reply should not dump proof inventory.");
    assert(!prepareResult.text.toLowerCase().includes("action:"), "Prepare draft reply should not expose action ids by default.");

    const duplicatePrepareResult = queuePrepareDraftFromSlackThread({ channelId: "C123", threadTs: "111.222" });
    assert(duplicatePrepareResult.ok, "Duplicate prepare draft should resolve to existing action rather than fail.");
    assert(duplicatePrepareResult.actionId === prepareResult.actionId, "Duplicate prepare draft should return the existing action id.");
    assert(duplicatePrepareResult.text.includes("Already on it"), "Duplicate prepare draft should stay concise.");
    assert(!duplicatePrepareResult.text.toLowerCase().includes("browser action"), "Duplicate prepare draft should not expose action ids by default.");

    const queuedActions = listBrowserActions(null, 10).filter((action) => action.actionType === "prepare_application_review" && action.jobId === prepareJob.id);
    assert(queuedActions.length === 1, `Expected exactly one queued prepare_application_review action, got ${queuedActions.length}`);

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
