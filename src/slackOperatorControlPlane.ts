import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { App } from "@slack/bolt";
import {
  BROWSER_CDP_URL,
  BROWSER_CHROME_EXECUTABLE_PATH,
  BROWSER_HEADLESS,
  BROWSER_START_URL,
  BROWSER_USER_DATA_DIR,
  HEARTBEAT_STALE_AFTER_MS,
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
import { rewriteSlackCopyWithKimi, type SlackCopyProvider } from "./slackCopywriter";

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

export interface LeadEngineRuntimeStatus {
  serviceActive: boolean;
  processActive: boolean;
  heartbeatFresh: boolean;
  heartbeatStatus: string | null;
  lastHeartbeatAt: string | null;
}

export interface SlackOperatorControlDeps {
  buildHealthReport?: typeof buildHealthReport;
  checkCdpEndpoint?: typeof checkCdpEndpoint;
  getBrowserSessionStatus?: typeof getBrowserSessionStatus;
  readHeartbeats?: typeof readHeartbeats;
  readLeadEngineState?: typeof readLatestState;
  readLeadEngineRuntimeStatus?: () => LeadEngineRuntimeStatus;
  runLeadEngineCycle?: typeof runLeadEngineCycle;
  setHuntingPaused?: typeof setHuntingPaused;
  startBrowserSession?: typeof startPersistentChromeSession;
  openRemoteChromeUrl?: (url: string) => Promise<RemoteChromeOpenResult>;
  now?: () => Date;
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
  const raw = match[0].split("|")[0].replace(/[),.;]+$/g, "");
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
  if (/^(?:are you running|are you active|you active|are you alive|you alive|you there|talk to me|are you healthy|is chrome okay|is chrome ok|is slack listening|is the lead engine running|lead engine running|check production health|production health|service status|control status|health check|what are you up to|what(?:'|’)?s happening|where are we|are we good|how(?:'|’)?s it going|how is your day going|can you help me|can you help me with something)$/i.test(commandText)) {
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

function commandSucceeds(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore", timeout: 1_000 });
    return true;
  } catch {
    return false;
  }
}

function leadEngineProcessActive(): boolean {
  try {
    const output = execFileSync("pgrep", [
      "-f",
      "npm run agent:run$|tsx .*src/leadEngine\\.ts --run( |$)|node .*src/leadEngine\\.ts --run( |$)",
    ], { encoding: "utf8", timeout: 1_000 });
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

function readLeadEngineRuntimeStatus(deps: SlackOperatorControlDeps = {}): LeadEngineRuntimeStatus {
  const now = (deps.now ?? (() => new Date()))();
  const heartbeats = (deps.readHeartbeats ?? readHeartbeats)();
  const heartbeat = heartbeats.find((record) => record.worker === "lead-engine") ?? null;
  const lastHeartbeatMs = heartbeat?.updatedAt ? Date.parse(heartbeat.updatedAt) : NaN;
  const heartbeatFresh = Number.isFinite(lastHeartbeatMs) && now.getTime() - lastHeartbeatMs <= HEARTBEAT_STALE_AFTER_MS;
  return {
    serviceActive: commandSucceeds("systemctl", ["is-active", "--quiet", "upwork-agent-lead-engine.service"]),
    processActive: leadEngineProcessActive(),
    heartbeatFresh,
    heartbeatStatus: heartbeat?.status ?? null,
    lastHeartbeatAt: heartbeat?.updatedAt ?? null,
  };
}

function leadEngineIsLive(runtime: LeadEngineRuntimeStatus): boolean {
  return (runtime.serviceActive || runtime.processActive) && runtime.heartbeatFresh;
}

function leadEngineLine(state: LeadEngineCycleSummary | null, runtime: LeadEngineRuntimeStatus): string {
  const control = readHuntingControlState();
  if (control.huntingPaused) {
    return `Lead engine: paused because you asked me to pause hunting.`;
  }
  if (!state) {
    return leadEngineIsLive(runtime)
      ? "Lead engine: service is active, but I do not have a recent run recorded yet."
      : "Lead engine is stopped. I do not have a recent controlled run recorded yet.";
  }
  if (isRecoveredBacklogDrain(state)) {
    return "Lead engine: I cleared an old capture backlog; browser is clean now.";
  }
  if (state.status === "ok") {
    if (leadEngineIsLive(runtime)) {
      return `Lead engine: running normally. I found ${state.jobsFound} lead${state.jobsFound === 1 ? "" : "s"} and queued ${state.jobsQueued}.`;
    }
    const runLabel = state.mode === "run_once" ? "Last controlled run" : "Last lead-engine cycle";
    return `Lead engine is stopped. ${runLabel} found ${state.jobsFound} lead${state.jobsFound === 1 ? "" : "s"} and queued ${state.jobsQueued}.`;
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
  const leadRuntime = (deps.readLeadEngineRuntimeStatus ?? (() => readLeadEngineRuntimeStatus(deps)))();
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
    `I’m here. Slack is live and Chrome is connected.`,
    health.findings.length > 0
      ? `A few things need attention, but there is no active Chrome block right now.`
      : `Nothing is blocking me right now.`,
    leadEngineLine(leadState, leadRuntime),
    qaLine,
    "I can help with one controlled application, show the QA queue, or check what’s blocked.",
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

function preserveOperatorSafetyPhrases(text: string): string[] {
  return [
    "Final submit remains manual",
    "Final submit stays manual",
    "did not click through login, CAPTCHA, security checks, or submit anything",
    "did not paste through VNC or click submit",
  ].filter((phrase) => text.includes(phrase));
}

export async function tryHandleSlackOperatorCommand(input: {
  text: string;
  channelId: string;
  threadTs: string;
  client: SlackClient;
  deps?: SlackOperatorControlDeps;
  copyProvider?: SlackCopyProvider;
}): Promise<boolean> {
  const intent = parseSlackOperatorIntent(input.text);
  if (!intent) return false;
  const deterministicText = await buildSlackOperatorReply(intent, input.deps);
  const copy = await rewriteSlackCopyWithKimi({
    path: "conversation_reply",
    deterministicText,
    userMessage: input.text,
    intent: `operator_${intent.type}`,
    context: { operatorIntent: intent.type },
    preservePhrases: preserveOperatorSafetyPhrases(deterministicText),
  }, input.copyProvider);
  await input.client.chat.postMessage({
    channel: input.channelId,
    thread_ts: input.threadTs,
    text: copy.text,
  });
  return true;
}
