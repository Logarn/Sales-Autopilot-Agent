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

export type BrowserManualAttentionIncidentStatus = "active" | "resolved" | "skipped";

export interface BrowserManualAttentionIncidentRecord {
  key: string;
  group: string;
  target: string;
  reason: string;
  status: BrowserManualAttentionIncidentStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  lastMainAlertAt?: string;
  lastThreadAlertAt?: string;
  actionIds: number[];
  jobIds: string[];
  urls: string[];
  titles: string[];
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
  manualAttentionIncidents?: BrowserManualAttentionIncidentRecord[];
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
  manualAttentionIncidents: [],
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
      manualAttentionIncidents: Array.isArray(parsed.manualAttentionIncidents) ? parsed.manualAttentionIncidents : [],
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

function uniqueNumbers(values: Array<number | undefined>): number[] {
  return Array.from(new Set(values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))).slice(0, 10);
}

function jobTokenFromJobId(value?: string | null): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  const upwork = normalized.match(/upwork[-:_~]?([A-Za-z0-9_-]{8,})/i)?.[1];
  if (upwork) return upwork;
  return normalized.replace(/^manual:/i, "").toLowerCase();
}

function jobTokenFromUrl(value?: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const match = decodeURIComponent(url.pathname).match(/~([A-Za-z0-9_-]{8,})/);
    return match?.[1] ?? null;
  } catch {
    const match = value.match(/~([A-Za-z0-9_-]{8,})/);
    return match?.[1] ?? null;
  }
}

function manualAttentionIncidentGroup(reason: string): string {
  if (/captcha|security|challenge|just.?a.?moment|cloudflare|browser_session_unhealthy|manual_attention_required/i.test(reason)) {
    return "browser_check";
  }
  if (/login|password|two_factor|2fa|passkey/i.test(reason)) {
    return "auth_check";
  }
  if (/cdp|browser_unavailable|browser_profile_in_use/i.test(reason)) {
    return "browser_unavailable";
  }
  return "manual_attention";
}

function manualAttentionIncidentTarget(event: Pick<BrowserManualAttentionEvent, "actionId" | "jobId" | "applicationId" | "url">): string {
  const jobToken = jobTokenFromUrl(event.url) ?? jobTokenFromJobId(event.applicationId ?? undefined) ?? jobTokenFromJobId(event.jobId);
  if (jobToken) return `job:${jobToken}`;
  if (event.url?.trim()) return `url:${event.url.trim().replace(/[?#].*$/, "")}`;
  if (event.actionId) return `action:${event.actionId}`;
  return "session";
}

export function browserManualAttentionIncidentKey(event: Pick<BrowserManualAttentionEvent, "actionId" | "jobId" | "applicationId" | "url" | "reason">): { key: string; group: string; target: string } {
  const group = manualAttentionIncidentGroup(event.reason);
  const target = manualAttentionIncidentTarget(event);
  return { group, target, key: `${group}:${target}` };
}

function activeIncidentMatches(
  incident: BrowserManualAttentionIncidentRecord,
  identity: { key: string; group: string; target: string },
  event?: Pick<BrowserManualAttentionEvent, "actionId" | "jobId" | "applicationId" | "url">,
): boolean {
  if (incident.status !== "active" || incident.group !== identity.group) return false;
  if (incident.key === identity.key) return true;
  if (identity.group === "browser_check" && (incident.target === "session" || identity.target === "session")) return true;
  if (event?.actionId && incident.actionIds.includes(event.actionId)) return true;
  if (event?.jobId && incident.jobIds.includes(event.jobId)) return true;
  if (event?.applicationId && incident.jobIds.includes(event.applicationId)) return true;
  if (event?.url && incident.urls.includes(event.url)) return true;
  return false;
}

function findActiveManualAttentionIncident(
  incidents: BrowserManualAttentionIncidentRecord[] | undefined,
  identity: { key: string; group: string; target: string },
  event?: Pick<BrowserManualAttentionEvent, "actionId" | "jobId" | "applicationId" | "url">,
): BrowserManualAttentionIncidentRecord | null {
  return (incidents ?? []).find((incident) => activeIncidentMatches(incident, identity, event)) ?? null;
}

function upsertManualAttentionIncident(
  incidents: BrowserManualAttentionIncidentRecord[] | undefined,
  event: BrowserManualAttentionEvent,
  now: Date,
): { incidents: BrowserManualAttentionIncidentRecord[]; incident: BrowserManualAttentionIncidentRecord; duplicate: boolean } {
  const identity = browserManualAttentionIncidentKey(event);
  const existing = findActiveManualAttentionIncident(incidents, identity, event);
  const seenAt = nowIso(now);
  const base: BrowserManualAttentionIncidentRecord = existing ?? {
    key: identity.key,
    group: identity.group,
    target: identity.target,
    reason: event.reason,
    status: "active",
    firstSeenAt: event.at,
    lastSeenAt: event.at,
    actionIds: [],
    jobIds: [],
    urls: [],
    titles: [],
    repeatCount: 0,
  };
  const incident: BrowserManualAttentionIncidentRecord = {
    ...base,
    lastSeenAt: seenAt,
    actionIds: uniqueNumbers([...base.actionIds, event.actionId]),
    jobIds: uniqueStrings([...base.jobIds, event.jobId, event.applicationId ?? undefined]),
    urls: uniqueStrings([...base.urls, event.url]),
    titles: uniqueStrings([...base.titles, event.title]),
    repeatCount: base.repeatCount + 1,
  };
  return {
    incidents: [...(incidents ?? []).filter((item) => item.key !== base.key), incident],
    incident,
    duplicate: Boolean(existing),
  };
}

function markIncidentAlert(
  record: BrowserSessionRecord,
  incidentKey: string,
  alertType: "main" | "thread",
  now: Date,
): BrowserSessionRecord {
  const timestamp = nowIso(now);
  return {
    ...record,
    manualAttentionIncidents: (record.manualAttentionIncidents ?? []).map((incident) =>
      incident.key === incidentKey
        ? {
            ...incident,
            ...(alertType === "main" ? { lastMainAlertAt: timestamp } : { lastThreadAlertAt: timestamp }),
          }
        : incident
    ),
  };
}

export function markBrowserManualAttentionThreadAlert(input: {
  actionId?: number;
  jobId?: string;
  applicationId?: string | null;
  url?: string | null;
  title?: string | null;
  reason: string;
  now?: Date;
}): { shouldPost: boolean; incidentKey: string; duplicate: boolean } {
  const now = input.now ?? new Date();
  const event: BrowserManualAttentionEvent = {
    at: nowIso(now),
    actionId: input.actionId,
    jobId: input.jobId,
    applicationId: input.applicationId ?? null,
    url: input.url,
    title: input.title,
    reason: input.reason,
  };
  const record = readRawSession();
  const upserted = upsertManualAttentionIncident(record.manualAttentionIncidents, event, now);
  const legacyDuplicate = record.lastAlertKey === alertKey(event) && upserted.incident.repeatCount > 1;
  const duplicate = Boolean(upserted.incident.lastMainAlertAt || upserted.incident.lastThreadAlertAt) || legacyDuplicate;
  const updated: BrowserSessionRecord = {
    ...record,
    updatedAt: nowIso(now),
    manualAttentionIncidents: upserted.incidents,
  };
  writeSession(duplicate ? updated : markIncidentAlert(updated, upserted.incident.key, "thread", now));
  return { shouldPost: !duplicate, incidentKey: upserted.incident.key, duplicate };
}

export function shouldSuppressBrowserManualAttentionChannelPost(input: {
  actionId?: number;
  jobId?: string;
  applicationId?: string | null;
  url?: string | null;
  reason: string;
}): boolean {
  const identity = browserManualAttentionIncidentKey({
    actionId: input.actionId,
    jobId: input.jobId,
    applicationId: input.applicationId ?? null,
    url: input.url ?? null,
    reason: input.reason,
  });
  const incident = findActiveManualAttentionIncident(readRawSession().manualAttentionIncidents, identity, {
    actionId: input.actionId,
    jobId: input.jobId,
    applicationId: input.applicationId ?? null,
    url: input.url ?? null,
  });
  return Boolean(incident?.lastMainAlertAt || incident?.lastThreadAlertAt);
}

function resolveManualAttentionIncidents(
  incidents: BrowserManualAttentionIncidentRecord[] | undefined,
  actionId?: number,
  status: "resolved" | "skipped" = "resolved",
  now = new Date(),
): BrowserManualAttentionIncidentRecord[] {
  const seenAt = nowIso(now);
  return (incidents ?? []).map((incident) =>
    incident.status === "active" && (!actionId || incident.actionIds.includes(actionId))
      ? { ...incident, status, lastSeenAt: seenAt }
      : incident
  );
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
    manualAttentionIncidents:
      status === "resolved" || status === "skipped"
        ? resolveManualAttentionIncidents(record.manualAttentionIncidents, actionId, status, now)
        : record.manualAttentionIncidents ?? [],
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
    manualAttentionIncidents: resolveManualAttentionIncidents(record.manualAttentionIncidents, actionId),
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

async function maybeSendManualAttentionAlert(record: BrowserSessionRecord, event: BrowserManualAttentionEvent, now: Date, incidentKey: string): Promise<BrowserSessionRecord> {
  const key = alertKey(event);
  const incident = (record.manualAttentionIncidents ?? []).find((item) => item.key === incidentKey);
  const legacyDuplicate = record.lastAlertKey === key && (incident?.repeatCount ?? 0) > 1;
  const duplicate = Boolean(incident?.lastMainAlertAt || incident?.lastThreadAlertAt) || legacyDuplicate;

  if (duplicate) {
    logger.info(`Manual browser attention alert suppressed. duplicate=${duplicate} incidentKey=${incidentKey}`);
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

  if (!sent) {
    logger.info(`Manual browser attention alert queued or failed; marking incident ${incidentKey} as alerted to avoid queue storms.`);
  }
  return markIncidentAlert({
    ...record,
    lastAlertSentAt: nowIso(now),
    lastAlertKey: key,
  }, incidentKey, "main", now);
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
  const incidentUpdate = upsertManualAttentionIncident(existing.manualAttentionIncidents, event, now);
  let updated: BrowserSessionRecord = {
    ...existing,
    state: unhealthy ? "browser_session_unhealthy" : "manual_attention_required",
    updatedAt: nowIso(now),
    lastManualAttentionAt: event.at,
    lastManualAttention: event,
    challengeEvents: events,
    quarantinedActions: upsertQuarantine(existing.quarantinedActions ?? [], event),
    manualAttentionIncidents: incidentUpdate.incidents,
  };
  updated = await maybeSendManualAttentionAlert(updated, event, now, incidentUpdate.incident.key);
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
