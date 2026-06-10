import * as path from "node:path";
import {
  BROWSER_CDP_URL,
  BROWSER_CHROME_EXECUTABLE_PATH,
  BROWSER_HEADLESS,
  BROWSER_QA_MAX_PROTECTED_TABS,
  BROWSER_USER_DATA_DIR,
} from "./config";
import { buildBrowserApplyPlan } from "./browserApply";
import {
  acquireBrowserSession,
  findChromeExecutable,
  PlaywrightChromiumLike,
  PlaywrightContextLike,
} from "./browserSessionControl";
import {
  getActiveBatchApplyWorkspace,
  getApplicationStatus,
  getLatestProposalVersion,
  getScoredJobForSlackPreview,
  listBatchApplyWorkspaceItems,
  listBrowserActions,
  updateBatchApplyWorkspaceItemStatus,
  type BatchApplyWorkspaceItemStatus,
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
  channelId: string | null;
  threadTs: string | null;
  title: string;
  state: "ready" | "blocked";
  status: string;
  applyUrl: string | null;
  tabReference: string | null;
  proposalVersion: number | null;
  screening: string;
  proof: string;
  portfolio: string;
  files: string;
  connects: string;
  boost: string;
  lastVerifiedAt: string | null;
  nextAction: string;
}

export interface ProtectedQaFocusResult {
  ok: boolean;
  text: string;
  item?: ProtectedQaQueueItem;
}

export interface BatchApplyWorkspaceItemView {
  index: number;
  jobId: string;
  channelId: string | null;
  threadTs: string | null;
  title: string;
  status: BatchApplyWorkspaceItemStatus;
  applyUrl: string | null;
  tabReference: string | null;
  proposalVersion: number | null;
  screening: string;
  proof: string;
  portfolio: string;
  files: string;
  connects: string;
  boost: string;
  lastVerifiedAt: string | null;
  nextAction: string;
  action?: BrowserAction;
}

export interface BatchApplyWorkspaceView {
  id: number | null;
  targetCount: number;
  status: "active" | "derived";
  items: BatchApplyWorkspaceItemView[];
  counts: Record<BatchApplyWorkspaceItemStatus, number>;
}

const BATCH_STATUSES: BatchApplyWorkspaceItemStatus[] = [
  "queued",
  "preparing",
  "ready",
  "blocked",
  "stale",
  "tab_missing",
  "skipped",
  "submitted",
];

function basenameList(values: string[], limit = 3): string {
  const names = values.map((item) => path.basename(item)).filter(Boolean);
  if (names.length === 0) return "none";
  const shown = names.slice(0, limit);
  return names.length > limit ? `${shown.join(", ")} + ${names.length - limit} more` : shown.join(", ");
}

function compactList(values: string[], limit = 2, empty = "none"): string {
  const unique = Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
  if (unique.length === 0) return empty;
  const shown = unique.slice(0, limit);
  return unique.length > limit ? `${shown.join(", ")} + ${unique.length - limit} more` : shown.join(", ");
}

function compactTitle(value: string): string {
  return value.length > 74 ? `${value.slice(0, 71)}...` : value;
}

function payloadString(action: BrowserAction, key: string): string | null {
  const value = action.payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizedSavedApplyUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/+$/g, "").toLowerCase();
    if (!/\/ab\/proposals\/job\/~[^/]+\/apply$/i.test(pathname)) return null;
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return `${hostname}${pathname}`;
  } catch {
    return null;
  }
}

function sameSavedApplyTab(candidateUrl: string, savedApplyUrl: string): boolean {
  const candidate = normalizedSavedApplyUrl(candidateUrl);
  const saved = normalizedSavedApplyUrl(savedApplyUrl);
  return Boolean(candidate && saved && candidate === saved);
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

function humanBlockedReason(value: string): string {
  if (/\b(captcha_or_security_challenge|captcha|cloudflare|just a moment|security check)\b/i.test(value)) {
    return "Upwork asked for a browser check";
  }
  if (/\b(login_required|log in|sign in)\b/i.test(value)) return "Upwork needs the remote Chrome session signed in";
  if (/\b(two_factor_required|2fa|two-factor|passkey)\b/i.test(value)) return "Upwork needs a human security check";
  return "remote Chrome needs review";
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
      const portfolioNames = plan?.portfolioHighlights ?? [];
      const files = plan?.attachments.map((attachment) => attachment.filePath) ?? [];
      const required = plan?.connects.required ?? null;
      const boost = plan?.connects.boost ?? null;
      const latestProposal = getLatestProposalVersion(action.jobId);
      const state = queueStateForAction(action, applicationStatus);
      const reason = humanBlockedReason(action.lastError || hold?.reason || hold?.state || "remote Chrome needs review");
      return {
        index: index + 1,
        action,
        jobId: action.jobId,
        channelId: payloadString(action, "channelId"),
        threadTs: payloadString(action, "threadTs"),
        title: compactTitle(job?.title ?? plan?.jobTitle ?? action.jobId),
        state,
        status: applicationStatus ?? action.status,
        applyUrl,
        tabReference: applyUrl,
        proposalVersion: latestProposal?.versionNumber ?? null,
        screening: plan?.screeningAnswers.length ? `${plan.screeningAnswers.length} answer${plan.screeningAnswers.length === 1 ? "" : "s"}` : "none captured",
        proof: proofNames.length > 0 ? compactList(proofNames, 2) : "planned proof not selected",
        portfolio: portfolioNames.length > 0 ? compactList(portfolioNames, 2) : "none selected",
        files: basenameList(files, 2),
        connects: required === null ? "unknown" : `${required}`,
        boost: boost && boost > 0 ? `${boost}` : "none",
        lastVerifiedAt: action.updatedAt ?? hold?.createdAt ?? null,
        nextAction: state === "blocked" ? `${reason}. Clear it, then reply "retry" or "skip this one".` : "review in remote Chrome, ask for changes, or manually submit",
      };
    });
}

function activeQaPreparationReservations(): Set<string> {
  const reservations = new Set<string>();
  for (const item of getProtectedQaQueueItems(1000)) {
    reservations.add(item.jobId);
  }
  for (const action of listBrowserActions(null, 1000)) {
    if (action.actionType !== "prepare_application_review") continue;
    if (action.status !== "pending" && action.status !== "in_progress") continue;
    const applicationStatus = getApplicationStatus(action.jobId);
    if (applicationStatus === "submitted" || applicationStatus === "applied" || applicationStatus === "rejected") continue;
    reservations.add(action.jobId);
  }
  return reservations;
}

export function canQueueNewQaPreparation(jobId: string): { ok: boolean; count: number; max: number } {
  const reservations = activeQaPreparationReservations();
  if (reservations.has(jobId)) {
    return { ok: true, count: reservations.size, max: BROWSER_QA_MAX_PROTECTED_TABS };
  }
  return {
    ok: reservations.size < BROWSER_QA_MAX_PROTECTED_TABS,
    count: reservations.size,
    max: BROWSER_QA_MAX_PROTECTED_TABS,
  };
}

function batchStatusFor(input: {
  recordedStatus?: BatchApplyWorkspaceItemStatus;
  action?: BrowserAction | null;
  protectedItem?: ProtectedQaQueueItem | null;
  applicationStatus: string | null;
}): BatchApplyWorkspaceItemStatus {
  if (input.applicationStatus === "submitted" || input.applicationStatus === "applied") return "submitted";
  if (input.applicationStatus === "rejected") return "skipped";
  if (input.recordedStatus === "tab_missing") return "tab_missing";
  if (input.protectedItem?.state === "blocked") return "blocked";
  if (input.protectedItem?.state === "ready") return "ready";
  if (input.action?.status === "pending") return "queued";
  if (input.action?.status === "in_progress") return "preparing";
  if (input.action?.status === "paused" || input.action?.status === "failed") return "blocked";
  if (input.action?.status === "completed") return "ready";
  if (input.action?.status === "cancelled") return "skipped";
  return input.recordedStatus ?? "stale";
}

function latestPrepareAction(jobId: string): BrowserAction | null {
  return listBrowserActions(null, 1000)
    .filter((action) => action.jobId === jobId && action.actionType === "prepare_application_review")
    .slice(-1)[0] ?? null;
}

function emptyCounts(): Record<BatchApplyWorkspaceItemStatus, number> {
  return Object.fromEntries(BATCH_STATUSES.map((status) => [status, 0])) as Record<BatchApplyWorkspaceItemStatus, number>;
}

function nextActionForStatus(status: BatchApplyWorkspaceItemStatus): string {
  switch (status) {
    case "queued":
      return "waiting for browser prep";
    case "preparing":
      return "browser prep is running";
    case "ready":
      return "ready for manual review";
    case "blocked":
      return "needs browser or page review before QA";
    case "stale":
      return "stale record; rebuild or skip";
    case "tab_missing":
      return "saved tab was missing; rebuild or skip";
    case "skipped":
      return "skipped from active batch";
    case "submitted":
      return "marked submitted after manual send";
  }
}

export function getBatchApplyWorkspaceView(): BatchApplyWorkspaceView {
  const batch = getActiveBatchApplyWorkspace();
  const protectedItems = getProtectedQaQueueItems(1000);
  const counts = emptyCounts();

  if (!batch) {
    const derivedItems = protectedItems.map((item): BatchApplyWorkspaceItemView => {
      const status: BatchApplyWorkspaceItemStatus = item.state === "blocked" ? "blocked" : "ready";
      counts[status] += 1;
      return {
        index: item.index,
        jobId: item.jobId,
        channelId: item.channelId,
        threadTs: item.threadTs,
        title: item.title,
        status,
        applyUrl: item.applyUrl,
        tabReference: item.tabReference,
        proposalVersion: item.proposalVersion,
        screening: item.screening,
        proof: item.proof,
        portfolio: item.portfolio,
        files: item.files,
        connects: item.connects,
        boost: item.boost,
        lastVerifiedAt: item.lastVerifiedAt,
        nextAction: item.nextAction,
        action: item.action,
      };
    });
    return {
      id: null,
      targetCount: BROWSER_QA_MAX_PROTECTED_TABS,
      status: "derived",
      items: derivedItems,
      counts,
    };
  }

  const protectedByJob = new Map(protectedItems.map((item) => [item.jobId, item]));
  const items = listBatchApplyWorkspaceItems(batch.id).map((record): BatchApplyWorkspaceItemView => {
    const protectedItem = protectedByJob.get(record.jobId) ?? null;
    const action = protectedItem?.action ?? latestPrepareAction(record.jobId);
    const applicationStatus = getApplicationStatus(record.jobId);
    const status = batchStatusFor({
      recordedStatus: record.status,
      action,
      protectedItem,
      applicationStatus,
    });
    counts[status] += 1;
    if (status !== record.status) {
      updateBatchApplyWorkspaceItemStatus({
        batchId: batch.id,
        jobId: record.jobId,
        status,
        lastVerifiedAt: action?.updatedAt ?? record.lastVerifiedAt,
      });
    }
    return {
      index: record.position,
      jobId: record.jobId,
      channelId: record.channelId ?? protectedItem?.channelId ?? null,
      threadTs: record.threadTs ?? protectedItem?.threadTs ?? null,
      title: compactTitle(protectedItem?.title ?? record.title ?? record.jobId),
      status,
      applyUrl: protectedItem?.applyUrl ?? record.applyUrl,
      tabReference: protectedItem?.tabReference ?? record.tabReference,
      proposalVersion: protectedItem?.proposalVersion ?? record.proposalVersion,
      screening: protectedItem?.screening ?? record.screeningSummary ?? "unknown",
      proof: protectedItem?.proof ?? record.proofSummary ?? "planned proof not selected",
      portfolio: protectedItem?.portfolio ?? record.portfolioSummary ?? "none selected",
      files: protectedItem?.files ?? "unknown",
      connects: protectedItem?.connects ?? record.connectsSummary ?? "unknown",
      boost: protectedItem?.boost ?? record.boostSummary ?? "none",
      lastVerifiedAt: action?.updatedAt ?? protectedItem?.lastVerifiedAt ?? record.lastVerifiedAt,
      nextAction: protectedItem?.nextAction ?? nextActionForStatus(status),
      action: action ?? undefined,
    };
  });

  return {
    id: batch.id,
    targetCount: batch.targetCount,
    status: "active",
    items,
    counts,
  };
}

function formatStatus(status: BatchApplyWorkspaceItemStatus): string {
  return status.replace(/_/g, " ");
}

export function formatProtectedQaQueueReply(items = getProtectedQaQueueItems(1000)): string {
  if (items.length === 0) {
    return "No prepared applications are waiting in the batch workspace.";
  }
  const ready = items.filter((item) => item.state === "ready").length;
  const blocked = items.filter((item) => item.state === "blocked").length;
  return [
    `Batch workspace: ${items.length} prepared application${items.length === 1 ? "" : "s"} (${ready} ready, ${blocked} blocked).`,
    ...items.map((item) => [
      `Application ${item.index}: ${item.title} - ${humanStatus(item)}`,
      `Proof: ${item.proof}; portfolio: ${item.portfolio}; files: ${item.files}.`,
      `Connects: ${item.connects}${item.boost !== "none" ? ` + boost ${item.boost}` : ""}; screening: ${item.screening}.`,
      `Next: ${item.nextAction}.`,
    ].join("\n")),
    "Final submit remains manual.",
  ].join("\n");
}

export function formatBatchApplyWorkspaceReply(view = getBatchApplyWorkspaceView()): string {
  if (view.items.length === 0) {
    return "No prepared applications are waiting in the batch workspace.";
  }
  const active = view.status === "active" ? `target ${view.targetCount}` : "derived from protected browser tabs";
  return [
    `Batch workspace: ${view.items.length}/${view.targetCount} applications tracked (${active}).`,
    `State: ${view.counts.ready} ready, ${view.counts.queued} queued, ${view.counts.preparing} preparing, ${view.counts.blocked} blocked, ${view.counts.stale} stale, ${view.counts.tab_missing} tab missing, ${view.counts.skipped} skipped, ${view.counts.submitted} submitted.`,
    ...view.items.map((item) => [
      `Application ${item.index}: ${item.title} - ${formatStatus(item.status)}.`,
      `Proof: ${item.proof}; portfolio: ${item.portfolio}; files: ${item.files}.`,
      `Connects: ${item.connects}${item.boost !== "none" && item.boost !== "no boost" ? ` + ${item.boost}` : ""}; screening: ${item.screening}; proposal v${item.proposalVersion ?? "unknown"}.`,
      `Last verified: ${item.lastVerifiedAt ?? "not verified yet"}. Next: ${item.nextAction}.`,
    ].join("\n")),
    "Open an application number to review its exact saved apply tab. Final submit remains manual.",
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

function markBatchTabMissing(jobId: string): void {
  const batch = getActiveBatchApplyWorkspace();
  if (!batch) return;
  updateBatchApplyWorkspaceItemStatus({
    batchId: batch.id,
    jobId,
    status: "tab_missing",
    lastVerifiedAt: new Date().toISOString(),
  });
}

function missingBatchItemFocusReply(index: number): ProtectedQaFocusResult | null {
  const batchItem = getBatchApplyWorkspaceView().items.find((item) => item.index === index);
  if (!batchItem) return null;
  if (batchItem.status === "queued" || batchItem.status === "preparing") {
    return {
      ok: false,
      text: `Application ${index} is ${formatStatus(batchItem.status)}. There is no protected QA tab to bring forward yet.`,
    };
  }
  markBatchTabMissing(batchItem.jobId);
  return {
    ok: false,
    text: [
      `I found application ${index} in the batch workspace, but I do not have a protected saved apply tab for it.`,
      "I did not reuse another Chrome tab or click submit.",
      "Best move: rebuild this application from the listing or skip it.",
    ].join("\n"),
  };
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
    if (input.index && input.index > 0) {
      const batchReply = missingBatchItemFocusReply(input.index);
      if (batchReply) return batchReply;
    }
    return {
      ok: false,
      text: "I do not have a protected application tab matching that request. Ask “what’s ready?” to see the batch workspace.",
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
    const page = (context.pages?.() ?? []).find((candidate) => sameSavedApplyTab(candidate.url(), item.applyUrl!));
    if (!page) {
      markBatchTabMissing(item.jobId);
      return {
        ok: false,
        item,
        text: [
          "I found the protected QA item, but the matching remote Chrome tab is gone.",
          "There is nothing useful to bring forward, and I did not reuse another tab or click submit.",
          "Best move: skip this stale blocked item and rebuild it from the listing if you still want to apply.",
        ].join("\n"),
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
