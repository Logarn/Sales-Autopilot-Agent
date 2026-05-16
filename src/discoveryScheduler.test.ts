import { strict as assert } from "node:assert";
import { computeDiscoveryJitterMs, countPendingCaptureActions, DiscoverySchedulerConfig, runDiscoverySchedulerCycle } from "./discoveryScheduler";
import type { BrowserAction } from "./types";

const config: DiscoverySchedulerConfig = {
  enabled: false,
  jitterMinMs: 480000,
  jitterMaxMs: 840000,
  maxJobsPerRun: 3,
  maxScrollsPerRun: 4,
  skipIfPendingCaptureCountGt: 3,
};

function action(id: number, status: BrowserAction["status"], actionType: BrowserAction["actionType"] = "capture_job_from_url"): BrowserAction {
  return {
    id,
    jobId: `manual:upwork-022055${id}000000000000`,
    actionType,
    status,
    payload: { url: `https://www.upwork.com/jobs/~022055${id}000000000000` },
    attempts: 0,
    lastError: null,
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
  };
}

async function runTests(): Promise<void> {
  assert.equal(computeDiscoveryJitterMs(config, () => 0), 480000);
  assert.equal(computeDiscoveryJitterMs(config, () => 0.999999), 840000);
  for (let i = 0; i < 20; i += 1) {
    const jitter = computeDiscoveryJitterMs(config, () => i / 20);
    assert(jitter >= 480000 && jitter <= 840000, "jitter should stay within configured 8-14 minute window");
  }

  assert.equal(config.enabled, false, "scheduler should be disabled by default in config-shaped defaults");
  assert.equal(countPendingCaptureActions([action(1, "pending"), action(2, "paused"), action(3, "pending", "prepare_application_review")]), 1);

  let discoveryCalls = 0;
  const ok = await runDiscoverySchedulerCycle(config, {
    inspectSession: async () => ({ sessionState: "logged_in", manualAttentionRequired: false, blocked: false }),
    listActions: () => [action(1, "pending"), action(2, "paused")],
    runDiscovery: async (options) => {
      discoveryCalls += 1;
      assert.equal(options.maxJobs, 3, "run should respect max jobs");
      assert.equal(options.maxScrolls, 4, "run should respect max scrolls");
      return {
        ok: true,
        tool: "discovery.best-matches",
        sessionState: "logged_in",
        manualAttentionRequired: false,
        blocked: false,
        jobsFound: 25,
        jobsQueued: 3,
        duplicatesSkipped: 7,
        alreadyHandledSkipped: 0,
        invalidSkipped: 160,
        scrollsPerformed: 1,
        queuedActionIds: [11, 12, 13],
      };
    },
  }, "discovery.run_once", null);
  assert.equal(ok.ok, true);
  assert.equal(ok.runType, "discovery.run_once");
  assert.equal(ok.jobsQueued, 3);
  assert.deepEqual(ok.queuedActionIds, [11, 12, 13]);
  assert.equal(ok.nextRunInMs, null, "run-once exits after one cycle and has no next delay");
  assert.equal(discoveryCalls, 1);

  discoveryCalls = 0;
  const blocked = await runDiscoverySchedulerCycle(config, {
    inspectSession: async () => ({ sessionState: "manual_attention_required", manualAttentionRequired: true, blocked: true }),
    listActions: () => [],
    runDiscovery: async () => { discoveryCalls += 1; throw new Error("should not run discovery when blocked"); },
  });
  assert.equal(blocked.skipped, true);
  assert.equal(blocked.skippedReason, "browser_session_blocked_or_unhealthy");
  assert.equal(discoveryCalls, 0, "blocked session must not run discovery");

  const tooMany = await runDiscoverySchedulerCycle(config, {
    inspectSession: async () => ({ sessionState: "logged_in", manualAttentionRequired: false, blocked: false }),
    listActions: () => [action(1, "pending"), action(2, "pending"), action(3, "pending"), action(4, "pending")],
    runDiscovery: async () => { throw new Error("should not run discovery with too many pending captures"); },
  });
  assert.equal(tooMany.skipped, true);
  assert.equal(tooMany.skippedReason, "too_many_pending_capture_actions");
  assert.equal(tooMany.pendingCaptureCount, 4);

  let firstResolve!: (value: any) => void;
  const firstRun = runDiscoverySchedulerCycle(config, {
    inspectSession: async () => ({ sessionState: "logged_in", manualAttentionRequired: false, blocked: false }),
    listActions: () => [],
    runDiscovery: async () => new Promise((resolve) => { firstResolve = resolve; }),
  });
  const overlap = await runDiscoverySchedulerCycle(config, {
    inspectSession: async () => ({ sessionState: "logged_in", manualAttentionRequired: false, blocked: false }),
    listActions: () => [],
    runDiscovery: async () => { throw new Error("overlap should not run discovery"); },
  });
  assert.equal(overlap.skippedReason, "run_already_in_progress");
  assert.equal(overlap.lockAcquired, false);
  firstResolve({
    ok: true,
    tool: "discovery.best-matches",
    sessionState: "logged_in",
    manualAttentionRequired: false,
    blocked: false,
    jobsFound: 0,
    jobsQueued: 0,
    duplicatesSkipped: 0,
    alreadyHandledSkipped: 0,
    invalidSkipped: 0,
    scrollsPerformed: 0,
  });
  await firstRun;

  console.log("discovery scheduler tests passed");
}

void runTests();
