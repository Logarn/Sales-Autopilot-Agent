import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import type { BrowserAction } from "./types";
import {
  canonicalCaptureJobId,
  captureThreadTargetsForAction,
  getCaptureWaiters,
  isStalePendingCaptureAction,
  withCaptureWaiter,
} from "./captureActionOwnership";

async function runTests(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-slack-capture-ownership/jobs.db");
  if (existsSync(dirname(tempDb))) {
    rmSync(dirname(tempDb), { recursive: true, force: true });
  }
  process.env.DB_PATH = tempDb;
  process.env.SLACK_COPY_LLM_ENABLED = "false";

  const db = require("./db") as typeof import("./db");
  const slackSocket = require("./slackSocket") as typeof import("./slackSocket");
  const browserCapture = require("./browserCapture") as typeof import("./browserCapture");

  const liveJobId = "022065102278412221125";
  const liveUrl = `https://www.upwork.com/jobs/~${liveJobId}`;
  const canonical = `manual:upwork-${liveJobId}`;
  assert.equal(canonicalCaptureJobId(liveJobId), canonical, "raw Upwork id should map to manual canonical job id");
  assert.equal(canonicalCaptureJobId(canonical), canonical, "manual job id should remain canonical");
  assert.equal(canonicalCaptureJobId(liveUrl), canonical, "Upwork URL should map to the same canonical job id");

  const oldPending = db.enqueueBrowserActionDeduped({
    jobId: canonical,
    actionType: "capture_job_from_url",
    payload: {
      ...browserCapture.buildCaptureActionPayload(liveUrl, "C_TEST", "1781395954.323659", "1781395954.323659", {
        originalUrl: liveUrl,
        canonicalJobUrl: liveUrl,
      }),
      sourceQuery: "slack_url",
    },
  });
  const retry = slackSocket.queueCaptureFromSlackUrl({
    channelId: "C_TEST",
    messageTs: "1781444706.703349",
    threadTs: "1781444706.703349",
    text: liveUrl,
    source: "slack_retry_capture",
  });
  assert(retry, "retry capture should parse the URL");
  assert.equal(retry.ownershipStatus, "attached_pending", "retry in thread B should attach to thread A pending action, not falsely requeue");
  assert.equal(retry.action.id, oldPending.id, "attached retry should reuse the existing pending action");
  const pendingAfterAttach = db.getBrowserActionById(oldPending.id);
  assert(pendingAfterAttach, "pending action should still exist");
  assert(getCaptureWaiters(pendingAfterAttach.payload).some((waiter) => waiter.threadTs === "1781444706.703349"), "thread B should be registered as a capture waiter");

  const completedJobId = "022065102278412221126";
  const completedUrl = `https://www.upwork.com/jobs/~${completedJobId}`;
  const completedCanonical = `manual:upwork-${completedJobId}`;
  const completed = db.enqueueBrowserActionDeduped({
    jobId: completedCanonical,
    actionType: "capture_job_from_url",
    payload: {
      ...browserCapture.buildCaptureActionPayload(completedUrl, "C_TEST", "111.000", "111.000", {
        originalUrl: completedUrl,
        canonicalJobUrl: completedUrl,
      }),
      sourceQuery: "slack_url",
    },
  });
  db.updateBrowserActionStatus(completed.id, "completed", "Capture completed in older thread.");
  const reuseCompleted = slackSocket.queueCaptureFromSlackUrl({
    channelId: "C_TEST",
    messageTs: "222.000",
    threadTs: "222.000",
    text: completedUrl,
  });
  assert(reuseCompleted, "completed capture reuse should return a queue result");
  assert.equal(reuseCompleted.ownershipStatus, "attached_completed", "completed capture should be reused instead of duplicated");
  assert.equal(reuseCompleted.action.id, completed.id, "completed capture reuse should reference the completed action");
  assert.equal(db.listBrowserActions(null, 1000).filter((action) => action.jobId === completedCanonical && action.actionType === "capture_job_from_url").length, 1, "completed capture reuse should not create a duplicate capture action");
  assert.equal(db.getSlackThreadStateByThreadTs("C_TEST", "222.000")?.jobId, completedCanonical, "current thread should be remapped to the completed capture job id");

  const staleJobId = "022065102278412221127";
  const staleUrl = `https://www.upwork.com/jobs/~${staleJobId}`;
  const staleCanonical = `manual:upwork-${staleJobId}`;
  const stale = db.enqueueBrowserActionDeduped({
    jobId: staleCanonical,
    actionType: "capture_job_from_url",
    payload: {
      ...browserCapture.buildCaptureActionPayload(staleUrl, "C_TEST", "333.000", "333.000", {
        originalUrl: staleUrl,
        canonicalJobUrl: staleUrl,
      }),
      sourceQuery: "slack_url",
    },
  });
  const raw = new Database(tempDb);
  raw.prepare("UPDATE browser_actions SET updated_at = ? WHERE id = ?").run("2026-06-13T00:00:00.000Z", stale.id);
  raw.close();
  const staleAction = db.getBrowserActionById(stale.id);
  assert(staleAction && isStalePendingCaptureAction(staleAction), "test setup should create a stale pending action");
  const replaced = slackSocket.queueCaptureFromSlackUrl({
    channelId: "C_TEST",
    messageTs: "444.000",
    threadTs: "444.000",
    text: staleUrl,
    source: "slack_retry_capture",
  });
  assert(replaced, "stale pending replacement should return a queue result");
  assert.equal(replaced.ownershipStatus, "replaced_stale", "stale pending capture should be cancelled and replaced");
  assert.notEqual(replaced.action.id, stale.id, "replacement should create a fresh current-thread action");
  assert.equal(db.getBrowserActionById(stale.id)?.status, "cancelled", "stale pending action should be cancelled");

  const waiterPayload = withCaptureWaiter({
    url: liveUrl,
    channelId: "C_TEST",
    messageTs: "primary.000",
    threadTs: "primary.000",
  }, {
    channelId: "C_TEST",
    messageTs: "waiter.000",
    threadTs: "waiter.000",
    upworkUrl: liveUrl,
    canonicalJobId: canonical,
    source: "test",
    draftRequested: true,
    attachedAt: "2026-06-14T00:00:00.000Z",
  });
  const targets = captureThreadTargetsForAction({
    id: 999,
    jobId: canonical,
    actionType: "capture_job_from_url",
    status: "completed",
    payload: waiterPayload,
    attempts: 1,
    lastError: null,
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
  } as BrowserAction);
  assert.deepEqual(targets.map((target) => target.threadTs), ["primary.000", "waiter.000"], "browser worker fulfillment should target primary and subscribed waiter threads once");

  db.closeDb();
}

runTests()
  .then(() => {
    console.log("slack capture ownership tests passed");
  })
  .catch((error) => {
    console.error(`slack capture ownership tests failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });

