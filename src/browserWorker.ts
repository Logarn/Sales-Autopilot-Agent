import * as fs from "node:fs";
import * as path from "node:path";
import {
  BROWSER_ACTION_LIMIT,
  BROWSER_ARTIFACT_DIR,
  BROWSER_DRY_RUN,
  BROWSER_HEADLESS,
  BROWSER_USER_DATA_DIR,
  BROWSER_WORKER_ENABLED,
} from "./config";
import {
  closeDb,
  incrementBrowserActionAttempts,
  listBrowserActions,
  updateBrowserActionStatus,
} from "./db";
import { logger } from "./logger";
import { BrowserAction } from "./types";

type DetectedBrowserState =
  | "dry_run"
  | "browser_unavailable"
  | "login_required"
  | "two_factor_required"
  | "captcha_or_security_challenge"
  | "job_page_loaded"
  | "apply_page_loaded"
  | "page_loaded"
  | "no_url";

interface BrowserWorkerOptions {
  dryRun: boolean;
  headless: boolean;
  userDataDir: string;
  artifactDir: string | null;
  limit: number;
}

interface PageSnapshot {
  url: string;
  title: string;
  textExcerpt: string;
}

interface PlaywrightPageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  locator(selector: string): { first(): { textContent(options?: { timeout?: number }): Promise<string | null> } };
}

interface PlaywrightContextLike {
  newPage(): Promise<PlaywrightPageLike>;
  close(): Promise<unknown>;
}

interface PlaywrightChromiumLike {
  launchPersistentContext(
    userDataDir: string,
    options: { headless: boolean }
  ): Promise<PlaywrightContextLike>;
}

function loadOptions(): BrowserWorkerOptions {
  return {
    dryRun: BROWSER_DRY_RUN,
    headless: BROWSER_HEADLESS,
    userDataDir: path.resolve(process.cwd(), BROWSER_USER_DATA_DIR),
    artifactDir: BROWSER_ARTIFACT_DIR ? path.resolve(process.cwd(), BROWSER_ARTIFACT_DIR) : null,
    limit: BROWSER_ACTION_LIMIT,
  };
}

function getActionUrl(action: BrowserAction): string | null {
  const payloadUrl = typeof action.payload.url === "string" ? action.payload.url : null;
  if (payloadUrl) return payloadUrl;
  if (action.actionType === "open_job") return `https://www.upwork.com/jobs/${action.jobId}`;
  if (action.actionType === "open_apply_page") return `https://www.upwork.com/ab/proposals/job/${action.jobId}/apply/`;
  return null;
}

function detectState(snapshot: PageSnapshot, action: BrowserAction): DetectedBrowserState {
  if (!snapshot.url) return "no_url";
  const haystack = `${snapshot.url}\n${snapshot.title}\n${snapshot.textExcerpt}`.toLowerCase();
  if (haystack.includes("two-factor") || haystack.includes("two factor") || haystack.includes("verification code")) {
    return "two_factor_required";
  }
  if (
    haystack.includes("captcha") ||
    haystack.includes("cloudflare") ||
    haystack.includes("security check") ||
    haystack.includes("verify you are human")
  ) {
    return "captcha_or_security_challenge";
  }
  if (haystack.includes("log in") || haystack.includes("login") || haystack.includes("sign in")) {
    return "login_required";
  }
  if (action.actionType === "open_apply_page" || snapshot.url.includes("/apply")) {
    return "apply_page_loaded";
  }
  if (action.actionType === "open_job" || snapshot.url.includes("/jobs/")) {
    return "job_page_loaded";
  }
  return "page_loaded";
}

function artifactSafeName(action: BrowserAction, suffix: string): string {
  return `browser-action-${action.id}-${action.actionType}-${suffix}`.replace(/[^a-z0-9._-]/gi, "_");
}

function saveTextArtifact(options: BrowserWorkerOptions, action: BrowserAction, name: string, content: string): void {
  if (!options.artifactDir) return;
  fs.mkdirSync(options.artifactDir, { recursive: true });
  fs.writeFileSync(path.join(options.artifactDir, artifactSafeName(action, name)), content);
}

function boundedExcerpt(value: string, maxLength = 2000): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function loadChromium(): Promise<PlaywrightChromiumLike | null> {
  try {
    const mod = (await import("playwright")) as { chromium?: PlaywrightChromiumLike };
    return mod.chromium ?? null;
  } catch {
    return null;
  }
}

async function inspectWithBrowser(
  action: BrowserAction,
  options: BrowserWorkerOptions,
  url: string
): Promise<DetectedBrowserState> {
  const chromium = await loadChromium();
  if (!chromium) {
    saveTextArtifact(options, action, "browser-unavailable.json", JSON.stringify({ action, url }, null, 2));
    return "browser_unavailable";
  }

  let context: PlaywrightContextLike | null = null;
  try {
    context = await chromium.launchPersistentContext(options.userDataDir, { headless: options.headless });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    const bodyText = (await page.locator("body").first().textContent({ timeout: 5000 })) ?? "";
    const snapshot: PageSnapshot = {
      url: page.url(),
      title: await page.title(),
      textExcerpt: boundedExcerpt(bodyText),
    };
    const state = detectState(snapshot, action);
    saveTextArtifact(
      options,
      action,
      "snapshot.json",
      JSON.stringify({ state, ...snapshot, artifactPolicy: "minimized-no-html-no-screenshot" }, null, 2)
    );
    return state;
  } finally {
    await context?.close();
  }
}

function terminalStatusForState(state: DetectedBrowserState): "completed" | "paused" {
  if (["login_required", "two_factor_required", "captcha_or_security_challenge", "browser_unavailable"].includes(state)) {
    return "paused";
  }
  return "completed";
}

async function processAction(action: BrowserAction, options: BrowserWorkerOptions): Promise<void> {
  const url = getActionUrl(action);
  updateBrowserActionStatus(action.id, "in_progress");
  incrementBrowserActionAttempts(action.id);

  if (!url) {
    updateBrowserActionStatus(action.id, "paused", "No URL available for browser action.");
    return;
  }

  if (options.dryRun) {
    const state: DetectedBrowserState = "dry_run";
    logger.info(`[dry-run] Would process browser action #${action.id} ${action.actionType}: ${url}`);
    saveTextArtifact(options, action, "dry-run.json", JSON.stringify({ action, url, state }, null, 2));
    updateBrowserActionStatus(action.id, "paused", "Dry run: browser action not opened. Set BROWSER_DRY_RUN=false to inspect pages.");
    return;
  }

  try {
    const state = await inspectWithBrowser(action, options, url);
    updateBrowserActionStatus(action.id, terminalStatusForState(state), `Detected state: ${state}`);
    logger.info(`Browser action #${action.id} detected state: ${state}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateBrowserActionStatus(action.id, "failed", message);
    logger.error(`Browser action #${action.id} failed: ${message}`);
  }
}

export async function runBrowserWorker(options = loadOptions()): Promise<void> {
  if (!BROWSER_WORKER_ENABLED) {
    logger.info("Browser worker is disabled. Set BROWSER_WORKER_ENABLED=true to process queued browser actions.");
    return;
  }

  const pending = listBrowserActions("pending", options.limit);
  if (pending.length === 0) {
    logger.info("No pending browser actions.");
    return;
  }

  logger.info(`Processing ${pending.length} browser action(s). dryRun=${options.dryRun}`);
  for (const action of pending) {
    await processAction(action, options);
  }
}

if (require.main === module) {
  runBrowserWorker()
    .catch((error: unknown) => {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
