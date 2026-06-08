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
import { BrowserSessionStatus, clearBrowserManualAttention, getBrowserSessionStatus, listUnresolvedBrowserChallengeQuarantines, recordBrowserManualAttention } from "./browserSession";
import { inspectLiveBrowserSessionFromCdp } from "./browserLiveSession";
import { BrowserSessionInspection } from "./browserSessionInspector";
import { writeHeartbeat } from "./heartbeat";
import { readHuntingControlState } from "./operatorControlState";

const LEAD_ENGINE_ACTION_TYPES = ["capture_job_from_url", "prepare_application_review"] as const;
const RECOVERABLE_BACKLOG_STOP_REASONS = new Set(["too_many_pending_capture_actions"]);
const CLEAN_BACKLOG_WORKER_STOP_REASONS = new Set(["completed_batch", "max_actions_reached"]);
export const RECOVERED_BACKLOG_STOP_REASON = "backlog_drained";

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
  workerStoppedReason?: string;
  workerError?: string;
  actionsProcessed: number;
  actionsCompleted: number;
  actionsPaused: number;
  actionsSkipped: number;
  slackPostFailures: number;
  unresolvedChallengeActions: number;
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
  recordManualAttention?: typeof recordBrowserManualAttention;
  listUnresolvedQuarantines?: typeof listUnresolvedBrowserChallengeQuarantines;
  random?: () => number;
  writeState?: (summary: LeadEngineCycleSummary) => void;
}

type DiscoveryOutcome = Awaited<ReturnType<typeof runDiscoveryOnceFromCdp>>;

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

async function recordLiveManualAttention(inspection: BrowserSessionInspection, deps: LeadEngineDeps, dryRun: boolean): Promise<void> {
  if (dryRun || !inspection.manualAttentionRequired) return;
  try {
    await (deps.recordManualAttention ?? recordBrowserManualAttention)({
      url: inspection.currentUrl || null,
      title: inspection.title || null,
      reason: String(inspection.manualAttentionReason ?? inspection.sessionState ?? "manual_attention_required"),
    });
  } catch {
    // Preserve the safe pause even if alert persistence or delivery fails.
  }
}

function getIdleDiscoveryReason(discovery: DiscoveryOutcome): "all_duplicates" | "no_new_jobs" | null {
  if (discovery.error || discovery.blocked || discovery.manualAttentionRequired || discovery.sessionState === "browser_session_unhealthy") {
    return null;
  }
  if (discovery.jobsFound > 0 && discovery.jobsQueued === 0 && discovery.duplicatesSkipped >= discovery.jobsFound) {
    return "all_duplicates";
  }
  if (discovery.ok && !discovery.skipped && discovery.jobsFound === 0 && discovery.jobsQueued === 0) {
    return "no_new_jobs";
  }
  return null;
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
      if (!storedSession.blocked) {
        await recordLiveManualAttention(liveSession, deps, input.dryRun);
      }
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
    unresolvedChallengeActions: 0,
    nextSleepMs: 0,
    ...overrides,
  };
}

export function isRecoveredBacklogDrain(state: LeadEngineCycleSummary): boolean {
  const stoppedReasonRecovered = state.stoppedReason === RECOVERED_BACKLOG_STOP_REASON || RECOVERABLE_BACKLOG_STOP_REASONS.has(state.stoppedReason);
  return stoppedReasonRecovered
    && state.sessionBlocked === false
    && state.browserSessionState === "logged_in"
    && state.queuePendingAfter === 0
    && state.actionsPaused === 0
    && state.slackPostFailures === 0
    && CLEAN_BACKLOG_WORKER_STOP_REASONS.has(state.workerStoppedReason ?? "")
    && state.workerStoppedReason !== "manual_attention_required"
    && state.workerStoppedReason !== "browser_session_blocked";
}

function recoverDrainedBacklog(summary: LeadEngineCycleSummary): void {
  if (!isRecoveredBacklogDrain(summary)) return;
  summary.status = "ok";
  summary.stoppedReason = RECOVERED_BACKLOG_STOP_REASON;
  summary.queueBackpressure = false;
}

function isPausedChallengeAction(action: { lastError?: string | null }): boolean {
  const value = String(action.lastError ?? "").toLowerCase();
  return /\b(captcha_or_security_challenge|login_required|two_factor_required|passkey|security check|just a moment|cloudflare|captcha)\b/.test(value);
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
    const listUnresolvedQuarantines = deps.listUnresolvedQuarantines ?? listUnresolvedBrowserChallengeQuarantines;
    const runDiscovery = deps.runDiscovery ?? runDiscoveryOnceFromCdp;
    const runWorker = deps.runWorker ?? runControlledWorkerLoop;
    const controlState = readHuntingControlState();
    if (controlState.huntingPaused) {
      const summary: LeadEngineCycleSummary = makeSummary(input, {
        status: "paused",
        stoppedReason: controlState.reason ?? "hunting_paused_from_slack",
        nextSleepMs: computeJitteredDelay(AGENT_ENGINE_INTERVAL_MS, AGENT_ENGINE_JITTER_PCT, random),
      });
      writeState(summary);
      writeHeartbeat({
        worker: "lead-engine",
        status: "success",
        error: null,
        metadata: { status: summary.status, stoppedReason: summary.stoppedReason },
      });
      return summary;
    }
    const storedSession = getSessionStatus();
    const session = await resolveLeadEngineBrowserSession(input, storedSession, deps);
    const pendingBefore = listActions("pending", 1000).length;
    const unresolvedQuarantines = listUnresolvedQuarantines();
    const pausedChallengeActions = listActions("paused", 1000).filter(isPausedChallengeAction);
    const summary: LeadEngineCycleSummary = makeSummary(input, {
      browserSessionState: session.state,
      sessionBlocked: session.blocked,
      queuePendingBefore: pendingBefore,
      queuePendingAfter: pendingBefore,
      actionsPaused: pausedChallengeActions.length,
      unresolvedChallengeActions: Math.max(unresolvedQuarantines.length, pausedChallengeActions.length),
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

    if (summary.unresolvedChallengeActions > 0) {
      summary.status = "paused";
      summary.stoppedReason = "browser_challenge_action_paused";
      summary.nextSleepMs = computeJitteredDelay(AGENT_ENGINE_INTERVAL_MS, AGENT_ENGINE_JITTER_PCT, random);
      writeState(summary);
      writeHeartbeat({
        worker: "lead-engine",
        status: "error",
        error: summary.stoppedReason,
        metadata: {
          status: summary.status,
          browserSessionState: summary.browserSessionState,
          sessionBlocked: summary.sessionBlocked,
          unresolvedChallengeActions: summary.unresolvedChallengeActions,
        },
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
        const idleReason = getIdleDiscoveryReason(discovery);
        if (idleReason) {
          summary.stoppedReason = idleReason;
        } else if (!discovery.ok || discovery.skipped) {
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
          actionsProcessed: Math.min(AGENT_ENGINE_MAX_WORKER_ACTIONS, listActions("pending", 1000).filter((a) => LEAD_ENGINE_ACTION_TYPES.includes(a.actionType as typeof LEAD_ENGINE_ACTION_TYPES[number])).length),
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
          allowedActionTypes: [...LEAD_ENGINE_ACTION_TYPES],
        }).catch((error) => {
          summary.status = "degraded";
          summary.stoppedReason = "worker_failed";
          summary.workerError = error instanceof Error ? error.message : String(error);
          return {
            actionsProcessed: 0,
            actionsCompleted: 0,
            actionsPaused: 0,
            actionsSkipped: 0,
            slackPostsSucceeded: 0,
            slackPostFailures: 0,
            stoppedReason: "worker_failed",
            remainingPendingCount: listActions("pending", 1000).length,
          };
        });

    summary.workerStoppedReason = worker.stoppedReason;
    summary.actionsProcessed = worker.actionsProcessed;
    summary.actionsCompleted = worker.actionsCompleted;
    summary.actionsPaused = worker.actionsPaused;
    summary.actionsSkipped = worker.actionsSkipped;
    summary.slackPostFailures = worker.slackPostFailures;
    summary.queuePendingAfter = worker.remainingPendingCount;
    if (worker.stoppedReason === "manual_attention_required" || worker.stoppedReason === "browser_session_blocked") {
      summary.status = "paused";
      summary.stoppedReason = worker.stoppedReason;
    } else if (worker.slackPostFailures > 0 && summary.status === "ok") {
      summary.status = "degraded";
      summary.stoppedReason = "slack_post_failed";
    }
    recoverDrainedBacklog(summary);

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
