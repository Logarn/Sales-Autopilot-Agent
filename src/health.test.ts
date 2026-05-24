import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
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

function runTests(): void {
  const tempDb = resolve(process.cwd(), "data/.tmp-health/jobs.db");
  cleanup(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;

  const { buildHealthReport } = require("./health") as {
    buildHealthReport: () => { findings: Array<{ key: string; message: string; severity: string }>; status: string };
  };
  const { closeDb, queueSlackMessage, recordHeartbeat } = require("./db") as {
    closeDb: () => void;
    queueSlackMessage: (payload: string) => void;
    recordHeartbeat: (input: { worker: string; status: "running" | "success" | "error"; error?: string }) => unknown;
  };

  try {
    queueSlackMessage(JSON.stringify({ text: "queued" }));
    recordHeartbeat({ worker: "lead-engine", status: "error", error: "manual_attention_required" });
    const report = buildHealthReport();
    assert(report.status === "critical", `Expected critical health report, got ${report.status}`);
    assert(report.findings.some((finding) => finding.key === "slack-posting-backed-up"), "Slack backlog should create a health finding");
    assert(report.findings.some((finding) => finding.key === "worker-error-lead-engine"), "Worker error heartbeat should create a health finding");
  } finally {
    closeDb();
    cleanup(tempDb);
  }
}

runTests();
console.log("health tests passed");
