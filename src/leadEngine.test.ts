import assert from "node:assert/strict";
import { enqueueBrowserAction, listBrowserActions, updateBrowserActionStatus } from "./db";
import { readLatestState, runLeadEngineCycle } from "./leadEngine";

function cleanup(): void {
  for (const a of listBrowserActions("pending", 1000)) updateBrowserActionStatus(a.id, "cancelled", "cleanup");
  for (const a of listBrowserActions("paused", 1000)) updateBrowserActionStatus(a.id, "cancelled", "cleanup");
}

async function run(): Promise<void> {
  cleanup();

  const empty = await runLeadEngineCycle({ mode: "run_once", dryRun: true });
  assert.equal(empty.mode, "run_once");
  assert.equal(empty.dryRun, true);
  assert.equal(typeof empty.nextSleepMs, "number");
  assert.equal(empty.discoveryRan, false);
  assert.equal(empty.sessionBlocked, false);

  enqueueBrowserAction({ jobId: "ae:test:1", actionType: "capture_job_from_url", payload: { url: "https://www.upwork.com/jobs/~x" } });
  enqueueBrowserAction({ jobId: "ae:test:2", actionType: "prepare_application_review", payload: { url: "https://www.upwork.com/jobs/~y" } });
  const dry = await runLeadEngineCycle({ mode: "run_once", dryRun: true });
  assert(dry.actionsProcessed >= 1, "dry run should preview capture actions");
  assert.equal(dry.discoveryRan, false, "dry run should not run discovery");

  const discoveryFailure = await runLeadEngineCycle(
    { mode: "run_once", dryRun: false },
    {
      getSessionStatus: () => ({ state: "healthy", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 }),
      listActions: () => [],
      runDiscovery: async () => {
        throw new Error("cdp unavailable in test");
      },
      runWorker: async () => ({
        actionsProcessed: 0,
        actionsCompleted: 0,
        actionsPaused: 0,
        actionsSkipped: 0,
        stoppedReason: "queue_empty",
        remainingPendingCount: 0,
      }),
      writeState: () => undefined,
      random: () => 0,
    },
  );
  assert.equal(discoveryFailure.status, "degraded", "one-cycle validation should degrade instead of crashing when discovery is unavailable");
  assert.equal(discoveryFailure.stoppedReason, "discovery_failed");
  assert.match(discoveryFailure.discoveryError ?? "", /cdp unavailable/);

  const blocked = await runLeadEngineCycle(
    { mode: "continuous", dryRun: false },
    {
      getSessionStatus: () => ({ state: "manual_attention_required", updatedAt: new Date().toISOString(), challengeEvents: [], blocked: true, alertCooldownRemainingMs: 0 }),
      listActions: () => [],
      writeState: () => undefined,
      random: () => 0,
    },
  );
  assert.equal(blocked.status, "paused", "scheduler cycle should pause when browser session is blocked");
  assert.equal(blocked.discoveryRan, false, "blocked scheduler cycle should not run discovery");
  assert.equal(blocked.actionsProcessed, 0, "blocked scheduler cycle should not process queue");

  const latest = readLatestState();
  assert(latest && latest.cycleId.length > 0, "latest state should persist");
  cleanup();
  console.log("lead engine tests passed");
}

run().catch((error) => {
  console.error(`lead engine tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
