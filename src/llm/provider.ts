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
  OPENAI_API_KEY,
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODEL,
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

  return {
    enabled: LLM_NORMALIZATION_ENABLED,
    provider,
    apiKey: process.env.LLM_API_KEY || LLM_API_KEY,
    model: process.env.LLM_MODEL || LLM_MODEL,
    baseUrl: (process.env.LLM_BASE_URL || LLM_BASE_URL).replace(/\/$/, ""),
  };
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

function shouldDisableQwenThinking(config: LlmProviderConfig): boolean {
  return config.provider === "lmstudio" && /qwen/i.test(config.model);
}

function messagesForProvider(messages: LlmChatMessage[], config: LlmProviderConfig): LlmChatMessage[] {
  if (!shouldDisableQwenThinking(config) || messages.some((message) => message.content.includes("/no_think"))) {
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

    const requestBody = {
      model: this.config.model,
      messages: messagesForProvider(request.messages, this.config),
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 1800,
    };

    const send = async (includeResponseFormat: boolean): Promise<ChatCompletionAttempt> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          ...requestBody,
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

      const choice = attempt.body.choices?.[0];
      const content = choice?.message?.content || choice?.message?.reasoning_content || choice?.reasoning_content;
      if (!content) {
        return { ok: false, error: "LLM response did not include JSON content" };
      }
      return { ok: true, data: parseJsonContent<T>(content) };
    } catch (error) {
      return { ok: false, error: safeErrorMessage(error, this.config) };
    }
  }
}
