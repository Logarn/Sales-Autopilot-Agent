import { SLACK_COPY_TEMPERATURE } from "./config";
import {
  OpenAiCompatibleProvider,
  getSlackCopyProviderConfig,
  type LlmJsonRequest,
  type LlmJsonResult,
} from "./llm/provider";
import { buildSoulPromptContext, buildSoulPromptSection } from "./soul";

export type SlackCopyPath =
  | "conversation_reply"
  | "qa_handoff"
  | "lead_packet"
  | "daily_digest";

export interface SlackCopyProvider {
  isAvailable(): boolean;
  completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>>;
}

export interface SlackCopyRequest {
  path: SlackCopyPath;
  deterministicText: string;
  userMessage?: string | null;
  intent?: string | null;
  context?: Record<string, unknown>;
  preservePhrases?: string[];
}

export interface SlackCopyResult {
  text: string;
  usedLlm: boolean;
  provider: "kimi" | "fallback";
  reason?: string;
}

interface SlackCopyPayload {
  text?: unknown;
}

function defaultSlackCopyProvider(): SlackCopyProvider {
  return new OpenAiCompatibleProvider(getSlackCopyProviderConfig());
}

function containsOldMenu(text: string): boolean {
  return /I can help with the draft, files, proof, boost, or status/i.test(text);
}

function containsRawIds(text: string): boolean {
  return [
    /\b(?:browser\s+)?action\s*#?\s*\d+\b/i,
    /\b(?:channel\s+(?:id|ts)|thread\s+(?:id|ts)|client_msg_id|event_ts|queue internals)\b/i,
    /\bjob id\s*[:#]\s*[A-Za-z0-9._~:-]+/i,
  ].some((pattern) => pattern.test(text));
}

function violatesSubmitBoundary(text: string): boolean {
  const normalized = text.replace(/\bmanually click\s+(?:\*?Send[^.\n]*\*?|\*?Submit\*?|submit)\b/gi, "manual_submit_safe");
  return [
    /\bI\s+(?:will|can|could|did|have)\s+(?:submit|send)\b/i,
    /\b(?:submitted|sent)\s+the\s+(?:proposal|application)\b/i,
    /\bclick(?:ed)?\s+(?:the\s+)?(?:submit|send)\b/i,
  ].some((pattern) => pattern.test(normalized));
}

function violatesProofWording(text: string, deterministicText: string): boolean {
  if (/Proof I used/i.test(text)) return true;
  if (/Proof planned/i.test(deterministicText) && !/Proof planned/i.test(text)) return true;
  if (/Proof verified/i.test(deterministicText) && !/Proof verified/i.test(text)) return true;
  return false;
}

function preservedPhrasesMissing(text: string, phrases: string[] = []): boolean {
  return phrases.some((phrase) => phrase.trim() && !text.includes(phrase));
}

function validateSlackCopy(text: string, request: SlackCopyRequest): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "empty copy";
  if (containsOldMenu(trimmed)) return "old command menu";
  if (containsRawIds(trimmed)) return "raw ids in non-debug copy";
  if (/\bthe agent\b/i.test(trimmed)) return "third-person agent language";
  if (violatesSubmitBoundary(trimmed)) return "submit boundary violation";
  if (violatesProofWording(trimmed, request.deterministicText)) return "proof wording drift";
  if (preservedPhrasesMissing(trimmed, request.preservePhrases)) return "required verbatim text missing";
  return null;
}

export async function rewriteSlackCopyWithKimi(
  request: SlackCopyRequest,
  provider: SlackCopyProvider = defaultSlackCopyProvider(),
): Promise<SlackCopyResult> {
  const fallback = (reason: string): SlackCopyResult => ({
    text: request.deterministicText,
    usedLlm: false,
    provider: "fallback",
    reason,
  });

  if (!provider.isAvailable()) {
    return fallback("Kimi/Moonshot Slack copy provider unavailable");
  }

  const response = await provider.completeJson<SlackCopyPayload>({
    temperature: SLACK_COPY_TEMPERATURE,
    maxTokens: 1200,
    messages: [
      {
        role: "system",
        content: [
          "You write Steve-facing Slack copy for an Upwork application agent.",
          "Rewrite the deterministic response into natural, concise Slack copy.",
          "Do not decide actions, change status, add facts, add raw ids, or expose internals.",
          "Never show a command menu.",
          "Never claim final submit happened or will happen. Final submit always remains manual.",
          "Use Proof planned until verification is explicit. Use Proof verified only when the deterministic text already says Proof verified. Never say Proof I used.",
          "If preservePhrases are provided, include each phrase exactly as written.",
          "Return JSON only: {\"text\":\"...\"}.",
          buildSoulPromptSection(`slack_copy:${request.path}`),
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          path: request.path,
          intent: request.intent ?? null,
          userMessage: request.userMessage ?? null,
          deterministicText: request.deterministicText,
          context: request.context ?? {},
          preservePhrases: request.preservePhrases ?? [],
          soul: buildSoulPromptContext(`slack_copy:${request.path}`),
        }),
      },
    ],
  });

  const text = typeof response.data?.text === "string" ? response.data.text : "";
  if (!response.ok || !text.trim()) {
    return fallback(response.error ?? response.skippedReason ?? "Kimi/Moonshot copy rewrite failed");
  }
  const validationError = validateSlackCopy(text, request);
  if (validationError) {
    return fallback(validationError);
  }
  return { text: text.trim(), usedLlm: true, provider: "kimi" };
}
