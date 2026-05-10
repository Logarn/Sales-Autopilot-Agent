import * as fs from "node:fs";
import * as path from "node:path";
import dotenv from "dotenv";
import { DEFAULT_SEARCH_QUERIES } from "./feeds";

dotenv.config();

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseQueriesFromEnvOrFile(): string[] {
  const envQueries = process.env.SEARCH_QUERIES;
  if (envQueries && envQueries.trim().length > 0) {
    return envQueries
      .split("|")
      .map((q) => q.trim())
      .filter(Boolean);
  }

  const configPath =
    process.env.QUERIES_CONFIG_PATH ?? path.resolve(process.cwd(), "config/queries.json");
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw) as { queries?: string[] };
      if (Array.isArray(parsed.queries) && parsed.queries.length > 0) {
        return parsed.queries.map((q) => q.trim()).filter(Boolean);
      }
    } catch {
      // Fall through to defaults if the optional JSON file is invalid.
    }
  }

  return DEFAULT_SEARCH_QUERIES;
}

export const APP_NAME = "Upwork Revenue Assistant";
export const SLACK_CHANNEL_WEBHOOK_URL = process.env.SLACK_CHANNEL_WEBHOOK_URL ?? "";
export const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN ?? "";
export const QUICK_BID_TEMPLATE_URL = process.env.QUICK_BID_TEMPLATE_URL ?? "";
export const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? "*/5 * * * *";
export const DAILY_SUMMARY_CRON = process.env.DAILY_SUMMARY_CRON ?? "0 8 * * *";
export const SCHEDULER_INTERVAL_MS = Math.min(
  Math.max(parseInteger(process.env.SCHEDULER_INTERVAL_MS, 5 * 60 * 1000), 5 * 60 * 1000),
  10 * 60 * 1000
);
export const HEARTBEAT_STALE_AFTER_MS = parseInteger(process.env.HEARTBEAT_STALE_AFTER_MS, 15 * 60 * 1000);
export const TIMEZONE = process.env.TIMEZONE ?? "Africa/Nairobi";
export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
export const DB_PATH = process.env.DB_PATH ?? "./data/jobs.db";
export const PROFILE_CONFIG_PATH = process.env.PROFILE_CONFIG_PATH ?? "./profile/profile.json";
export const PORTFOLIO_CONFIG_PATH = process.env.PORTFOLIO_CONFIG_PATH ?? "./profile/portfolio.json";
export const MANUAL_JOBS_CONFIG_PATH = process.env.MANUAL_JOBS_CONFIG_PATH ?? "./config/manual-jobs.json";
export const CONNECTS_RULES_CONFIG_PATH = process.env.CONNECTS_RULES_CONFIG_PATH ?? "./profile/connects-rules.json";
export const PROFILE_KNOWLEDGE_DIR = process.env.PROFILE_KNOWLEDGE_DIR ?? "./profile/knowledge";
export const MIN_SCORE_TO_NOTIFY = parseInteger(process.env.MIN_SCORE_TO_NOTIFY, 4);
export const MIN_SCORE_HIGH = parseInteger(process.env.MIN_SCORE_HIGH, 8);
export const MAX_DESCRIPTION_LENGTH = parseInteger(process.env.MAX_DESCRIPTION_LENGTH, 300);
export const ENABLE_LOW_MATCH_DIGEST = parseBoolean(process.env.ENABLE_LOW_MATCH_DIGEST, false);
export const BROWSER_WORKER_ENABLED = parseBoolean(process.env.BROWSER_WORKER_ENABLED, false);
export const BROWSER_HEADLESS = parseBoolean(process.env.BROWSER_HEADLESS, true);
export const BROWSER_USER_DATA_DIR = process.env.BROWSER_USER_DATA_DIR ?? "./data/browser-profile";
export const BROWSER_DRY_RUN = parseBoolean(process.env.BROWSER_DRY_RUN, true);
export const BROWSER_ARTIFACT_DIR = process.env.BROWSER_ARTIFACT_DIR ?? "";
export const BROWSER_ACTION_LIMIT = parseInteger(process.env.BROWSER_ACTION_LIMIT, 5);
export const FETCH_RETRY_ATTEMPTS = parseInteger(process.env.FETCH_RETRY_ATTEMPTS, 3);
export const FEED_DELAY_MS = parseInteger(process.env.FEED_DELAY_MS, 10000);
export const APIFY_REQUEST_TIMEOUT_MS = parseInteger(
  process.env.APIFY_REQUEST_TIMEOUT_MS,
  120000
);
export const SLACK_DELAY_MS = parseInteger(process.env.SLACK_DELAY_MS, 2000);
export const SLACK_RETRY_ATTEMPTS = parseInteger(process.env.SLACK_RETRY_ATTEMPTS, 3);
export const SEARCH_QUERIES = parseQueriesFromEnvOrFile();
export { parseBoolean, parseInteger };

export function validateRequiredConfig(): void {
  if (!APIFY_API_TOKEN.trim()) {
    throw new Error("APIFY_API_TOKEN is required. Set it in your environment.");
  }
}
