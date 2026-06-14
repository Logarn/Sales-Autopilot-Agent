import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function runTests(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-slack-promise-notifications/jobs.db");
  if (existsSync(dirname(tempDb))) {
    rmSync(dirname(tempDb), { recursive: true, force: true });
  }
  process.env.DB_PATH = tempDb;
  process.env.SLACK_COPY_LLM_ENABLED = "false";

  const db = require("./db") as typeof import("./db");
  const notifications = require("./slackPromiseNotifications") as typeof import("./slackPromiseNotifications");
  const workflow = require("./slackWorkflowContext") as typeof import("./slackWorkflowContext");

  const channelId = "C_PROMISE";
  const threadTs = "1700000000.000";
  const draft = {
    jobId: "job-1",
    status: "draft",
    fitScore: 88,
    fitReasons: ["Strong Klaviyo match"],
    redFlags: [],
    suggestedBid: "$95/hr",
    suggestedConnects: 12,
    suggestedBoostConnects: 4,
    connectsWarnings: [],
    selectedPortfolioItems: [],
    proposalQuality: { score: 90, issues: [], positiveSignals: [], wordCount: 20 },
    proposalText: "I can help tighten the retention flows and map the next Klaviyo wins.",
    generatedAt: "2026-06-14T00:00:00.000Z",
    proposalVersion: 1,
  } as any;
  const job = {
    id: "job-1",
    title: "Klaviyo retention cleanup",
    url: "https://www.upwork.com/jobs/~012345678901234567",
  } as any;
  const proofPlan = {
    files: ["retention-audit.pdf"],
    portfolioHighlights: ["Retention audit"],
    certificates: [],
    mentionOnly: ["Klaviyo account cleanup"],
    unavailableOnPage: false,
  };

  db.recordSlackWorkflowPromise({
    channelId,
    threadTs,
    type: "draft_preview",
    text: "I will post the draft here once it is ready.",
    workflowState: "draft_requested",
    requestedByUserText: "send the draft when ready",
    draftRequested: true,
  });

  const posted: Array<{ channel: string; threadTs: string; text: string }> = [];
  const draftPlan = {
    notificationType: "draft_ready" as const,
    workflowState: "draft_ready" as const,
    stateKey: notifications.slackPromiseStateKey(["draft_ready", draft.jobId, draft.proposalVersion, draft.generatedAt]),
    text: notifications.buildDraftProofPlanNotificationText({ job, draft, proofPlan, heading: "Draft is ready." }),
    promiseStatus: "fulfilled" as const,
  };

  const first = await notifications.postSlackPromiseNotification({
    channelId,
    threadTs,
    plan: draftPlan,
    postThreadMessage: async (target) => {
      posted.push(target);
      return true;
    },
  });
  assert(first.posted && !first.duplicate, "first draft-ready notification should post");
  assert(posted.length === 1, "first draft-ready notification should call the Slack mock once");
  assert(posted[0].channel === channelId && posted[0].threadTs === threadTs, "notification should post in the mapped Slack thread");
  assert(!posted[0].text.includes("browser_actions") && !posted[0].text.includes("workflow_state"), "normal notification text should hide raw internals");
  assert(posted[0].text.includes("Final submit remains manual."), "notification should preserve manual-submit boundary");
  assert(db.getSlackWorkflowState(channelId, threadTs)?.latestAgentPromise?.status === "fulfilled", "draft promise should be marked fulfilled");

  const duplicate = await notifications.postSlackPromiseNotification({
    channelId,
    threadTs,
    plan: draftPlan,
    postThreadMessage: async (target) => {
      posted.push(target);
      return true;
    },
  });
  assert(duplicate.duplicate && !duplicate.posted, "duplicate draft-ready state should be suppressed");
  assert(posted.length === 1, "duplicate draft-ready state should not post again");

  const retryPlan = {
    ...draftPlan,
    stateKey: notifications.slackPromiseStateKey(["draft_ready", draft.jobId, "retry-after-failure"]),
    text: `${draftPlan.text}\nRetry marker.`,
  };
  const failedAttempt = await notifications.postSlackPromiseNotification({
    channelId,
    threadTs,
    plan: retryPlan,
    postThreadMessage: async () => false,
  });
  assert(failedAttempt.status === "failed" && !failedAttempt.posted, "failed Slack post should be recorded as failed");
  const retryAttempt = await notifications.postSlackPromiseNotification({
    channelId,
    threadTs,
    plan: retryPlan,
    postThreadMessage: async (target) => {
      posted.push(target);
      return true;
    },
  });
  assert(retryAttempt.posted && !retryAttempt.duplicate, "failed notification state should be retryable");
  assert(posted.length === 2, "retry after failed post should call the Slack mock once");

  db.recordSlackWorkflowPromise({
    channelId,
    threadTs: "capture-failed.001",
    type: "capture_draft_proof_plan",
    text: "I will come back with the draft and proof plan.",
    workflowState: "capture_queued",
    requestedByUserText: "here is a job URL",
    draftRequested: true,
  });
  const blockerPlan = {
    notificationType: "capture_blocked" as const,
    workflowState: "capture_failed" as const,
    stateKey: notifications.slackPromiseStateKey(["capture_blocked", "job-2", "source_context_unavailable"]),
    text: notifications.buildBlockerNotificationText({
      fallbackLabel: "https://www.upwork.com/jobs/~022222222222222222",
      reason: "I could not read enough job content to score or draft safely.",
      nextSafeAction: "Reply \"retry capture\" after the page is readable, or send the listing link again.",
    }),
    promiseStatus: "blocked" as const,
    blocker: "I could not read enough job content to score or draft safely.",
  };
  const blockerPosted = await notifications.postSlackPromiseNotification({
    channelId,
    threadTs: "capture-failed.001",
    plan: blockerPlan,
    postThreadMessage: async (target) => {
      posted.push(target);
      return true;
    },
  });
  assert(blockerPosted.posted, "capture blocker should post");
  assert(db.getSlackWorkflowState(channelId, "capture-failed.001")?.latestAgentPromise?.status === "blocked", "capture promise should be marked blocked");

  const qaContext = workflow.buildUnifiedSlackJobContext({
    channelId,
    threadTs: "qa-ready.001",
    threadState: { channelId, messageTs: "qa-ready.001", threadTs: "qa-ready.001", upworkUrl: job.url, jobId: job.id, status: "prepared_draft" },
    workflowStateRecord: {
      channelId,
      threadTs: "qa-ready.001",
      workflowState: "draft_requested",
      draftRequested: true,
      prepRequested: true,
      latestAgentPromise: {
        type: "draft_preview",
        status: "pending",
        text: "Older draft promise.",
        createdAt: "2026-06-14T00:00:00.000Z",
      },
      lastUserMessage: null,
      lastAgentReply: null,
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    },
    job,
    draft,
    proofPlan,
    connects: { required: 12, boost: 4, total: 16 },
    applicationStatus: "prepared_for_qa",
  });
  const selectedQa = notifications.selectPromiseNotificationForContext(qaContext);
  assert(selectedQa?.notificationType === "qa_ready", "newer QA-ready state should supersede stale draft promise notification");

  const debugTrace = notifications.buildSlackWorkflowDebugTrace(channelId, threadTs);
  assert(debugTrace.includes("Promise/state trace:"), "debug trace should include a promise/state header");
  assert(debugTrace.includes("draft_ready"), "debug trace should include notification state history");

  db.closeDb();
}

runTests()
  .then(() => {
    console.log("slack promise notification tests passed");
  })
  .catch((error) => {
    console.error(`slack promise notification tests failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
