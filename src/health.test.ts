import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function cleanup(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  }
  const dir = dirname(path);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

async function runTests(): Promise<void> {
  const tempDir = resolve(process.cwd(), "data/.tmp-health");
  const tempDb = resolve(tempDir, "jobs.db");
  const tempState = resolve(tempDir, "agent-engine-state.json");
  cleanup(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;
  process.env.AGENT_ENGINE_STATE_PATH = tempState;

  const { buildHealthReport } = require("./health") as {
    buildHealthReport: () => { findings: Array<{ key: string; message: string; severity: string }>; status: string };
  };
  const {
    closeDb,
    getQueuedSlackMessages,
    markQueuedMessageSent,
    queueSlackMessage,
    recordHeartbeat,
  } = require("./db") as {
    closeDb: () => void;
    getQueuedSlackMessages: () => Array<{ id: number }>;
    markQueuedMessageSent: (id: number) => void;
    queueSlackMessage: (payload: string) => void;
    recordHeartbeat: (input: { worker: string; status: "running" | "success" | "error"; error?: string }) => unknown;
  };
  const { clearBrowserManualAttention, recordBrowserManualAttention } = require("./browserSession") as {
    clearBrowserManualAttention: (actionId?: number) => unknown;
    recordBrowserManualAttention: (input: {
      actionId?: number;
      jobId?: string;
      reason: string;
      url?: string | null;
      title?: string | null;
    }) => Promise<unknown>;
  };

  try {
    queueSlackMessage(JSON.stringify({ text: "queued" }));
    recordHeartbeat({ worker: "lead-engine", status: "error", error: "manual_attention_required" });
    await recordBrowserManualAttention({
      actionId: 210,
      jobId: "health:test:challenge",
      reason: "captcha_or_security_challenge",
      url: "https://www.upwork.com/?__cf_chl_tk=test",
      title: "Just a moment...",
    });
    const report = buildHealthReport();
    assert(report.status === "critical", `Expected critical health report, got ${report.status}`);
    assert(report.findings.some((finding) => finding.key === "slack-posting-backed-up"), "Slack backlog should create a health finding");
    assert(report.findings.some((finding) => finding.key === "worker-error-lead-engine"), "Worker error heartbeat should create a health finding");
    assert(report.findings.some((finding) => finding.key === "browser-currently-blocked"), "Current browser blocker should be distinguished from stale warnings");

    for (const item of getQueuedSlackMessages()) markQueuedMessageSent(item.id);
    clearBrowserManualAttention(210);
    recordHeartbeat({ worker: "lead-engine", status: "error", error: "too_many_pending_capture_actions" });
    writeFileSync(tempState, JSON.stringify({
      ts: new Date().toISOString(),
      cycleId: "cycle-health-drained-backlog",
      mode: "run_once",
      dryRun: false,
      status: "degraded",
      stoppedReason: "too_many_pending_capture_actions",
      browserSessionState: "logged_in",
      sessionBlocked: false,
      queuePendingBefore: 5,
      queuePendingAfter: 0,
      queueBackpressure: false,
      discoveryRan: true,
      jobsFound: 0,
      jobsQueued: 0,
      duplicatesSkipped: 0,
      workerStoppedReason: "completed_batch",
      actionsProcessed: 5,
      actionsCompleted: 3,
      actionsPaused: 0,
      actionsSkipped: 0,
      slackPostFailures: 0,
      unresolvedChallengeActions: 0,
      nextSleepMs: 0,
    }, null, 2));
    const recovered = buildHealthReport();
    assert(recovered.status !== "critical", `Recovered drained backlog should not keep health critical, got ${recovered.status}`);
    assert(!recovered.findings.some((finding) => finding.key === "worker-error-lead-engine"), "Recovered drained backlog should suppress stale lead-engine critical heartbeat");
    assert(!recovered.findings.some((finding) => finding.message.includes("too_many_pending_capture_actions")), "Normal health copy should not expose raw backlog stop reason");

    writeFileSync(tempState, JSON.stringify({
      ts: new Date().toISOString(),
      cycleId: "cycle-health-still-pending",
      mode: "run_once",
      dryRun: false,
      status: "degraded",
      stoppedReason: "too_many_pending_capture_actions",
      browserSessionState: "logged_in",
      sessionBlocked: false,
      queuePendingBefore: 5,
      queuePendingAfter: 1,
      queueBackpressure: false,
      discoveryRan: true,
      jobsFound: 0,
      jobsQueued: 0,
      duplicatesSkipped: 0,
      workerStoppedReason: "max_actions_reached",
      actionsProcessed: 4,
      actionsCompleted: 3,
      actionsPaused: 0,
      actionsSkipped: 0,
      slackPostFailures: 0,
      unresolvedChallengeActions: 0,
      nextSleepMs: 0,
    }, null, 2));
    const stillPending = buildHealthReport();
    assert(stillPending.findings.some((finding) => finding.key === "lead-engine-degraded"), "Health should keep a finding when backlog did not fully drain");
    assert(!stillPending.findings.some((finding) => finding.message.includes("too_many_pending_capture_actions")), "Backlog warning should use human copy, not raw stop reason");
  } finally {
    closeDb();
    cleanup(tempDb);
  }
}

runTests()
  .then(() => console.log("health tests passed"))
  .catch((error) => {
    console.error(`health tests failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
