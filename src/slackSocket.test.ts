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

function runTests(): void {
  const tempDb = resolve(process.cwd(), "data/.tmp-slack-socket/jobs.db");
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;

  const { buildSlackSocketStartupError, parseSlackThreadCommand, parseUpworkJobUrlFromText, queuePrepareDraftFromSlackThread } = require("./slackSocket") as {
    buildSlackSocketStartupError: (input: { socketEnabled: boolean; botToken: string; appToken: string }) => string | null;
    parseSlackThreadCommand: (value: string) => {
      type: string;
      rawText: string;
      instruction?: string;
      actionId?: number;
    };
    parseUpworkJobUrlFromText: (value: string) => { normalizedUrl: string; jobId: string } | null;
    queuePrepareDraftFromSlackThread: (input: { channelId: string; threadTs: string }) => { ok: boolean; text: string; actionId?: number };
  };
  const { closeDb, markJobSeen, upsertSlackThreadState, listBrowserActions } = require("./db") as {
    closeDb: () => void;
    markJobSeen: (job: any, notified: boolean) => void;
    upsertSlackThreadState: (input: any) => unknown;
    listBrowserActions: (status?: string | null, limit?: number) => Array<{ id: number; actionType: string; jobId: string; status: string }>;
  };
  const { buildApplicationDraft } = require("./agent") as { buildApplicationDraft: (job: any) => any };
  const { scoreJob } = require("./filter") as { scoreJob: (job: any) => any };

  try {
    const urlTests: TestCase[] = [
      {
        name: "parse job url from full jobs path",
        got: parseUpworkJobUrlFromText("Check this: https://www.upwork.com/jobs/~0123456789abcdef and apply"),
        want: {
          normalizedUrl: "https://www.upwork.com/jobs/~0123456789abcdef",
          jobId: "0123456789abcdef",
        },
      },
      {
        name: "parse job url from proposals/apply path",
        got: parseUpworkJobUrlFromText("Review this apply page: https://www.upwork.com/ab/proposals/job/~0123456789abcdef/apply/"),
        want: {
          normalizedUrl: "https://www.upwork.com/ab/proposals/job/~0123456789abcdef/apply/",
          jobId: "0123456789abcdef",
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
      { name: "revise with instruction", input: "revise: tighten tone", expectType: "revise", instruction: "tighten tone" },
      { name: "prepare draft", input: "prepare draft", expectType: "prepare_draft" },
      { name: "retry action", input: "retry 123", expectType: "retry_action", actionId: 123 },
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
    assert(prepareResult.text.includes("profile/attachments/truly-beauty-case-study.pdf"), "Prepare draft reply should include selected auto-attach asset.");
    assert(prepareResult.text.includes("Final submit remains manual"), "Prepare draft reply should keep manual submit reminder.");
    assert(!prepareResult.text.toLowerCase().includes("copy/paste"), "Prepare draft reply must not introduce copy/paste workflow.");

    const duplicatePrepareResult = queuePrepareDraftFromSlackThread({ channelId: "C123", threadTs: "111.222" });
    assert(duplicatePrepareResult.ok, "Duplicate prepare draft should resolve to existing action rather than fail.");
    assert(duplicatePrepareResult.actionId === prepareResult.actionId, "Duplicate prepare draft should return the existing action id.");
    assert(duplicatePrepareResult.text.includes("already exists as browser action"), "Duplicate prepare draft should describe the existing action.");

    const queuedActions = listBrowserActions(null, 10).filter((action) => action.actionType === "prepare_application_review" && action.jobId === prepareJob.id);
    assert(queuedActions.length === 1, `Expected exactly one queued prepare_application_review action, got ${queuedActions.length}`);

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
  try {
    runTests();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`slack socket parser tests failed: ${message}`);
    process.exitCode = 1;
  }
}
