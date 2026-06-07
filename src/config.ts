import * as fs from "node:fs";
import * as path from "node:path";
import dotenv from "dotenv";
import { DEFAULT_SEARCH_QUERIES } from "./feeds";

dotenv.config({ quiet: true });

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

function parseDelimitedList(value: string | undefined): string[] {
  if (!value || value.trim().length === 0) {
    return [];
  }
  return value
    .split("|")
    .map((q) => q.trim())
    .filter(Boolean);
}

function parseDelimitedListLoose(value: string | undefined): string[] {
  if (!value || value.trim().length === 0) {
    return [];
  }
  return value
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseQueriesFromEnvOrFile(): string[] {
  const envQueries = parseDelimitedList(process.env.SEARCH_QUERIES);
  if (envQueries.length > 0) {
    return envQueries;
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

function parseBrowserSearchInputs(): string[] {
  const explicitQueries = parseDelimitedList(process.env.BROWSER_SEARCH_QUERIES);
  if (explicitQueries.length > 0) {
    return explicitQueries;
  }

  const explicitUrls = parseDelimitedList(process.env.BROWSER_SEARCH_URLS);
  if (explicitUrls.length > 0) {
    return explicitUrls;
  }

  return SEARCH_QUERIES;
}

export const APP_NAME = "Upwork Revenue Assistant";
export const SLACK_CHANNEL_WEBHOOK_URL = process.env.SLACK_CHANNEL_WEBHOOK_URL ?? "";
export const SLACK_INBOUND_MODE = process.env.SLACK_INBOUND_MODE ?? "local_cli";
export const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "";
export const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN ?? "";
export const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN ?? "";
export const SLACK_POLL_CHANNEL_ID = process.env.SLACK_POLL_CHANNEL_ID ?? "";
export const DISCOVERY_SLACK_CHANNEL_ID = process.env.DISCOVERY_SLACK_CHANNEL_ID ?? "";
export const SLACK_SOCKET_MODE_ENABLED = parseBoolean(process.env.SLACK_SOCKET_MODE_ENABLED, false);
export const SLACK_ALLOWED_CHANNEL_IDS = parseDelimitedListLoose(process.env.SLACK_ALLOWED_CHANNEL_IDS);
export const SLACK_FILE_MAX_BYTES = Math.max(1, parseInteger(process.env.SLACK_FILE_MAX_BYTES, 10 * 1024 * 1024));
export const SLACK_FILE_ALLOWED_EXTENSIONS = parseDelimitedListLoose(
  process.env.SLACK_FILE_ALLOWED_EXTENSIONS ?? ".pdf,.png,.jpg,.jpeg,.webp",
).map((item) => item.toLowerCase());
export const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN ?? "";
export const QUICK_BID_TEMPLATE_URL = process.env.QUICK_BID_TEMPLATE_URL ?? "";
export const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? "*/5 * * * *";
export const DAILY_SUMMARY_CRON = process.env.DAILY_SUMMARY_CRON ?? "0 8 * * *";
export const SCHEDULER_INTERVAL_MS = Math.min(
  Math.max(parseInteger(process.env.SCHEDULER_INTERVAL_MS, 5 * 60 * 1000), 5 * 60 * 1000),
  10 * 60 * 1000
);
export const HEARTBEAT_STALE_AFTER_MS = parseInteger(process.env.HEARTBEAT_STALE_AFTER_MS, 15 * 60 * 1000);
export const HEALTH_ALERT_COOLDOWN_MS = parseInteger(process.env.HEALTH_ALERT_COOLDOWN_MS, 60 * 60 * 1000);
export const TIMEZONE = process.env.TIMEZONE ?? "Africa/Nairobi";
export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
export const DB_PATH = process.env.DB_PATH ?? "./data/jobs.db";
export const PROFILE_CONFIG_PATH = process.env.PROFILE_CONFIG_PATH ?? "./profile/profile.json";
export const PORTFOLIO_CONFIG_PATH = process.env.PORTFOLIO_CONFIG_PATH ?? "./profile/portfolio.json";
export const MANUAL_JOBS_CONFIG_PATH = process.env.MANUAL_JOBS_CONFIG_PATH ?? "./config/manual-jobs.json";
export const SAVED_SEARCHES_CONFIG_PATH = process.env.SAVED_SEARCHES_CONFIG_PATH ?? "./config/saved-searches.json";
export const CONNECTS_RULES_CONFIG_PATH = process.env.CONNECTS_RULES_CONFIG_PATH ?? "./profile/connects-rules.json";
export const PROOF_ASSET_ROOT = process.env.PROOF_ASSET_ROOT ?? "";
export const PROFILE_KNOWLEDGE_DIR = process.env.PROFILE_KNOWLEDGE_DIR ?? "./profile/knowledge";
export const MIN_SCORE_TO_NOTIFY = parseInteger(process.env.MIN_SCORE_TO_NOTIFY, 4);
export const MIN_SCORE_HIGH = parseInteger(process.env.MIN_SCORE_HIGH, 8);
export const MAX_DESCRIPTION_LENGTH = parseInteger(process.env.MAX_DESCRIPTION_LENGTH, 300);
export const ENABLE_LOW_MATCH_DIGEST = parseBoolean(process.env.ENABLE_LOW_MATCH_DIGEST, false);
export const LLM_PROVIDER = process.env.LLM_PROVIDER ?? "openai-compatible";
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
export const LLM_API_KEY = process.env.LLM_API_KEY ?? OPENAI_API_KEY;
export const LLM_MODEL = process.env.LLM_MODEL ?? "gpt-4o-mini";
export const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
export const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "";
export const LMSTUDIO_API_KEY = process.env.LMSTUDIO_API_KEY ?? "";
export const LMSTUDIO_BASE_URL = process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1";
export const LMSTUDIO_MODEL = process.env.LMSTUDIO_MODEL ?? "qwen/qwen3.5-9b";
export const XAI_API_KEY = process.env.XAI_API_KEY ?? process.env.GROK_API_KEY ?? "";
export const XAI_BASE_URL = process.env.XAI_BASE_URL ?? process.env.GROK_BASE_URL ?? "https://api.x.ai/v1";
export const XAI_MODEL = process.env.XAI_MODEL ?? process.env.GROK_MODEL ?? "grok-4.3";
export const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY ?? process.env.KIMI_API_KEY ?? "";
export const MOONSHOT_BASE_URL = process.env.MOONSHOT_BASE_URL ?? process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1";
export const MOONSHOT_MODEL = process.env.MOONSHOT_MODEL ?? process.env.KIMI_MODEL ?? "kimi-k2.5";
export const LLM_NORMALIZATION_ENABLED = parseBoolean(process.env.LLM_NORMALIZATION_ENABLED, false);
export const LLM_REQUEST_TIMEOUT_MS = Math.max(1000, parseInteger(process.env.LLM_REQUEST_TIMEOUT_MS, 30_000));
export const JOB_INTELLIGENCE_ENABLED = parseBoolean(process.env.JOB_INTELLIGENCE_ENABLED, false);
export const JOB_INTELLIGENCE_PROVIDER = process.env.JOB_INTELLIGENCE_PROVIDER ?? (XAI_API_KEY ? "xai" : LLM_PROVIDER);
export const JOB_INTELLIGENCE_MODEL = process.env.JOB_INTELLIGENCE_MODEL ?? (JOB_INTELLIGENCE_PROVIDER.toLowerCase() === "xai" || JOB_INTELLIGENCE_PROVIDER.toLowerCase() === "grok" ? XAI_MODEL : LLM_MODEL);
export const JOB_INTELLIGENCE_TEMPERATURE = Number.isFinite(Number.parseFloat(process.env.JOB_INTELLIGENCE_TEMPERATURE ?? ""))
  ? Number.parseFloat(process.env.JOB_INTELLIGENCE_TEMPERATURE ?? "")
  : 0;
export const SLACK_COPY_LLM_ENABLED = parseBoolean(process.env.SLACK_COPY_LLM_ENABLED, true);
export const SLACK_COPY_PROVIDER = process.env.SLACK_COPY_PROVIDER ?? "kimi";
export const SLACK_COPY_MODEL = process.env.SLACK_COPY_MODEL ?? (SLACK_COPY_PROVIDER.toLowerCase() === "kimi" || SLACK_COPY_PROVIDER.toLowerCase() === "moonshot" ? MOONSHOT_MODEL : LLM_MODEL);
export const SLACK_COPY_TEMPERATURE = Number.isFinite(Number.parseFloat(process.env.SLACK_COPY_TEMPERATURE ?? ""))
  ? Number.parseFloat(process.env.SLACK_COPY_TEMPERATURE ?? "")
  : 0.25;
export const BROWSER_WORKER_ENABLED = parseBoolean(process.env.BROWSER_WORKER_ENABLED, false);
export const BROWSER_HEADLESS = parseBoolean(process.env.BROWSER_HEADLESS, true);
export const BROWSER_SESSION_MODE = process.env.BROWSER_SESSION_MODE === "cdp" ? "cdp" : "launch";
export const BROWSER_CDP_URL = process.env.BROWSER_CDP_URL ?? "http://127.0.0.1:9222";
export const BROWSER_START_URL = process.env.BROWSER_START_URL ?? "https://www.upwork.com/nx/find-work/best-matches/";
export const BROWSER_USER_DATA_DIR = process.env.BROWSER_USER_DATA_DIR ?? "./data/browser-profile";
export const BROWSER_CHROME_EXECUTABLE_PATH = process.env.BROWSER_CHROME_EXECUTABLE_PATH ?? "";
export const BROWSER_DRY_RUN = parseBoolean(process.env.BROWSER_DRY_RUN, true);
export const BROWSER_ARTIFACT_DIR = process.env.BROWSER_ARTIFACT_DIR ?? "";
export const BROWSER_ACTION_LIMIT = parseInteger(process.env.BROWSER_ACTION_LIMIT, 5);
export const BROWSER_LIVE_ACTION_LIMIT = Math.max(1, parseInteger(process.env.BROWSER_LIVE_ACTION_LIMIT, 1));
export const BROWSER_MANUAL_ATTENTION_ALERT_COOLDOWN_MS = parseInteger(process.env.BROWSER_MANUAL_ATTENTION_ALERT_COOLDOWN_MS, 60 * 60 * 1000);
export const BROWSER_SESSION_CHALLENGE_THRESHOLD = Math.max(1, parseInteger(process.env.BROWSER_SESSION_CHALLENGE_THRESHOLD, 2));
export const BROWSER_SESSION_CHALLENGE_WINDOW_MS = parseInteger(process.env.BROWSER_SESSION_CHALLENGE_WINDOW_MS, 60 * 60 * 1000);
export const BROWSER_QA_MAX_PROTECTED_TABS = Math.max(1, parseInteger(process.env.BROWSER_QA_MAX_PROTECTED_TABS, 5));
export const AUTO_PREPARE_DRAFT_ENABLED = parseBoolean(process.env.AUTO_PREPARE_DRAFT_ENABLED, true);
export const AGENT_ENGINE_ENABLED = parseBoolean(process.env.AGENT_ENGINE_ENABLED, false);
export const AGENT_ENGINE_INTERVAL_MS = Math.max(60_000, parseInteger(process.env.AGENT_ENGINE_INTERVAL_MS, 5 * 60 * 1000));
export const AGENT_ENGINE_JITTER_PCT = Math.min(0.5, Math.max(0, Number.parseFloat(process.env.AGENT_ENGINE_JITTER_PCT ?? "0.2") || 0.2));
export const AGENT_ENGINE_QUEUE_CAP = Math.max(1, parseInteger(process.env.AGENT_ENGINE_QUEUE_CAP, 25));
export const AGENT_ENGINE_MAX_WORKER_ACTIONS = Math.max(1, parseInteger(process.env.AGENT_ENGINE_MAX_WORKER_ACTIONS, 2));
export const AGENT_ENGINE_STATE_PATH = process.env.AGENT_ENGINE_STATE_PATH ?? "./data/agent-engine-state.json";
export const AUTO_PREPARE_MIN_SCORE = parseInteger(process.env.AUTO_PREPARE_MIN_SCORE, 80);
export const AUTO_PREPARE_MAX_CONNECTS = parseInteger(process.env.AUTO_PREPARE_MAX_CONNECTS, 30);
export const AUTO_PREPARE_REQUIRE_BROWSER_HEALTHY = parseBoolean(process.env.AUTO_PREPARE_REQUIRE_BROWSER_HEALTHY, true);
export const BROWSER_SEARCH_ENABLED = parseBoolean(process.env.BROWSER_SEARCH_ENABLED, false);
export const BROWSER_SEARCH_INTERVAL_MS = Math.min(
  Math.max(parseInteger(process.env.BROWSER_SEARCH_INTERVAL_MS, 10 * 60 * 1000), 8 * 60 * 1000),
  14 * 60 * 1000
);
export const BROWSER_SEARCH_JITTER_MIN_MS = parseInteger(process.env.BROWSER_SEARCH_JITTER_MIN_MS, 8 * 60 * 1000);
export const BROWSER_SEARCH_JITTER_MAX_MS = parseInteger(process.env.BROWSER_SEARCH_JITTER_MAX_MS, 14 * 60 * 1000);
export const BROWSER_SEARCH_MAX_JOBS_PER_QUERY = Math.max(
  1,
  parseInteger(process.env.BROWSER_SEARCH_MAX_JOBS_PER_QUERY, 10)
);
export const DISCOVERY_SCHEDULER_ENABLED = parseBoolean(process.env.DISCOVERY_SCHEDULER_ENABLED, false);
export const DISCOVERY_JITTER_MIN_MS = parseInteger(process.env.DISCOVERY_JITTER_MIN_MS, 8 * 60 * 1000);
export const DISCOVERY_JITTER_MAX_MS = parseInteger(process.env.DISCOVERY_JITTER_MAX_MS, 14 * 60 * 1000);
export const DISCOVERY_MAX_JOBS_PER_RUN = Math.max(1, parseInteger(process.env.DISCOVERY_MAX_JOBS_PER_RUN, 3));
export const DISCOVERY_MAX_SCROLLS_PER_RUN = Math.max(0, parseInteger(process.env.DISCOVERY_MAX_SCROLLS_PER_RUN, 4));
export const DISCOVERY_SKIP_IF_PENDING_CAPTURE_COUNT_GT = Math.max(0, parseInteger(process.env.DISCOVERY_SKIP_IF_PENDING_CAPTURE_COUNT_GT, 3));
export const BROWSER_SEARCH_FRESHNESS_WINDOW_MINUTES = Math.max(
  1,
  parseInteger(process.env.BROWSER_SEARCH_FRESHNESS_WINDOW_MINUTES, 60)
);
export const FETCH_RETRY_ATTEMPTS = parseInteger(process.env.FETCH_RETRY_ATTEMPTS, 3);
export const FEED_DELAY_MS = parseInteger(process.env.FEED_DELAY_MS, 10000);
export const APIFY_REQUEST_TIMEOUT_MS = parseInteger(
  process.env.APIFY_REQUEST_TIMEOUT_MS,
  120000
);
export const SLACK_DELAY_MS = parseInteger(process.env.SLACK_DELAY_MS, 2000);
export const SLACK_RETRY_ATTEMPTS = parseInteger(process.env.SLACK_RETRY_ATTEMPTS, 3);
export const SEARCH_QUERIES = parseQueriesFromEnvOrFile();
export const BROWSER_SEARCH_INPUTS = parseBrowserSearchInputs();
export { parseBoolean, parseInteger };

export function validateRequiredConfig(): void {
  if (!APIFY_API_TOKEN.trim()) {
    throw new Error("APIFY_API_TOKEN is required. Set it in your environment.");
  }
}
