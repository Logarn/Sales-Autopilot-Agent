import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
  const dir = dirname(path);
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

function leadEngineSummary(overrides: Record<string, unknown> = {}) {
  return {
    ts: new Date(0).toISOString(),
    cycleId: "cycle-test",
    mode: "run_once",
    dryRun: false,
    status: "ok",
    stoppedReason: "completed",
    browserSessionState: "logged_in",
    sessionBlocked: false,
    queuePendingBefore: 0,
    queuePendingAfter: 0,
    queueBackpressure: false,
    discoveryRan: true,
    jobsFound: 3,
    jobsQueued: 2,
    duplicatesSkipped: 1,
    actionsProcessed: 1,
    actionsCompleted: 1,
    actionsPaused: 0,
    actionsSkipped: 0,
    slackPostFailures: 0,
    nextSleepMs: 0,
    ...overrides,
  };
}

async function runTests(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-slack-operator/jobs.db");
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;
  process.env.SLACK_SOCKET_MODE_ENABLED = "true";

  const {
    buildSlackOperatorReply,
    parseSlackOperatorIntent,
    tryHandleSlackOperatorCommand,
  } = require("./slackOperatorControlPlane") as {
    buildSlackOperatorReply: (intent: any, deps?: any) => Promise<string>;
    parseSlackOperatorIntent: (text: string) => any;
    tryHandleSlackOperatorCommand: (input: { text: string; channelId: string; threadTs: string; client: any; deps?: any }) => Promise<boolean>;
  };
  const { runLeadEngineCycle } = require("./leadEngine") as {
    runLeadEngineCycle: (input: { mode: "run_once" | "continuous"; dryRun: boolean }, deps?: any) => Promise<any>;
  };
  const { setHuntingPaused } = require("./operatorControlState") as {
    setHuntingPaused: (paused: boolean, reason?: string | null) => unknown;
  };
  const { closeDb } = require("./db") as { closeDb: () => void };

  try {
    assert(parseSlackOperatorIntent("are you running?")?.type === "service_status", "Running question should parse as service status.");
    assert(parseSlackOperatorIntent("pause hunting")?.type === "pause_hunting", "Pause hunting should parse.");
    assert(parseSlackOperatorIntent("start hunting")?.type === "start_hunting", "Start hunting should parse.");
    const openIntent = parseSlackOperatorIntent("open https://www.upwork.com/jobs/~0123456789abcdef in Chrome");
    assert(openIntent?.type === "open_remote_chrome", "Open URL in Chrome should parse as remote Chrome control.");

    const statusReply = await buildSlackOperatorReply({ type: "service_status" }, {
      buildHealthReport: () => ({
        generatedAt: new Date(0).toISOString(),
        status: "ok",
        heartbeats: [],
        staleHeartbeats: [],
        findings: [],
      }),
      checkCdpEndpoint: async () => ({ reachable: true, browserVersion: "Chrome/Test" }),
      getBrowserSessionStatus: () => ({
        state: "healthy",
        updatedAt: new Date(0).toISOString(),
        challengeEvents: [],
        blocked: false,
        alertCooldownRemainingMs: 0,
      }),
      readHeartbeats: () => [{ worker: "lead-engine", status: "running", updatedAt: new Date(0).toISOString() }],
      readLeadEngineState: () => leadEngineSummary(),
    });
    assert(statusReply.includes("Yeah") && statusReply.includes("Slack is live"), "Health command should return friendly teammate status.");
    assert(statusReply.includes("Chrome is connected"), "Health command should include friendly browser status.");
    assert(statusReply.includes("Final submit stays manual"), "Health command should preserve submit safety.");
    assert(!/Overall health|Workers|Heartbeats|systemd|journalctl|action #|job_id|raw/i.test(statusReply), "Normal health status should not include dashboard or raw operational dumps.");

    const recoveredBacklogStatus = await buildSlackOperatorReply({ type: "service_status" }, {
      buildHealthReport: () => ({
        generatedAt: new Date(0).toISOString(),
        status: "ok",
        heartbeats: [],
        staleHeartbeats: [],
        findings: [],
      }),
      checkCdpEndpoint: async () => ({ reachable: true, browserVersion: "Chrome/Test" }),
      getBrowserSessionStatus: () => ({
        state: "healthy",
        updatedAt: new Date(0).toISOString(),
        challengeEvents: [],
        blocked: false,
        alertCooldownRemainingMs: 0,
      }),
      readHeartbeats: () => [{ worker: "lead-engine", status: "success", updatedAt: new Date(0).toISOString() }],
      readLeadEngineState: () => leadEngineSummary({
        status: "degraded",
        stoppedReason: "too_many_pending_capture_actions",
        queuePendingBefore: 5,
        queuePendingAfter: 0,
        actionsProcessed: 5,
        actionsCompleted: 3,
        actionsPaused: 0,
        workerStoppedReason: "completed_batch",
      }),
    });
    assert(recoveredBacklogStatus.includes("I cleared an old capture backlog; browser is clean now."), "Recovered backlog status should use human wording.");
    assert(!recoveredBacklogStatus.includes("too_many_pending_capture_actions"), "Recovered backlog status should not expose raw stop reason.");

    let browserStartCalled = false;
    let pauseSet = false;
    const pauseReply = await buildSlackOperatorReply({ type: "pause_hunting" }, {
      setHuntingPaused: (paused: boolean) => {
        pauseSet = paused;
        return { huntingPaused: paused, reason: "test", updatedAt: new Date(0).toISOString() };
      },
      startBrowserSession: async () => {
        browserStartCalled = true;
        return { started: false, message: "should not run" };
      },
    });
    assert(pauseSet, "Pause hunting should set the hunting pause flag.");
    assert(!browserStartCalled, "Pause hunting must not restart or kill the browser.");
    assert(pauseReply.includes("left Chrome") && pauseReply.includes("QA tabs open"), "Pause reply should explain Chrome tabs remain protected.");

    let startClearedPause = false;
    let leadEngineRan = false;
    const startReply = await buildSlackOperatorReply({ type: "start_hunting" }, {
      setHuntingPaused: (paused: boolean) => {
        startClearedPause = !paused;
        return { huntingPaused: paused, reason: null, updatedAt: new Date(0).toISOString() };
      },
      runLeadEngineCycle: async () => {
        leadEngineRan = true;
        return leadEngineSummary();
      },
    });
    assert(startClearedPause && leadEngineRan, "Start hunting should clear pause and run one safe lead-engine cycle.");
    assert(startReply.includes("I started hunting") && startReply.includes("Final submit remains manual"), "Start hunting reply should preserve final-submit safety.");

    const restartReply = await buildSlackOperatorReply({ type: "restart_browser_session" }, {
      startBrowserSession: async () => ({ started: false, message: "Chrome already appears to be running. Not starting a duplicate." }),
    });
    assert(restartReply.includes("not restarted by force") && restartReply.includes("Not starting a duplicate"), "Browser restart should avoid duplicate/forced restarts.");

    let openedUrl = "";
    const openReply = await buildSlackOperatorReply(openIntent, {
      openRemoteChromeUrl: async (url: string) => {
        openedUrl = url;
        return { ok: true, text: "I opened that in remote Chrome and brought the tab forward. I did not paste through VNC or click submit." };
      },
    });
    assert(openedUrl === "https://www.upwork.com/jobs/~0123456789abcdef", "Remote Chrome open should target the parsed URL.");
    assert(openReply.includes("remote Chrome") && openReply.includes("did not paste") && openReply.includes("click submit"), "Open URL reply should confirm CDP-style control and submit safety.");

    const posted: string[] = [];
    const handled = await tryHandleSlackOperatorCommand({
      text: "is Chrome okay?",
      channelId: "C123",
      threadTs: "111.222",
      client: { chat: { postMessage: async (payload: { text: string }) => posted.push(payload.text) } },
      deps: {
        buildHealthReport: () => ({ generatedAt: new Date(0).toISOString(), status: "ok", heartbeats: [], staleHeartbeats: [], findings: [] }),
        checkCdpEndpoint: async () => ({ reachable: true }),
        getBrowserSessionStatus: () => ({ state: "healthy", updatedAt: new Date(0).toISOString(), challengeEvents: [], blocked: false, alertCooldownRemainingMs: 0 }),
        readHeartbeats: () => [],
        readLeadEngineState: () => null,
      },
    });
    assert(handled && posted.some((reply) => reply.includes("Chrome is connected")), "Slack handler should post friendly Chrome health.");

    setHuntingPaused(true, "Paused from Slack.");
    let discoveryCalled = false;
    const pausedSummary = await runLeadEngineCycle({ mode: "run_once", dryRun: false }, {
      runDiscovery: async () => {
        discoveryCalled = true;
        return { ok: true, skipped: false, jobsFound: 0, jobsQueued: 0, duplicatesSkipped: 0 };
      },
      runWorker: async () => {
        throw new Error("worker should not run while paused");
      },
      writeState: () => undefined,
      random: () => 0,
    });
    assert(pausedSummary.status === "paused" && pausedSummary.stoppedReason === "Paused from Slack.", "Lead engine should honor the Slack hunting pause.");
    assert(!discoveryCalled, "Lead engine pause should stop discovery before browser work starts.");
    setHuntingPaused(false);

    console.log("slack operator control-plane tests passed");
  } finally {
    closeDb();
    cleanupDatabase(tempDb);
  }
}

if (require.main === module) {
  runTests().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`slack operator control-plane tests failed: ${message}`);
    process.exitCode = 1;
  });
}
