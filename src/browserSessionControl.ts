import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

export type BrowserSessionMode = "launch" | "cdp";

export interface BrowserSessionConnectionOptions {
  mode: BrowserSessionMode;
  userDataDir: string;
  chromeExecutablePath: string | null;
  cdpUrl: string;
  headless: boolean;
}

export interface BrowserSessionLaunchCommand {
  executablePath: string;
  args: string[];
}

export interface BrowserSessionCdpCheckResult {
  reachable: boolean;
  websocketDebuggerUrl?: string;
  browserVersion?: string;
  error?: string;
}

export interface PlaywrightLocatorLike {
  count(): Promise<number>;
  first(): PlaywrightLocatorLike;
  textContent(options?: { timeout?: number }): Promise<string | null>;
  fill(value: string, options?: { timeout?: number }): Promise<unknown>;
  setInputFiles(files: string[], options?: { timeout?: number }): Promise<unknown>;
  check(options?: { timeout?: number }): Promise<unknown>;
}

export interface PlaywrightPageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  locator(selector: string): PlaywrightLocatorLike;
}

export interface PlaywrightContextLike {
  newPage(): Promise<PlaywrightPageLike>;
  pages?(): PlaywrightPageLike[];
  close(): Promise<unknown>;
}

export interface PlaywrightBrowserLike {
  contexts(): PlaywrightContextLike[];
  close(): Promise<unknown>;
}

export interface PlaywrightChromiumLike {
  launchPersistentContext(userDataDir: string, options: { headless: boolean; executablePath?: string }): Promise<PlaywrightContextLike>;
  connectOverCDP(cdpUrl: string): Promise<PlaywrightBrowserLike>;
}

export interface BrowserSessionHandle {
  mode: BrowserSessionMode;
  context: PlaywrightContextLike;
  close(): Promise<void>;
}

let cdpDownloadBehaviorBypassInstalled = false;

export function installCdpDownloadBehaviorBypass(): boolean {
  if (cdpDownloadBehaviorBypassInstalled) return true;
  try {
    const require = createRequire(__filename);
    const packageJsonPath = require.resolve("playwright-core/package.json");
    const modulePath = path.join(path.dirname(packageJsonPath), "lib/server/chromium/crConnection.js");
    const module = require(modulePath) as {
      CRSession?: { prototype?: { send?: (method: string, params?: unknown) => Promise<unknown> } };
    };
    const prototype = module.CRSession?.prototype;
    const original = prototype?.send;
    if (!prototype || typeof original !== "function") return false;
    prototype.send = async function patchedCdpSend(this: unknown, method: string, params?: unknown) {
      if (method === "Browser.setDownloadBehavior") {
        return {};
      }
      return original.call(this, method, params);
    };
    cdpDownloadBehaviorBypassInstalled = true;
    return true;
  } catch {
    return false;
  }
}

export function normalizeBrowserSessionMode(value: string | undefined): BrowserSessionMode {
  return value?.toLowerCase() === "cdp" ? "cdp" : "launch";
}

export function findChromeExecutable(): string | null {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function parseRemoteDebuggingPort(cdpUrl: string): number {
  try {
    return Number.parseInt(new URL(cdpUrl).port || "9222", 10);
  } catch {
    return 9222;
  }
}

export function buildBrowserSessionLaunchCommand(input: {
  chromeExecutablePath: string;
  userDataDir: string;
  cdpUrl: string;
  startUrl?: string;
}): BrowserSessionLaunchCommand {
  const port = parseRemoteDebuggingPort(input.cdpUrl);
  return {
    executablePath: input.chromeExecutablePath,
    args: [
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${path.resolve(input.userDataDir)}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--new-window",
      input.startUrl ?? "https://www.upwork.com/nx/find-work/best-matches/",
    ],
  };
}

export async function checkCdpEndpoint(cdpUrl: string): Promise<BrowserSessionCdpCheckResult> {
  try {
    const versionUrl = new URL("/json/version", cdpUrl).toString();
    const response = await fetch(versionUrl);
    if (!response.ok) {
      return { reachable: false, error: `HTTP ${response.status} from ${versionUrl}` };
    }
    const payload = (await response.json()) as { webSocketDebuggerUrl?: string; Browser?: string };
    if (!payload.webSocketDebuggerUrl) {
      return { reachable: false, error: `CDP endpoint ${versionUrl} responded without webSocketDebuggerUrl.` };
    }
    return {
      reachable: true,
      websocketDebuggerUrl: payload.webSocketDebuggerUrl,
      browserVersion: payload.Browser,
    };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isBrowserProfileInUseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ProcessSingleton|profile.*in use|Opening in existing browser session|SingletonLock|user data directory is already in use/i.test(message);
}

export function isCdpAcquisitionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Browser\.setDownloadBehavior|Browser context management is not supported|connectOverCDP: Protocol error/i.test(message);
}

export function isCdpUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|connect.*9222|websocket.*failed|CDP endpoint.*unreachable/i.test(message);
}

export function classifyBrowserSessionError(error: unknown): "browser_profile_in_use" | "cdp_unavailable" | "cdp_acquisition_failed" | "unknown" {
  if (isBrowserProfileInUseError(error)) return "browser_profile_in_use";
  if (isCdpAcquisitionError(error)) return "cdp_acquisition_failed";
  if (isCdpUnavailableError(error)) return "cdp_unavailable";
  return "unknown";
}

export async function acquireBrowserSession(
  chromium: PlaywrightChromiumLike,
  options: BrowserSessionConnectionOptions,
): Promise<BrowserSessionHandle> {
  if (options.mode === "cdp") {
    const check = await checkCdpEndpoint(options.cdpUrl);
    if (!check.reachable) {
      throw new Error(`CDP endpoint unavailable at ${options.cdpUrl}. Start it with npm run browser:session. ${check.error ?? ""}`.trim());
    }
    installCdpDownloadBehaviorBypass();
    let browser: PlaywrightBrowserLike;
    try {
      browser = await chromium.connectOverCDP(options.cdpUrl);
    } catch (error) {
      if (isCdpAcquisitionError(error)) {
        throw new Error(`CDP acquisition failed at ${options.cdpUrl}: connected to the endpoint, but Playwright could not reuse the existing default context without browser context management. ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    }
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error(`Connected to CDP at ${options.cdpUrl}, but no browser context is available.`);
    }
    return {
      mode: "cdp",
      context,
      close: async () => {
        // Disconnect Playwright's CDP transport without launching or owning the visible Chrome process.
        await browser.close();
      },
    };
  }

  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: options.headless,
    ...(options.chromeExecutablePath ? { executablePath: options.chromeExecutablePath } : {}),
  });
  return {
    mode: "launch",
    context,
    close: async () => {
      await context.close();
    },
  };
}

export async function startPersistentChromeSession(input: {
  chromeExecutablePath: string | null;
  userDataDir: string;
  cdpUrl: string;
  startUrl?: string;
}): Promise<{ started: boolean; message: string }> {
  const executablePath = input.chromeExecutablePath ?? findChromeExecutable();
  if (!executablePath) {
    return { started: false, message: "Chrome executable not found. Set BROWSER_CHROME_EXECUTABLE_PATH first." };
  }

  const command = buildBrowserSessionLaunchCommand({
    chromeExecutablePath: executablePath,
    userDataDir: input.userDataDir,
    cdpUrl: input.cdpUrl,
    startUrl: input.startUrl,
  });
  fs.mkdirSync(path.resolve(input.userDataDir), { recursive: true });
  const child = spawn(command.executablePath, command.args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return {
    started: true,
    message: `Started visible Chrome session with remote debugging at ${input.cdpUrl}. Open Upwork manually, sign in if needed, then run npm run browser:cdp:check.`,
  };
}
