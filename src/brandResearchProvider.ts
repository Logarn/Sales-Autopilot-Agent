import {
  BRAND_RESEARCH_API_KEY,
  BRAND_RESEARCH_MAX_RESULTS,
  BRAND_RESEARCH_PROVIDER,
  BRAND_RESEARCH_TIMEOUT_MS,
  BRAVE_SEARCH_API_KEY,
  SERPAPI_API_KEY,
  TAVILY_API_KEY,
} from "./config";
import { BrandResearchSourceDetail, JobPosting } from "./types";

export interface BrandResearchSearchInput {
  query: string;
  job: Pick<JobPosting, "id" | "title" | "description" | "skills" | "category" | "budget" | "clientCountry">;
  maxResults: number;
  timeoutMs: number;
}

export interface BrandResearchToolProvider {
  name: string;
  isAvailable(): boolean;
  search(input: BrandResearchSearchInput): Promise<BrandResearchSourceDetail[]>;
}

export interface BrandResearchRun {
  shouldResearch: boolean;
  attempted: boolean;
  provider: string;
  status: "not_applicable" | "not_configured" | "skipped" | "succeeded" | "failed";
  query: string;
  results: BrandResearchSourceDetail[];
  skippedReason?: string;
  error?: string;
}

class DisabledBrandResearchProvider implements BrandResearchToolProvider {
  readonly name = "disabled";

  isAvailable(): boolean {
    return false;
  }

  async search(): Promise<BrandResearchSourceDetail[]> {
    return [];
  }
}

export function createMockBrandResearchProvider(results: BrandResearchSourceDetail[]): BrandResearchToolProvider {
  return {
    name: "mock",
    isAvailable: () => true,
    search: async () => results,
  };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (/^(?:0|127|10)\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(?:1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (host === "::1" || host.startsWith("::ffff:127.") || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  return false;
}

export function isSafeBrandResearchUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    if (isPrivateHostname(hostname)) return false;
    if (hostname === "upwork.com" || hostname.endsWith(".upwork.com")) return false;
    if (hostname === "slack.com" || hostname.endsWith(".slack.com")) return false;
    return true;
  } catch {
    return false;
  }
}

function safeResult(input: {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
  provider: string;
}): BrandResearchSourceDetail | null {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!isSafeBrandResearchUrl(url)) return null;
  const title = typeof input.title === "string" ? input.title : "";
  const snippet = typeof input.snippet === "string" ? input.snippet : "";
  return {
    title: truncate(title || url, 160),
    url,
    snippet: truncate(snippet, 700),
    provider: input.provider,
  };
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

class TavilyBrandResearchProvider implements BrandResearchToolProvider {
  readonly name = "tavily";

  constructor(private readonly apiKey: string) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey.trim());
  }

  async search(input: BrandResearchSearchInput): Promise<BrandResearchSourceDetail[]> {
    const payload = await fetchJson(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: this.apiKey,
          query: input.query,
          max_results: input.maxResults,
          include_answer: false,
          include_raw_content: false,
        }),
      },
      input.timeoutMs,
    );
    const results = Array.isArray((payload as { results?: unknown[] }).results)
      ? (payload as { results: Array<Record<string, unknown>> }).results
      : [];
    return results
      .map((result) => safeResult({
        title: result.title,
        url: result.url,
        snippet: result.content,
        provider: this.name,
      }))
      .filter((result): result is BrandResearchSourceDetail => Boolean(result))
      .slice(0, input.maxResults);
  }
}

class SerpApiBrandResearchProvider implements BrandResearchToolProvider {
  readonly name = "serpapi";

  constructor(private readonly apiKey: string) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey.trim());
  }

  async search(input: BrandResearchSearchInput): Promise<BrandResearchSourceDetail[]> {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", input.query);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("num", String(input.maxResults));
    const payload = await fetchJson(url.toString(), { method: "GET" }, input.timeoutMs);
    const results = Array.isArray((payload as { organic_results?: unknown[] }).organic_results)
      ? (payload as { organic_results: Array<Record<string, unknown>> }).organic_results
      : [];
    return results
      .map((result) => safeResult({
        title: result.title,
        url: result.link,
        snippet: result.snippet,
        provider: this.name,
      }))
      .filter((result): result is BrandResearchSourceDetail => Boolean(result))
      .slice(0, input.maxResults);
  }
}

class BraveBrandResearchProvider implements BrandResearchToolProvider {
  readonly name = "brave";

  constructor(private readonly apiKey: string) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey.trim());
  }

  async search(input: BrandResearchSearchInput): Promise<BrandResearchSourceDetail[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", input.query);
    url.searchParams.set("count", String(input.maxResults));
    const payload = await fetchJson(
      url.toString(),
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-subscription-token": this.apiKey,
        },
      },
      input.timeoutMs,
    );
    const results = Array.isArray((payload as { web?: { results?: unknown[] } }).web?.results)
      ? (payload as { web: { results: Array<Record<string, unknown>> } }).web.results
      : [];
    return results
      .map((result) => safeResult({
        title: result.title,
        url: result.url,
        snippet: result.description,
        provider: this.name,
      }))
      .filter((result): result is BrandResearchSourceDetail => Boolean(result))
      .slice(0, input.maxResults);
  }
}

export function createConfiguredBrandResearchProvider(): BrandResearchToolProvider {
  const provider = BRAND_RESEARCH_PROVIDER.toLowerCase();
  const sharedKey = BRAND_RESEARCH_API_KEY.trim();
  if (provider === "tavily") return new TavilyBrandResearchProvider(TAVILY_API_KEY || sharedKey);
  if (provider === "serpapi") return new SerpApiBrandResearchProvider(SERPAPI_API_KEY || sharedKey);
  if (provider === "brave") return new BraveBrandResearchProvider(BRAVE_SEARCH_API_KEY || sharedKey);
  return new DisabledBrandResearchProvider();
}

function firstVisibleUrl(text: string): string {
  const match = text.match(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/[^\s),.;]*)?/i);
  if (!match?.[0] || /upwork\.com/i.test(match[0])) return "";
  return match[0].startsWith("http") ? match[0] : `https://${match[0]}`;
}

function firstVisibleBrand(text: string): string {
  const patterns = [
    /\b(?:brand|store|company|site)\s+([A-Z][A-Za-z0-9&' -]{2,60}?)(?=\s*(?:\/|,|\.|\band\b|\bneeds\b|\bis\b|\n|$))/,
    /\bfor\s+([A-Z][A-Za-z0-9&' -]{2,50}?)(?=\s+(?:brand|store|shop|site|company)\b)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return normalizeWhitespace(match[1]);
  }
  return "";
}

function categoryClue(text: string, fallbackCategory: string): string {
  const lower = text.toLowerCase();
  if (/garden|plant|lawn|seed|nursery|horticulture/.test(lower)) return "gardening ecommerce";
  if (/beauty|skincare|cosmetic|skin care|makeup/.test(lower)) return "beauty skincare ecommerce";
  if (/fashion|apparel|clothing|boutique|jewelry/.test(lower)) return "fashion apparel ecommerce";
  if (/email design|template|figma|design|creative|visual/.test(lower)) return "email design conversion hierarchy";
  if (/\b(?:pet|dog|cat|farm|hobby)\b/.test(lower)) return "pet hobby ecommerce";
  if (/supplement|wellness|health/.test(lower)) return "health wellness ecommerce";
  if (/saas|b2b|software|crm implementation|sales pipeline/.test(lower)) return "B2B SaaS lifecycle marketing";
  if (/shopify|ecommerce|e-commerce|dtc|d2c/.test(lower)) return "DTC ecommerce lifecycle marketing";
  return fallbackCategory;
}

export function buildBrandResearchQuery(
  job: Pick<JobPosting, "title" | "description" | "skills" | "category" | "budget" | "clientCountry">,
): { shouldResearch: boolean; query: string; reason: string } {
  const text = [job.title, job.description, job.skills.join(" "), job.category, job.budget, job.clientCountry].join("\n");
  const visibleUrl = firstVisibleUrl(text);
  if (visibleUrl && isSafeBrandResearchUrl(visibleUrl)) {
    const host = new URL(visibleUrl).hostname.replace(/^www\./, "");
    return {
      shouldResearch: true,
      query: `site:${host} brand products customers reviews lifecycle marketing`,
      reason: `visible website clue ${host}`,
    };
  }

  const brand = firstVisibleBrand(text);
  if (brand) {
    return {
      shouldResearch: true,
      query: `"${brand}" brand products customers ecommerce`,
      reason: `visible brand clue ${brand}`,
    };
  }

  const category = categoryClue(text, job.category);
  if (category && category.toLowerCase() !== "email marketing") {
    return {
      shouldResearch: true,
      query: `${category} customer buying moments objections repeat purchase lifecycle leaks`,
      reason: `category clue ${category}`,
    };
  }

  return { shouldResearch: false, query: "", reason: "no useful brand, site, product, or category clue" };
}

export async function researchBrandForJob(input: {
  job: Pick<JobPosting, "id" | "title" | "description" | "skills" | "category" | "budget" | "clientCountry">;
  provider?: BrandResearchToolProvider;
  maxResults?: number;
  timeoutMs?: number;
}): Promise<BrandResearchRun> {
  const provider = input.provider ?? createConfiguredBrandResearchProvider();
  const query = buildBrandResearchQuery(input.job);
  if (!query.shouldResearch) {
    return {
      shouldResearch: false,
      attempted: false,
      provider: provider.name,
      status: "not_applicable",
      query: "",
      results: [],
      skippedReason: query.reason,
    };
  }

  if (!provider.isAvailable()) {
    return {
      shouldResearch: true,
      attempted: false,
      provider: provider.name,
      status: "not_configured",
      query: query.query,
      results: [],
      skippedReason: `${provider.name} brand research provider is not configured`,
    };
  }

  try {
    const results = await provider.search({
      query: query.query,
      job: input.job,
      maxResults: input.maxResults ?? BRAND_RESEARCH_MAX_RESULTS,
      timeoutMs: input.timeoutMs ?? BRAND_RESEARCH_TIMEOUT_MS,
    });
    return {
      shouldResearch: true,
      attempted: true,
      provider: provider.name,
      status: results.length > 0 ? "succeeded" : "failed",
      query: query.query,
      results,
      skippedReason: results.length > 0 ? undefined : "provider returned no safe source results",
    };
  } catch (error) {
    return {
      shouldResearch: true,
      attempted: true,
      provider: provider.name,
      status: "failed",
      query: query.query,
      results: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
