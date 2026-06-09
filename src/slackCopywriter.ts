import { SLACK_COPY_TEMPERATURE } from "./config";
import {
  OpenAiCompatibleProvider,
  getSlackCopyProviderFallbackConfigs,
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
  recentPhrases?: string[];
}

export interface SlackCopyResult {
  text: string;
  usedLlm: boolean;
  provider: "kimi" | "grok" | "fallback";
  reason?: string;
}

interface SlackCopyPayload {
  text?: unknown;
}

const recentOpeningsByPath = new Map<SlackCopyPath, string[]>();

interface NamedSlackCopyProvider {
  name: "kimi" | "grok";
  provider: SlackCopyProvider;
}

function providerName(value: string): "kimi" | "grok" {
  return value === "xai" || value === "grok" ? "grok" : "kimi";
}

function defaultSlackCopyProviders(): NamedSlackCopyProvider[] {
  return getSlackCopyProviderFallbackConfigs().map((config) => ({
    name: providerName(config.provider),
    provider: new OpenAiCompatibleProvider(config),
  }));
}

function containsOldMenu(text: string): boolean {
  return /I can help with the draft, files, proof, boost, or status/i.test(text);
}

function containsRawIds(text: string): boolean {
  return [
    /\b(?:browser\s+)?action\s*#?\s*\d+\b/i,
    /\b(?:channel\s+(?:id|ts)|thread\s+(?:id|ts)|client_msg_id|event_ts|queue internals)\b/i,
    /\bjob id\s*[:#]\s*[A-Za-z0-9._~:-]+/i,
    /\bmanual:upwork-[^\s)]+/i,
  ].some((pattern) => pattern.test(text));
}

function containsRawInternalFields(text: string): boolean {
  return [
    /\bpacket_sent\b/i,
    /\bplatformEligibility\b/i,
    /\binternalSkipReason\b/i,
    /\bsource_context_unavailable\b/i,
    /\bfield_preparation_incomplete\b/i,
    /\bmanual_attention_required\b/i,
    /\bbrowser_attention_required\b/i,
    /\bbrowserSessionState\b/i,
    /\bbrowser_challenge_action_paused\b/i,
    /\bcaptcha_or_security_challenge\b/i,
    /\btoo_many_pending_capture_actions\b/i,
    /\blead decision\b/i,
    /\bqueue internals\b/i,
  ].some((pattern) => pattern.test(text));
}

function containsDashboardDump(text: string): boolean {
  return [
    /^Overall health:/im,
    /^Workers:/im,
    /^Heartbeats:/im,
    /^Findings:/im,
    /^QA queue$/im,
    /\b0 active heartbeat/i,
    /\bstale heartbeat/i,
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

function violatesConnectsWording(text: string, deterministicText: string): boolean {
  const connectsUnknown = /Connects(?:\*?:)?\s*(?:not verified|unknown)|couldn[’']t verify the Connects|Connects section isn[’']t readable/i.test(deterministicText);
  if (!connectsUnknown) return false;
  if (/\bConnects verified\b|\bverified Connects\b|Required Connects verified|Connects:\s*\d+\s*(?:required|Connects)?/i.test(text)) return true;
  if (/\bBoost:\s*(?!not set|skipped)|\bboost\s+\d+\s*(?:selected|Connects)?/i.test(text)) return true;
  return false;
}

function preservedPhrasesMissing(text: string, phrases: string[] = []): boolean {
  return phrases.some((phrase) => phrase.trim() && !text.includes(phrase));
}

function normalizeOpening(value: string): string {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-•*>:\s`*_]+/, "").trim())
    .find(Boolean) ?? "";
  return firstLine
    .replace(/<@[A-Z0-9_]+>/g, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function recentOpeningsFor(request: SlackCopyRequest): string[] {
  const fromRequest = request.recentPhrases ?? [];
  const fromContext = [
    ...(Array.isArray(request.context?.recentPhrases) ? request.context?.recentPhrases as unknown[] : []),
    ...(Array.isArray(request.context?.recentLeadOpenings) ? request.context?.recentLeadOpenings as unknown[] : []),
    ...(Array.isArray(request.context?.recentReplyOpenings) ? request.context?.recentReplyOpenings as unknown[] : []),
  ].filter((value): value is string => typeof value === "string");
  return [
    ...fromRequest,
    ...fromContext,
    ...(recentOpeningsByPath.get(request.path) ?? []),
  ]
    .map(normalizeOpening)
    .filter(Boolean);
}

function repeatsRecentOpening(text: string, request: SlackCopyRequest): boolean {
  const opening = normalizeOpening(text);
  if (!opening) return false;
  return recentOpeningsFor(request).some((recent) => {
    if (!recent) return false;
    return recent === opening || opening.startsWith(`${recent} `) || recent.startsWith(`${opening} `);
  });
}

function rememberOpening(path: SlackCopyPath, text: string): void {
  const opening = normalizeOpening(text);
  if (!opening) return;
  const next = [opening, ...(recentOpeningsByPath.get(path) ?? []).filter((item) => item !== opening)].slice(0, 12);
  recentOpeningsByPath.set(path, next);
}

function extractUpworkUrl(request: SlackCopyRequest): string | null {
  const fromContext = typeof request.context?.upworkUrl === "string" ? request.context.upworkUrl : null;
  const fromDeterministic = request.deterministicText.match(/https?:\/\/(?:www\.)?upwork\.com\/[^\s<>]+/i)?.[0] ?? null;
  return fromContext ?? fromDeterministic;
}

function hasClearLeadCta(text: string): boolean {
  return /\b(?:reply|review|open|check|tell me|say|look at|approve|skip|prep it)\b/i.test(text);
}

function validateSlackCopy(text: string, request: SlackCopyRequest): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "empty copy";
  if (containsOldMenu(trimmed)) return "old command menu";
  if (containsRawIds(trimmed)) return "raw ids in non-debug copy";
  if (containsRawInternalFields(trimmed)) return "raw internal fields in non-debug copy";
  if (containsDashboardDump(trimmed)) return "dashboard dump in non-debug copy";
  if (/\bthe agent\b/i.test(trimmed)) return "third-person agent language";
  if (violatesSubmitBoundary(trimmed)) return "submit boundary violation";
  if (violatesProofWording(trimmed, request.deterministicText)) return "proof wording drift";
  if (violatesConnectsWording(trimmed, request.deterministicText)) return "connects verification drift";
  if (preservedPhrasesMissing(trimmed, request.preservePhrases)) return "required verbatim text missing";
  if (repeatsRecentOpening(trimmed, request)) return "repeated recent opening";
  if (request.path === "lead_packet") {
    const upworkUrl = extractUpworkUrl(request);
    if (upworkUrl && !trimmed.includes(upworkUrl)) return "missing Upwork link";
    if (!hasClearLeadCta(trimmed)) return "missing clear lead CTA";
  }
  return null;
}

function compactSafeFallbackText(request: SlackCopyRequest, reason: string): string {
  const deterministic = request.deterministicText.trim();
  if (!deterministic) return "I hit a copywriting issue, but I will keep this safe and stop before submit.";
  if (containsOldMenu(deterministic)) {
    return "I’m not sure what you want next. Send the specific change or next step and I’ll handle it without touching final submit.";
  }
  if (/qa_queue|show_qa_queue/i.test(request.intent ?? "") && /\bQA queue\b/i.test(deterministic)) {
    return deterministic;
  }
  if (containsRawIds(deterministic) || containsRawInternalFields(deterministic) || containsDashboardDump(deterministic)) {
    if (/health|running|blocked|attention|status/i.test(request.intent ?? "")) {
      return "I have the current state, but the clean copywriter path failed. Safe version: I’m paused until the open blocker is cleared or skipped. Final submit remains manual. Ask for debug if you want the raw details.";
    }
    return "I have the details, but the clean copywriter path failed. I’m keeping the safe state unchanged and hiding raw internals here. Ask for debug if you want the raw details.";
  }
  if (request.path === "lead_packet") {
    const url = extractUpworkUrl(request);
    const title = typeof request.context?.title === "string" ? request.context.title : "New Upwork lead";
    const fit = typeof request.context?.matchLevel === "string" ? request.context.matchLevel : "review";
    const cta = deterministic.match(/\*Next:\*\s*([^\n]+)/i)?.[1]?.trim() ?? "Review this and reply with the next call.";
    return [
      `New lead: ${title}`,
      `Fit: ${fit}. I’ll keep prep inside the guardrails and stop before submit.`,
      `Next: ${cta}`,
      url,
    ].filter(Boolean).join("\n");
  }
  void reason;
  return deterministic;
}

export async function rewriteSlackCopyWithKimi(
  request: SlackCopyRequest,
  provider?: SlackCopyProvider,
): Promise<SlackCopyResult> {
  const fallback = (reason: string): SlackCopyResult => ({
    text: compactSafeFallbackText(request, reason),
    usedLlm: false,
    provider: "fallback",
    reason,
  });

  const providers: NamedSlackCopyProvider[] = provider
    ? [{ name: "kimi", provider }]
    : defaultSlackCopyProviders();
  const failures: string[] = [];

  for (const candidate of providers) {
    if (!candidate.provider.isAvailable()) {
      failures.push(`${candidate.name}: unavailable`);
      continue;
    }

    const response = await candidate.provider.completeJson<SlackCopyPayload>({
      temperature: SLACK_COPY_TEMPERATURE,
      maxTokens: 1200,
      messages: [
        {
          role: "system",
          content: [
            "You write Steve-facing Slack copy for an Upwork application agent.",
            "Rewrite the deterministic response into natural, concise Slack copy. Keep the meaning and safety state.",
            "Reason first from the current context, then write the message. Do not expose the reasoning.",
            "You are a sharp senior SDR/operator teammate, not a dashboard, bot, CLI, or monitoring page.",
            "Use first person. Be short, direct, context-aware, and useful. Prefer one clear recommendation.",
            "Push toward resolution: say what is true, what matters, and what Steve should do next.",
            "Never output dashboard headings like Overall health, Workers, Heartbeats, Findings, QA queue, or raw service state unless debug was explicitly requested.",
            "For lead packets: be concise, human, commercially opinionated, and varied; include the Upwork link; include one clear next-step CTA; avoid raw packet fields.",
            "For normal Slack replies: answer the actual question directly and conversationally. Do not route natural language into a command-menu fallback.",
            "Use sales memories as hypotheses when provided. Current context and hard safety override learned preferences.",
            "Avoid starting with any recent opening listed in recentOpenings.",
            "Do not decide actions, change status, add facts, add raw ids, or expose internals.",
            "Never show a command menu.",
            "Never claim final submit happened or will happen. Final submit always remains manual.",
            "Never bypass CAPTCHA, security, login, passkey, or 2FA checks.",
            "Never claim files, proof, portfolio, browser fill, Connects, or boost were verified unless deterministic text/context says so.",
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
            recentOpenings: recentOpeningsFor(request),
            soul: buildSoulPromptContext(`slack_copy:${request.path}`),
          }),
        },
      ],
    });

    const text = typeof response.data?.text === "string" ? response.data.text : "";
    if (!response.ok || !text.trim()) {
      failures.push(`${candidate.name}: ${response.error ?? response.skippedReason ?? "copy rewrite failed"}`);
      continue;
    }
    const validationError = validateSlackCopy(text, request);
    if (validationError) {
      failures.push(`${candidate.name}: ${validationError}`);
      continue;
    }
    const trimmed = text.trim();
    rememberOpening(request.path, trimmed);
    return { text: trimmed, usedLlm: true, provider: candidate.name };
  }

  return fallback(failures.length ? failures.join("; ") : "Slack copy LLM providers unavailable");
}
