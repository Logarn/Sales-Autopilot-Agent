import assert from "node:assert/strict";
import { enqueueBrowserAction, listBrowserActions, updateBrowserActionStatus } from "./db";
import { readLatestState, runLeadEngineCycle } from "./leadEngine";
import { BrowserSessionStatus } from "./browserSession";
import { BrowserSessionInspection, classifyBrowserSessionSnapshot } from "./browserSessionInspector";
import { readHeartbeat } from "./heartbeat";

function cleanup(): void {
  for (const a of listBrowserActions("pending", 1000)) updateBrowserActionStatus(a.id, "cancelled", "cleanup");
  for (const a of listBrowserActions("paused", 1000)) updateBrowserActionStatus(a.id, "cancelled", "cleanup");
}

function sessionStatus(overrides: Partial<BrowserSessionStatus> = {}): BrowserSessionStatus {
  return {
    state: "healthy",
    updatedAt: new Date().toISOString(),
    challengeEvents: [],
    blocked: false,
    alertCooldownRemainingMs: 0,
    ...overrides,
  };
}

function workerEmpty() {
  return {
    actionsProcessed: 0,
    actionsCompleted: 0,
    actionsPaused: 0,
    actionsSkipped: 0,
    slackPostsSucceeded: 0,
    slackPostFailures: 0,
    stoppedReason: "queue_empty",
    remainingPendingCount: 0,
  };
}

function discoveryOk() {
  return {
    ok: true,
    runType: "discovery.run_once" as const,
    sessionState: "logged_in",
    jobsFound: 1,
    jobsQueued: 1,
    duplicatesSkipped: 0,
    alreadyHandledSkipped: 0,
    invalidSkipped: 0,
    scrollsPerformed: 0,
    nextRunInMs: null,
    lockAcquired: true,
  };
}

function duplicateOnlyDiscovery() {
  return {
    ok: false,
    runType: "discovery.run_once" as const,
    sessionState: "logged_in",
    jobsFound: 25,
    jobsQueued: 0,
    duplicatesSkipped: 25,
    alreadyHandledSkipped: 0,
    invalidSkipped: 0,
    scrollsPerformed: 1,
    nextRunInMs: null,
    lockAcquired: true,
  };
}

function usableFeedInspection(): BrowserSessionInspection {
  return classifyBrowserSessionSnapshot({
    currentUrl: "https://www.upwork.com/nx/find-work/best-matches",
    title: "Upwork",
    textExcerpt: "Jobs you might like Best Matches Most Recent Klaviyo retention strategist Shopify lifecycle marketer Payment verified Proposals: 10 to 15 Hourly Posted 3 hours ago",
    jobLinkCount: 215,
  }, { state: "manual_attention_required", blocked: true, reason: "captcha_or_security_challenge" });
}

function challengeInspection(): BrowserSessionInspection {
  return classifyBrowserSessionSnapshot({
    currentUrl: "https://www.upwork.com/?__cf_chl_tk=abc",
    title: "Challenge - Upwork",
    textExcerpt: "Checking if the site connection is secure Cloudflare CAPTCHA",
  }, { state: "healthy", blocked: false });
}

async function run(): Promise<void> {
  cleanup();

  const empty = await runLeadEngineCycle({ mode: "run_once", dryRun: true }, {
    getSessionStatus: () => sessionStatus(),
  });
  assert.equal(empty.mode, "run_once");
  assert.equal(empty.dryRun, true);
  assert.equal(typeof empty.nextSleepMs, "number");
  assert.equal(empty.discoveryRan, false);
  assert.equal(empty.sessionBlocked, false);

  enqueueBrowserAction({ jobId: "ae:test:1", actionType: "capture_job_from_url", payload: { url: "https://www.upwork.com/jobs/~x" } });
  enqueueBrowserAction({ jobId: "ae:test:2", actionType: "prepare_application_review", payload: { url: "https://www.upwork.com/jobs/~y" } });
  const dry = await runLeadEngineCycle({ mode: "run_once", dryRun: true }, {
    getSessionStatus: () => sessionStatus(),
  });
  assert.equal(dry.actionsProcessed, 2, "dry run should preview both capture and prepare actions");
  assert.equal(dry.discoveryRan, false, "dry run should not run discovery");

  const discoveryFailure = await runLeadEngineCycle(
    { mode: "run_once", dryRun: false },
    {
      getSessionStatus: () => sessionStatus(),
      inspectLiveSession: async () => usableFeedInspection(),
      listActions: () => [],
      runDiscovery: async () => {
        throw new Error("cdp unavailable in test");
      },
      runWorker: async () => ({
        actionsProcessed: 0,
        actionsCompleted: 0,
        actionsPaused: 0,
        actionsSkipped: 0,
        slackPostsSucceeded: 0,
        slackPostFailures: 0,
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

  const duplicateOnly = await runLeadEngineCycle(
    { mode: "run_once", dryRun: false },
    {
      getSessionStatus: () => sessionStatus(),
      inspectLiveSession: async () => usableFeedInspection(),
      listActions: () => [],
      runDiscovery: async () => duplicateOnlyDiscovery(),
      runWorker: async () => workerEmpty(),
      writeState: () => undefined,
      random: () => 0,
    },
  );
  assert.equal(duplicateOnly.status, "ok", "duplicate-only discovery should be an idle success, not degraded");
  assert.equal(duplicateOnly.stoppedReason, "all_duplicates");
  assert.equal(duplicateOnly.discoveryRan, true);
  assert.equal(duplicateOnly.jobsFound, 25);
  assert.equal(duplicateOnly.jobsQueued, 0);
  assert.equal(duplicateOnly.duplicatesSkipped, 25);
  assert.equal(duplicateOnly.actionsProcessed, 0);
  const duplicateOnlyHeartbeat = readHeartbeat("lead-engine");
  assert.equal(duplicateOnlyHeartbeat?.status, "success", "duplicate-only discovery should record a successful heartbeat");
  assert.equal(duplicateOnlyHeartbeat?.lastError, null, "duplicate-only discovery should clear the previous lead-engine heartbeat error");
  assert.equal(duplicateOnlyHeartbeat?.metadata.status, "ok", "duplicate-only heartbeat metadata should reflect ok status");
  assert.equal(duplicateOnlyHeartbeat?.metadata.stoppedReason, "all_duplicates", "duplicate-only heartbeat metadata should preserve idle reason");

  let backpressureDiscoveryCalls = 0;
  let backpressureWorkerCalls = 0;
  const backpressure = await runLeadEngineCycle(
    { mode: "run_once", dryRun: false },
    {
      getSessionStatus: () => sessionStatus(),
      inspectLiveSession: async () => usableFeedInspection(),
      listActions: () => Array.from({ length: 10_000 }, () => ({}) as never),
      runDiscovery: async () => {
        backpressureDiscoveryCalls += 1;
        return discoveryOk();
      },
      runWorker: async () => {
        backpressureWorkerCalls += 1;
        return workerEmpty();
      },
      writeState: () => undefined,
      random: () => 0,
    },
  );
  assert.equal(backpressure.status, "degraded", "queue backpressure should remain degraded");
  assert.equal(backpressure.stoppedReason, "backpressure_discovery_skipped");
  assert.equal(backpressure.queueBackpressure, true);
  assert.equal(backpressure.discoveryRan, false, "backpressure should skip discovery");
  assert.equal(backpressureDiscoveryCalls, 0);
  assert.equal(backpressureWorkerCalls, 1, "lead engine should still allow the worker to drain existing queue during backpressure");

  const nonCriticalCaptureFailure = await runLeadEngineCycle(
    { mode: "run_once", dryRun: false },
    {
      getSessionStatus: () => sessionStatus(),
      inspectLiveSession: async () => usableFeedInspection(),
      listActions: () => [],
      runDiscovery: async () => discoveryOk(),
      runWorker: async () => ({
        actionsProcessed: 2,
        actionsCompleted: 1,
        actionsPaused: 0,
        actionsSkipped: 0,
        slackPostsSucceeded: 0,
        slackPostFailures: 0,
        stoppedReason: "completed_batch",
        remainingPendingCount: 0,
      }),
      writeState: () => undefined,
      random: () => 0,
    },
  );
  assert.equal(nonCriticalCaptureFailure.status, "ok", "one failed unreadable capture should not mark lead engine manual_attention_required when the worker continues");
  assert.notEqual(nonCriticalCaptureFailure.stoppedReason, "manual_attention_required");
  assert.equal(nonCriticalCaptureFailure.actionsPaused, 0);

  let staleDiscoveryCalls = 0;
  let staleWorkerCalls = 0;
  let clearCalls = 0;
  let staleWorkerAllowedActionTypes: unknown;
  const staleStoredSession = sessionStatus({
    state: "manual_attention_required",
    blocked: true,
    lastManualAttentionAt: "2026-05-26T03:11:09.924Z",
    lastManualAttention: {
      at: "2026-05-26T03:11:09.924Z",
      reason: "captcha_or_security_challenge",
      title: "Challenge - Upwork",
      url: "https://www.upwork.com/?__cf_chl_tk=stale",
    },
    reason: "captcha_or_security_challenge",
  });
  const staleButLiveUsable = await runLeadEngineCycle(
    { mode: "run_once", dryRun: false },
    {
      getSessionStatus: () => staleStoredSession,
      inspectLiveSession: async () => usableFeedInspection(),
      clearManualAttention: () => {
        clearCalls += 1;
      },
      listActions: () => [],
      runDiscovery: async () => {
        staleDiscoveryCalls += 1;
        return discoveryOk();
      },
      runWorker: async (workerInput) => {
        staleWorkerCalls += 1;
        staleWorkerAllowedActionTypes = workerInput?.allowedActionTypes;
        return workerEmpty();
      },
      writeState: () => undefined,
      random: () => 0,
    },
  );
  assert.equal(staleButLiveUsable.status, "ok", "fresh usable feed should let lead engine proceed despite stale stored manual attention");
  assert.equal(staleButLiveUsable.stoppedReason, "completed");
  assert.equal(staleButLiveUsable.browserSessionState, "logged_in");
  assert.equal(staleButLiveUsable.sessionBlocked, false);
  assert.equal(staleButLiveUsable.discoveryRan, true);
  assert.equal(staleDiscoveryCalls, 1);
  assert.equal(staleWorkerCalls, 1);
  assert.equal(clearCalls, 1, "real run should clear stale stored manual-attention state after a usable live feed");
  assert.deepEqual(
    staleWorkerAllowedActionTypes,
    ["capture_job_from_url", "prepare_application_review"],
    "lead engine worker gate should process capture and prepare actions",
  );

  let challengeDiscoveryCalls = 0;
  let challengeWorkerCalls = 0;
  const challenge = await runLeadEngineCycle(
    { mode: "run_once", dryRun: false },
    {
      getSessionStatus: () => sessionStatus(),
      inspectLiveSession: async () => challengeInspection(),
      listActions: () => [],
      runDiscovery: async () => {
        challengeDiscoveryCalls += 1;
        return discoveryOk();
      },
      runWorker: async () => {
        challengeWorkerCalls += 1;
        return workerEmpty();
      },
      writeState: () => undefined,
      random: () => 0,
    },
  );
  assert.equal(challenge.status, "paused", "actual challenge page should pause lead engine");
  assert.equal(challenge.stoppedReason, "browser_session_blocked");
  assert.equal(challenge.browserSessionState, "manual_attention_required");
  assert.equal(challenge.sessionBlocked, true);
  assert.equal(challenge.discoveryRan, false);
  assert.equal(challenge.actionsProcessed, 0);
  assert.equal(challengeDiscoveryCalls, 0);
  assert.equal(challengeWorkerCalls, 0);

  const browserToolUsable = usableFeedInspection();
  const browserToolSessionCheck = {
    ok: !browserToolUsable.blocked,
    sessionState: browserToolUsable.sessionState,
    manualAttentionRequired: browserToolUsable.manualAttentionRequired,
    blocked: browserToolUsable.blocked,
  };
  assert.deepEqual(browserToolSessionCheck, {
    ok: true,
    sessionState: "logged_in",
    manualAttentionRequired: false,
    blocked: false,
  });

  const parity = await runLeadEngineCycle(
    { mode: "run_once", dryRun: false },
    {
      getSessionStatus: () => staleStoredSession,
      inspectLiveSession: async () => browserToolUsable,
      clearManualAttention: () => undefined,
      listActions: () => [],
      runDiscovery: async () => discoveryOk(),
      runWorker: async () => workerEmpty(),
      writeState: () => undefined,
      random: () => 0,
    },
  );
  assert.equal(parity.browserSessionState, browserToolSessionCheck.sessionState, "browser:tool usable-feed interpretation should match lead-engine gate");
  assert.equal(parity.sessionBlocked, browserToolSessionCheck.blocked);
  assert.notEqual(parity.stoppedReason, "browser_session_blocked");

  const blocked = await runLeadEngineCycle(
    { mode: "continuous", dryRun: false },
    {
      getSessionStatus: () => sessionStatus({ state: "manual_attention_required", blocked: true, reason: "captcha_or_security_challenge" }),
      inspectLiveSession: async () => challengeInspection(),
      listActions: () => [],
      writeState: () => undefined,
      random: () => 0,
    },
  );
  assert.equal(blocked.status, "paused", "scheduler cycle should pause when browser session is blocked");
  assert.equal(blocked.discoveryRan, false, "blocked scheduler cycle should not run discovery");
  assert.equal(blocked.actionsProcessed, 0, "blocked scheduler cycle should not process queue");

  const slackFailure = await runLeadEngineCycle(
    { mode: "run_once", dryRun: false },
    {
      getSessionStatus: () => sessionStatus(),
      inspectLiveSession: async () => usableFeedInspection(),
      listActions: () => [],
      runDiscovery: async () => discoveryOk(),
      runWorker: async () => ({
        actionsProcessed: 1,
        actionsCompleted: 1,
        actionsPaused: 0,
        actionsSkipped: 0,
        slackPostsSucceeded: 0,
        slackPostFailures: 1,
        stoppedReason: "completed_batch",
        remainingPendingCount: 0,
      }),
      writeState: () => undefined,
      random: () => 0,
    },
  );
  assert.equal(slackFailure.slackPostFailures, 1, "lead engine should report Slack post failures from the worker summary");
  assert.equal(slackFailure.status, "degraded", "Slack post failures should degrade the cycle summary");
  assert.equal(slackFailure.stoppedReason, "slack_post_failed");

  const latest = readLatestState();
  assert(latest && latest.cycleId.length > 0, "latest state should persist");
  cleanup();
  console.log("lead engine tests passed");
}

run().catch((error) => {
  console.error(`lead engine tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
