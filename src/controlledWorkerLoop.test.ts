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
  } = require("./db") as {
    closeDb: () => void;
    enqueueBrowserAction: (input: { jobId: string; actionType: string; payload: Record<string, unknown> }) => number;
    getBrowserActionById: (id: number) => { status: string } | null;
    listBrowserActions: (status?: string | null, limit?: number) => Array<{ id: number }>;
    updateBrowserActionStatus: (id: number, status: string, lastError?: string | null) => void;
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
    }>;
  };

  function clearPending(): void {
  for (const status of ["pending", "paused", "failed"] as const) {
    for (const action of listBrowserActions(status, 500)) {
      updateBrowserActionStatus(action.id, "cancelled", "test cleanup");
    }
  }
}

  try {
  clearPending();

  const empty = await runControlledWorkerLoop({ maxActions: 2, dryRun: true });
  assert.equal(empty.stoppedReason, "queue_empty");

  const activeId = enqueueBrowserAction({ jobId: "cw:test:active", actionType: "capture_job_from_url", payload: { url: "https://www.upwork.com/jobs/~active" } });
  const queuedBehindActiveId = enqueueBrowserAction({ jobId: "cw:test:behind-active", actionType: "capture_job_from_url", payload: { url: "https://www.upwork.com/jobs/~behind" } });
  updateBrowserActionStatus(activeId, "in_progress", "active browser work");
  const activeBlocked = await runControlledWorkerLoop({ maxActions: 2, dryRun: true });
  assert.equal(activeBlocked.stoppedReason, "browser_action_in_progress", "controlled worker should not start another browser action while one is active");
  assert.equal(getBrowserActionById(queuedBehindActiveId)?.status, "pending", "queued work should remain pending behind active browser work");
  updateBrowserActionStatus(activeId, "cancelled", "continue test");
  updateBrowserActionStatus(queuedBehindActiveId, "cancelled", "continue test");

  const id1 = enqueueBrowserAction({ jobId: "cw:test:1", actionType: "capture_job_from_url", payload: { url: "https://www.upwork.com/jobs/~1" } });
  const id2 = enqueueBrowserAction({ jobId: "cw:test:2", actionType: "capture_job_from_url", payload: { url: "https://www.upwork.com/jobs/~2" } });
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

  const unavailableId = enqueueBrowserAction({ jobId: "cw:test:unavailable", actionType: "capture_job_from_url", payload: { url: "https://www.upwork.com/jobs/~unavailable" } });
  const laterId = enqueueBrowserAction({ jobId: "cw:test:later", actionType: "capture_job_from_url", payload: { url: "https://www.upwork.com/jobs/~later" } });
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

  const challengeId = enqueueBrowserAction({ jobId: "cw:test:challenge", actionType: "capture_job_from_url", payload: { url: "https://www.upwork.com/jobs/~challenge" } });
  const afterChallengeId = enqueueBrowserAction({ jobId: "cw:test:after-challenge", actionType: "capture_job_from_url", payload: { url: "https://www.upwork.com/jobs/~afterchallenge" } });
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
  updateBrowserActionStatus(challengeId, "cancelled", "test cleanup");
  updateBrowserActionStatus(afterChallengeId, "cancelled", "test cleanup");

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
