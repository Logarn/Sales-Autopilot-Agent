import * as fs from "node:fs";
import * as path from "node:path";
import {
  BROWSER_MANUAL_ATTENTION_ALERT_COOLDOWN_MS,
  BROWSER_SESSION_CHALLENGE_THRESHOLD,
  BROWSER_SESSION_CHALLENGE_WINDOW_MS,
  DB_PATH,
} from "./config";
import { getApplicationJobLink } from "./db";
import { logger } from "./logger";
import { sendSlackMessage } from "./slack";

export type BrowserSessionState = "healthy" | "manual_attention_required" | "cooling_down" | "disabled_until_manual_retry" | "browser_session_unhealthy";

export interface BrowserManualAttentionEvent {
  at: string;
  actionId?: number;
  jobId?: string;
  applicationId?: string | null;
  threadChannelId?: string | null;
  threadTs?: string | null;
  actionType?: string | null;
  source?: string | null;
  jobTitle?: string | null;
  url?: string | null;
  title?: string | null;
  reason: string;
}

export type BrowserChallengeQuarantineStatus = "paused" | "retried" | "resolved" | "skipped";

export interface BrowserChallengeQuarantineRecord {
  actionId?: number;
  jobId?: string;
  applicationId?: string | null;
  threadChannelId?: string | null;
  threadTs?: string | null;
  actionType?: string | null;
  source?: string | null;
  pageUrl?: string | null;
  pageTitle?: string | null;
  challengeType: string;
  firstSeenAt: string;
  lastSeenAt: string;
  retryCommand?: string;
  status: BrowserChallengeQuarantineStatus;
  repeatCount: number;
}

export interface BrowserSessionRecord {
  state: BrowserSessionState;
  updatedAt: string;
  lastManualAttentionAt?: string;
  lastManualAttention?: BrowserManualAttentionEvent;
  lastAlertSentAt?: string;
  lastAlertKey?: string;
  challengeEvents: BrowserManualAttentionEvent[];
  quarantinedActions?: BrowserChallengeQuarantineRecord[];
}

export interface BrowserSessionStatus extends BrowserSessionRecord {
  blocked: boolean;
  alertCooldownRemainingMs: number;
  retryCommand?: string;
  reason?: string;
}

const DEFAULT_SESSION: BrowserSessionRecord = {
  state: "healthy",
  updatedAt: new Date(0).toISOString(),
  challengeEvents: [],
  quarantinedActions: [],
};

function sessionPath(): string {
  return path.join(path.dirname(path.resolve(process.cwd(), DB_PATH)), "browser-session.json");
}

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function readRawSession(): BrowserSessionRecord {
  const filePath = sessionPath();
  if (!fs.existsSync(filePath)) return { ...DEFAULT_SESSION, updatedAt: nowIso() };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<BrowserSessionRecord>;
    return {
      ...DEFAULT_SESSION,
      ...parsed,
      challengeEvents: Array.isArray(parsed.challengeEvents) ? parsed.challengeEvents : [],
      quarantinedActions: Array.isArray(parsed.quarantinedActions) ? parsed.quarantinedActions : [],
    };
  } catch {
    return { ...DEFAULT_SESSION, updatedAt: nowIso() };
  }
}

function writeSession(record: BrowserSessionRecord): void {
  const filePath = sessionPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
}

function quarantineKey(input: { actionId?: number; jobId?: string; applicationId?: string | null; source?: string | null }): string {
  if (input.actionId) return `action:${input.actionId}`;
  if (input.applicationId) return `application:${input.applicationId}`;
  if (input.jobId) return `job:${input.jobId}`;
  if (input.source) return `source:${input.source}`;
  return "browser-session";
}

function upsertQuarantine(
  quarantines: BrowserChallengeQuarantineRecord[],
  event: BrowserManualAttentionEvent,
): BrowserChallengeQuarantineRecord[] {
  const key = quarantineKey(event);
  const existing = quarantines.find((record) => quarantineKey(record) === key);
  const retryCommand = event.actionId ? `retry ${event.actionId}` : "retry";
  const next: BrowserChallengeQuarantineRecord = {
    actionId: event.actionId,
    jobId: event.jobId,
    applicationId: event.applicationId ?? null,
    threadChannelId: event.threadChannelId ?? null,
    threadTs: event.threadTs ?? null,
    actionType: event.actionType ?? null,
    source: event.source ?? null,
    pageUrl: event.url ?? null,
    pageTitle: event.title ?? null,
    challengeType: event.reason,
    firstSeenAt: existing?.firstSeenAt ?? event.at,
    lastSeenAt: event.at,
    retryCommand,
    status: "paused",
    repeatCount: (existing?.repeatCount ?? 0) + 1,
  };
  return [...quarantines.filter((record) => quarantineKey(record) !== key), next];
}

function updateQuarantineStatus(
  status: BrowserChallengeQuarantineStatus,
  actionId?: number,
  now = new Date(),
): BrowserSessionRecord {
  const record = readRawSession();
  const quarantinedActions = record.quarantinedActions ?? [];
  const last = actionId
    ? quarantinedActions.find((item) => item.actionId === actionId)
    : quarantinedActions.slice().reverse().find((item) => item.status === "paused");
  if (!last) return record;
  const updated: BrowserSessionRecord = {
    ...record,
    updatedAt: nowIso(now),
    quarantinedActions: quarantinedActions.map((item) =>
      item === last ? { ...item, status, lastSeenAt: nowIso(now) } : item
    ),
  };
  writeSession(updated);
  return updated;
}

export function listBrowserChallengeQuarantines(status?: BrowserChallengeQuarantineStatus): BrowserChallengeQuarantineRecord[] {
  const records = readRawSession().quarantinedActions ?? [];
  return status ? records.filter((record) => record.status === status) : records;
}

export function listUnresolvedBrowserChallengeQuarantines(): BrowserChallengeQuarantineRecord[] {
  return listBrowserChallengeQuarantines("paused");
}

export function markBrowserChallengeRetried(actionId?: number): BrowserSessionRecord {
  return updateQuarantineStatus("retried", actionId);
}

export function markBrowserChallengeResolved(actionId?: number): BrowserSessionRecord {
  return updateQuarantineStatus("resolved", actionId);
}

export function markBrowserChallengeSkipped(actionId?: number): BrowserSessionRecord {
  return updateQuarantineStatus("skipped", actionId);
}

export function getBrowserSessionStatus(now = new Date()): BrowserSessionStatus {
  const record = readRawSession();
  const lastAlert = record.lastAlertSentAt ? Date.parse(record.lastAlertSentAt) : 0;
  const remaining = lastAlert ? Math.max(0, BROWSER_MANUAL_ATTENTION_ALERT_COOLDOWN_MS - (now.getTime() - lastAlert)) : 0;
  const blocked = ["manual_attention_required", "cooling_down", "disabled_until_manual_retry", "browser_session_unhealthy"].includes(record.state);
  const actionId = record.lastManualAttention?.actionId;
  return {
    ...record,
    blocked,
    alertCooldownRemainingMs: remaining,
    retryCommand: actionId ? `npm run browser:retry -- --id ${actionId}` : undefined,
    reason: record.lastManualAttention?.reason,
  };
}

export function clearBrowserManualAttention(actionId?: number): BrowserSessionRecord {
  const record = readRawSession();
  if (actionId && record.lastManualAttention?.actionId && record.lastManualAttention.actionId !== actionId) {
    logger.warn(`Manual attention state is for action #${record.lastManualAttention.actionId}; retry requested for #${actionId}. Keeping session state ${record.state}.`);
    return record;
  }
  const updated: BrowserSessionRecord = {
    ...record,
    state: "healthy",
    updatedAt: nowIso(),
    quarantinedActions: (record.quarantinedActions ?? []).map((item) =>
      (!actionId || item.actionId === actionId) && item.status === "paused"
        ? { ...item, status: "resolved", lastSeenAt: nowIso() }
        : item
    ),
  };
  writeSession(updated);
  return updated;
}

function alertKey(event: BrowserManualAttentionEvent): string {
  return `${event.reason}:${event.actionId ?? "none"}:${event.jobId ?? "none"}`;
}

function humanBrowserAttentionReason(reason: string): string {
  if (reason === "captcha_or_security_challenge") return "Upwork is asking for a browser check.";
  if (reason === "login_required") return "Upwork needs the remote Chrome session logged back in.";
  if (reason === "two_factor_required") return "Upwork is asking for a two-factor check.";
  if (reason === "browser_unavailable" || reason === "cdp_unavailable") return "Remote Chrome is not reachable right now.";
  if (reason === "browser_profile_in_use") return "Remote Chrome is already open with the shared profile.";
  if (reason === "browser_session_unhealthy") return "Remote Chrome has hit repeated browser checks and needs a human look.";
  return "Remote Chrome needs a human look before I can keep working safely.";
}

export function buildManualAttentionSlackText(event: BrowserManualAttentionEvent): string {
  const jobLine = event.jobTitle ? `\nJob: ${event.jobTitle}` : "";
  const pageLine = event.title ? `\nPage: ${event.title}` : "";
	  return [
	    "Upwork checked one application page. I paused that one safely.",
	    `${humanBrowserAttentionReason(event.reason)} I did not submit anything.${jobLine}${pageLine}`,
	    "Clear the remote Chrome check, then reply “retry” in the relevant Slack thread and I’ll pick this back up.",
	    "Ask for debug details only if you need the raw action state.",
	  ].join("\n");
}

function recentChallengeEvents(events: BrowserManualAttentionEvent[], now: Date): BrowserManualAttentionEvent[] {
  const cutoff = now.getTime() - BROWSER_SESSION_CHALLENGE_WINDOW_MS;
  return events.filter((event) => Date.parse(event.at) >= cutoff);
}

async function maybeSendManualAttentionAlert(record: BrowserSessionRecord, event: BrowserManualAttentionEvent, now: Date): Promise<BrowserSessionRecord> {
  const key = alertKey(event);
  const lastAlertAt = record.lastAlertSentAt ? Date.parse(record.lastAlertSentAt) : 0;
  const withinCooldown = lastAlertAt > 0 && now.getTime() - lastAlertAt < BROWSER_MANUAL_ATTENTION_ALERT_COOLDOWN_MS;
  const duplicate = record.lastAlertKey === key;

  if (withinCooldown || duplicate) {
    logger.info(`Manual browser attention alert suppressed. duplicate=${duplicate} cooldownRemainingMs=${withinCooldown ? BROWSER_MANUAL_ATTENTION_ALERT_COOLDOWN_MS - (now.getTime() - lastAlertAt) : 0}`);
    return record;
  }

  const text = buildManualAttentionSlackText(event);
  const sent = await sendSlackMessage({
    text: "Upwork needs a browser check",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
      },
    ],
  });

  if (!sent) return record;
  return {
    ...record,
    lastAlertSentAt: nowIso(now),
    lastAlertKey: key,
  };
}

export async function recordBrowserManualAttention(input: {
  actionId?: number;
  jobId?: string;
  applicationId?: string | null;
  threadChannelId?: string | null;
  threadTs?: string | null;
  actionType?: string | null;
  source?: string | null;
  url?: string | null;
  title?: string | null;
  reason: string;
  now?: Date;
}): Promise<BrowserSessionRecord> {
  const now = input.now ?? new Date();
  const link = input.jobId ? getApplicationJobLink(input.jobId) : null;
  const event: BrowserManualAttentionEvent = {
    at: nowIso(now),
    actionId: input.actionId,
    jobId: input.jobId,
    applicationId: input.applicationId ?? null,
    threadChannelId: input.threadChannelId ?? null,
    threadTs: input.threadTs ?? null,
    actionType: input.actionType ?? null,
    source: input.source ?? null,
    jobTitle: link?.title ?? null,
    url: input.url,
    title: input.title,
    reason: input.reason,
  };

  const existing = readRawSession();
  const events = recentChallengeEvents([...existing.challengeEvents, event], now);
  const unhealthy = events.length > BROWSER_SESSION_CHALLENGE_THRESHOLD;
  let updated: BrowserSessionRecord = {
    ...existing,
    state: unhealthy ? "browser_session_unhealthy" : "manual_attention_required",
    updatedAt: nowIso(now),
    lastManualAttentionAt: event.at,
    lastManualAttention: event,
    challengeEvents: events,
    quarantinedActions: upsertQuarantine(existing.quarantinedActions ?? [], event),
  };
  updated = await maybeSendManualAttentionAlert(updated, event, now);
  writeSession(updated);

  if (unhealthy) {
    logger.warn(
      `Browser session unhealthy: ${events.length} manual-attention events within ${Math.round(BROWSER_SESSION_CHALLENGE_WINDOW_MS / 60000)} minutes. Recommendation: slow cadence, check VM/browser session, or use safer intake source.`
    );
  }
  return updated;
}

export function formatBrowserSessionStatus(status = getBrowserSessionStatus()): string {
  const cooldownMinutes = Math.ceil(status.alertCooldownRemainingMs / 60000);
  return [
    `browserSessionState=${status.state}`,
    `blocked=${status.blocked}`,
    `lastManualAttentionAt=${status.lastManualAttentionAt ?? "n/a"}`,
    `alertCooldown=${status.alertCooldownRemainingMs > 0 ? `${cooldownMinutes}m remaining` : "ready"}`,
    `retryCommand=${status.retryCommand ?? "n/a"}`,
  ].join(" ");
}
