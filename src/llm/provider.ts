import {
  LLM_API_KEY,
  LLM_BASE_URL,
  LLM_MODEL,
  LLM_NORMALIZATION_ENABLED,
  LLM_PROVIDER,
  LLM_REQUEST_TIMEOUT_MS,
  LMSTUDIO_API_KEY,
  LMSTUDIO_BASE_URL,
  LMSTUDIO_MODEL,
  JOB_INTELLIGENCE_ENABLED,
  JOB_INTELLIGENCE_MODEL,
  JOB_INTELLIGENCE_PROVIDER,
  MOONSHOT_API_KEY,
  MOONSHOT_BASE_URL,
  MOONSHOT_MODEL,
  OPENAI_API_KEY,
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODEL,
  PROPOSAL_COPY_LLM_ENABLED,
  PROPOSAL_COPY_MODEL,
  PROPOSAL_COPY_PROVIDER,
  SLACK_COPY_LLM_ENABLED,
  SLACK_COPY_MODEL,
  SLACK_COPY_PROVIDER,
  XAI_API_KEY,
  XAI_BASE_URL,
  XAI_MODEL,
} from "../config";

export interface LlmProviderConfig {
  enabled: boolean;
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmJsonRequest {
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  plainTextFallbackKey?: string;
}

export interface LlmJsonResult<T> {
  ok: boolean;
  data?: T;
  skippedReason?: string;
  error?: string;
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string }; reasoning_content?: string }>;
  error?: { message?: string };
}

interface ChatCompletionAttempt {
  ok: boolean;
  status: number;
  body: OpenAiChatResponse;
}

function responseFormatForProvider(provider: string): Record<string, unknown> {
  if (provider === "lmstudio") {
    return {
      type: "json_schema",
      json_schema: {
        name: "structured_json_response",
        schema: {
          type: "object",
          additionalProperties: true,
        },
      },
    };
  }

  return { type: "json_object" };
}

function thinkingForProvider(config: LlmProviderConfig): Record<string, unknown> | null {
  if (config.provider !== "moonshot") return null;
  if (/kimi-k2\.7/i.test(config.model)) return null;
  if (!/kimi-k2\.(?:5|6)/i.test(config.model)) return null;
  return { type: "disabled" };
}

function temperatureForProvider(config: LlmProviderConfig, request: LlmJsonRequest, thinking: Record<string, unknown> | null): number {
  if (config.provider === "moonshot" && thinking?.type === "disabled") return 0.6;
  return request.temperature ?? 0.1;
}

function isGrokModel(value: string | undefined): boolean {
  return /\b(?:grok|xai)\b/i.test(value ?? "");
}

function moonshotModel(preferred: string | undefined, fallback: string): string {
  if (preferred && !isGrokModel(preferred)) return preferred;
  return process.env.MOONSHOT_MODEL || process.env.KIMI_MODEL || fallback;
}

export function getLlmProviderConfig(): LlmProviderConfig {
  const provider = (process.env.LLM_PROVIDER || LLM_PROVIDER || "openai-compatible").trim().toLowerCase();

  if (provider === "openai") {
    return {
      enabled: LLM_NORMALIZATION_ENABLED,
      provider,
      apiKey: process.env.OPENAI_API_KEY || OPENAI_API_KEY || process.env.LLM_API_KEY || LLM_API_KEY,
      model: process.env.LLM_MODEL || LLM_MODEL,
      baseUrl: (process.env.LLM_BASE_URL || LLM_BASE_URL).replace(/\/$/, ""),
    };
  }

  if (provider === "openrouter") {
    return {
      enabled: LLM_NORMALIZATION_ENABLED,
      provider,
      apiKey: process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || OPENROUTER_MODEL || process.env.LLM_MODEL || LLM_MODEL,
      baseUrl: (process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL).replace(/\/$/, ""),
    };
  }

  if (provider === "lmstudio" || provider === "lm-studio") {
    return {
      enabled: LLM_NORMALIZATION_ENABLED,
      provider: "lmstudio",
      apiKey: process.env.LMSTUDIO_API_KEY || LMSTUDIO_API_KEY || process.env.LLM_API_KEY || LLM_API_KEY || "lm-studio",
      model: process.env.LMSTUDIO_MODEL || LMSTUDIO_MODEL || process.env.LLM_MODEL || LLM_MODEL || "qwen/qwen3.5-9b",
      baseUrl: (process.env.LMSTUDIO_BASE_URL || LMSTUDIO_BASE_URL || process.env.LLM_BASE_URL || LLM_BASE_URL || "http://localhost:1234/v1").replace(/\/$/, ""),
    };
  }

  if (provider === "kimi" || provider === "moonshot") {
    return {
      enabled: LLM_NORMALIZATION_ENABLED,
      provider: "moonshot",
      apiKey: process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || MOONSHOT_API_KEY || process.env.LLM_API_KEY || LLM_API_KEY,
      model: moonshotModel(process.env.LLM_MODEL || LLM_MODEL, MOONSHOT_MODEL),
      baseUrl: (process.env.MOONSHOT_BASE_URL || process.env.KIMI_BASE_URL || MOONSHOT_BASE_URL).replace(/\/$/, ""),
    };
  }

  return {
    enabled: LLM_NORMALIZATION_ENABLED,
    provider,
    apiKey: process.env.LLM_API_KEY || LLM_API_KEY,
    model: process.env.LLM_MODEL || LLM_MODEL,
    baseUrl: (process.env.LLM_BASE_URL || LLM_BASE_URL).replace(/\/$/, ""),
  };
}

function baseOpenAiCompatibleConfig(input: {
  enabled: boolean;
  provider: string;
  model: string;
  genericProvider?: LlmProviderConfig;
}): LlmProviderConfig {
  const provider = input.provider.trim().toLowerCase();
  if (provider === "xai" || provider === "grok") {
    return {
      enabled: input.enabled,
      provider: "xai",
      apiKey: process.env.XAI_API_KEY || process.env.GROK_API_KEY || XAI_API_KEY,
      model: input.model || process.env.XAI_MODEL || process.env.GROK_MODEL || XAI_MODEL,
      baseUrl: (process.env.XAI_BASE_URL || process.env.GROK_BASE_URL || XAI_BASE_URL).replace(/\/$/, ""),
    };
  }
  if (provider === "kimi" || provider === "moonshot") {
    return {
      enabled: input.enabled,
      provider: "moonshot",
      apiKey: process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || MOONSHOT_API_KEY,
      model: moonshotModel(input.model, MOONSHOT_MODEL),
      baseUrl: (process.env.MOONSHOT_BASE_URL || process.env.KIMI_BASE_URL || MOONSHOT_BASE_URL).replace(/\/$/, ""),
    };
  }
  const generic = input.genericProvider ?? getLlmProviderConfig();
  return {
    ...generic,
    enabled: input.enabled,
    model: input.model || generic.model,
  };
}

function runtimeBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function getJobIntelligenceProviderConfig(): LlmProviderConfig {
  const generic = getLlmProviderConfig();
  return baseOpenAiCompatibleConfig({
    enabled: runtimeBoolean(process.env.JOB_INTELLIGENCE_ENABLED, JOB_INTELLIGENCE_ENABLED),
    provider: process.env.JOB_INTELLIGENCE_PROVIDER || JOB_INTELLIGENCE_PROVIDER || generic.provider,
    model: process.env.JOB_INTELLIGENCE_MODEL || JOB_INTELLIGENCE_MODEL,
    genericProvider: generic,
  });
}

export function getSlackCopyProviderConfig(): LlmProviderConfig {
  const generic = getLlmProviderConfig();
  return baseOpenAiCompatibleConfig({
    enabled: runtimeBoolean(process.env.SLACK_COPY_LLM_ENABLED, SLACK_COPY_LLM_ENABLED),
    provider: process.env.SLACK_COPY_PROVIDER || SLACK_COPY_PROVIDER || "kimi",
    model: process.env.SLACK_COPY_MODEL || SLACK_COPY_MODEL,
    genericProvider: generic,
  });
}

export function getProposalCopyProviderConfig(): LlmProviderConfig {
  const generic = getLlmProviderConfig();
  return baseOpenAiCompatibleConfig({
    enabled: runtimeBoolean(process.env.PROPOSAL_COPY_LLM_ENABLED, PROPOSAL_COPY_LLM_ENABLED),
    provider: process.env.PROPOSAL_COPY_PROVIDER || PROPOSAL_COPY_PROVIDER || "kimi",
    model: process.env.PROPOSAL_COPY_MODEL || PROPOSAL_COPY_MODEL,
    genericProvider: generic,
  });
}

export function getSlackCopyProviderFallbackConfigs(): LlmProviderConfig[] {
  const primary = getSlackCopyProviderConfig();
  const fallbackProvider = (process.env.SLACK_COPY_FALLBACK_PROVIDER || "").trim();
  if (!fallbackProvider) return [primary];
  const fallback = baseOpenAiCompatibleConfig({
    enabled: primary.enabled,
    provider: fallbackProvider,
    model: process.env.SLACK_COPY_FALLBACK_MODEL || (fallbackProvider === "kimi" || fallbackProvider === "moonshot" ? MOONSHOT_MODEL : process.env.XAI_MODEL || process.env.GROK_MODEL || XAI_MODEL),
  });
  if (primary.provider === fallback.provider && primary.model === fallback.model && primary.baseUrl === fallback.baseUrl) {
    return [primary];
  }
  return [primary, fallback];
}

function redactSecret(value: string): string {
  if (!value) return "";
  return value.length <= 8 ? "[redacted]" : `${value.slice(0, 3)}…${value.slice(-2)}[redacted]`;
}

function safeErrorMessage(error: unknown, config: LlmProviderConfig): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replaceAll(config.apiKey, redactSecret(config.apiKey))
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted-token]");
}

function shouldDisableProviderThinking(config: LlmProviderConfig): boolean {
  return config.provider === "lmstudio" && /qwen/i.test(config.model);
}

function messagesForProvider(messages: LlmChatMessage[], config: LlmProviderConfig): LlmChatMessage[] {
  if (!shouldDisableProviderThinking(config) || messages.some((message) => message.content.includes("/no_think"))) {
    return messages;
  }

  const firstSystemIndex = messages.findIndex((message) => message.role === "system");
  if (firstSystemIndex === -1) {
    return [{ role: "system", content: "/no_think\nReturn JSON only." }, ...messages];
  }

  return messages.map((message, index) =>
    index === firstSystemIndex ? { ...message, content: `/no_think\n${message.content}` } : message
  );
}

function parseJsonContent<T>(content: string): T {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) {
      return JSON.parse(fenced) as T;
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }
    throw new Error("LLM response did not contain a JSON object.");
  }
}

function plainTextFallback<T>(content: string, key?: string): LlmJsonResult<T> | null {
  const cleaned = content.trim();
  if (!key || cleaned.length < 120 || /^\.{3,}$/.test(cleaned)) return null;
  return { ok: true, data: { [key]: cleaned } as T };
}

export class OpenAiCompatibleProvider {
  constructor(private readonly config: LlmProviderConfig = getLlmProviderConfig()) {}

  isAvailable(): boolean {
    return Boolean(this.config.enabled && this.config.apiKey.trim() && this.config.model.trim() && this.config.baseUrl.trim());
  }

  async completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>> {
    if (!this.config.enabled) {
      return { ok: false, skippedReason: "LLM normalization disabled" };
    }
    if (!this.config.apiKey.trim()) {
      return { ok: false, skippedReason: "LLM_API_KEY not configured" };
    }

    const thinking = thinkingForProvider(this.config);
    const requestBody = {
      model: this.config.model,
      messages: messagesForProvider(request.messages, this.config),
      temperature: temperatureForProvider(this.config, request, thinking),
      max_tokens: request.maxTokens ?? 1800,
    };

    const send = async (includeResponseFormat: boolean): Promise<ChatCompletionAttempt> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? LLM_REQUEST_TIMEOUT_MS);
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          ...requestBody,
          ...(thinking ? { thinking } : {}),
          ...(includeResponseFormat ? { response_format: responseFormatForProvider(this.config.provider) } : {}),
        }),
      }).finally(() => clearTimeout(timeout));

      const body = (await response.json().catch(() => ({}))) as OpenAiChatResponse;
      return { ok: response.ok, status: response.status, body };
    };

    try {
      let attempt = await send(true);
      if (!attempt.ok && (attempt.status === 400 || attempt.status === 422)) {
        attempt = await send(false);
      }

      if (!attempt.ok) {
        return { ok: false, error: safeErrorMessage(attempt.body.error?.message ?? `LLM request failed with ${attempt.status}`, this.config) };
      }

      const contentFor = (item: ChatCompletionAttempt): string => {
        const choice = item.body.choices?.[0];
        return choice?.message?.content || choice?.message?.reasoning_content || choice?.reasoning_content || "";
      };

      let content = contentFor(attempt);
      if (!content) {
        const retry = await send(false);
        if (!retry.ok) {
          return { ok: false, error: safeErrorMessage(retry.body.error?.message ?? `LLM request failed with ${retry.status}`, this.config) };
        }
        content = contentFor(retry);
      }
      if (!content) {
        return { ok: false, error: "LLM response did not include JSON content" };
      }
      try {
        return { ok: true, data: parseJsonContent<T>(content) };
      } catch (error) {
        const retry = await send(false);
        if (!retry.ok) {
          return { ok: false, error: safeErrorMessage(retry.body.error?.message ?? `LLM request failed with ${retry.status}`, this.config) };
        }
        const retryContent = contentFor(retry);
        if (!retryContent) {
          return { ok: false, error: "LLM response did not include JSON content" };
        }
        try {
          return { ok: true, data: parseJsonContent<T>(retryContent) };
        } catch (retryError) {
          return plainTextFallback<T>(retryContent, request.plainTextFallbackKey) ??
            plainTextFallback<T>(content, request.plainTextFallbackKey) ??
            { ok: false, error: safeErrorMessage(retryError, this.config) };
        }
      }
    } catch (error) {
      return { ok: false, error: safeErrorMessage(error, this.config) };
    }
  }
}
