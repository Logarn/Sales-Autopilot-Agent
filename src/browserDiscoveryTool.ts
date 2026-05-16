import { canonicalizeUpworkJobUrl, deriveCaptureThreadJobId, extractUpworkJobIdFromUrl } from "./browserCapture";
import { enqueueBrowserActionDeduped, getApplicationStatus, listBrowserActions } from "./db";
import { BrowserSessionInspection, InspectorLocatorLike, inspectBrowserSession, selectRelevantBrowserPage } from "./browserSessionInspector";
import { BrowserAction } from "./types";

export const BEST_MATCHES_URL = "https://www.upwork.com/nx/find-work/best-matches/";
export const DISCOVERY_BEST_MATCHES_TOOL = "discovery.best-matches";

export interface DiscoveryBestMatchesOptions {
  maxJobs: number;
  maxScrolls?: number;
  now?: Date;
}

export type DiscoverySourceType = "best_matches";

export interface DiscoverySourceConfig {
  sourceType: DiscoverySourceType;
  sourceLabel: "Best Matches";
  url: string;
}

export const DISCOVERY_SOURCES: Record<DiscoverySourceType, DiscoverySourceConfig> = {
  best_matches: {
    sourceType: "best_matches",
    sourceLabel: "Best Matches",
    url: BEST_MATCHES_URL,
  },
};

export interface DiscoveryJobLink {
  jobId: string;
  canonicalJobUrl: string;
  originalUrl: string;
  sourceType: DiscoverySourceType;
  sourceLabel: "Best Matches";
  discoveredAt: string;
  postedAtText?: string;
  recencyRank: number;
}

export interface DiscoveryBestMatchesResult {
  ok: boolean;
  tool: typeof DISCOVERY_BEST_MATCHES_TOOL;
  sessionState: string;
  manualAttentionReason?: string;
  manualAttentionRequired: boolean;
  blocked: boolean;
  jobsFound: number;
  jobsQueued: number;
  duplicatesSkipped: number;
  alreadyHandledSkipped: number;
  invalidSkipped: number;
  scrollsPerformed: number;
  newestQueuedPostedAtText?: string;
  oldestQueuedPostedAtText?: string;
  retryAllowedAfterManualFix?: boolean;
  queuedActionIds?: number[];
  error?: string;
}

export interface DiscoveryPageLike {
  url(): string;
  title(): Promise<string>;
  locator(selector: string): InspectorLocatorLike;
  goto?(url: string, options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle" | string; timeout?: number }): Promise<unknown>;
  waitForTimeout?(ms: number): Promise<unknown>;
  evaluate<R, A = unknown>(fn: (arg?: A) => R, arg?: A): Promise<R>;
}

export interface DiscoveryContextLike {
  pages?(): DiscoveryPageLike[];
}

function absoluteUpworkUrl(value: string): string | null {
  const trimmed = value.trim().replace(/&amp;/g, "&");
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) return `https://www.upwork.com${trimmed}`;
  if (/^https:\/\/(?:www\.)?upwork\.com\//i.test(trimmed)) return trimmed;
  return null;
}

function isApplyUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return /\/(?:nx|ab)\/proposals\/job\/[^/]+\/apply\/?/i.test(parsed.pathname);
  } catch {
    return /\/(?:nx|ab)\/proposals\/job\/[^/]+\/apply\/?/i.test(value);
  }
}

export function isValidDiscoveryUpworkJobId(jobId: string | null): jobId is string {
  return Boolean(jobId && /^\d{12,24}$/.test(jobId));
}

export function canonicalizeDiscoveryUpworkJobUrl(value: string): string | null {
  const canonical = canonicalizeUpworkJobUrl(value);
  const jobId = canonical ? extractUpworkJobIdFromUrl(canonical) : null;
  if (!canonical || !isValidDiscoveryUpworkJobId(jobId)) return null;
  try {
    const parsed = new URL(value);
    const path = parsed.pathname;
    const realJobDetailShape =
      /^\/jobs\/(?:[^/?#]+_)?~\d{12,24}\/?$/i.test(path) ||
      /^\/nx\/find-work\/best-matches\/details\/~\d{12,24}\/?$/i.test(path);
    return realJobDetailShape ? `https://www.upwork.com/jobs/~${jobId}` : null;
  } catch {
    return null;
  }
}

export interface DiscoveryExtractionResult {
  links: DiscoveryJobLink[];
  invalidSkipped: number;
  alreadyHandledSkipped: number;
}

function htmlTextNear(html: string, index: number, radius = 1200): string {
  return html
    .slice(Math.max(0, index - radius), Math.min(html.length, index + radius))
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function hasVisibleHandledCue(value: string): boolean {
  return /\b(applied|proposal\s+sent|submitted|already\s+applied|view\s+proposal)\b/i.test(value);
}

function htmlTextAfter(html: string, index: number, radius = 1200): string {
  return htmlTextNear(html.slice(index, Math.min(html.length, index + radius)), 0, radius);
}

function extractPostedAtText(value: string): string | undefined {
  const match = value.match(/\b(?:posted\s*)?(?:(?:less\s+than\s+)?\d+\s*(?:minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\s+ago|yesterday|today)\b/i);
  return match?.[0]?.replace(/^posted\s*/i, "").trim();
}

function recencyRankFromText(value: string | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const lower = value.toLowerCase();
  if (/less\s+than\s+\d+\s*(minute|min)/.test(lower)) return 0;
  if (/today/.test(lower)) return 12 * 60;
  if (/yesterday/.test(lower)) return 24 * 60;
  const amount = Number.parseInt(lower.match(/\d+/)?.[0] ?? "", 10);
  if (!Number.isFinite(amount)) return Number.POSITIVE_INFINITY;
  if (/minute|min/.test(lower)) return amount;
  if (/hour|hr/.test(lower)) return amount * 60;
  if (/day/.test(lower)) return amount * 24 * 60;
  return Number.POSITIVE_INFINITY;
}

export function extractBestMatchesJobLinksWithStats(html: string, options: DiscoveryBestMatchesOptions): DiscoveryExtractionResult {
  const maxJobs = Math.max(0, Math.floor(options.maxJobs));
  const discoveredAt = (options.now ?? new Date()).toISOString();
  const candidates: Array<{ value: string; index: number }> = [];
  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  let hrefMatch: RegExpExecArray | null;
  while ((hrefMatch = hrefPattern.exec(html)) !== null) {
    candidates.push({ value: hrefMatch[1] ?? "", index: hrefMatch.index });
  }
  const urlTextPattern = /https:\/\/(?:www\.)?upwork\.com\/[^\s"'<>]+/gi;
  let textMatch: RegExpExecArray | null;
  while ((textMatch = urlTextPattern.exec(html)) !== null) {
    candidates.push({ value: textMatch[0] ?? "", index: textMatch.index });
  }

  const byCanonical = new Map<string, DiscoveryJobLink>();
  let invalidSkipped = 0;
  let alreadyHandledSkipped = 0;
  for (const candidate of candidates) {
    const absolute = absoluteUpworkUrl(candidate.value);
    if (!absolute || isApplyUrl(absolute)) continue;
    const canonicalJobUrl = canonicalizeDiscoveryUpworkJobUrl(absolute);
    const jobId = canonicalJobUrl ? extractUpworkJobIdFromUrl(canonicalJobUrl) : null;
    if (!canonicalJobUrl || !jobId) {
      if (/\/jobs\/|\/nx\/find-work\/best-matches\/details\//i.test(absolute)) invalidSkipped += 1;
      continue;
    }
    const nearbyText = htmlTextNear(html, candidate.index);
    if (hasVisibleHandledCue(nearbyText)) {
      alreadyHandledSkipped += 1;
      continue;
    }
    const postedAtText = extractPostedAtText(htmlTextAfter(html, candidate.index)) ?? extractPostedAtText(nearbyText);
    if (!byCanonical.has(canonicalJobUrl)) {
      byCanonical.set(canonicalJobUrl, {
        jobId,
        canonicalJobUrl,
        originalUrl: absolute,
        sourceType: DISCOVERY_SOURCES.best_matches.sourceType,
        sourceLabel: DISCOVERY_SOURCES.best_matches.sourceLabel,
        discoveredAt,
        postedAtText,
        recencyRank: recencyRankFromText(postedAtText),
      });
    }
    if (byCanonical.size >= maxJobs) break;
  }
  return { links: [...byCanonical.values()].slice(0, maxJobs), invalidSkipped, alreadyHandledSkipped };
}

export function extractBestMatchesJobLinksFromHtml(html: string, options: DiscoveryBestMatchesOptions): DiscoveryJobLink[] {
  return extractBestMatchesJobLinksWithStats(html, options).links;
}

export function isDuplicateDiscoveryJob(link: DiscoveryJobLink, actions: BrowserAction[]): boolean {
  const threadJobId = deriveCaptureThreadJobId(link.canonicalJobUrl, link.jobId);
  return actions.some((action) => {
    if (action.status === "cancelled" || action.status === "failed") return false;
    if (action.jobId === threadJobId) return true;
    const payloadUrl = typeof action.payload.url === "string" ? action.payload.url : "";
    const payloadCanonical = typeof action.payload.canonicalJobUrl === "string" ? action.payload.canonicalJobUrl : "";
    return canonicalizeDiscoveryUpworkJobUrl(payloadUrl) === link.canonicalJobUrl || canonicalizeDiscoveryUpworkJobUrl(payloadCanonical) === link.canonicalJobUrl;
  });
}

export function isAlreadyHandledDiscoveryJob(link: DiscoveryJobLink, status: string | null): boolean {
  return Boolean(status && ["rejected", "applied", "submitted", "replied", "interview", "hired", "lost"].includes(status));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrollBestMatchesPage(page: DiscoveryPageLike): Promise<boolean> {
  try {
    const result = await page.evaluate(() => {
      const scrollingElement = document.scrollingElement ?? document.documentElement;
      const before = scrollingElement.scrollTop;
      scrollingElement.scrollBy({ top: Math.max(800, Math.floor(window.innerHeight * 0.85)), behavior: "instant" as ScrollBehavior });
      const after = scrollingElement.scrollTop;
      return { before, after, height: scrollingElement.scrollHeight };
    });
    if (page.waitForTimeout) {
      await page.waitForTimeout(1200);
    } else {
      await sleep(1200);
    }
    return result.after > result.before;
  } catch {
    return false;
  }
}

function blockedResult(inspection: BrowserSessionInspection): DiscoveryBestMatchesResult {
  return {
    ok: false,
    tool: DISCOVERY_BEST_MATCHES_TOOL,
    sessionState: inspection.sessionState,
    manualAttentionReason: inspection.manualAttentionReason,
    manualAttentionRequired: inspection.manualAttentionRequired,
    blocked: inspection.blocked,
    jobsFound: 0,
    jobsQueued: 0,
    duplicatesSkipped: 0,
    alreadyHandledSkipped: 0,
    invalidSkipped: 0,
    scrollsPerformed: 0,
    retryAllowedAfterManualFix: inspection.retryAllowedAfterManualFix,
  };
}

export async function runDiscoveryBestMatches(context: DiscoveryContextLike, options: DiscoveryBestMatchesOptions): Promise<DiscoveryBestMatchesResult> {
  const maxJobs = Math.max(1, Math.floor(options.maxJobs));
  const inspection = await inspectBrowserSession(context);
  if (inspection.blocked || inspection.manualAttentionRequired || inspection.sessionState === "browser_session_unhealthy") {
    return blockedResult(inspection);
  }

  const selected = selectRelevantBrowserPage(context.pages?.() ?? []);
  if (!selected.page) {
    return {
      ok: false,
      tool: DISCOVERY_BEST_MATCHES_TOOL,
      sessionState: inspection.sessionState,
      manualAttentionRequired: false,
      blocked: false,
      jobsFound: 0,
      jobsQueued: 0,
      duplicatesSkipped: 0,
      alreadyHandledSkipped: 0,
      invalidSkipped: 0,
      scrollsPerformed: 0,
      error: "No browser page is available for discovery.",
    };
  }
  const page = selected.page as unknown as DiscoveryPageLike;
  if (!/\/nx\/find-work\/best-matches/i.test(page.url()) && page.goto) {
    await page.goto(BEST_MATCHES_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  }

  const maxScrolls = Math.max(0, Math.floor(options.maxScrolls ?? 3));
  const existingActions = listBrowserActions(null, 1000);
  const queuedActionIds: number[] = [];
  const queueableLinks = new Map<string, DiscoveryJobLink>();
  const duplicateKeys = new Set<string>();
  const alreadyHandledKeys = new Set<string>();
  let invalidSkipped = 0;
  let alreadyHandledSkipped = 0;
  let scrollsPerformed = 0;
  let staleScrolls = 0;
  let previousSeenCount = 0;
  const seenLinks = new Map<string, DiscoveryJobLink>();

  for (let pass = 0; pass <= maxScrolls; pass += 1) {
    const inspectionAfterScroll = pass === 0 ? inspection : await inspectBrowserSession(context);
    if (inspectionAfterScroll.blocked || inspectionAfterScroll.manualAttentionRequired || inspectionAfterScroll.sessionState === "browser_session_unhealthy") {
      return blockedResult(inspectionAfterScroll);
    }

    const html = await page.evaluate(() => (globalThis as unknown as { document: { documentElement: { outerHTML: string } } }).document.documentElement.outerHTML);
    const extraction = extractBestMatchesJobLinksWithStats(html, { maxJobs: Math.max(maxJobs * 5, 25), now: options.now });
    invalidSkipped += extraction.invalidSkipped;
    alreadyHandledSkipped += extraction.alreadyHandledSkipped;

    for (const link of extraction.links) {
      seenLinks.set(link.canonicalJobUrl, link);
      const applicationStatus = getApplicationStatus(deriveCaptureThreadJobId(link.canonicalJobUrl, link.jobId));
      if (isAlreadyHandledDiscoveryJob(link, applicationStatus)) {
        alreadyHandledKeys.add(link.canonicalJobUrl);
        continue;
      }
      if (isDuplicateDiscoveryJob(link, existingActions)) {
        duplicateKeys.add(link.canonicalJobUrl);
        continue;
      }
      if (!queueableLinks.has(link.canonicalJobUrl)) {
        queueableLinks.set(link.canonicalJobUrl, link);
      }
    }

    if (queueableLinks.size >= maxJobs || pass >= maxScrolls) break;
    const currentSeenCount = seenLinks.size + invalidSkipped + alreadyHandledSkipped;
    const scrolled = await scrollBestMatchesPage(page);
    if (scrolled) scrollsPerformed += 1;
    if (!scrolled || currentSeenCount <= previousSeenCount) {
      staleScrolls += 1;
    } else {
      staleScrolls = 0;
    }
    previousSeenCount = currentSeenCount;
    if (staleScrolls >= 2) break;
  }

  let duplicatesSkipped = duplicateKeys.size;
  alreadyHandledSkipped += alreadyHandledKeys.size;
  const links = [...queueableLinks.values()]
    .sort((left, right) => left.recencyRank - right.recencyRank || left.discoveredAt.localeCompare(right.discoveredAt))
    .slice(0, maxJobs);
  const queuedPostedAtTexts: string[] = [];

  for (const link of links) {
    const jobId = deriveCaptureThreadJobId(link.canonicalJobUrl, link.jobId);
    const enqueueResult = enqueueBrowserActionDeduped({
      jobId,
      actionType: "capture_job_from_url",
      payload: {
        source: "discovery.best_matches",
        url: link.canonicalJobUrl,
        originalUrl: link.originalUrl,
        canonicalJobUrl: link.canonicalJobUrl,
        notes: "Discovered from Upwork Best Matches; browser capture required before scoring and draft prep.",
        discovery: {
          sourceType: link.sourceType,
          sourceLabel: link.sourceLabel,
          discoveredAt: link.discoveredAt,
          canonicalJobUrl: link.canonicalJobUrl,
          ...(link.postedAtText ? { postedAtText: link.postedAtText, recencyRank: link.recencyRank } : {}),
        },
      },
    });
    if (enqueueResult.duplicate) {
      duplicatesSkipped += 1;
      continue;
    }
    queuedActionIds.push(enqueueResult.id);
    if (link.postedAtText) queuedPostedAtTexts.push(link.postedAtText);
    existingActions.push({
      id: enqueueResult.id,
      jobId,
      actionType: "capture_job_from_url",
      status: "pending",
      payload: { url: link.canonicalJobUrl, canonicalJobUrl: link.canonicalJobUrl },
      attempts: 0,
      lastError: null,
      createdAt: link.discoveredAt,
      updatedAt: link.discoveredAt,
    });
  }

  return {
    ok: true,
    tool: DISCOVERY_BEST_MATCHES_TOOL,
    sessionState: inspection.sessionState,
    manualAttentionRequired: false,
    blocked: false,
    jobsFound: seenLinks.size,
    jobsQueued: queuedActionIds.length,
    duplicatesSkipped,
    alreadyHandledSkipped,
    invalidSkipped,
    scrollsPerformed,
    newestQueuedPostedAtText: queuedPostedAtTexts[0],
    oldestQueuedPostedAtText: queuedPostedAtTexts[queuedPostedAtTexts.length - 1],
    queuedActionIds,
  };
}
