import * as fs from "node:fs";
import * as path from "node:path";
import {
  AGENT_ENGINE_ENABLED,
  AGENT_ENGINE_INTERVAL_MS,
  AGENT_ENGINE_JITTER_PCT,
  AGENT_ENGINE_MAX_WORKER_ACTIONS,
  AGENT_ENGINE_QUEUE_CAP,
  AGENT_ENGINE_STATE_PATH,
} from "./config";
import { closeDb, listBrowserActions } from "./db";
import { runDiscoveryOnceFromCdp } from "./discoveryScheduler";
import { runControlledWorkerLoop } from "./browserWorker";
import { BrowserSessionStatus, clearBrowserManualAttention, getBrowserSessionStatus } from "./browserSession";
import { inspectLiveBrowserSessionFromCdp } from "./browserLiveSession";
import { BrowserSessionInspection } from "./browserSessionInspector";
import { writeHeartbeat } from "./heartbeat";

export interface LeadEngineCycleSummary {
  ts: string;
  cycleId: string;
  mode: "run_once" | "continuous";
  dryRun: boolean;
  status: "ok" | "paused" | "degraded";
  stoppedReason: string;
  browserSessionState: string;
  sessionBlocked: boolean;
  queuePendingBefore: number;
  queuePendingAfter: number;
  queueBackpressure: boolean;
  discoveryRan: boolean;
  jobsFound: number;
  jobsQueued: number;
  duplicatesSkipped: number;
  discoveryError?: string;
  actionsProcessed: number;
  actionsCompleted: number;
  actionsPaused: number;
  actionsSkipped: number;
  slackPostFailures: number;
  nextSleepMs: number;
}

let cycleLock = false;

interface LeadEngineDeps {
  getSessionStatus?: typeof getBrowserSessionStatus;
  inspectLiveSession?: () => Promise<BrowserSessionInspection>;
  clearManualAttention?: () => unknown;
  listActions?: typeof listBrowserActions;
  runDiscovery?: typeof runDiscoveryOnceFromCdp;
  runWorker?: typeof runControlledWorkerLoop;
  random?: () => number;
  writeState?: (summary: LeadEngineCycleSummary) => void;
}

function computeJitteredDelay(baseMs: number, jitterPct: number, random = Math.random): number {
  const delta = Math.floor(baseMs * jitterPct);
  const min = Math.max(1000, baseMs - delta);
  const max = baseMs + delta;
  return min + Math.floor(random() * (max - min + 1));
}

function writeLatestState(summary: LeadEngineCycleSummary): void {
  const absolute = path.resolve(process.cwd(), AGENT_ENGINE_STATE_PATH);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, JSON.stringify(summary, null, 2));
}

function liveInspectionBlocksLeadEngine(inspection: BrowserSessionInspection): boolean {
  return inspection.blocked || inspection.manualAttentionRequired || inspection.sessionState === "browser_session_unhealthy";
}

function liveInspectionIsUsableFeed(inspection: BrowserSessionInspection): boolean {
  if (liveInspectionBlocksLeadEngine(inspection) || inspection.sessionState !== "logged_in") return false;
  try {
    const url = new URL(inspection.currentUrl);
    const host = url.hostname.toLowerCase();
    const pathName = url.pathname.toLowerCase();
    return (host === "upwork.com" || host.endsWith(".upwork.com")) && (pathName === "/nx/find-work" || pathName.startsWith("/nx/find-work/"));
  } catch {
    return false;
  }
}

async function resolveLeadEngineBrowserSession(
  input: { dryRun: boolean },
  storedSession: BrowserSessionStatus,
  deps: LeadEngineDeps,
): Promise<{ state: string; blocked: boolean }> {
  const shouldInspectLive = storedSession.blocked || !input.dryRun;
  if (!shouldInspectLive) {
    return { state: storedSession.state, blocked: storedSession.blocked };
  }

  const inspectLiveSession = deps.inspectLiveSession ?? (() => inspectLiveBrowserSessionFromCdp({ includeStoredSessionState: false }));
  try {
    const liveSession = await inspectLiveSession();
    if (liveInspectionBlocksLeadEngine(liveSession)) {
      return { state: liveSession.sessionState, blocked: true };
    }
    if (storedSession.blocked && liveInspectionIsUsableFeed(liveSession)) {
      if (!input.dryRun) {
        (deps.clearManualAttention ?? clearBrowserManualAttention)();
      }
      return { state: liveSession.sessionState, blocked: false };
    }
    if (storedSession.blocked) {
      return { state: storedSession.state, blocked: true };
    }
    return { state: liveSession.sessionState, blocked: false };
  } catch {
    return { state: storedSession.state, blocked: storedSession.blocked };
  }
}

export function readLatestState(): LeadEngineCycleSummary | null {
  const absolute = path.resolve(process.cwd(), AGENT_ENGINE_STATE_PATH);
  if (!fs.existsSync(absolute)) return null;
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8")) as LeadEngineCycleSummary;
  } catch {
    return null;
  }
}

function makeSummary(input: { mode: "run_once" | "continuous"; dryRun: boolean }, overrides: Partial<LeadEngineCycleSummary> = {}): LeadEngineCycleSummary {
  return {
    ts: new Date().toISOString(),
    cycleId: `cycle-${Date.now()}`,
    mode: input.mode,
    dryRun: input.dryRun,
    status: "ok",
    stoppedReason: "completed",
    browserSessionState: "unknown",
    sessionBlocked: false,
    queuePendingBefore: 0,
    queuePendingAfter: 0,
    queueBackpressure: false,
    discoveryRan: false,
    jobsFound: 0,
    jobsQueued: 0,
    duplicatesSkipped: 0,
    actionsProcessed: 0,
    actionsCompleted: 0,
    actionsPaused: 0,
    actionsSkipped: 0,
    slackPostFailures: 0,
    nextSleepMs: 0,
    ...overrides,
  };
}

export async function runLeadEngineCycle(
  input: { mode: "run_once" | "continuous"; dryRun: boolean },
  deps: LeadEngineDeps = {},
): Promise<LeadEngineCycleSummary> {
  const writeState = deps.writeState ?? writeLatestState;
  const random = deps.random ?? Math.random;
  if (cycleLock) {
    const overlap: LeadEngineCycleSummary = makeSummary(input, {
      status: "paused",
      stoppedReason: "overlap_guard",
      nextSleepMs: 0,
    });
    writeState(overlap);
    writeHeartbeat({ worker: "lead-engine", status: "error", error: "overlap_guard", metadata: { mode: input.mode, dryRun: input.dryRun } });
    return overlap;
  }

  cycleLock = true;
  try {
    writeHeartbeat({ worker: "lead-engine", status: "running", metadata: { mode: input.mode, dryRun: input.dryRun } });
    const getSessionStatus = deps.getSessionStatus ?? getBrowserSessionStatus;
    const listActions = deps.listActions ?? listBrowserActions;
    const runDiscovery = deps.runDiscovery ?? runDiscoveryOnceFromCdp;
    const runWorker = deps.runWorker ?? runControlledWorkerLoop;
    const storedSession = getSessionStatus();
    const session = await resolveLeadEngineBrowserSession(input, storedSession, deps);
    const pendingBefore = listActions("pending", 1000).length;
    const summary: LeadEngineCycleSummary = makeSummary(input, {
      browserSessionState: session.state,
      sessionBlocked: session.blocked,
      queuePendingBefore: pendingBefore,
      queuePendingAfter: pendingBefore,
    });

    if (session.blocked) {
      summary.status = "paused";
      summary.stoppedReason = "browser_session_blocked";
      summary.nextSleepMs = computeJitteredDelay(AGENT_ENGINE_INTERVAL_MS, AGENT_ENGINE_JITTER_PCT, random);
      writeState(summary);
      writeHeartbeat({
        worker: "lead-engine",
        status: "error",
        error: summary.stoppedReason,
        metadata: { status: summary.status, browserSessionState: summary.browserSessionState },
      });
      return summary;
    }

    const queueFull = pendingBefore >= AGENT_ENGINE_QUEUE_CAP;
    summary.queueBackpressure = queueFull;
    if (!queueFull && !input.dryRun) {
      try {
        const discovery = await runDiscovery();
        summary.discoveryRan = true;
        summary.jobsFound = discovery.jobsFound;
        summary.jobsQueued = discovery.jobsQueued;
        summary.duplicatesSkipped = discovery.duplicatesSkipped;
        if (!discovery.ok || discovery.skipped) {
          summary.status = "degraded";
          summary.stoppedReason = discovery.skippedReason ?? discovery.error ?? "discovery_degraded";
          if (discovery.error) summary.discoveryError = discovery.error;
        }
      } catch (error) {
        summary.status = "degraded";
        summary.stoppedReason = "discovery_failed";
        summary.discoveryError = error instanceof Error ? error.message : String(error);
      }
    } else if (queueFull) {
      summary.status = "degraded";
      summary.stoppedReason = "backpressure_discovery_skipped";
    }

    const worker = input.dryRun
      ? {
          actionsProcessed: Math.min(AGENT_ENGINE_MAX_WORKER_ACTIONS, listActions("pending", 1000).filter((a) => a.actionType === "capture_job_from_url").length),
          actionsCompleted: 0,
          actionsPaused: 0,
          actionsSkipped: 0,
          slackPostsSucceeded: 0,
          slackPostFailures: 0,
          stoppedReason: "dry_run_preview",
          remainingPendingCount: listActions("pending", 1000).length,
        }
      : await runWorker({
          maxActions: AGENT_ENGINE_MAX_WORKER_ACTIONS,
          dryRun: false,
          allowedActionTypes: ["capture_job_from_url"],
        });

    summary.actionsProcessed = worker.actionsProcessed;
    summary.actionsCompleted = worker.actionsCompleted;
    summary.actionsPaused = worker.actionsPaused;
    summary.actionsSkipped = worker.actionsSkipped;
    summary.slackPostFailures = worker.slackPostFailures;
    summary.queuePendingAfter = worker.remainingPendingCount;
    if (worker.stoppedReason === "manual_attention_required") {
      summary.status = "paused";
      summary.stoppedReason = "manual_attention_required";
    } else if (worker.slackPostFailures > 0 && summary.status === "ok") {
      summary.status = "degraded";
      summary.stoppedReason = "slack_post_failed";
    }

    summary.nextSleepMs = computeJitteredDelay(AGENT_ENGINE_INTERVAL_MS, AGENT_ENGINE_JITTER_PCT, random);
    writeState(summary);
    writeHeartbeat({
      worker: "lead-engine",
      status: summary.status === "ok" ? "success" : "error",
      error: summary.status === "ok" ? null : summary.stoppedReason,
      metadata: {
        status: summary.status,
        stoppedReason: summary.stoppedReason,
        jobsQueued: summary.jobsQueued,
        actionsProcessed: summary.actionsProcessed,
        queuePendingAfter: summary.queuePendingAfter,
      },
    });
    return summary;
  } catch (error) {
    writeHeartbeat({
      worker: "lead-engine",
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      metadata: { mode: input.mode, dryRun: input.dryRun },
    });
    throw error;
  } finally {
    cycleLock = false;
  }
}

export async function runLeadEngineContinuous(input: { dryRun: boolean }): Promise<void> {
  if (!AGENT_ENGINE_ENABLED) {
    const summary = makeSummary({ mode: "continuous", dryRun: input.dryRun }, {
      status: "paused",
      stoppedReason: "agent_engine_disabled",
    });
    writeLatestState(summary);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return;
  }

  while (true) {
    const summary = await runLeadEngineCycle({ mode: "continuous", dryRun: input.dryRun });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    await new Promise((resolve) => setTimeout(resolve, summary.nextSleepMs));
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "--run-once";
  const dryRun = process.argv.includes("--dry-run");

  if (cmd === "--status") {
    process.stdout.write(`${JSON.stringify(readLatestState() ?? { ok: false, error: "no_state" })}\n`);
    return;
  }
  if (cmd === "--run") {
    await runLeadEngineContinuous({ dryRun });
    return;
  }
  if (cmd === "--run-once") {
    const summary = await runLeadEngineCycle({ mode: "run_once", dryRun });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return;
  }
  if (cmd === "--validate") {
    const summary = await runLeadEngineCycle({ mode: "run_once", dryRun: false });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify({ ok: false, error: "Usage: leadEngine.ts --run|--run-once|--validate|--status [--dry-run]" })}\n`);
  process.exitCode = 1;
}

if (require.main === module) {
  void main().finally(() => closeDb());
}
