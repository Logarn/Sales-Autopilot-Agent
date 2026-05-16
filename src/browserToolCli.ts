import {
  BROWSER_CDP_URL,
  BROWSER_CHROME_EXECUTABLE_PATH,
  BROWSER_HEADLESS,
  BROWSER_USER_DATA_DIR,
} from "./config";
import { recordBrowserManualAttention } from "./browserSession";
import { acquireBrowserSession, findChromeExecutable, PlaywrightChromiumLike } from "./browserSessionControl";
import { inspectBrowserSession, selectRelevantBrowserPage } from "./browserSessionInspector";
import { runDiscoveryBestMatches } from "./browserDiscoveryTool";
import { startGoogleLoginOnPage } from "./upworkLoginDriver";
import { closeDb } from "./db";
import * as path from "node:path";

export type BrowserToolName = "session.check" | "login.start-google" | "discovery.best-matches";

interface CliOptions {
  tool: string | undefined;
  email?: string;
  maxJobs?: number;
  maxScrolls?: number;
}

interface ToolJsonResult {
  ok: boolean;
  tool: string;
  sessionState?: string;
  manualAttentionReason?: string;
  manualAttentionCategory?: string;
  manualAttentionRequired?: boolean;
  blocked?: boolean;
  currentUrl?: string;
  title?: string;
  retryAllowedAfterManualFix?: boolean;
  emailSelectedOrEntered?: boolean;
  googleAccountChooserVisible?: boolean;
  matchingGoogleAccountVisible?: boolean;
  googleAccountSelected?: boolean;
  emailEntered?: boolean;
  nextExpectedStep?: string;
  error?: string;
  jobsFound?: number;
  jobsQueued?: number;
  duplicatesSkipped?: number;
  alreadyHandledSkipped?: number;
  invalidSkipped?: number;
  scrollsPerformed?: number;
  newestQueuedPostedAtText?: string;
  oldestQueuedPostedAtText?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const [tool, ...rest] = argv;
  const options: CliOptions = { tool };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--email") {
      options.email = rest[index + 1];
      index += 1;
    } else if (rest[index] === "--max-jobs") {
      const parsed = Number.parseInt(rest[index + 1] ?? "", 10);
      options.maxJobs = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
      index += 1;
    } else if (rest[index] === "--max-scrolls") {
      const parsed = Number.parseInt(rest[index + 1] ?? "", 10);
      options.maxScrolls = Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
      index += 1;
    }
  }
  return options;
}

async function loadChromium(): Promise<PlaywrightChromiumLike> {
  const mod = (await import("playwright")) as { chromium?: PlaywrightChromiumLike };
  if (!mod.chromium) {
    throw new Error("Playwright chromium is unavailable.");
  }
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

function compactResult(result: ToolJsonResult): ToolJsonResult {
  const compact: ToolJsonResult = {
    ok: result.ok,
    tool: result.tool,
  };
  for (const key of [
    "sessionState",
    "manualAttentionReason",
    "manualAttentionCategory",
    "manualAttentionRequired",
    "blocked",
    "currentUrl",
    "title",
    "retryAllowedAfterManualFix",
    "emailSelectedOrEntered",
    "googleAccountChooserVisible",
    "matchingGoogleAccountVisible",
    "googleAccountSelected",
    "emailEntered",
    "nextExpectedStep",
    "error",
    "jobsFound",
    "jobsQueued",
    "duplicatesSkipped",
    "alreadyHandledSkipped",
    "invalidSkipped",
    "scrollsPerformed",
    "newestQueuedPostedAtText",
    "oldestQueuedPostedAtText",
  ] as const) {
    const value = result[key];
    if (value !== undefined) {
      (compact as unknown as Record<string, unknown>)[key] = typeof value === "string" ? value.slice(0, 500) : value;
    }
  }
  return compact;
}

async function recordManualAttentionIfNeeded(result: ToolJsonResult): Promise<void> {
  if (!result.blocked || !result.manualAttentionReason) return;
  if (result.manualAttentionReason === "manual_attention_required" || result.manualAttentionReason === "browser_session_unhealthy") return;
  await recordBrowserManualAttention({
    url: result.currentUrl ?? null,
    title: result.title ?? null,
    reason: result.manualAttentionReason,
  });
}

export async function runBrowserTool(options: CliOptions): Promise<{ result: ToolJsonResult; exitCode: number }> {
  if (options.tool !== "session.check" && options.tool !== "login.start-google" && options.tool !== "discovery.best-matches") {
    return {
      result: { ok: false, tool: options.tool ?? "unknown", error: "Unknown browser tool. Supported tools: session.check, login.start-google, discovery.best-matches" },
      exitCode: 1,
    };
  }

  if (options.tool === "session.check") {
    const result = await withCdpContext(async (context) => {
      const inspection = await inspectBrowserSession(context);
      return compactResult({
        ok: !inspection.blocked,
        tool: "session.check",
        sessionState: inspection.sessionState,
        manualAttentionReason: inspection.manualAttentionReason,
        manualAttentionCategory: inspection.manualAttentionCategory,
        manualAttentionRequired: inspection.manualAttentionRequired,
        blocked: inspection.blocked,
        currentUrl: inspection.currentUrl,
        title: inspection.title,
        retryAllowedAfterManualFix: inspection.retryAllowedAfterManualFix,
      });
    });
    await recordManualAttentionIfNeeded(result);
    return { result, exitCode: result.blocked ? 2 : 0 };
  }

  if (options.tool === "discovery.best-matches") {
    const result = await withCdpContext(async (context) => compactResult(await runDiscoveryBestMatches(context as never, { maxJobs: options.maxJobs ?? 5, maxScrolls: options.maxScrolls })));
    await recordManualAttentionIfNeeded(result);
    return { result, exitCode: result.blocked ? 2 : result.ok ? 0 : 1 };
  }

  const email = options.email?.trim();
  if (!email) {
    return { result: { ok: false, tool: "login.start-google", error: "Missing required --email value." }, exitCode: 1 };
  }

  const result = await withCdpContext(async (context) => {
    const pages = context.pages?.() ?? [];
    const selected = selectRelevantBrowserPage(pages);
    if (!selected.page) {
      return compactResult({ ok: false, tool: "login.start-google", sessionState: "unknown", manualAttentionRequired: false, blocked: false, currentUrl: "", title: "", error: "No browser page is available." });
    }
    const loginResult = await startGoogleLoginOnPage(selected.page as never, email);
    return compactResult(loginResult);
  });
  await recordManualAttentionIfNeeded(result);
  return { result, exitCode: result.blocked ? 2 : result.ok ? 0 : 1 };
}

async function main(): Promise<void> {
  const originalConsoleLog = console.log;
  console.log = (...args: unknown[]) => {
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  };

  let exitCode = 1;
  let result: ToolJsonResult;
  try {
    const outcome = await runBrowserTool(parseArgs(process.argv.slice(2)));
    result = outcome.result;
    exitCode = outcome.exitCode;
  } catch (error) {
    result = {
      ok: false,
      tool: process.argv[2] ?? "unknown",
      error: error instanceof Error ? error.message : String(error),
    };
    exitCode = 1;
  } finally {
    closeDb();
  }

  console.log = originalConsoleLog;
  process.stdout.write(`${JSON.stringify(compactResult(result!))}\n`);
  process.exit(exitCode);
}

if (require.main === module) {
  void main();
}
