import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalizeUpworkJobUrl, deriveCaptureThreadJobId, extractUpworkJobIdFromUrl } from "./browserCapture";
import { SAVED_SEARCHES_CONFIG_PATH } from "./config";
import { enqueueBrowserActionDeduped, getApplicationStatus, listBrowserActions } from "./db";
import { BrowserSessionInspection, InspectorLocatorLike, inspectBrowserSession, isUpworkFindWorkFeedUrl, isUpworkWorkTabUrl } from "./browserSessionInspector";
import { BrowserAction } from "./types";

export const BEST_MATCHES_URL = "https://www.upwork.com/nx/find-work/best-matches/";
export const DISCOVERY_BEST_MATCHES_TOOL = "discovery.best-matches";
export const RECENT_JOBS_URL = "https://www.upwork.com/nx/search/jobs/?sort=recency";
export const DISCOVERY_MULTI_SOURCE_TOOL = "discovery.multi-source";

export interface DiscoveryBestMatchesOptions {
  maxJobs: number;
  maxScrolls?: number;
  now?: Date;
}

export type DiscoverySourceType = "best_matches" | "recent_jobs" | "keyword_search" | "category_search" | "saved_search";

export interface DiscoverySourceConfig {
  sourceType: DiscoverySourceType;
  sourceLabel: string;
  url: string;
  purpose?: string;
  query?: string;
}

export const DISCOVERY_SOURCES: Record<"best_matches" | "recent_jobs", DiscoverySourceConfig> = {
  best_matches: {
    sourceType: "best_matches",
    sourceLabel: "Best Matches",
    url: BEST_MATCHES_URL,
  },
  recent_jobs: {
    sourceType: "recent_jobs",
    sourceLabel: "Recent Jobs",
    url: RECENT_JOBS_URL,
    purpose: "Most recent Upwork jobs across relevant feeds.",
  },
};

export interface DiscoveryJobLink {
  jobId: string;
  canonicalJobUrl: string;
  originalUrl: string;
  sourceType: DiscoverySourceType;
  sourceLabel: string;
  discoveredAt: string;
  postedAtText?: string;
  recencyRank: number;
  sourcePurpose?: string;
  sourceQuery?: string;
  sourceUrl?: string;
}

export interface DiscoveryBestMatchesResult {
  ok: boolean;
  tool: typeof DISCOVERY_BEST_MATCHES_TOOL | typeof DISCOVERY_MULTI_SOURCE_TOOL;
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
  sourcesChecked?: string[];
  error?: string;
}

export interface SavedDiscoverySearchConfig {
  id: string;
  name: string;
  purpose: string;
  sourceType?: "saved_search" | "keyword_search" | "category_search";
  url?: string;
  query?: string;
  category?: string;
  enabled?: boolean;
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
  newPage?(): Promise<DiscoveryPageLike>;
}

function readSavedSearchConfig(configPath: string): SavedDiscoverySearchConfig[] {
  if (!fs.existsSync(configPath)) return [];
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as { searches?: SavedDiscoverySearchConfig[] };
  if (!Array.isArray(parsed.searches)) return [];
  return parsed.searches;
}

export function loadSavedDiscoverySearches(configPath = SAVED_SEARCHES_CONFIG_PATH): SavedDiscoverySearchConfig[] {
  const resolvedPath = path.resolve(process.cwd(), configPath);
  return readSavedSearchConfig(resolvedPath)
    .filter((search) =>
      typeof search.id === "string" &&
      typeof search.name === "string" &&
      typeof search.purpose === "string"
    )
    .map((search) => ({
      ...search,
      url: typeof search.url === "string" ? search.url : undefined,
      query: typeof search.query === "string" ? search.query : undefined,
      category: typeof search.category === "string" ? search.category : undefined,
    }))
    .filter((search) => search.enabled !== false)
    .filter((search) => search.id.trim() && search.name.trim() && search.purpose.trim())
    .filter((search) => Boolean(search.url?.trim() || search.query?.trim() || search.category?.trim()));
}

function sourceTypeForSavedSearch(search: SavedDiscoverySearchConfig): DiscoverySourceType {
  if (search.sourceType === "keyword_search" || search.sourceType === "category_search" || search.sourceType === "saved_search") {
    return search.sourceType;
  }
  return search.url?.trim() ? "saved_search" : "keyword_search";
}

function buildSearchUrl(search: SavedDiscoverySearchConfig): string {
  if (search.url?.trim()) return search.url.trim();
  const params = new URLSearchParams();
  if (search.query?.trim()) params.set("q", search.query.trim());
  if (search.category?.trim()) params.set("category2_uid", search.category.trim());
  params.set("sort", "recency");
  return `https://www.upwork.com/nx/search/jobs/?${params.toString()}`;
}

function sourceLabelForSavedSearch(search: SavedDiscoverySearchConfig, sourceType: DiscoverySourceType): string {
  if (sourceType === "saved_search") return `Saved Search - ${search.name}`;
  if (sourceType === "category_search") return `Category Search - ${search.name}`;
  return `Keyword Search - ${search.name}`;
}

export function buildConfiguredDiscoverySources(searches = loadSavedDiscoverySearches()): DiscoverySourceConfig[] {
  return [
    DISCOVERY_SOURCES.best_matches,
    ...searches.map((search) => {
      const sourceType = sourceTypeForSavedSearch(search);
      return {
        sourceType,
        sourceLabel: sourceLabelForSavedSearch(search, sourceType),
        url: buildSearchUrl(search),
        purpose: search.purpose,
        query: search.query ?? search.category,
      };
    }),
  ];
}

function isUpworkSourceUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return host === "upwork.com" || host.endsWith(".upwork.com");
  } catch {
    return false;
  }
}

export function isAllowedDiscoverySourceConfig(source: DiscoverySourceConfig): boolean {
  if (!source.sourceLabel.trim() || !isUpworkSourceUrl(source.url) || isApplyUrl(source.url)) return false;
  if (source.sourceType === "best_matches") {
    return isCurrentDiscoverySourceUrl(source.url, DISCOVERY_SOURCES.best_matches.url);
  }
  if (source.sourceType === "saved_search" || source.sourceType === "keyword_search" || source.sourceType === "category_search") {
    return isUpworkFindWorkFeedUrl(source.url);
  }
  if (source.sourceType === "recent_jobs") {
    return Boolean(source.purpose?.trim()) && isUpworkFindWorkFeedUrl(source.url);
  }
  return false;
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

export function extractDiscoveryJobLinksWithStats(
  html: string,
  options: DiscoveryBestMatchesOptions & { source?: DiscoverySourceConfig },
): DiscoveryExtractionResult {
  const maxJobs = Math.max(0, Math.floor(options.maxJobs));
  const discoveredAt = (options.now ?? new Date()).toISOString();
  const source = options.source ?? DISCOVERY_SOURCES.best_matches;
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
        sourceType: source.sourceType,
        sourceLabel: source.sourceLabel,
        discoveredAt,
        postedAtText,
        recencyRank: recencyRankFromText(postedAtText),
        sourcePurpose: source.purpose,
        sourceQuery: source.query,
        sourceUrl: source.url,
      });
    }
    if (byCanonical.size >= maxJobs) break;
  }
  return { links: [...byCanonical.values()].slice(0, maxJobs), invalidSkipped, alreadyHandledSkipped };
}

export function extractBestMatchesJobLinksWithStats(html: string, options: DiscoveryBestMatchesOptions): DiscoveryExtractionResult {
  return extractDiscoveryJobLinksWithStats(html, { ...options, source: DISCOVERY_SOURCES.best_matches });
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

async function scrollDiscoveryPage(page: DiscoveryPageLike): Promise<boolean> {
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

function toolForSource(source: DiscoverySourceConfig): typeof DISCOVERY_BEST_MATCHES_TOOL | typeof DISCOVERY_MULTI_SOURCE_TOOL {
  return source.sourceType === "best_matches" ? DISCOVERY_BEST_MATCHES_TOOL : DISCOVERY_MULTI_SOURCE_TOOL;
}

function blockedResult(
  inspection: BrowserSessionInspection,
  tool: typeof DISCOVERY_BEST_MATCHES_TOOL | typeof DISCOVERY_MULTI_SOURCE_TOOL = DISCOVERY_BEST_MATCHES_TOOL,
): DiscoveryBestMatchesResult {
  return {
    ok: false,
    tool,
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

function isCurrentDiscoverySourceUrl(currentUrl: string, sourceUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const target = new URL(sourceUrl);
    const samePath = current.origin === target.origin && current.pathname.replace(/\/+$/, "") === target.pathname.replace(/\/+$/, "");
    if (!samePath) return false;
    return target.search ? current.search === target.search : true;
  } catch {
    return false;
  }
}

export function getActiveDiscoverySourceLabelForUrl(currentUrl: string, sources = buildConfiguredDiscoverySources()): string | null {
  const source = sources.find((candidate) => isAllowedDiscoverySourceConfig(candidate) && isCurrentDiscoverySourceUrl(currentUrl, candidate.url));
  return source?.sourceLabel ?? null;
}

export function hasAllowedCaptureSourceMetadata(action: BrowserAction): boolean {
  if (action.actionType !== "capture_job_from_url") return true;
  const source = typeof action.payload.source === "string" ? action.payload.source : "";
  const canonicalJobUrl = typeof action.payload.canonicalJobUrl === "string" ? action.payload.canonicalJobUrl : "";
  if (source === "slack_url" && canonicalizeDiscoveryUpworkJobUrl(canonicalJobUrl)) return true;

  const discovery = action.payload.discovery;
  if (!discovery || typeof discovery !== "object" || Array.isArray(discovery)) return false;
  const payload = discovery as Record<string, unknown>;
  const sourceType = typeof payload.sourceType === "string" ? payload.sourceType : "";
  const sourceLabel = typeof payload.sourceLabel === "string" ? payload.sourceLabel : "";
  const sourceUrl = typeof payload.sourceUrl === "string" ? payload.sourceUrl : "";
  const discoveredAt = typeof payload.discoveredAt === "string" ? payload.discoveredAt : "";
  const discoveryCanonicalJobUrl = typeof payload.canonicalJobUrl === "string" ? payload.canonicalJobUrl : canonicalJobUrl;
  const sourceConfig = { sourceType, sourceLabel, url: sourceUrl } as DiscoverySourceConfig;
  return Boolean(
    source.startsWith("discovery.") &&
    isAllowedDiscoverySourceConfig(sourceConfig) &&
    discoveredAt &&
    canonicalizeDiscoveryUpworkJobUrl(discoveryCanonicalJobUrl)
  );
}

export function countUnknownSourceQueuedCaptureActions(actions: BrowserAction[]): number {
  return actions.filter((action) =>
    action.actionType === "capture_job_from_url" &&
    ["pending", "in_progress", "paused"].includes(action.status) &&
    !hasAllowedCaptureSourceMetadata(action)
  ).length;
}

async function selectAllowedDiscoveryPage(
  context: DiscoveryContextLike,
  source: DiscoverySourceConfig,
): Promise<{ page: DiscoveryPageLike | null; reason: string; ignoredTabCount: number }> {
  const pages = context.pages?.() ?? [];
  const exactSourcePage = pages.find((page) => isCurrentDiscoverySourceUrl(page.url(), source.url));
  if (exactSourcePage) {
    return { page: exactSourcePage, reason: `Using existing configured discovery source tab: ${source.sourceLabel}.`, ignoredTabCount: ignoredDiscoveryTabCount(pages, exactSourcePage) };
  }

  const reusableSourceTab = pages.find((page) => isUpworkFindWorkFeedUrl(page.url()) && !isUpworkWorkTabUrl(page.url()));
  if (reusableSourceTab?.goto) {
    await reusableSourceTab.goto(source.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    return { page: reusableSourceTab, reason: `Navigated existing feed/search tab to configured discovery source: ${source.sourceLabel}.`, ignoredTabCount: ignoredDiscoveryTabCount(pages, reusableSourceTab) };
  }

  if (context.newPage) {
    const page = await context.newPage();
    if (page.goto) {
      await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    return { page, reason: `Opened a new tab for configured discovery source: ${source.sourceLabel}.`, ignoredTabCount: ignoredDiscoveryTabCount(pages, page) };
  }

  return { page: null, reason: "No allowed feed/search tab is available and this context cannot open a new source tab.", ignoredTabCount: ignoredDiscoveryTabCount(pages, null) };
}

function ignoredDiscoveryTabCount(pages: DiscoveryPageLike[], selectedPage: DiscoveryPageLike | null): number {
  return pages.filter((page) => page !== selectedPage && isUpworkWorkTabUrl(page.url())).length;
}

export async function runDiscoverySource(
  context: DiscoveryContextLike,
  source: DiscoverySourceConfig,
  options: DiscoveryBestMatchesOptions,
): Promise<DiscoveryBestMatchesResult> {
  const maxJobs = Math.max(1, Math.floor(options.maxJobs));
  const tool = toolForSource(source);
  if (!isAllowedDiscoverySourceConfig(source)) {
    return {
      ok: false,
      tool,
      sessionState: "unknown",
      manualAttentionRequired: false,
      blocked: false,
      jobsFound: 0,
      jobsQueued: 0,
      duplicatesSkipped: 0,
      alreadyHandledSkipped: 0,
      invalidSkipped: 0,
      scrollsPerformed: 0,
      error: `Discovery source is not allowed or not configured safely: ${source.sourceLabel}`,
    };
  }
  const inspection = await inspectBrowserSession(context);
  if (inspection.blocked || inspection.manualAttentionRequired || inspection.sessionState === "browser_session_unhealthy") {
    return blockedResult(inspection, tool);
  }

  const selected = await selectAllowedDiscoveryPage(context, source);
  if (!selected.page) {
    return {
      ok: false,
      tool,
      sessionState: inspection.sessionState,
      manualAttentionRequired: false,
      blocked: false,
      jobsFound: 0,
      jobsQueued: 0,
      duplicatesSkipped: 0,
      alreadyHandledSkipped: 0,
      invalidSkipped: 0,
      scrollsPerformed: 0,
      error: selected.reason,
    };
  }
  const page = selected.page as unknown as DiscoveryPageLike;
  if (!isCurrentDiscoverySourceUrl(page.url(), source.url)) {
    return {
      ok: false,
      tool,
      sessionState: inspection.sessionState,
      manualAttentionRequired: false,
      blocked: false,
      jobsFound: 0,
      jobsQueued: 0,
      duplicatesSkipped: 0,
      alreadyHandledSkipped: 0,
      invalidSkipped: 0,
      scrollsPerformed: 0,
      error: `Selected page is not the configured discovery source. source=${source.url} actual=${page.url()}`,
    };
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
      return blockedResult(inspectionAfterScroll, tool);
    }

    const html = await page.evaluate(() => (globalThis as unknown as { document: { documentElement: { outerHTML: string } } }).document.documentElement.outerHTML);
    const extraction = extractDiscoveryJobLinksWithStats(html, { maxJobs: Math.max(maxJobs * 5, 25), now: options.now, source });
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
    const scrolled = await scrollDiscoveryPage(page);
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
        source: `discovery.${source.sourceType}`,
        sourceType: link.sourceType,
        sourceLabel: link.sourceLabel,
        sourceUrl: link.sourceUrl ?? source.url,
        discoveredAt: link.discoveredAt,
        url: link.canonicalJobUrl,
        originalUrl: link.originalUrl,
        canonicalJobUrl: link.canonicalJobUrl,
        notes: `Discovered from Upwork ${source.sourceLabel}; browser capture required before scoring and draft prep.`,
        discovery: {
          sourceType: link.sourceType,
          sourceLabel: link.sourceLabel,
          discoveredAt: link.discoveredAt,
          canonicalJobUrl: link.canonicalJobUrl,
          sourceUrl: link.sourceUrl ?? source.url,
          ...(link.sourcePurpose ? { purpose: link.sourcePurpose } : {}),
          ...(link.sourceQuery ? { query: link.sourceQuery } : {}),
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
    tool,
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
    sourcesChecked: [source.sourceLabel],
  };
}

export async function runDiscoveryBestMatches(context: DiscoveryContextLike, options: DiscoveryBestMatchesOptions): Promise<DiscoveryBestMatchesResult> {
  return runDiscoverySource(context, DISCOVERY_SOURCES.best_matches, options);
}

export async function runDiscoveryConfiguredSources(
  context: DiscoveryContextLike,
  options: DiscoveryBestMatchesOptions,
  sources = buildConfiguredDiscoverySources(),
): Promise<DiscoveryBestMatchesResult> {
  const activeSources = sources.length > 0 ? sources : [DISCOVERY_SOURCES.best_matches];
  const maxJobs = Math.max(1, Math.floor(options.maxJobs));
  const aggregate: DiscoveryBestMatchesResult = {
    ok: true,
    tool: DISCOVERY_MULTI_SOURCE_TOOL,
    sessionState: "unknown",
    manualAttentionRequired: false,
    blocked: false,
    jobsFound: 0,
    jobsQueued: 0,
    duplicatesSkipped: 0,
    alreadyHandledSkipped: 0,
    invalidSkipped: 0,
    scrollsPerformed: 0,
    queuedActionIds: [],
    sourcesChecked: [],
  };

  for (const source of activeSources) {
    if (aggregate.jobsQueued >= maxJobs) break;
    const remainingJobs = maxJobs - aggregate.jobsQueued;
    const result = await runDiscoverySource(context, source, { ...options, maxJobs: remainingJobs });
    aggregate.sessionState = result.sessionState;
    aggregate.manualAttentionRequired = aggregate.manualAttentionRequired || result.manualAttentionRequired;
    aggregate.blocked = aggregate.blocked || result.blocked;
    aggregate.jobsFound += result.jobsFound;
    aggregate.jobsQueued += result.jobsQueued;
    aggregate.duplicatesSkipped += result.duplicatesSkipped;
    aggregate.alreadyHandledSkipped += result.alreadyHandledSkipped;
    aggregate.invalidSkipped += result.invalidSkipped;
    aggregate.scrollsPerformed += result.scrollsPerformed;
    aggregate.sourcesChecked?.push(source.sourceLabel);
    aggregate.queuedActionIds?.push(...(result.queuedActionIds ?? []));
    aggregate.newestQueuedPostedAtText ??= result.newestQueuedPostedAtText;
    aggregate.oldestQueuedPostedAtText = result.oldestQueuedPostedAtText ?? aggregate.oldestQueuedPostedAtText;

    if (!result.ok) {
      return {
        ...aggregate,
        ok: false,
        manualAttentionReason: result.manualAttentionReason,
        retryAllowedAfterManualFix: result.retryAllowedAfterManualFix,
        error: result.error,
      };
    }
  }

  return aggregate;
}
