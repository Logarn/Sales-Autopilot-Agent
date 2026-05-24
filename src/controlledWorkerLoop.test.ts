import assert from "node:assert/strict";
import { enqueueBrowserAction, getBrowserActionById, listBrowserActions, updateBrowserActionStatus } from "./db";
import { runControlledWorkerLoop } from "./browserWorker";

function clearPending(): void {
  const pending = listBrowserActions("pending", 500);
  for (const action of pending) {
    updateBrowserActionStatus(action.id, "cancelled", "test cleanup");
  }
}

async function run(): Promise<void> {
  clearPending();

  const empty = await runControlledWorkerLoop({ maxActions: 2, dryRun: true });
  assert.equal(empty.stoppedReason, "queue_empty");

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

  console.log("controlled worker loop tests passed");
}

run().catch((error) => {
  console.error(`controlled worker loop tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
