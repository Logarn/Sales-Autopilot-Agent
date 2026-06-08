import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

function cleanupPath(path: string): void {
  if (existsSync(path)) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

async function run(): Promise<void> {
  const tempDir = resolve(process.cwd(), "data/.tmp-controlled-worker-loop");
  const tempDb = resolve(tempDir, "jobs.db");
  cleanupPath(tempDir);
  process.env.DB_PATH = tempDb;

	  const {
	    closeDb,
	    enqueueBrowserAction,
	    getBrowserActionById,
	    listBrowserActions,
	    updateBrowserActionStatus,
	    mergeBrowserActionPayload,
	  } = require("./db") as {
	    closeDb: () => void;
	    enqueueBrowserAction: (input: { jobId: string; actionType: string; payload: Record<string, unknown> }) => number;
	    getBrowserActionById: (id: number) => { id: number; status: string; payload: Record<string, unknown> } | null;
	    listBrowserActions: (status?: string | null, limit?: number) => Array<{ id: number }>;
	    updateBrowserActionStatus: (id: number, status: string, lastError?: string | null) => void;
	    mergeBrowserActionPayload: (id: number, patch: Record<string, unknown>) => unknown;
	  };
	  const {
	    clearBrowserManualAttention,
	    listBrowserChallengeQuarantines,
	    recordBrowserManualAttention,
	  } = require("./browserSession") as {
	    clearBrowserManualAttention: (actionId?: number) => unknown;
	    listBrowserChallengeQuarantines: (status?: string) => Array<{ actionId?: number; repeatCount: number; status: string; retryCommand?: string }>;
	    recordBrowserManualAttention: (input: {
	      actionId: number;
	      jobId: string;
	      reason: string;
	      url?: string | null;
	      title?: string | null;
	    }) => Promise<{ quarantinedActions?: Array<{ actionId?: number; repeatCount: number; status: string; retryCommand?: string }> }>;
	  };
  const { runControlledWorkerLoop } = require("./browserWorker") as {
    runControlledWorkerLoop: (input: {
      maxActions?: number;
      dryRun?: boolean;
      allowedActionTypes?: string[];
      processActionOverride?: (action: { id: number }) => Promise<{ slackPostsSucceeded: number; slackPostFailures: number }>;
    }) => Promise<{
      actionsProcessed: number;
      actionsCompleted: number;
      actionsPaused: number;
      stoppedReason: string;
      remainingPendingCount: number;
    }>;
  };

  function clearPending(): void {
  for (const status of ["pending", "paused", "failed"] as const) {
    for (const action of listBrowserActions(status, 500)) {
      updateBrowserActionStatus(action.id, "cancelled", "test cleanup");
    }
  }
}

  function slackCapturePayload(index: number): { url: string; canonicalJobUrl: string; source: "slack_url" } {
    const url = `https://www.upwork.com/jobs/~022060000000000${String(index).padStart(6, "0")}`;
    return { url, canonicalJobUrl: url, source: "slack_url" };
  }

  try {
  clearPending();

  const empty = await runControlledWorkerLoop({ maxActions: 2, dryRun: true });
  assert.equal(empty.stoppedReason, "queue_empty");

  const activeId = enqueueBrowserAction({ jobId: "cw:test:active", actionType: "capture_job_from_url", payload: slackCapturePayload(1) });
  const queuedBehindActiveId = enqueueBrowserAction({ jobId: "cw:test:behind-active", actionType: "capture_job_from_url", payload: slackCapturePayload(2) });
  updateBrowserActionStatus(activeId, "in_progress", "active browser work");
  const activeBlocked = await runControlledWorkerLoop({ maxActions: 2, dryRun: true });
  assert.equal(activeBlocked.stoppedReason, "browser_action_in_progress", "controlled worker should not start another browser action while one is active");
  assert.equal(getBrowserActionById(queuedBehindActiveId)?.status, "pending", "queued work should remain pending behind active browser work");
  updateBrowserActionStatus(activeId, "cancelled", "continue test");
  updateBrowserActionStatus(queuedBehindActiveId, "cancelled", "continue test");

  const id1 = enqueueBrowserAction({ jobId: "cw:test:1", actionType: "capture_job_from_url", payload: slackCapturePayload(3) });
  const id2 = enqueueBrowserAction({ jobId: "cw:test:2", actionType: "capture_job_from_url", payload: slackCapturePayload(4) });
  const id3 = enqueueBrowserAction({ jobId: "cw:test:3", actionType: "open_job", payload: { url: "https://www.upwork.com/jobs/~3" } });

  const limited = await runControlledWorkerLoop({ maxActions: 2, dryRun: true, allowedActionTypes: ["capture_job_from_url"] });
  assert.equal(limited.actionsProcessed, 1);
  assert.equal(limited.actionsPaused, 1);
  assert.equal(limited.stoppedReason, "manual_attention_required");

  const a1 = getBrowserActionById(id1);
  const a2 = getBrowserActionById(id2);
  const a3 = getBrowserActionById(id3);
  assert.equal(a1?.status, "paused");
  assert.equal(a2?.status, "pending");
  assert.equal(a3?.status, "pending", "disallowed action type should stay pending");

  updateBrowserActionStatus(id1, "cancelled", "continue test");
  updateBrowserActionStatus(id2, "cancelled", "continue test");
  const onlyOpenJob = await runControlledWorkerLoop({ maxActions: 1, dryRun: true, allowedActionTypes: ["open_job"] });
  assert.equal(onlyOpenJob.actionsProcessed, 1);
  assert.equal(onlyOpenJob.actionsPaused, 1);
  assert.equal(getBrowserActionById(id3)?.status, "paused");

  updateBrowserActionStatus(id3, "cancelled", "continue test");
  const prepareId = enqueueBrowserAction({ jobId: "cw:test:prepare", actionType: "prepare_application_review", payload: { url: "https://www.upwork.com/jobs/~prepare" } });
  const prepare = await runControlledWorkerLoop({ maxActions: 1, dryRun: true, allowedActionTypes: ["prepare_application_review"] });
  assert.equal(prepare.actionsProcessed, 1, "controlled worker should process explicitly allowed prepare actions");
  assert.equal(prepare.actionsPaused, 1, "invalid test prepare action should pause safely instead of being skipped");
  assert.equal(getBrowserActionById(prepareId)?.status, "paused");
  updateBrowserActionStatus(prepareId, "cancelled", "test cleanup");

  const unknownUrl = slackCapturePayload(9).url;
  const unknownSourceId = enqueueBrowserAction({ jobId: "cw:test:unknown-source", actionType: "capture_job_from_url", payload: { url: unknownUrl, canonicalJobUrl: unknownUrl } });
  const unknownSource = await runControlledWorkerLoop({ maxActions: 1, dryRun: true, allowedActionTypes: ["capture_job_from_url"] });
  assert.equal(unknownSource.actionsProcessed, 1, "unknown-source capture should be inspected by the worker");
  assert.equal(unknownSource.actionsPaused, 0, "unknown-source capture should fail without manual browser attention");
  assert.equal(unknownSource.stoppedReason, "completed_batch");
  assert.equal(getBrowserActionById(unknownSourceId)?.status, "failed", "unknown-source capture should be failed before browser work");
  updateBrowserActionStatus(unknownSourceId, "cancelled", "test cleanup");

  const unavailableId = enqueueBrowserAction({ jobId: "cw:test:unavailable", actionType: "capture_job_from_url", payload: slackCapturePayload(5) });
  const laterId = enqueueBrowserAction({ jobId: "cw:test:later", actionType: "capture_job_from_url", payload: slackCapturePayload(6) });
  const nonCritical = await runControlledWorkerLoop({
    maxActions: 2,
    dryRun: true,
    allowedActionTypes: ["capture_job_from_url"],
    processActionOverride: async (action) => {
      if (action.id === unavailableId) {
        updateBrowserActionStatus(action.id, "failed", "source_context_unavailable: unreadable job card");
      } else {
        updateBrowserActionStatus(action.id, "completed", "test completed");
      }
      return { slackPostsSucceeded: 0, slackPostFailures: 0 };
    },
  });
  assert.equal(nonCritical.actionsProcessed, 2, "worker should continue after non-critical capture failure");
  assert.equal(nonCritical.actionsCompleted, 1);
  assert.equal(nonCritical.actionsPaused, 0);
  assert.equal(nonCritical.stoppedReason, "completed_batch");
  assert.equal(getBrowserActionById(unavailableId)?.status, "failed");
  assert.equal(getBrowserActionById(laterId)?.status, "completed");

  const challengeId = enqueueBrowserAction({ jobId: "cw:test:challenge", actionType: "capture_job_from_url", payload: slackCapturePayload(7) });
  const afterChallengeId = enqueueBrowserAction({ jobId: "cw:test:after-challenge", actionType: "capture_job_from_url", payload: slackCapturePayload(8) });
	  const trueChallenge = await runControlledWorkerLoop({
    maxActions: 2,
    dryRun: true,
    allowedActionTypes: ["capture_job_from_url"],
    processActionOverride: async (action) => {
      updateBrowserActionStatus(action.id, "paused", "Detected state: captcha_or_security_challenge.");
      return { slackPostsSucceeded: 0, slackPostFailures: 0 };
    },
  });
  assert.equal(trueChallenge.actionsProcessed, 1, "worker should stop on true manual-attention pause");
  assert.equal(trueChallenge.actionsPaused, 1);
  assert.equal(trueChallenge.stoppedReason, "manual_attention_required");
  assert.equal(getBrowserActionById(challengeId)?.status, "paused");
	  assert.equal(getBrowserActionById(afterChallengeId)?.status, "pending", "later action should remain pending after true challenge pause");
	  await recordBrowserManualAttention({
	    actionId: challengeId,
	    jobId: "cw:test:challenge",
	    reason: "captcha_or_security_challenge",
	    url: "https://www.upwork.com/?__cf_chl_tk=test",
	    title: "Just a moment...",
	  });
	  const repeatedRecord = await recordBrowserManualAttention({
	    actionId: challengeId,
	    jobId: "cw:test:challenge",
	    reason: "captcha_or_security_challenge",
	    url: "https://www.upwork.com/?__cf_chl_tk=test",
	    title: "Just a moment...",
	  });
	  const repeatedQuarantine = repeatedRecord.quarantinedActions?.find((item) => item.actionId === challengeId);
	  assert.equal(repeatedQuarantine?.repeatCount, 2, "same action challenge should increment quarantine repeat count for backoff");
	  mergeBrowserActionPayload(challengeId, {
	    challengeQuarantine: {
	      actionId: challengeId,
	      challengeType: "captcha_or_security_challenge",
	      status: "paused",
	      retryCommand: repeatedQuarantine?.retryCommand,
	      repeatCount: repeatedQuarantine?.repeatCount,
	      backoffUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
	    },
	  });
	  const challengePayload = getBrowserActionById(challengeId)?.payload.challengeQuarantine as { backoffUntil?: string; repeatCount?: number } | undefined;
	  assert.equal(challengePayload?.repeatCount, 2);
	  assert(challengePayload?.backoffUntil, "repeated challenge should stamp a per-action backoff window");
	  assert.equal(listBrowserChallengeQuarantines("paused").some((item) => item.actionId === challengeId), true, "paused quarantine should be queryable");
	  clearBrowserManualAttention(challengeId);
	  updateBrowserActionStatus(challengeId, "cancelled", "test cleanup");
  updateBrowserActionStatus(afterChallengeId, "cancelled", "test cleanup");

  const seq1 = enqueueBrowserAction({ jobId: "cw:test:seq-1", actionType: "prepare_application_review", payload: { url: "https://www.upwork.com/jobs/~seq1" } });
  const seq2 = enqueueBrowserAction({ jobId: "cw:test:seq-2", actionType: "prepare_application_review", payload: { url: "https://www.upwork.com/jobs/~seq2" } });
  const seq3 = enqueueBrowserAction({ jobId: "cw:test:seq-3", actionType: "prepare_application_review", payload: { url: "https://www.upwork.com/jobs/~seq3" } });
  const processedSequentially: number[] = [];
  const processSequentially = async (action: { id: number }) => {
    processedSequentially.push(action.id);
    updateBrowserActionStatus(action.id, "completed", "test completed");
    return { slackPostsSucceeded: 0, slackPostFailures: 0 };
  };
  const sequentialFirst = await runControlledWorkerLoop({
    maxActions: 1,
    dryRun: true,
    allowedActionTypes: ["prepare_application_review"],
    processActionOverride: processSequentially,
  });
  assert.equal(sequentialFirst.actionsProcessed, 1, "first controlled pass should process one queued approval");
  assert.equal(sequentialFirst.remainingPendingCount, 2, "two queued approvals should remain after the first pass");
  assert.equal(getBrowserActionById(seq1)?.status, "completed");
  assert.equal(getBrowserActionById(seq2)?.status, "pending");
  assert.equal(getBrowserActionById(seq3)?.status, "pending");

  const sequentialSecond = await runControlledWorkerLoop({
    maxActions: 1,
    dryRun: true,
    allowedActionTypes: ["prepare_application_review"],
    processActionOverride: processSequentially,
  });
  assert.equal(sequentialSecond.actionsProcessed, 1, "second controlled pass should process one queued approval");
  assert.equal(sequentialSecond.remainingPendingCount, 1, "one queued approval should remain after the second pass");
  assert.equal(getBrowserActionById(seq2)?.status, "completed");
  assert.equal(getBrowserActionById(seq3)?.status, "pending");

  const sequentialThird = await runControlledWorkerLoop({
    maxActions: 1,
    dryRun: true,
    allowedActionTypes: ["prepare_application_review"],
    processActionOverride: processSequentially,
  });
  assert.equal(sequentialThird.actionsProcessed, 1, "third controlled pass should process the final queued approval");
  assert.equal(sequentialThird.remainingPendingCount, 0, "no queued approvals should remain after the third pass");
  assert.deepEqual(processedSequentially, [seq1, seq2, seq3], "queued approvals should be processed one-by-one in FIFO order");

  console.log("controlled worker loop tests passed");
  } finally {
    closeDb();
    cleanupPath(tempDir);
  }
}

run().catch((error) => {
  console.error(`controlled worker loop tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
