import {
  BROWSER_CDP_URL,
  BROWSER_CHROME_EXECUTABLE_PATH,
  BROWSER_HEADLESS,
  BROWSER_START_URL,
  BROWSER_USER_DATA_DIR,
} from "./config";
import { clearBrowserManualAttention, getBrowserSessionStatus, BrowserSessionStatus } from "./browserSession";
import {
  acquireBrowserSession,
  checkCdpEndpoint,
  classifyBrowserSessionError,
  findChromeExecutable,
  getChromeProfileProcessDiagnostics,
  PlaywrightChromiumLike,
  PlaywrightContextLike,
  startPersistentChromeSession,
} from "./browserSessionControl";
import { countUnknownSourceQueuedCaptureActions, getActiveDiscoverySourceLabelForUrl } from "./browserDiscoveryTool";
import { buildBrowserTabDiagnostics, inspectBrowserSession, BrowserSessionInspection, selectRelevantBrowserPage } from "./browserSessionInspector";
import { closeDb, getBrowserActionById, listBrowserActions } from "./db";
import { BrowserAction } from "./types";
import * as path from "node:path";

const CLEAR_TOOL = "browser.session.clear";

export interface BrowserSessionClearResult {
  ok: boolean;
  tool: typeof CLEAR_TOOL;
  cleared: boolean;
  actionId?: number;
  previousSessionState?: string;
  sessionState?: string;
  visibleSessionState?: string;
  blocked?: boolean;
  actionStatusUnchanged?: string;
  reason?: string;
  error?: string;
}

interface BrowserSessionClearDeps {
  getSessionStatus: () => BrowserSessionStatus;
  getActionById: (id: number) => BrowserAction | null;
  inspectVisibleSession: () => Promise<BrowserSessionInspection>;
  clearManualAttention: (id: number) => unknown;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseActionId(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function compactResult(result: BrowserSessionClearResult): BrowserSessionClearResult {
  const compact: BrowserSessionClearResult = {
    ok: result.ok,
    tool: CLEAR_TOOL,
    cleared: result.cleared,
  };
  for (const key of [
    "actionId",
    "previousSessionState",
    "sessionState",
    "visibleSessionState",
    "blocked",
    "actionStatusUnchanged",
    "reason",
    "error",
  ] as const) {
    const value = result[key];
    if (value !== undefined) {
      (compact as unknown as Record<string, unknown>)[key] = typeof value === "string" ? value.slice(0, 500) : value;
    }
  }
  return compact;
}

function hasRestrictedManualAttentionMarkers(value: string): boolean {
  return /__cf_chl|cdn-cgi\/challenge|challenge|captcha|security\s+check|attention\s+required|manual\s+attention|password|passkey|security\s+key|two[-\s]?factor|2[-\s]?step|verification\s*code|authenticator|otp|suspicious\s+login|unusual\s+(?:activity|traffic)|verify\s+(?:it|you|your)|cloudflare|not\s+a\s+robot|checking\s+your\s+browser/i.test(value);
}

function visibleSessionIsCleanEnough(inspection: BrowserSessionInspection): boolean {
  if (inspection.blocked || inspection.manualAttentionRequired) return false;
  if ([
    "password_required",
    "passkey_required",
    "two_factor_required",
    "captcha_or_security_challenge",
    "suspicious_login_check",
    "manual_attention_required",
    "browser_session_unhealthy",
  ].includes(inspection.sessionState)) {
    return false;
  }
  if (inspection.sessionState === "logged_in") return true;
  if (inspection.sessionState === "unknown") {
    return !hasRestrictedManualAttentionMarkers(`${inspection.currentUrl}\n${inspection.title}\n${inspection.matchedText ?? ""}\n${inspection.summary ?? ""}`);
  }
  return false;
}

export async function runBrowserSessionClear(actionId: number | null, deps: BrowserSessionClearDeps): Promise<{ result: BrowserSessionClearResult; exitCode: number }> {
  if (!actionId) {
    return { result: compactResult({ ok: false, tool: CLEAR_TOOL, cleared: false, error: "Missing required --id value." }), exitCode: 1 };
  }

  const before = deps.getSessionStatus();
  const blockedStates = new Set(["manual_attention_required", "cooling_down", "disabled_until_manual_retry", "browser_session_unhealthy"]);
  if (!before.blocked || !blockedStates.has(before.state)) {
    return {
      result: compactResult({ ok: false, tool: CLEAR_TOOL, cleared: false, actionId, sessionState: before.state, blocked: before.blocked, reason: "stored_session_is_not_blocked" }),
      exitCode: 1,
    };
  }
  if (before.lastManualAttention?.actionId !== actionId) {
    return {
      result: compactResult({ ok: false, tool: CLEAR_TOOL, cleared: false, actionId, sessionState: before.state, blocked: before.blocked, reason: "manual_attention_action_id_mismatch" }),
      exitCode: 1,
    };
  }

  const action = deps.getActionById(actionId);
  if (!action) {
    return {
      result: compactResult({ ok: false, tool: CLEAR_TOOL, cleared: false, actionId, sessionState: before.state, blocked: before.blocked, reason: "action_not_found" }),
      exitCode: 1,
    };
  }
  if (action.status !== "paused") {
    return {
      result: compactResult({ ok: false, tool: CLEAR_TOOL, cleared: false, actionId, sessionState: before.state, blocked: before.blocked, actionStatusUnchanged: action.status, reason: "action_is_not_paused" }),
      exitCode: 1,
    };
  }

  const visible = await deps.inspectVisibleSession();
  if (!visibleSessionIsCleanEnough(visible)) {
    return {
      result: compactResult({
        ok: false,
        tool: CLEAR_TOOL,
        cleared: false,
        actionId,
        sessionState: before.state,
        visibleSessionState: visible.sessionState,
        blocked: true,
        actionStatusUnchanged: action.status,
        reason: "visible_browser_still_requires_manual_attention",
      }),
      exitCode: 2,
    };
  }

  deps.clearManualAttention(actionId);
  const after = deps.getSessionStatus();
  const unchangedAction = deps.getActionById(actionId);
  if (after.blocked) {
    return {
      result: compactResult({ ok: false, tool: CLEAR_TOOL, cleared: false, actionId, previousSessionState: before.state, sessionState: after.state, visibleSessionState: visible.sessionState, blocked: after.blocked, actionStatusUnchanged: unchangedAction?.status, reason: "stored_session_remains_blocked_after_clear" }),
      exitCode: 1,
    };
  }
  if (unchangedAction?.status !== "paused") {
    return {
      result: compactResult({ ok: false, tool: CLEAR_TOOL, cleared: false, actionId, previousSessionState: before.state, sessionState: after.state, visibleSessionState: visible.sessionState, blocked: after.blocked, actionStatusUnchanged: unchangedAction?.status, reason: "action_status_changed_unexpectedly" }),
      exitCode: 1,
    };
  }

  return {
    result: compactResult({
      ok: true,
      tool: CLEAR_TOOL,
      cleared: true,
      actionId,
      previousSessionState: before.state,
      sessionState: after.state,
      visibleSessionState: visible.sessionState,
      blocked: after.blocked,
      actionStatusUnchanged: unchangedAction.status,
    }),
    exitCode: 0,
  };
}

async function loadChromium(): Promise<PlaywrightChromiumLike> {
  const mod = (await import("playwright")) as { chromium?: PlaywrightChromiumLike };
  if (!mod.chromium) throw new Error("Playwright chromium is unavailable.");
  return mod.chromium;
}

interface VisibleCdpSessionDeepInspection {
  inspection: BrowserSessionInspection;
  pageCount: number;
  chromeProcessCount: number;
  duplicateProfileConflict: boolean;
  openUpworkTabCount: number;
  selectedFeedTabUrl: string | null;
  selectedWorkTabUrl: string | null;
  staleWorkTabCount: number;
  ignoredTabCount: number;
  activeDiscoverySourceLabel: string | null;
  unknownSourceQueuedCaptureCount: number;
  selectedPageUrl: string;
  selectedPageTitle: string;
  selectedPageReason: string;
}

async function inspectVisibleCdpSession(): Promise<VisibleCdpSessionDeepInspection> {
  const chromium = await loadChromium();
  const handle = await acquireBrowserSession(chromium, {
    mode: "cdp",
    cdpUrl: BROWSER_CDP_URL,
    userDataDir: path.resolve(process.cwd(), BROWSER_USER_DATA_DIR),
    chromeExecutablePath: BROWSER_CHROME_EXECUTABLE_PATH ? path.resolve(process.cwd(), BROWSER_CHROME_EXECUTABLE_PATH) : findChromeExecutable(),
    headless: BROWSER_HEADLESS,
  });
  try {
    const context = handle.context as PlaywrightContextLike;
    const pages = context.pages?.() ?? [];
    const selected = selectRelevantBrowserPage(pages);
    const processDiagnostics = getChromeProfileProcessDiagnostics({
      userDataDir: path.resolve(process.cwd(), BROWSER_USER_DATA_DIR),
      cdpUrl: BROWSER_CDP_URL,
    });
    const tabDiagnostics = buildBrowserTabDiagnostics(pages);
    const selectedPageUrl = selected.page?.url() ?? "";
    const selectedPageTitle = selected.page ? await selected.page.title().catch(() => "") : "";
    const inspection = await inspectBrowserSession(context, { includeStoredSessionState: false });
    return {
      inspection,
      pageCount: pages.length,
      chromeProcessCount: processDiagnostics.chromeProcessCount,
      duplicateProfileConflict: processDiagnostics.duplicateProfileConflict,
      openUpworkTabCount: tabDiagnostics.openUpworkTabCount,
      selectedFeedTabUrl: tabDiagnostics.selectedFeedTabUrl,
      selectedWorkTabUrl: tabDiagnostics.selectedWorkTabUrl,
      staleWorkTabCount: tabDiagnostics.staleWorkTabCount,
      ignoredTabCount: tabDiagnostics.ignoredTabCount,
      activeDiscoverySourceLabel: tabDiagnostics.selectedFeedTabUrl ? getActiveDiscoverySourceLabelForUrl(tabDiagnostics.selectedFeedTabUrl) : null,
      unknownSourceQueuedCaptureCount: countUnknownSourceQueuedCaptureActions(listBrowserActions(null, 1000)),
      selectedPageUrl,
      selectedPageTitle,
      selectedPageReason: selected.page ? selected.reason : "No pages are open in the default CDP context.",
    };
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "--start") {
    const result = await startPersistentChromeSession({
      chromeExecutablePath: BROWSER_CHROME_EXECUTABLE_PATH || findChromeExecutable(),
      userDataDir: BROWSER_USER_DATA_DIR,
      cdpUrl: BROWSER_CDP_URL,
      startUrl: BROWSER_START_URL,
    });
    console.log(result.message);
    process.exitCode = result.started ? 0 : 1;
    return;
  }

  if (mode === "--check") {
    const result = await checkCdpEndpoint(BROWSER_CDP_URL);
    if (!result.reachable) {
      console.error(`CDP unavailable at ${BROWSER_CDP_URL}: ${result.error ?? "unknown error"}`);
      process.exitCode = 1;
      return;
    }
    console.log(`CDP reachable at ${BROWSER_CDP_URL}`);
    console.log(`Browser: ${result.browserVersion ?? "unknown"}`);
    console.log(`WebSocket: ${result.websocketDebuggerUrl ?? "missing"}`);
    try {
      const deep = await inspectVisibleCdpSession();
      console.log(`Deep check: ok cdpReachable=true connectOverCDP=true defaultContext=true pageCount=${deep.pageCount} sessionState=${deep.inspection.sessionState} blocked=${deep.inspection.blocked}`);
      console.log(`Chrome shared-profile processes: count=${deep.chromeProcessCount} duplicateProfileConflict=${deep.duplicateProfileConflict}`);
      console.log(`Upwork tabs: count=${deep.openUpworkTabCount} feed=${deep.selectedFeedTabUrl ?? "n/a"} work=${deep.selectedWorkTabUrl ?? "n/a"} staleWorkTabs=${deep.staleWorkTabCount} ignoredTabs=${deep.ignoredTabCount}`);
      console.log(`Discovery source: active=${deep.activeDiscoverySourceLabel ?? "n/a"} unknownSourceQueuedCaptures=${deep.unknownSourceQueuedCaptureCount}`);
      console.log(`Selected page: url=${deep.selectedPageUrl || "n/a"} title=${deep.selectedPageTitle || "n/a"}`);
      console.log(`Selected page reason: ${deep.selectedPageReason}`);
      if (deep.duplicateProfileConflict) {
        console.error("Duplicate Chrome/profile conflict detected for the shared browser profile; stop extra Chrome processes before running browser work.");
        process.exitCode = 1;
      }
    } catch (error) {
      const classification = classifyBrowserSessionError(error);
      console.error(`Deep check failed: ${classification}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    } finally {
      closeDb();
    }
    return;
  }

  if (mode === "--clear") {
    let exitCode = 1;
    let result: BrowserSessionClearResult;
    try {
      const outcome = await runBrowserSessionClear(parseActionId(argValue("--id")), {
        getSessionStatus: () => getBrowserSessionStatus(),
        getActionById: (id) => getBrowserActionById(id),
        inspectVisibleSession: async () => (await inspectVisibleCdpSession()).inspection,
        clearManualAttention: (id) => clearBrowserManualAttention(id),
      });
      result = outcome.result;
      exitCode = outcome.exitCode;
    } catch (error) {
      result = compactResult({ ok: false, tool: CLEAR_TOOL, cleared: false, actionId: parseActionId(argValue("--id")) ?? undefined, error: error instanceof Error ? error.message : String(error) });
      exitCode = 1;
    } finally {
      closeDb();
    }
    process.stdout.write(`${JSON.stringify(compactResult(result!))}\n`);
    process.exitCode = exitCode;
    return;
  }

  console.log("Usage:");
  console.log("  npm run browser:session");
  console.log("  npm run browser:cdp:check");
  console.log("  npm run browser:session:clear -- --id <paused-action-id>");
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
