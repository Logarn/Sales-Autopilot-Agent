import * as path from "node:path";
import { App } from "@slack/bolt";
import {
  BROWSER_CDP_URL,
  BROWSER_CHROME_EXECUTABLE_PATH,
  BROWSER_HEADLESS,
  BROWSER_START_URL,
  BROWSER_USER_DATA_DIR,
} from "./config";
import { getBrowserSessionStatus, listUnresolvedBrowserChallengeQuarantines } from "./browserSession";
import { isSupportedUpworkJobUrl } from "./browserCapture";
import {
  acquireBrowserSession,
  checkCdpEndpoint,
  findChromeExecutable,
  PlaywrightChromiumLike,
  startPersistentChromeSession,
} from "./browserSessionControl";
import { buildHealthReport } from "./health";
import { readHeartbeats } from "./heartbeat";
import { isRecoveredBacklogDrain, readLatestState, runLeadEngineCycle, type LeadEngineCycleSummary } from "./leadEngine";
import { readHuntingControlState, setHuntingPaused } from "./operatorControlState";
import { getProtectedQaQueueItems } from "./browserQaWorkspace";

type SlackClient = App["client"];

export type SlackOperatorIntent =
  | { type: "service_status" }
  | { type: "pause_hunting" }
  | { type: "start_hunting" }
  | { type: "restart_browser_session" }
  | { type: "open_remote_chrome"; url: string };

export interface RemoteChromeOpenResult {
  ok: boolean;
  text: string;
}

export interface SlackOperatorControlDeps {
  buildHealthReport?: typeof buildHealthReport;
  checkCdpEndpoint?: typeof checkCdpEndpoint;
  getBrowserSessionStatus?: typeof getBrowserSessionStatus;
  readHeartbeats?: typeof readHeartbeats;
  readLeadEngineState?: typeof readLatestState;
  runLeadEngineCycle?: typeof runLeadEngineCycle;
  setHuntingPaused?: typeof setHuntingPaused;
  startBrowserSession?: typeof startPersistentChromeSession;
  openRemoteChromeUrl?: (url: string) => Promise<RemoteChromeOpenResult>;
}

function normalizeOperatorText(value: string): string {
  return value
    .replace(/<@[A-Za-z0-9_]+(?:\|[^>]+)?>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.!?]+$/g, "").trim();
}

function parseHttpUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>]+/i);
  if (!match) return null;
  const raw = match[0].replace(/[),.;]+$/g, "");
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isAllowedRemoteChromeOperatorUrl(value: string): boolean {
  return isSupportedUpworkJobUrl(value);
}

export function parseSlackOperatorIntent(text: string): SlackOperatorIntent | null {
  const normalized = normalizeOperatorText(text);
  const commandText = stripTrailingPunctuation(normalized).toLowerCase();
  const url = parseHttpUrl(normalized);
  if (
    url &&
    isAllowedRemoteChromeOperatorUrl(url) &&
    /\b(?:open|bring|show|focus)\b.*\b(?:chrome|browser|application|draft|page|this)\b/i.test(normalized)
  ) {
    return { type: "open_remote_chrome", url };
  }
  if (/^(?:are you running|are you healthy|is chrome okay|is chrome ok|is slack listening|is the lead engine running|lead engine running|check production health|production health|service status|control status|health check)$/i.test(commandText)) {
    return { type: "service_status" };
  }
  if (/^(?:pause hunting|stop hunting|hold hunting|pause lead engine|pause discovery)$/i.test(commandText)) {
    return { type: "pause_hunting" };
  }
  if (/^(?:start hunting|resume hunting|restart hunting|start lead engine|resume lead engine|kick off hunting)$/i.test(commandText)) {
    return { type: "start_hunting" };
  }
  if (/^(?:restart browser session|restart chrome session|start browser session|start chrome|restart chrome)$/i.test(commandText)) {
    return { type: "restart_browser_session" };
  }
  return null;
}

function humanizeReason(value: string | null | undefined): string {
  if (!value) return "needs attention";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function leadEngineLine(state: LeadEngineCycleSummary | null): string {
  const control = readHuntingControlState();
  if (control.huntingPaused) {
    return `Lead engine: paused because you asked me to pause hunting.`;
  }
  if (!state) return "Lead engine: I do not have a recent run recorded yet.";
  if (isRecoveredBacklogDrain(state)) {
    return "Lead engine: I cleared an old capture backlog; browser is clean now.";
  }
  if (state.status === "ok") {
    return `Lead engine: running normally. I found ${state.jobsFound} lead${state.jobsFound === 1 ? "" : "s"} and queued ${state.jobsQueued}.`;
  }
  if (state.status === "paused") {
    return `Lead engine: paused safely because ${humanizeReason(state.stoppedReason)}.`;
  }
  return `Lead engine: needs attention because ${humanizeReason(state.stoppedReason)}.`;
}

async function buildOperatorStatusReply(deps: SlackOperatorControlDeps = {}): Promise<string> {
  const health = (deps.buildHealthReport ?? buildHealthReport)();
  const browserSession = (deps.getBrowserSessionStatus ?? getBrowserSessionStatus)();
  const quarantined = listUnresolvedBrowserChallengeQuarantines();
  const cdp = await (deps.checkCdpEndpoint ?? checkCdpEndpoint)(BROWSER_CDP_URL);
  const leadState = (deps.readLeadEngineState ?? readLatestState)();
  const protectedCount = getProtectedQaQueueItems(1000).length;
  const qaLine = protectedCount > 0
    ? `${protectedCount} QA application${protectedCount === 1 ? " is" : "s are"} waiting.`
    : "No QA applications are waiting.";

  if (browserSession.blocked || !cdp.reachable) {
    return [
      "I’m up, but Chrome needs Steve before I can keep hunting.",
      cdp.reachable ? "Slack is live. Chrome is connected, but Upwork is showing a browser/security check." : "Slack is live. Remote Chrome is not reachable cleanly right now.",
      "Clear the visible remote Chrome check, then say “retry.” I won’t bypass it or submit anything.",
    ].join("\n");
  }

  if (quarantined.length > 0) {
    return [
      "Yeah — I’m up. Slack is live and Chrome is connected.",
      `I’m paused because ${quarantined.length} old apply item${quarantined.length === 1 ? " is" : "s are"} still sitting from the earlier Upwork check. Browser itself looks clean now.`,
      `${qaLine} Best move: skip the stale blocked applications, then I’ll restart hunting if the next check is clean.`,
    ].join("\n");
  }

  return [
    `Yeah — I’m running. Slack is live and Chrome is connected.`,
    health.findings.length > 0
      ? `A few things need attention, but there is no active Chrome block right now.`
      : `Nothing is blocking me right now.`,
    leadEngineLine(leadState),
    qaLine,
    "Final submit stays manual.",
  ].join("\n");
}

async function startHunting(deps: SlackOperatorControlDeps = {}): Promise<string> {
  (deps.setHuntingPaused ?? setHuntingPaused)(false);
  const run = deps.runLeadEngineCycle ?? runLeadEngineCycle;
  const summary = await run({ mode: "run_once", dryRun: false });
  if (summary.status === "ok") {
    return `I started hunting. I queued ${summary.jobsQueued} new lead${summary.jobsQueued === 1 ? "" : "s"} and checked the browser queue. Final submit remains manual.`;
  }
  if (summary.status === "paused") {
    return `I tried to start hunting, but I paused safely because ${humanizeReason(summary.stoppedReason)}. Chrome and protected QA tabs were left alone.`;
  }
  return `I started a hunting check, but it needs attention because ${humanizeReason(summary.stoppedReason)}. Final submit remains manual.`;
}

async function restartBrowserSession(deps: SlackOperatorControlDeps = {}): Promise<string> {
  const start = deps.startBrowserSession ?? startPersistentChromeSession;
  const result = await start({
    chromeExecutablePath: BROWSER_CHROME_EXECUTABLE_PATH ? path.resolve(process.cwd(), BROWSER_CHROME_EXECUTABLE_PATH) : findChromeExecutable(),
    userDataDir: path.resolve(process.cwd(), BROWSER_USER_DATA_DIR),
    cdpUrl: BROWSER_CDP_URL,
    startUrl: BROWSER_START_URL,
  });
  if (result.started) {
    return "I started the visible Chrome session with remote debugging. I did not click through login, CAPTCHA, security checks, or submit anything.";
  }
  return `Chrome was not restarted by force: ${result.message}`;
}

async function loadChromium(): Promise<PlaywrightChromiumLike> {
  const mod = (await import("playwright")) as { chromium?: PlaywrightChromiumLike };
  if (!mod.chromium) throw new Error("Playwright chromium is unavailable.");
  return mod.chromium;
}

export async function openRemoteChromeUrl(url: string): Promise<RemoteChromeOpenResult> {
  if (!isAllowedRemoteChromeOperatorUrl(url)) {
    return {
      ok: false,
      text: "I can only open known Upwork job or apply pages in remote Chrome from Slack. I did not open that URL.",
    };
  }
  const chromium = await loadChromium();
  const handle = await acquireBrowserSession(chromium, {
    mode: "cdp",
    cdpUrl: BROWSER_CDP_URL,
    userDataDir: path.resolve(process.cwd(), BROWSER_USER_DATA_DIR),
    chromeExecutablePath: BROWSER_CHROME_EXECUTABLE_PATH ? path.resolve(process.cwd(), BROWSER_CHROME_EXECUTABLE_PATH) : findChromeExecutable(),
    headless: BROWSER_HEADLESS,
  });
  try {
    const context = handle.context;
    const pages = context.pages?.() ?? [];
    const existing = pages.find((page) => page.url() === url);
    const page = existing ?? await context.newPage();
    if (!existing) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    if (typeof page.bringToFront === "function") {
      await page.bringToFront();
    }
    return {
      ok: true,
      text: "I opened that in remote Chrome and brought the tab forward. I did not paste through VNC or click submit.",
    };
  } finally {
    await handle.close();
  }
}

export async function buildSlackOperatorReply(intent: SlackOperatorIntent, deps: SlackOperatorControlDeps = {}): Promise<string> {
  if (intent.type === "service_status") {
    return buildOperatorStatusReply(deps);
  }
  if (intent.type === "pause_hunting") {
    (deps.setHuntingPaused ?? setHuntingPaused)(true, "Paused from Slack.");
    return "I paused hunting. I left Chrome and the prepared QA tabs open.";
  }
  if (intent.type === "start_hunting") {
    return startHunting(deps);
  }
  if (intent.type === "restart_browser_session") {
    return restartBrowserSession(deps);
  }
  if (!isAllowedRemoteChromeOperatorUrl(intent.url)) {
    return "I can only open known Upwork job or apply pages in remote Chrome from Slack. I did not open that URL.";
  }
  const result = await (deps.openRemoteChromeUrl ?? openRemoteChromeUrl)(intent.url);
  return result.text;
}

export async function tryHandleSlackOperatorCommand(input: {
  text: string;
  channelId: string;
  threadTs: string;
  client: SlackClient;
  deps?: SlackOperatorControlDeps;
}): Promise<boolean> {
  const intent = parseSlackOperatorIntent(input.text);
  if (!intent) return false;
  const text = await buildSlackOperatorReply(intent, input.deps);
  await input.client.chat.postMessage({
    channel: input.channelId,
    thread_ts: input.threadTs,
    text,
  });
  return true;
}
