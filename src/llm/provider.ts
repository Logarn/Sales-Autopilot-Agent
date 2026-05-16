import { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_NORMALIZATION_ENABLED, LLM_PROVIDER } from "../config";

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
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export function getLlmProviderConfig(): LlmProviderConfig {
  return {
    enabled: LLM_NORMALIZATION_ENABLED,
    provider: LLM_PROVIDER,
    apiKey: LLM_API_KEY,
    model: LLM_MODEL,
    baseUrl: LLM_BASE_URL.replace(/\/$/, ""),
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

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.1,
          max_tokens: request.maxTokens ?? 1800,
          response_format: { type: "json_object" },
        }),
      });

      const body = (await response.json().catch(() => ({}))) as OpenAiChatResponse;
      if (!response.ok) {
        return { ok: false, error: safeErrorMessage(body.error?.message ?? `LLM request failed with ${response.status}`, this.config) };
      }

      const content = body.choices?.[0]?.message?.content;
      if (!content) {
        return { ok: false, error: "LLM response did not include JSON content" };
      }
      return { ok: true, data: JSON.parse(content) as T };
    } catch (error) {
      return { ok: false, error: safeErrorMessage(error, this.config) };
    }
  }
}
