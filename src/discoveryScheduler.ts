import {
  BROWSER_CDP_URL,
  BROWSER_CHROME_EXECUTABLE_PATH,
  BROWSER_HEADLESS,
  BROWSER_USER_DATA_DIR,
  DISCOVERY_JITTER_MAX_MS,
  DISCOVERY_JITTER_MIN_MS,
  DISCOVERY_MAX_JOBS_PER_RUN,
  DISCOVERY_MAX_SCROLLS_PER_RUN,
  DISCOVERY_SCHEDULER_ENABLED,
  DISCOVERY_SKIP_IF_PENDING_CAPTURE_COUNT_GT,
} from "./config";
import { runDiscoveryBestMatches, DiscoveryBestMatchesResult } from "./browserDiscoveryTool";
import { inspectBrowserSession } from "./browserSessionInspector";
import { acquireBrowserSession, findChromeExecutable, PlaywrightChromiumLike } from "./browserSessionControl";
import { closeDb, listBrowserActions } from "./db";
import { BrowserAction } from "./types";
import * as path from "node:path";

export type DiscoveryRunType = "discovery.run_once" | "discovery.scheduler";

export interface DiscoverySchedulerConfig {
  enabled: boolean;
  jitterMinMs: number;
  jitterMaxMs: number;
  maxJobsPerRun: number;
  maxScrollsPerRun: number;
  skipIfPendingCaptureCountGt: number;
}

export interface DiscoverySchedulerRunResult {
  ok: boolean;
  runType: DiscoveryRunType;
  sessionState: string;
  manualAttentionRequired?: boolean;
  blocked?: boolean;
  skipped?: boolean;
  skippedReason?: string;
  pendingCaptureCount?: number;
  jobsFound: number;
  jobsQueued: number;
  duplicatesSkipped: number;
  alreadyHandledSkipped: number;
  invalidSkipped: number;
  scrollsPerformed: number;
  newestQueuedPostedAtText?: string;
  oldestQueuedPostedAtText?: string;
  queuedActionIds?: number[];
  nextRunInMs: number | null;
  lockAcquired: boolean;
  error?: string;
}

interface DiscoverySchedulerDeps {
  now?: () => Date;
  random?: () => number;
  listActions?: () => BrowserAction[];
  inspectSession: () => Promise<{ sessionState: string; manualAttentionRequired: boolean; blocked: boolean }>;
  runDiscovery: (options: { maxJobs: number; maxScrolls: number; now: Date }) => Promise<DiscoveryBestMatchesResult>;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RESULT_COUNTS = {
  jobsFound: 0,
  jobsQueued: 0,
  duplicatesSkipped: 0,
  alreadyHandledSkipped: 0,
  invalidSkipped: 0,
  scrollsPerformed: 0,
};

let runInProgress = false;

function compactResult(result: DiscoverySchedulerRunResult): DiscoverySchedulerRunResult {
  const compact: DiscoverySchedulerRunResult = {
    ok: result.ok,
    runType: result.runType,
    sessionState: result.sessionState,
    jobsFound: result.jobsFound,
    jobsQueued: result.jobsQueued,
    duplicatesSkipped: result.duplicatesSkipped,
    alreadyHandledSkipped: result.alreadyHandledSkipped,
    invalidSkipped: result.invalidSkipped,
    scrollsPerformed: result.scrollsPerformed,
    nextRunInMs: result.nextRunInMs,
    lockAcquired: result.lockAcquired,
  };
  for (const key of [
    "manualAttentionRequired",
    "blocked",
    "skipped",
    "skippedReason",
    "pendingCaptureCount",
    "newestQueuedPostedAtText",
    "oldestQueuedPostedAtText",
    "queuedActionIds",
    "error",
  ] as const) {
    const value = result[key];
    if (value !== undefined) {
      (compact as unknown as Record<string, unknown>)[key] = typeof value === "string" ? value.slice(0, 500) : value;
    }
  }
  return compact;
}

export function getDiscoverySchedulerConfig(): DiscoverySchedulerConfig {
  return {
    enabled: DISCOVERY_SCHEDULER_ENABLED,
    jitterMinMs: DISCOVERY_JITTER_MIN_MS,
    jitterMaxMs: DISCOVERY_JITTER_MAX_MS,
    maxJobsPerRun: DISCOVERY_MAX_JOBS_PER_RUN,
    maxScrollsPerRun: DISCOVERY_MAX_SCROLLS_PER_RUN,
    skipIfPendingCaptureCountGt: DISCOVERY_SKIP_IF_PENDING_CAPTURE_COUNT_GT,
  };
}

export function computeDiscoveryJitterMs(config: Pick<DiscoverySchedulerConfig, "jitterMinMs" | "jitterMaxMs">, random = Math.random): number {
  const min = Math.max(0, Math.floor(config.jitterMinMs));
  const max = Math.max(min, Math.floor(config.jitterMaxMs));
  return min + Math.floor(random() * (max - min + 1));
}

export function countPendingCaptureActions(actions: BrowserAction[]): number {
  return actions.filter((action) => action.status === "pending" && action.actionType === "capture_job_from_url").length;
}

function skippedResult(input: {
  runType: DiscoveryRunType;
  sessionState: string;
  reason: string;
  nextRunInMs: number | null;
  lockAcquired: boolean;
  manualAttentionRequired?: boolean;
  blocked?: boolean;
  pendingCaptureCount?: number;
}): DiscoverySchedulerRunResult {
  return compactResult({
    ok: true,
    runType: input.runType,
    sessionState: input.sessionState,
    manualAttentionRequired: input.manualAttentionRequired,
    blocked: input.blocked,
    skipped: true,
    skippedReason: input.reason,
    pendingCaptureCount: input.pendingCaptureCount,
    ...DEFAULT_RESULT_COUNTS,
    nextRunInMs: input.nextRunInMs,
    lockAcquired: input.lockAcquired,
  });
}

export async function runDiscoverySchedulerCycle(
  config: DiscoverySchedulerConfig,
  deps: DiscoverySchedulerDeps,
  runType: DiscoveryRunType = "discovery.run_once",
  nextRunInMs: number | null = null,
): Promise<DiscoverySchedulerRunResult> {
  const log = deps.log ?? (() => undefined);
  if (runInProgress) {
    return skippedResult({ runType, sessionState: "unknown", reason: "run_already_in_progress", nextRunInMs, lockAcquired: false });
  }
  runInProgress = true;
  log(JSON.stringify({ event: "discovery_run_started", runType, lockAcquired: true }));
  try {
    const inspection = await deps.inspectSession();
    if (inspection.blocked || inspection.manualAttentionRequired || inspection.sessionState === "browser_session_unhealthy") {
      const result = skippedResult({
        runType,
        sessionState: inspection.sessionState,
        reason: "browser_session_blocked_or_unhealthy",
        nextRunInMs,
        lockAcquired: true,
        manualAttentionRequired: inspection.manualAttentionRequired,
        blocked: inspection.blocked,
      });
      log(JSON.stringify({ event: "discovery_run_skipped", reason: result.skippedReason, sessionState: result.sessionState, nextRunInMs }));
      return result;
    }
    if (inspection.sessionState !== "logged_in") {
      const result = skippedResult({
        runType,
        sessionState: inspection.sessionState,
        reason: "preferred_browser_not_ready_for_discovery",
        nextRunInMs,
        lockAcquired: true,
        manualAttentionRequired: inspection.manualAttentionRequired,
        blocked: true,
      });
      log(JSON.stringify({ event: "discovery_run_skipped", reason: result.skippedReason, sessionState: result.sessionState, nextRunInMs }));
      return result;
    }

    const pendingCaptureCount = countPendingCaptureActions(deps.listActions?.() ?? []);
    if (pendingCaptureCount > config.skipIfPendingCaptureCountGt) {
      const result = skippedResult({
        runType,
        sessionState: inspection.sessionState,
        reason: "too_many_pending_capture_actions",
        nextRunInMs,
        lockAcquired: true,
        manualAttentionRequired: inspection.manualAttentionRequired,
        blocked: inspection.blocked,
        pendingCaptureCount,
      });
      log(JSON.stringify({ event: "discovery_run_skipped", reason: result.skippedReason, pendingCaptureCount, nextRunInMs }));
      return result;
    }

    const discovery = await deps.runDiscovery({
      maxJobs: config.maxJobsPerRun,
      maxScrolls: config.maxScrollsPerRun,
      now: deps.now?.() ?? new Date(),
    });
    const result = compactResult({
      ok: discovery.ok,
      runType,
      sessionState: discovery.sessionState,
      manualAttentionRequired: discovery.manualAttentionRequired,
      blocked: discovery.blocked,
      pendingCaptureCount,
      jobsFound: discovery.jobsFound,
      jobsQueued: discovery.jobsQueued,
      duplicatesSkipped: discovery.duplicatesSkipped,
      alreadyHandledSkipped: discovery.alreadyHandledSkipped,
      invalidSkipped: discovery.invalidSkipped,
      scrollsPerformed: discovery.scrollsPerformed,
      newestQueuedPostedAtText: discovery.newestQueuedPostedAtText,
      oldestQueuedPostedAtText: discovery.oldestQueuedPostedAtText,
      queuedActionIds: discovery.queuedActionIds,
      nextRunInMs,
      lockAcquired: true,
      error: discovery.error,
    });
    log(JSON.stringify({ event: "discovery_run_finished", jobsQueued: result.jobsQueued, jobsFound: result.jobsFound, nextRunInMs }));
    return result;
  } catch (error) {
    const result = compactResult({
      ok: false,
      runType,
      sessionState: "unknown",
      ...DEFAULT_RESULT_COUNTS,
      nextRunInMs,
      lockAcquired: true,
      error: error instanceof Error ? error.message : String(error),
    });
    log(JSON.stringify({ event: "discovery_run_error", error: result.error, nextRunInMs }));
    return result;
  } finally {
    runInProgress = false;
  }
}

async function loadChromium(): Promise<PlaywrightChromiumLike> {
  const mod = (await import("playwright")) as { chromium?: PlaywrightChromiumLike };
  if (!mod.chromium) throw new Error("Playwright chromium is unavailable.");
  return mod.chromium;
}

async function withCdpContext<T>(run: (context: Awaited<ReturnType<typeof acquireBrowserSession>>["context"]) => Promise<T>): Promise<T> {
  const chromium = await loadChromium();
  const handle = await acquireBrowserSession(chromium, {
    mode: "cdp",
    cdpUrl: BROWSER_CDP_URL,
    userDataDir: path.resolve(process.cwd(), BROWSER_USER_DATA_DIR),
    chromeExecutablePath: BROWSER_CHROME_EXECUTABLE_PATH ? path.resolve(process.cwd(), BROWSER_CHROME_EXECUTABLE_PATH) : findChromeExecutable(),
    headless: BROWSER_HEADLESS,
  });
  try {
    return await run(handle.context);
  } finally {
    await handle.close();
  }
}

export async function runDiscoveryOnceFromCdp(config = getDiscoverySchedulerConfig()): Promise<DiscoverySchedulerRunResult> {
  return withCdpContext(async (context) => runDiscoverySchedulerCycle(config, {
    inspectSession: async () => {
      const inspection = await inspectBrowserSession(context);
      return { sessionState: inspection.sessionState, manualAttentionRequired: inspection.manualAttentionRequired, blocked: inspection.blocked };
    },
    listActions: () => listBrowserActions(null, 1000),
    runDiscovery: (options) => runDiscoveryBestMatches(context as never, { maxJobs: options.maxJobs, maxScrolls: options.maxScrolls, now: options.now }),
  }, "discovery.run_once", null));
}

async function runContinuousScheduler(config = getDiscoverySchedulerConfig()): Promise<void> {
  if (!config.enabled) {
    process.stdout.write(`${JSON.stringify(compactResult({ ok: true, runType: "discovery.scheduler", sessionState: "disabled", skipped: true, skippedReason: "scheduler_disabled", ...DEFAULT_RESULT_COUNTS, nextRunInMs: null, lockAcquired: false }))}\n`);
    return;
  }

  // Continuous mode intentionally only runs discovery. It never invokes browser:worker or apply/submit logic.
  while (true) {
    const delay = computeDiscoveryJitterMs(config);
    const result = await withCdpContext(async (context) => runDiscoverySchedulerCycle(config, {
      inspectSession: async () => {
        const inspection = await inspectBrowserSession(context);
        return { sessionState: inspection.sessionState, manualAttentionRequired: inspection.manualAttentionRequired, blocked: inspection.blocked };
      },
      listActions: () => listBrowserActions(null, 1000),
      runDiscovery: (options) => runDiscoveryBestMatches(context as never, { maxJobs: options.maxJobs, maxScrolls: options.maxScrolls, now: options.now }),
      log: (message) => process.stderr.write(`${message}\n`),
    }, "discovery.scheduler", delay));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "--run-once";
  try {
    if (mode === "--scheduler") {
      await runContinuousScheduler();
      return;
    }
    if (mode !== "--run-once") {
      process.stdout.write(`${JSON.stringify({ ok: false, runType: "unknown", error: "Usage: discoveryScheduler.ts --run-once|--scheduler" })}\n`);
      process.exitCode = 1;
      return;
    }
    const result = await runDiscoveryOnceFromCdp();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    closeDb();
  }
}

if (require.main === module) {
  void main();
}
