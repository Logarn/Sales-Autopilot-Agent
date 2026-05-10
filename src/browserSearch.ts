import {
  BROWSER_DRY_RUN,
  BROWSER_SEARCH_ENABLED,
  BROWSER_SEARCH_FRESHNESS_WINDOW_MINUTES,
  BROWSER_SEARCH_INPUTS,
  BROWSER_SEARCH_INTERVAL_MS,
  BROWSER_SEARCH_MAX_JOBS_PER_QUERY,
} from "./config";
import { BrowserSearchConfig, BrowserSearchQuery } from "./types";

const UPWORK_SEARCH_URL = "https://www.upwork.com/nx/search/jobs/";
const UPWORK_JOB_URL_PATTERN = /https:\/\/(?:www\.)?upwork\.com\/jobs\/[^\s"'<>]*~([A-Za-z0-9_-]{8,})[^\s"'<>]*/i;

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "query";
}

export function normalizeUpworkSearchInput(input: string): BrowserSearchQuery {
  const trimmed = input.trim();
  const isUrl = /^https?:\/\//i.test(trimmed);
  const url = isUrl ? trimmed : `${UPWORK_SEARCH_URL}?q=${encodeURIComponent(trimmed)}&sort=recency`;
  let query = trimmed;
  if (isUrl) {
    try {
      query = new URL(trimmed).searchParams.get("q")?.trim() || trimmed;
    } catch {
      query = trimmed;
    }
  }

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
  return url.match(UPWORK_JOB_URL_PATTERN)?.[1] ?? null;
}

export function isSafeUpworkJobUrl(url: string): boolean {
  return UPWORK_JOB_URL_PATTERN.test(url.trim());
}

export function shouldSkipBrowserSearch(config: BrowserSearchConfig): string | null {
  if (!config.enabled) return "browser_search_disabled";
  if (config.queries.length === 0) return "no_browser_search_queries";
  return null;
}
