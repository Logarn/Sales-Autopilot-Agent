import type { BrowserAction, BrowserActionPayload } from "./types";

export const CAPTURE_WAITERS_PAYLOAD_KEY = "captureWaiters";
export const DEFAULT_CAPTURE_STALE_MS = 30 * 60 * 1000;

export interface CaptureThreadWaiter {
  channelId: string;
  messageTs: string;
  threadTs: string;
  upworkUrl: string;
  canonicalJobId: string;
  source: "slack_url" | "slack_retry_capture" | "browser_worker" | "test";
  draftRequested?: boolean;
  attachedAt: string;
}

export interface CaptureThreadTarget {
  channelId: string;
  messageTs: string;
  threadTs: string;
  upworkUrl?: string;
  canonicalJobId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeUpworkJobId(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;

  const manual = /^manual:upwork-([A-Za-z0-9_-]+)$/i.exec(text);
  if (manual?.[1]) return manual[1];

  const raw = /^~?([0-9]{8,}|[A-Za-z0-9_-]{12,})$/.exec(text);
  if (raw?.[1]) return raw[1];

  const url = /\/jobs\/(?:[^/?#]*_)?~([A-Za-z0-9_-]+)/i.exec(text);
  if (url?.[1]) return url[1];

  return null;
}

export function canonicalCaptureJobId(value: unknown): string | null {
  const jobId = normalizeUpworkJobId(value);
  return jobId ? `manual:upwork-${jobId}` : null;
}

export function canonicalCaptureJobIdFromInputs(value: unknown, parsedJobId?: string | null): string | null {
  return canonicalCaptureJobId(parsedJobId) ?? canonicalCaptureJobId(value);
}

export function payloadCanonicalCaptureJobId(payload: BrowserActionPayload | null | undefined): string | null {
  if (!payload) return null;
  return canonicalCaptureJobId(payload.canonicalJobUrl) ??
    canonicalCaptureJobId(payload.url) ??
    canonicalCaptureJobId(payload.originalUrl) ??
    canonicalCaptureJobId(payload.applicationId);
}

export function browserActionCanonicalCaptureJobId(action: Pick<BrowserAction, "jobId" | "payload">): string | null {
  return canonicalCaptureJobId(action.jobId) ?? payloadCanonicalCaptureJobId(action.payload);
}

export function sameCanonicalCaptureJob(left: unknown, right: unknown): boolean {
  const leftCanonical = canonicalCaptureJobId(left);
  const rightCanonical = canonicalCaptureJobId(right);
  return Boolean(leftCanonical && rightCanonical && leftCanonical === rightCanonical);
}

export function findCaptureActionsForCanonicalJob(actions: BrowserAction[], canonicalJobId: string): BrowserAction[] {
  return actions.filter((action) =>
    action.actionType === "capture_job_from_url" &&
    browserActionCanonicalCaptureJobId(action) === canonicalJobId
  );
}

export function getCaptureWaiters(payload: BrowserActionPayload | null | undefined): CaptureThreadWaiter[] {
  const raw = payload?.[CAPTURE_WAITERS_PAYLOAD_KEY];
  if (!Array.isArray(raw)) return [];
  const waiters: CaptureThreadWaiter[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (!record) continue;
    const channelId = stringValue(record.channelId);
    const messageTs = stringValue(record.messageTs);
    const threadTs = stringValue(record.threadTs);
    const upworkUrl = stringValue(record.upworkUrl);
    const canonicalJobId = stringValue(record.canonicalJobId);
    const attachedAt = stringValue(record.attachedAt);
    if (!channelId || !messageTs || !threadTs || !upworkUrl || !canonicalJobId || !attachedAt) continue;
    waiters.push({
      channelId,
      messageTs,
      threadTs,
      upworkUrl,
      canonicalJobId,
      source: record.source === "slack_retry_capture" || record.source === "browser_worker" || record.source === "test"
        ? record.source
        : "slack_url",
      draftRequested: record.draftRequested === true,
      attachedAt,
    });
  }
  return waiters;
}

export function captureWaiterKey(waiter: Pick<CaptureThreadWaiter, "channelId" | "threadTs">): string {
  return `${waiter.channelId}:${waiter.threadTs}`;
}

export function withCaptureWaiter(payload: BrowserActionPayload, waiter: CaptureThreadWaiter): BrowserActionPayload {
  const waiters = getCaptureWaiters(payload);
  const key = captureWaiterKey(waiter);
  const next = waiters.filter((item) => captureWaiterKey(item) !== key);
  next.push(waiter);
  return {
    ...payload,
    [CAPTURE_WAITERS_PAYLOAD_KEY]: next,
  };
}

export function actionHasCaptureThread(action: BrowserAction, target: Pick<CaptureThreadWaiter, "channelId" | "threadTs">): boolean {
  const payload = action.payload;
  const payloadChannelId = stringValue(payload.channelId);
  const payloadThreadTs = stringValue(payload.threadTs);
  if (payloadChannelId === target.channelId && payloadThreadTs === target.threadTs) return true;
  return getCaptureWaiters(payload).some((waiter) => captureWaiterKey(waiter) === captureWaiterKey(target));
}

export function captureThreadTargetsForAction(action: BrowserAction): CaptureThreadTarget[] {
  const targets: CaptureThreadTarget[] = [];
  const payload = action.payload;
  const channelId = stringValue(payload.channelId);
  const messageTs = stringValue(payload.messageTs);
  const threadTs = stringValue(payload.threadTs);
  const upworkUrl = stringValue(payload.url) ?? stringValue(payload.canonicalJobUrl) ?? stringValue(payload.originalUrl) ?? undefined;
  const canonicalJobId = browserActionCanonicalCaptureJobId(action) ?? undefined;

  if (channelId && messageTs && threadTs) {
    targets.push({ channelId, messageTs, threadTs, upworkUrl, canonicalJobId });
  }

  for (const waiter of getCaptureWaiters(payload)) {
    targets.push({
      channelId: waiter.channelId,
      messageTs: waiter.messageTs,
      threadTs: waiter.threadTs,
      upworkUrl: waiter.upworkUrl,
      canonicalJobId: waiter.canonicalJobId,
    });
  }

  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.channelId}:${target.threadTs}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isStalePendingCaptureAction(action: BrowserAction, now = new Date(), staleMs = DEFAULT_CAPTURE_STALE_MS): boolean {
  if (action.actionType !== "capture_job_from_url" || action.status !== "pending") return false;
  const rawTimestamp = action.updatedAt || action.createdAt;
  const timestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rawTimestamp)
    ? Date.parse(`${rawTimestamp.replace(" ", "T")}Z`)
    : Date.parse(rawTimestamp);
  if (!Number.isFinite(timestamp)) return false;
  return now.getTime() - timestamp > staleMs;
}
