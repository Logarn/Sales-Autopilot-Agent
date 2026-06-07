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
  jobTitle?: string | null;
  url?: string | null;
  title?: string | null;
  reason: string;
}

export interface BrowserSessionRecord {
  state: BrowserSessionState;
  updatedAt: string;
  lastManualAttentionAt?: string;
  lastManualAttention?: BrowserManualAttentionEvent;
  lastAlertSentAt?: string;
  lastAlertKey?: string;
  challengeEvents: BrowserManualAttentionEvent[];
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
  };
  writeSession(updated);
  return updated;
}

function alertKey(event: BrowserManualAttentionEvent): string {
  return `${event.reason}:${event.actionId ?? "none"}:${event.jobId ?? "none"}`;
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

  const jobLine = event.jobId ? `\nJob: ${event.jobTitle ?? "Unknown title"} (${event.jobId})` : "";
  const sent = await sendSlackMessage({
    text: "Upwork needs manual browser attention",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `⚠️ *Upwork needs manual browser attention.*\n` +
            `I paused safely and did not submit anything.${jobLine}\n` +
            `Reason: ${event.reason}\n` +
            `Page: ${event.title ?? "unknown"}\n` +
            `Please resolve the visible browser page manually, then reply “retry” in the relevant Slack thread.\n` +
            `Ask for debug details only if you need the raw action state.`,
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
