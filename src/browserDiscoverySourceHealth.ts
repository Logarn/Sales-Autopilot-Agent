import * as fs from "node:fs";
import * as path from "node:path";
import { DB_PATH } from "./config";

export interface DiscoverySourceHealthSource {
  sourceType: string;
  sourceLabel: string;
  url: string;
  query?: string;
}

export interface DiscoverySourceHealthRecord {
  sourceId: string;
  sourceType: string;
  searchId: string;
  humanLabel: string;
  url: string;
  lastSuccessAt?: string;
  lastBrowserCheckAt?: string;
  challengeCheckCount: number;
  pauseUntil?: string;
  jobsCaptured: number;
  goodLeadsFound: number;
  lastError?: string;
}

interface DiscoverySourceHealthState {
  updatedAt: string;
  sources: DiscoverySourceHealthRecord[];
}

const SEARCH_PAUSE_BASE_MS = 15 * 60 * 1000;
const SEARCH_PAUSE_MAX_MS = 4 * 60 * 60 * 1000;

function sourceHealthPath(): string {
  return path.join(path.dirname(path.resolve(process.cwd(), DB_PATH)), "browser-discovery-source-health.json");
}

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "source";
}

export function discoverySourceId(source: DiscoverySourceHealthSource): string {
  return `${slugify(source.sourceType)}:${slugify(source.sourceLabel || source.query || source.url)}`;
}

function defaultRecord(source: DiscoverySourceHealthSource): DiscoverySourceHealthRecord {
  const sourceId = discoverySourceId(source);
  return {
    sourceId,
    sourceType: source.sourceType,
    searchId: sourceId,
    humanLabel: source.sourceLabel || "Upwork search",
    url: source.url,
    challengeCheckCount: 0,
    jobsCaptured: 0,
    goodLeadsFound: 0,
  };
}

function readState(): DiscoverySourceHealthState {
  const filePath = sourceHealthPath();
  if (!fs.existsSync(filePath)) return { updatedAt: nowIso(), sources: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<DiscoverySourceHealthState>;
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : nowIso(),
      sources: Array.isArray(parsed.sources) ? parsed.sources.map((item) => ({
        sourceId: String(item.sourceId ?? ""),
        sourceType: String(item.sourceType ?? ""),
        searchId: String(item.searchId ?? item.sourceId ?? ""),
        humanLabel: String(item.humanLabel ?? "Upwork search"),
        url: String(item.url ?? ""),
        lastSuccessAt: typeof item.lastSuccessAt === "string" ? item.lastSuccessAt : undefined,
        lastBrowserCheckAt: typeof item.lastBrowserCheckAt === "string" ? item.lastBrowserCheckAt : undefined,
        challengeCheckCount: Number.isFinite(item.challengeCheckCount) ? Number(item.challengeCheckCount) : 0,
        pauseUntil: typeof item.pauseUntil === "string" ? item.pauseUntil : undefined,
        jobsCaptured: Number.isFinite(item.jobsCaptured) ? Number(item.jobsCaptured) : 0,
        goodLeadsFound: Number.isFinite(item.goodLeadsFound) ? Number(item.goodLeadsFound) : 0,
        lastError: typeof item.lastError === "string" ? item.lastError : undefined,
      })).filter((item) => item.sourceId) : [],
    };
  } catch {
    return { updatedAt: nowIso(), sources: [] };
  }
}

function writeState(state: DiscoverySourceHealthState): void {
  const filePath = sourceHealthPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ ...state, updatedAt: nowIso() }, null, 2)}\n`);
}

function upsertSourceRecord(
  source: DiscoverySourceHealthSource,
  update: (record: DiscoverySourceHealthRecord) => DiscoverySourceHealthRecord,
): DiscoverySourceHealthRecord {
  const state = readState();
  const sourceId = discoverySourceId(source);
  const existing = state.sources.find((item) => item.sourceId === sourceId) ?? defaultRecord(source);
  const updated = update({
    ...existing,
    sourceType: source.sourceType,
    searchId: existing.searchId || sourceId,
    humanLabel: source.sourceLabel || existing.humanLabel,
    url: source.url || existing.url,
  });
  const nextSources = state.sources.filter((item) => item.sourceId !== sourceId);
  nextSources.push(updated);
  writeState({ ...state, sources: nextSources.sort((left, right) => left.humanLabel.localeCompare(right.humanLabel)) });
  return updated;
}

function pauseMsForChallengeCount(count: number): number {
  return Math.min(SEARCH_PAUSE_MAX_MS, SEARCH_PAUSE_BASE_MS * (2 ** Math.max(0, count - 1)));
}

export function readDiscoverySourceHealth(): DiscoverySourceHealthRecord[] {
  return readState().sources;
}

export function isDiscoverySourceTemporarilyPaused(source: DiscoverySourceHealthSource, now = new Date()): DiscoverySourceHealthRecord | null {
  const record = readState().sources.find((item) => item.sourceId === discoverySourceId(source));
  if (!record?.pauseUntil) return null;
  return Date.parse(record.pauseUntil) > now.getTime() ? record : null;
}

export function markDiscoverySourceBrowserCheck(source: DiscoverySourceHealthSource, now = new Date()): DiscoverySourceHealthRecord {
  return upsertSourceRecord(source, (record) => ({
    ...record,
    lastBrowserCheckAt: nowIso(now),
  }));
}

export function markDiscoverySourceChallenge(source: DiscoverySourceHealthSource, reason: string, now = new Date()): DiscoverySourceHealthRecord {
  return upsertSourceRecord(source, (record) => {
    const challengeCheckCount = record.challengeCheckCount + 1;
    return {
      ...record,
      lastBrowserCheckAt: nowIso(now),
      challengeCheckCount,
      pauseUntil: nowIso(new Date(now.getTime() + pauseMsForChallengeCount(challengeCheckCount))),
      lastError: reason,
    };
  });
}

export function markDiscoverySourceSuccess(source: DiscoverySourceHealthSource, input: { jobsCaptured: number; goodLeadsFound: number; now?: Date }): DiscoverySourceHealthRecord {
  const now = input.now ?? new Date();
  return upsertSourceRecord(source, (record) => ({
    ...record,
    lastSuccessAt: nowIso(now),
    lastBrowserCheckAt: nowIso(now),
    challengeCheckCount: 0,
    pauseUntil: undefined,
    jobsCaptured: record.jobsCaptured + Math.max(0, input.jobsCaptured),
    goodLeadsFound: record.goodLeadsFound + Math.max(0, input.goodLeadsFound),
    lastError: undefined,
  }));
}

export function clearPausedDiscoverySourceHealth(sourceId?: string): number {
  const state = readState();
  let cleared = 0;
  const sources = state.sources.map((record) => {
    if (sourceId && record.sourceId !== sourceId) return record;
    if (!record.pauseUntil && !record.lastError) return record;
    cleared += 1;
    return {
      ...record,
      pauseUntil: undefined,
      lastError: undefined,
      challengeCheckCount: 0,
    };
  });
  writeState({ ...state, sources });
  return cleared;
}

export function pauseDiscoverySources(sourceList: DiscoverySourceHealthSource[], input: { exceptSourceTypes?: string[]; reason: string; now?: Date }): number {
  const now = input.now ?? new Date();
  const except = new Set(input.exceptSourceTypes ?? []);
  let count = 0;
  for (const source of sourceList) {
    if (except.has(source.sourceType)) continue;
    markDiscoverySourceChallenge(source, input.reason, now);
    count += 1;
  }
  return count;
}

export function formatDiscoverySourceHealthForSlack(options: { debug?: boolean; now?: Date } = {}): string {
  const now = options.now ?? new Date();
  const records = readDiscoverySourceHealth();
  const paused = records.filter((record) => record.pauseUntil && Date.parse(record.pauseUntil) > now.getTime());
  if (options.debug) {
    if (records.length === 0) return "Debug: no discovery source health records yet.";
    return [
      "Debug discovery source health:",
      ...records.map((record) => [
        `${record.humanLabel}`,
        `sourceId=${record.sourceId}`,
        `searchId=${record.searchId}`,
        `url=${record.url}`,
        `lastSuccess=${record.lastSuccessAt ?? "n/a"}`,
        `lastBrowserCheck=${record.lastBrowserCheckAt ?? "n/a"}`,
        `challengeChecks=${record.challengeCheckCount}`,
        `pauseUntil=${record.pauseUntil ?? "n/a"}`,
        `jobsCaptured=${record.jobsCaptured}`,
        `goodLeadsFound=${record.goodLeadsFound}`,
        `lastError=${record.lastError ?? "n/a"}`,
      ].join(" ")),
    ].join("\n");
  }

  if (paused.length === 0) {
    return "Nothing is blocked right now. I’ll keep hunting from Best Matches and the clean searches.";
  }

  const labels = paused.map((record) => record.humanLabel).slice(0, 2);
  const names = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return [
    `Upwork checked one search page${paused.length > 1 ? "s" : ""}, so I’m leaving ${paused.length === 1 ? "that one" : "those"} alone for now.`,
    `Affected: ${names}.`,
    "I’ll keep hunting from the safer feed.",
  ].join(" ");
}
