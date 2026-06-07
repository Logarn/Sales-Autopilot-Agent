import * as path from "node:path";
import {
  BROWSER_CDP_URL,
  BROWSER_CHROME_EXECUTABLE_PATH,
  BROWSER_HEADLESS,
  BROWSER_QA_MAX_PROTECTED_TABS,
  BROWSER_USER_DATA_DIR,
} from "./config";
import { buildBrowserApplyPlan } from "./browserApply";
import { extractUpworkJobIdFromUrl } from "./browserCapture";
import {
  acquireBrowserSession,
  findChromeExecutable,
  PlaywrightChromiumLike,
  PlaywrightContextLike,
} from "./browserSessionControl";
import {
  getApplicationStatus,
  getScoredJobForSlackPreview,
  listBrowserActions,
} from "./db";
import {
  getProtectedQaApplyUrl,
  isProtectedQaApplyAction,
  readBrowserQaHoldPayload,
} from "./browserQaHold";
import type { BrowserAction } from "./types";

export interface ProtectedQaQueueItem {
  index: number;
  action: BrowserAction;
  jobId: string;
  title: string;
  state: "ready" | "blocked";
  status: string;
  applyUrl: string | null;
  proof: string;
  files: string;
  connects: string;
  boost: string;
  nextAction: string;
}

export interface ProtectedQaFocusResult {
  ok: boolean;
  text: string;
  item?: ProtectedQaQueueItem;
}

function basenameList(values: string[], limit = 3): string {
  const names = values.map((item) => path.basename(item)).filter(Boolean);
  if (names.length === 0) return "none";
  const shown = names.slice(0, limit);
  return names.length > limit ? `${shown.join(", ")} + ${names.length - limit} more` : shown.join(", ");
}

function compactTitle(value: string): string {
  return value.length > 74 ? `${value.slice(0, 71)}...` : value;
}

function sameUpworkJob(left: string, right: string): boolean {
  const leftJobId = extractUpworkJobIdFromUrl(left);
  const rightJobId = extractUpworkJobIdFromUrl(right);
  return Boolean(leftJobId && rightJobId && leftJobId === rightJobId) || left === right;
}

function queueStateForAction(action: BrowserAction, applicationStatus: string | null): ProtectedQaQueueItem["state"] {
  if (action.status === "paused" || action.status === "failed" || applicationStatus === "needs_review") {
    return "blocked";
  }
  return "ready";
}

function humanStatus(item: ProtectedQaQueueItem): string {
  if (item.state === "blocked") return "blocked";
  if (item.status === "draft_prepared") return "ready";
  return "ready";
}

export function getProtectedQaQueueItems(limit = BROWSER_QA_MAX_PROTECTED_TABS): ProtectedQaQueueItem[] {
  return listBrowserActions(null, 1000)
    .filter((action) => isProtectedQaApplyAction(action, getApplicationStatus))
    .slice(-limit)
    .map((action, index) => {
      const applicationStatus = getApplicationStatus(action.jobId);
      const hold = readBrowserQaHoldPayload(action);
      const plan = buildBrowserApplyPlan(action.jobId).plan;
      const job = getScoredJobForSlackPreview(action.jobId);
      const applyUrl = getProtectedQaApplyUrl(action, getApplicationStatus);
      const proofNames = plan?.highlights ?? [];
      const files = plan?.attachments.map((attachment) => attachment.filePath) ?? [];
      const required = plan?.connects.required ?? null;
      const boost = plan?.connects.boost ?? null;
      const state = queueStateForAction(action, applicationStatus);
      const reason = action.lastError || hold?.reason || hold?.state || "remote Chrome needs review";
      return {
        index: index + 1,
        action,
        jobId: action.jobId,
        title: compactTitle(job?.title ?? plan?.jobTitle ?? action.jobId),
        state,
        status: applicationStatus ?? action.status,
        applyUrl,
        proof: proofNames.length > 0 ? proofNames.slice(0, 2).join(", ") : "planned proof not selected",
        files: basenameList(files, 2),
        connects: required === null ? "unknown" : `${required}`,
        boost: boost && boost > 0 ? `${boost}` : "none",
        nextAction: state === "blocked" ? `clear Chrome, then reply "retry" (${reason})` : "review in remote Chrome, ask for changes, or manually submit",
      };
    });
}

export function canQueueNewQaPreparation(jobId: string): { ok: boolean; count: number; max: number } {
  const items = getProtectedQaQueueItems(1000);
  if (items.some((item) => item.jobId === jobId)) {
    return { ok: true, count: items.length, max: BROWSER_QA_MAX_PROTECTED_TABS };
  }
  return {
    ok: items.length < BROWSER_QA_MAX_PROTECTED_TABS,
    count: items.length,
    max: BROWSER_QA_MAX_PROTECTED_TABS,
  };
}

export function formatProtectedQaQueueReply(items = getProtectedQaQueueItems(1000)): string {
  if (items.length === 0) {
    return "QA queue is empty. No prepared or blocked applications are waiting in remote Chrome.";
  }
  return [
    "QA queue",
    "",
    ...items.map((item) => [
      `${item.index}. ${item.title} - ${humanStatus(item)}`,
      `   Portfolio: ${item.proof}`,
      `   Files: ${item.files}`,
      `   Connects: ${item.connects}${item.boost !== "none" ? ` + boost ${item.boost}` : ""}`,
      `   Next: ${item.nextAction}`,
      `   Say "open ${item.index}" to bring it up in remote Chrome.`,
    ].join("\n")),
  ].join("\n");
}

export function findProtectedQaQueueItem(input: { jobId?: string | null; index?: number; query?: string | null }): ProtectedQaQueueItem | null {
  const items = getProtectedQaQueueItems(1000);
  if (input.jobId) {
    const byJob = items.find((item) => item.jobId === input.jobId);
    if (byJob) return byJob;
  }
  if (input.index && input.index > 0) {
    const byIndex = items.find((item) => item.index === input.index);
    if (byIndex) return byIndex;
  }
  const query = input.query?.trim().toLowerCase();
  if (query) {
    if (query === "blocked") return items.find((item) => item.state === "blocked") ?? null;
    if (query === "ready") return items.find((item) => item.state === "ready") ?? null;
    return items.find((item) =>
      item.title.toLowerCase().includes(query) ||
      item.state === query ||
      item.status.toLowerCase().includes(query) ||
      item.nextAction.toLowerCase().includes(query) ||
      item.jobId.toLowerCase().includes(query)
    ) ?? null;
  }
  return null;
}

async function loadChromium(): Promise<PlaywrightChromiumLike> {
  const mod = (await import("playwright")) as { chromium?: PlaywrightChromiumLike };
  if (!mod.chromium) {
    throw new Error("Playwright chromium is unavailable.");
  }
  return mod.chromium;
}

export async function focusProtectedQaApplicationTab(input: {
  jobId?: string | null;
  index?: number;
  query?: string | null;
}, deps: {
  chromium?: PlaywrightChromiumLike;
  acquireSession?: typeof acquireBrowserSession;
} = {}): Promise<ProtectedQaFocusResult> {
  const item = findProtectedQaQueueItem(input);
  if (!item) {
    return {
      ok: false,
      text: "I do not have a protected QA application tab matching that request. Ask “what’s ready?” to see the QA queue.",
    };
  }
  if (!item.applyUrl) {
    return {
      ok: false,
      item,
      text: "I found the QA item, but I do not have a saved apply-page URL for it. Ask for debug details if you want the raw queue state.",
    };
  }

  const chromium = deps.chromium ?? await loadChromium();
  const handle = await (deps.acquireSession ?? acquireBrowserSession)(chromium, {
    mode: "cdp",
    cdpUrl: BROWSER_CDP_URL,
    userDataDir: path.resolve(process.cwd(), BROWSER_USER_DATA_DIR),
    chromeExecutablePath: BROWSER_CHROME_EXECUTABLE_PATH ? path.resolve(process.cwd(), BROWSER_CHROME_EXECUTABLE_PATH) : findChromeExecutable(),
    headless: BROWSER_HEADLESS,
  });
  try {
    const context = handle.context as PlaywrightContextLike;
    const page = (context.pages?.() ?? []).find((candidate) => sameUpworkJob(candidate.url(), item.applyUrl!));
    if (!page) {
      return {
        ok: false,
        item,
        text: "I found the protected QA item, but the matching remote Chrome tab is not open anymore. I did not reuse another tab or click submit.",
      };
    }
    if (typeof page.bringToFront === "function") {
      await page.bringToFront();
    }
    return {
      ok: true,
      item,
      text: "Done — I brought the remote Chrome application tab to the front. Review it in remote Chrome. Final submit is still untouched.",
    };
  } finally {
    await handle.close();
  }
}
