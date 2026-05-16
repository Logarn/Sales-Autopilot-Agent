import * as path from "node:path";
import {
  BROWSER_CDP_URL,
  BROWSER_CHROME_EXECUTABLE_PATH,
  BROWSER_PREFERRED_PROFILE_DIRECTORY,
  BROWSER_PREFERRED_USER_DATA_DIR,
  BROWSER_START_URL,
} from "./config";
import {
  checkCdpEndpoint,
  findChromeExecutable,
  startPersistentChromeSession,
  PlaywrightChromiumLike,
  acquireBrowserSession,
  classifyBrowserSessionError,
} from "./browserSessionControl";
import { inspectBrowserSession } from "./browserSessionInspector";

export interface PreferredBrowserStatus {
  online: boolean;
  cdpReachable: boolean;
  upworkLoggedIn: boolean | null;
  upworkSessionState: string;
  currentUrl: string;
  title: string;
  readyForDiscovery: boolean;
  reason?: string;
  cdpUrl: string;
  userDataDir: string;
  profileDirectory: string;
  startUrl: string;
  browserVersion?: string;
}

export interface PreferredBrowserStartResult {
  started: boolean;
  cdpUrl: string;
  userDataDir: string;
  profileDirectory: string;
  startUrl: string;
  message: string;
}

function resolveChromeExecutable(): string | null {
  return BROWSER_CHROME_EXECUTABLE_PATH ? path.resolve(process.cwd(), BROWSER_CHROME_EXECUTABLE_PATH) : findChromeExecutable();
}

function toUpworkLoggedIn(sessionState: string): boolean | null {
  if (sessionState === "logged_in") return true;
  if (sessionState === "logged_out" || sessionState === "login_in_progress") return false;
  return null;
}

function notReadyReason(input: { cdpReachable: boolean; sessionState: string; inspectionBlocked?: boolean; error?: string }): string | undefined {
  if (!input.cdpReachable) return input.error ? `cdp_unreachable: ${input.error}` : "cdp_unreachable";
  if (input.inspectionBlocked) return `browser_blocked_or_manual_attention_required: ${input.sessionState}`;
  if (input.sessionState !== "logged_in") return `upwork_not_logged_in: ${input.sessionState}`;
  return undefined;
}

export async function startPreferredBrowser(): Promise<PreferredBrowserStartResult> {
  const result = await startPersistentChromeSession({
    chromeExecutablePath: resolveChromeExecutable(),
    userDataDir: BROWSER_PREFERRED_USER_DATA_DIR,
    profileDirectory: BROWSER_PREFERRED_PROFILE_DIRECTORY,
    cdpUrl: BROWSER_CDP_URL,
    startUrl: BROWSER_START_URL,
  });
  return {
    started: result.started,
    cdpUrl: BROWSER_CDP_URL,
    userDataDir: path.resolve(process.cwd(), BROWSER_PREFERRED_USER_DATA_DIR),
    profileDirectory: BROWSER_PREFERRED_PROFILE_DIRECTORY,
    startUrl: BROWSER_START_URL,
    message: result.message,
  };
}

async function loadChromium(): Promise<PlaywrightChromiumLike> {
  const mod = (await import("playwright")) as { chromium?: PlaywrightChromiumLike };
  if (!mod.chromium) throw new Error("Playwright chromium is unavailable.");
  return mod.chromium;
}

export async function checkPreferredBrowserStatus(): Promise<PreferredBrowserStatus> {
  const cdp = await checkCdpEndpoint(BROWSER_CDP_URL);
  const base = {
    cdpUrl: BROWSER_CDP_URL,
    userDataDir: path.resolve(process.cwd(), BROWSER_PREFERRED_USER_DATA_DIR),
    profileDirectory: BROWSER_PREFERRED_PROFILE_DIRECTORY,
    startUrl: BROWSER_START_URL,
    browserVersion: cdp.browserVersion,
  };

  if (!cdp.reachable) {
    return {
      ...base,
      online: false,
      cdpReachable: false,
      upworkLoggedIn: null,
      upworkSessionState: "unknown",
      currentUrl: "",
      title: "",
      readyForDiscovery: false,
      reason: notReadyReason({ cdpReachable: false, sessionState: "unknown", error: cdp.error }),
    };
  }

  try {
    const chromium = await loadChromium();
    const handle = await acquireBrowserSession(chromium, {
      mode: "cdp",
      cdpUrl: BROWSER_CDP_URL,
      userDataDir: path.resolve(process.cwd(), BROWSER_PREFERRED_USER_DATA_DIR),
      chromeExecutablePath: resolveChromeExecutable(),
      headless: false,
    });
    try {
      const inspection = await inspectBrowserSession(handle.context, { includeStoredSessionState: false });
      const readyForDiscovery = inspection.sessionState === "logged_in" && !inspection.blocked && !inspection.manualAttentionRequired;
      return {
        ...base,
        online: true,
        cdpReachable: true,
        upworkLoggedIn: toUpworkLoggedIn(inspection.sessionState),
        upworkSessionState: inspection.sessionState,
        currentUrl: inspection.currentUrl,
        title: inspection.title,
        readyForDiscovery,
        reason: readyForDiscovery ? undefined : notReadyReason({ cdpReachable: true, sessionState: inspection.sessionState, inspectionBlocked: inspection.blocked || inspection.manualAttentionRequired }),
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    const classification = classifyBrowserSessionError(error);
    return {
      ...base,
      online: false,
      cdpReachable: true,
      upworkLoggedIn: null,
      upworkSessionState: "unknown",
      currentUrl: "",
      title: "",
      readyForDiscovery: false,
      reason: `${classification}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
    };
  }
}
