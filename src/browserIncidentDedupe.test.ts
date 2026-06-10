import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

function cleanupPath(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

function baseDiagnostics(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actionId: 11,
    jobId: "manual:upwork-a",
    jobTitle: "Klaviyo retention support",
    actionType: "prepare_application_review",
    sourceUrl: "https://www.upwork.com/jobs/~022060000000000000001",
    applyUrl: "https://www.upwork.com/ab/proposals/job/~022060000000000000001/apply/",
    intendedAction: "Open Upwork apply page, prepare fields for human review, and stop before submit.",
    state: "captcha_or_security_challenge",
    stopBeforeSubmit: true,
    validationIssues: [],
    coverLetterPresent: true,
    coverLetterLength: 120,
    coverLetterPreview: "Drafted safely.",
    screeningAnswersCount: 0,
    screeningAnswers: [],
    rate: "$72/hr",
    requiredConnects: null,
    boostConnects: 0,
    totalConnects: null,
    connectsDecision: "manual_review",
    connectsExpectedValue: null,
    connectsConfidence: "unknown",
    connectsSource: null,
    selectedAttachments: [],
    filesAttached: [],
    manualReviewAssets: [],
    mentionOnlyProof: [],
    proofAvailability: [],
    portfolioHighlights: [],
    profileHighlights: [],
    figmaRecommendations: [],
    videoRecommendations: [],
    manualReviewWarnings: [],
    missingLocalAssets: [],
    skippedAttachments: [],
    selectedHighlights: [],
    warnings: [],
    attemptedFields: [],
    skippedFields: [],
    manualFields: ["finalSubmit"],
    fieldVerification: [
      { field: "targetTab", status: "attempted_unverified", detail: "Upwork showed a browser check." },
      { field: "finalSubmit", status: "skipped_by_strategy", detail: "Final submit/send button was intentionally not clicked." },
    ],
    verifiedFields: [],
    unverifiedFields: ["targetTab"],
    unavailableFields: [],
    missingFileFields: [],
    blockedByUiFields: [],
    skippedByStrategyFields: ["finalSubmit"],
    ...overrides,
  };
}

async function run(): Promise<void> {
  const tempDir = resolve(process.cwd(), "data/.tmp-browser-incident-dedupe");
  const tempDb = resolve(tempDir, "jobs.db");
  cleanupPath(tempDir);
  process.env.DB_PATH = tempDb;
  process.env.SLACK_CHANNEL_WEBHOOK_URL = "";
  process.env.SLACK_BOT_TOKEN = "";
  process.env.SLACK_DELAY_MS = "0";
  process.env.SLACK_RETRY_ATTEMPTS = "1";
  process.env.SLACK_COPY_LLM_ENABLED = "false";

  const {
    closeDb,
    getQueuedSlackMessages,
  } = require("./db") as {
    closeDb: () => void;
    getQueuedSlackMessages: () => Array<{ id: number; payload: string }>;
  };
  const {
    clearBrowserManualAttention,
    markBrowserChallengeResolved,
    recordBrowserManualAttention,
    shouldSuppressBrowserManualAttentionChannelPost,
  } = require("./browserSession") as {
    clearBrowserManualAttention: (actionId?: number) => unknown;
    markBrowserChallengeResolved: (actionId?: number) => unknown;
    recordBrowserManualAttention: (input: {
      actionId?: number;
      jobId?: string;
      applicationId?: string | null;
      url?: string | null;
      title?: string | null;
      reason: string;
      now?: Date;
    }) => Promise<{ manualAttentionIncidents?: Array<{ key: string; status: string; repeatCount: number; lastMainAlertAt?: string; actionIds: number[] }> }>;
    shouldSuppressBrowserManualAttentionChannelPost: (input: {
      actionId?: number;
      jobId?: string;
      applicationId?: string | null;
      url?: string | null;
      reason: string;
    }) => boolean;
  };
  const { postPrepareDraftStatus } = require("./browserWorker") as {
    postPrepareDraftStatus: (input: { thread?: null; heading: string; diagnostics: Record<string, unknown> }, deps?: { postWebhookMessage?: (payload: { text?: string }) => Promise<boolean> }) => Promise<"posted" | "skipped" | "failed">;
  };

  const urlA = "https://www.upwork.com/ab/proposals/job/~022060000000000000001/apply/";
  const urlB = "https://www.upwork.com/ab/proposals/job/~022060000000000000002/apply/";

  try {
    const first = await recordBrowserManualAttention({
      actionId: 11,
      jobId: "manual:upwork-a",
      url: urlA,
      title: "Just a moment...",
      reason: "captcha_or_security_challenge",
      now: new Date("2026-06-10T00:00:00.000Z"),
    });
    assert.equal(getQueuedSlackMessages().length, 1, "first browser-check incident should create one main Slack alert attempt");
    assert.equal(first.manualAttentionIncidents?.find((item) => item.status === "active")?.repeatCount, 1);

    const repeated = await recordBrowserManualAttention({
      actionId: 11,
      jobId: "manual:upwork-a-different-local-id",
      url: urlA,
      title: "Just a moment...",
      reason: "captcha_or_security_challenge",
      now: new Date("2026-06-10T00:01:00.000Z"),
    });
    assert.equal(getQueuedSlackMessages().length, 1, "same apply URL should not queue a second main alert");
    assert.equal(repeated.manualAttentionIncidents?.find((item) => item.status === "active")?.repeatCount, 2);

    await recordBrowserManualAttention({
      title: "Just a moment...",
      reason: "captcha_or_security_challenge",
      now: new Date("2026-06-10T00:02:00.000Z"),
    });
    assert.equal(getQueuedSlackMessages().length, 1, "generic browser-check detection should collapse into the active incident");

    const globalDuplicateStatus = await postPrepareDraftStatus(
      {
        thread: null,
        heading: "Draft preparation paused.",
        diagnostics: baseDiagnostics(),
      },
      {
        postWebhookMessage: async () => {
          throw new Error("duplicate worker handoff should not post");
        },
      },
    );
    assert.equal(globalDuplicateStatus, "skipped", "worker/global browser-check handoff should suppress duplicate channel post");

    let connectsPostCount = 0;
    const connectsDuplicateStatus = await postPrepareDraftStatus(
      {
        thread: null,
        heading: "Draft preparation paused.",
        diagnostics: baseDiagnostics({
          state: "connects_not_verified",
          fieldVerification: [
            { field: "requiredConnects", status: "attempted_unverified", detail: "Required Connects are still unknown." },
            { field: "finalSubmit", status: "skipped_by_strategy", detail: "Final submit/send button was intentionally not clicked." },
          ],
          unverifiedFields: ["requiredConnects"],
        }),
      },
      {
        postWebhookMessage: async () => {
          connectsPostCount += 1;
          return true;
        },
      },
    );
    assert.equal(connectsDuplicateStatus, "posted", "Connects-not-verified handoff is separate from a browser-check incident.");
    assert.equal(connectsPostCount, 1, "Connects-not-verified handoff should still post exactly once when it is the actual state.");
    assert.equal(shouldSuppressBrowserManualAttentionChannelPost({ actionId: 11, jobId: "manual:upwork-a", url: urlA, reason: "captcha_or_security_challenge" }), true);

    await recordBrowserManualAttention({
      actionId: 12,
      jobId: "manual:upwork-b",
      url: urlB,
      title: "Just a moment...",
      reason: "captcha_or_security_challenge",
      now: new Date("2026-06-10T00:03:00.000Z"),
    });
    assert.equal(getQueuedSlackMessages().length, 2, "different job/apply URL can create a separate browser-check alert");

    markBrowserChallengeResolved(11);
    await recordBrowserManualAttention({
      actionId: 11,
      jobId: "manual:upwork-a",
      url: urlA,
      title: "Just a moment...",
      reason: "captcha_or_security_challenge",
      now: new Date("2026-06-10T00:04:00.000Z"),
    });
    assert.equal(getQueuedSlackMessages().length, 3, "resolved then reblocked browser-check incident can alert again");

    clearBrowserManualAttention();
  } finally {
    closeDb();
    cleanupPath(tempDir);
  }
}

run()
  .then(() => console.log("browser incident dedupe tests passed"))
  .catch((error) => {
    console.error(`browser incident dedupe tests failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
