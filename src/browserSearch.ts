import {
  BROWSER_DRY_RUN,
  BROWSER_HEADLESS,
  BROWSER_SEARCH_ENABLED,
  BROWSER_SEARCH_FRESHNESS_WINDOW_MINUTES,
  BROWSER_SEARCH_INPUTS,
  BROWSER_SEARCH_INTERVAL_MS,
  BROWSER_SEARCH_MAX_JOBS_PER_QUERY,
  BROWSER_USER_DATA_DIR,
} from "./config";
import { closeDb, enqueueBrowserAction } from "./db";
import { writeHeartbeat } from "./heartbeat";
import { logger } from "./logger";
import { buildDeterministicOpportunityPacket } from "./normalization";
import {
  BrowserCapturedJobPage,
  BrowserSearchConfig,
  BrowserSearchQuery,
  BrowserSearchResultLink,
  BrowserSearchRunResult,
  BrowserSearchRunSummary,
} from "./types";
import { formatBrowserSessionStatus, getBrowserSessionStatus, recordBrowserManualAttention } from "./browserSession";
import { guardedGoto } from "./browserSafetyGuard";

const UPWORK_SEARCH_URL = "https://www.upwork.com/nx/search/jobs/";
const UPWORK_HOSTS = new Set(["upwork.com", "www.upwork.com"]);
const UPWORK_JOB_ID_PATTERN = /~([A-Za-z0-9_-]{8,})/;
const SECURITY_STATES = [
  "two-factor",
  "two factor",
  "verification code",
  "captcha",
  "cloudflare",
  "security check",
  "verify you are human",
  "log in",
  "login",
  "sign in",
];

type BrowserSearchPausedReason = "browser_search_disabled" | "no_browser_search_queries" | "dry_run" | "browser_unavailable" | "login_or_security_required" | "browser_session_blocked";

interface PlaywrightPageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  locator(selector: string): { first(): { textContent(options?: { timeout?: number }): Promise<string | null> } };
  evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T>;
}

interface PlaywrightContextLike {
  newPage(): Promise<PlaywrightPageLike>;
  close(): Promise<unknown>;
}

interface PlaywrightChromiumLike {
  launchPersistentContext(userDataDir: string, options: { headless: boolean }): Promise<PlaywrightContextLike>;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "query";
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isSafeUpworkSearchUrl(url: string): boolean {
  const parsed = parseUrl(url.trim());
  return parsed != null && parsed.protocol === "https:" && UPWORK_HOSTS.has(parsed.hostname) && parsed.pathname === "/nx/search/jobs/";
}

export function normalizeUpworkSearchInput(input: string): BrowserSearchQuery | null {
  const trimmed = input.trim();
  const isUrl = /^https?:\/\//i.test(trimmed);
  if (isUrl && !isSafeUpworkSearchUrl(trimmed)) {
    return null;
  }

  const url = isUrl ? trimmed : `${UPWORK_SEARCH_URL}?q=${encodeURIComponent(trimmed)}&sort=recency`;
  const parsed = isUrl ? parseUrl(trimmed) : null;
  const query = parsed?.searchParams.get("q")?.trim() || trimmed;

  return {
    id: slugify(query),
    label: query,
    query,
    url,
  };
}

export function buildBrowserSearchQueries(inputs: string[]): BrowserSearchQuery[] {
  const seen = new Set<string>();
  const queries: BrowserSearchQuery[] = [];
  for (const input of inputs) {
    if (!input.trim()) continue;
    const query = normalizeUpworkSearchInput(input);
    if (!query) continue;
    const key = query.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
  }
  return queries;
}

export function getBrowserSearchConfig(): BrowserSearchConfig {
  return {
    enabled: BROWSER_SEARCH_ENABLED,
    dryRun: BROWSER_DRY_RUN,
    intervalMs: BROWSER_SEARCH_INTERVAL_MS,
    maxJobsPerQuery: BROWSER_SEARCH_MAX_JOBS_PER_QUERY,
    freshnessWindowMinutes: BROWSER_SEARCH_FRESHNESS_WINDOW_MINUTES,
    queries: buildBrowserSearchQueries(BROWSER_SEARCH_INPUTS),
  };
}

export function extractUpworkJobId(url: string): string | null {
  const parsed = parseUrl(url.trim());
  if (!parsed || parsed.protocol !== "https:" || !UPWORK_HOSTS.has(parsed.hostname) || !parsed.pathname.startsWith("/jobs/")) {
    return null;
  }
  return parsed.pathname.match(UPWORK_JOB_ID_PATTERN)?.[1] ?? null;
}

export function isSafeUpworkJobUrl(url: string): boolean {
  return extractUpworkJobId(url) != null;
}

export function shouldSkipBrowserSearch(config: BrowserSearchConfig): BrowserSearchPausedReason | null {
  const session = getBrowserSessionStatus();
  if (session.blocked) return "browser_session_blocked";
  if (!config.enabled) return "browser_search_disabled";
  if (config.queries.length === 0) return "no_browser_search_queries";
  if (config.dryRun) return "dry_run";
  return null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createInitialSummary(config: BrowserSearchConfig): BrowserSearchRunSummary {
  const timestamp = nowIso();
  return {
    startedAt: timestamp,
    finishedAt: timestamp,
    dryRun: config.dryRun,
    queriesRun: 0,
    jobsFound: 0,
    jobsCaptured: 0,
    jobsQueued: 0,
    errors: [],
  };
}

function finish(summary: BrowserSearchRunSummary, pausedReason?: BrowserSearchPausedReason): BrowserSearchRunSummary {
  return {
    ...summary,
    finishedAt: nowIso(),
    pausedReason,
  };
}

function emptyResult(summary: BrowserSearchRunSummary): BrowserSearchRunResult {
  return { summary, links: [], capturedPages: [], normalizedPackets: [] };
}

function boundedText(value: string, maxLength = 12000): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function detectLoginOrSecurity(url: string, title: string, text: string): boolean {
  const haystack = `${url}\n${title}\n${text}`.toLowerCase();
  return SECURITY_STATES.some((state) => haystack.includes(state));
}

async function loadChromium(): Promise<PlaywrightChromiumLike | null> {
  try {
    const mod = (await import("playwright")) as { chromium?: PlaywrightChromiumLike };
    return mod.chromium ?? null;
  } catch {
    return null;
  }
}

async function bodyText(page: PlaywrightPageLike): Promise<string> {
  return (await page.locator("body").first().textContent({ timeout: 5000 })) ?? "";
}

async function assertNoSecurityPause(page: PlaywrightPageLike): Promise<boolean> {
  const text = await bodyText(page);
  return detectLoginOrSecurity(page.url(), await page.title(), text);
}

async function extractSearchLinks(page: PlaywrightPageLike, query: BrowserSearchQuery, maxJobs: number): Promise<BrowserSearchResultLink[]> {
  const discoveredAt = nowIso();
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='/jobs/']"))
      .map((anchor) => anchor.href)
      .filter(Boolean)
  );
  const seen = new Set<string>();
  const links: BrowserSearchResultLink[] = [];
  for (const href of hrefs) {
    if (!isSafeUpworkJobUrl(href)) continue;
    const url = href.replace(/[?#].*$/, "");
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      jobId: extractUpworkJobId(url),
      title: "Upwork job",
      url,
      sourceQueryId: query.id,
      sourceQueryLabel: query.label,
      discoveredAt,
    });
    if (links.length >= maxJobs) break;
  }
  return links;
}

async function captureJobPage(page: PlaywrightPageLike, link: BrowserSearchResultLink): Promise<BrowserCapturedJobPage | null> {
  await guardedGoto(page, link.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const text = boundedText(await bodyText(page));
  const title = await page.title();
  if (detectLoginOrSecurity(page.url(), title, text)) {
    return null;
  }
  return {
    jobId: extractUpworkJobId(page.url()),
    url: page.url(),
    title,
    text,
    sourceQueryId: link.sourceQueryId,
    sourceQueryLabel: link.sourceQueryLabel,
    capturedAt: nowIso(),
  };
}

export async function runBrowserSearch(config = getBrowserSearchConfig()): Promise<BrowserSearchRunResult> {
  const summary = createInitialSummary(config);
  const skipReason = shouldSkipBrowserSearch(config);
  if (skipReason) {
    logger.info(`Browser search paused: ${skipReason}; ${formatBrowserSessionStatus()}`);
    return emptyResult(finish(summary, skipReason));
  }

  const chromium = await loadChromium();
  if (!chromium) {
    return emptyResult(finish(summary, "browser_unavailable"));
  }

  const links: BrowserSearchResultLink[] = [];
  const capturedPages: BrowserCapturedJobPage[] = [];
  const normalizedPackets = [];
  let context: PlaywrightContextLike | null = null;

  try {
    context = await chromium.launchPersistentContext(BROWSER_USER_DATA_DIR, { headless: BROWSER_HEADLESS });
    const page = await context.newPage();
    for (const query of config.queries) {
      await guardedGoto(page, query.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      summary.queriesRun += 1;
      if (await assertNoSecurityPause(page)) {
        await recordBrowserManualAttention({ url: page.url(), title: await page.title(), reason: "browser_search_login_or_security_required" });
        return { summary: finish(summary, "login_or_security_required"), links, capturedPages, normalizedPackets };
      }
      const queryLinks = await extractSearchLinks(page, query, config.maxJobsPerQuery);
      links.push(...queryLinks);
      summary.jobsFound = links.length;

      for (const link of queryLinks) {
        const captured = await captureJobPage(page, link);
        if (!captured) {
          await recordBrowserManualAttention({ url: page.url(), title: await page.title(), reason: "browser_search_login_or_security_required" });
          return { summary: finish(summary, "login_or_security_required"), links, capturedPages, normalizedPackets };
        }
        capturedPages.push(captured);
        const packet = buildDeterministicOpportunityPacket(captured.text, { url: captured.url, capturedAt: new Date(captured.capturedAt) });
        normalizedPackets.push(packet);
        enqueueBrowserAction({
          jobId: packet.job.id,
          actionType: "open_job",
          payload: {
            url: captured.url,
            title: captured.title,
            source: "browser_search",
            sourceQuery: captured.sourceQueryLabel,
            capturedAt: captured.capturedAt,
            notes: "Browser search captured and normalized this job detail page; queued for downstream browser review/capture workflows.",
          },
        });
        summary.jobsCaptured = capturedPages.length;
        summary.jobsQueued += 1;
      }
    }
    return { summary: finish(summary), links, capturedPages, normalizedPackets };
  } catch (error) {
    summary.errors.push(error instanceof Error ? error.message : String(error));
    return { summary: finish(summary), links, capturedPages, normalizedPackets };
  } finally {
    await context?.close();
  }
}

function heartbeatMetadata(summary: BrowserSearchRunSummary): Record<string, unknown> {
  return {
    source: "browser-search-cli",
    dryRun: summary.dryRun,
    queriesRun: summary.queriesRun,
    jobsFound: summary.jobsFound,
    jobsCaptured: summary.jobsCaptured,
    jobsQueued: summary.jobsQueued,
    pausedReason: summary.pausedReason ?? null,
    errors: summary.errors,
  };
}

export async function runBrowserSearchCli(): Promise<void> {
  const result = await runBrowserSearch();
  writeHeartbeat({
    worker: "browser-search",
    status: result.summary.errors.length > 0 ? "error" : "success",
    error: result.summary.errors[0],
    metadata: heartbeatMetadata(result.summary),
  });
  console.log(JSON.stringify(result.summary, null, 2));
}

if (require.main === module) {
  runBrowserSearchCli()
    .catch((error: unknown) => {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
