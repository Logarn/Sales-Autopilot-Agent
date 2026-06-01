import { OpenAiCompatibleProvider, type LlmJsonRequest, type LlmJsonResult } from "./llm/provider";
import type { ApplicationStatus } from "./types";

export type SlackThreadBrainIntent =
  | "approve_prepare"
  | "status"
  | "revise"
  | "reject"
  | "retry_action"
  | "mark_submitted"
  | "record_outcome"
  | "clarify"
  | "ignore";

export type SlackThreadBrainConfidence = "high" | "medium" | "low";

export interface SlackThreadBrainInput {
  text: string;
  botMentioned: boolean;
  threadMapped: boolean;
  jobId?: string | null;
  upworkUrl?: string | null;
  threadStatus?: string | null;
}

export interface SlackThreadBrainDecision {
  intent: SlackThreadBrainIntent;
  confidence: SlackThreadBrainConfidence;
  instruction?: string | null;
  actionId?: number | null;
  replyText?: string | null;
  reason?: string | null;
  outcomeStatus?: ApplicationStatus | null;
}

export interface SlackThreadBrainProvider {
  isAvailable(): boolean;
  completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>>;
}

const INTENTS = new Set<SlackThreadBrainIntent>([
  "approve_prepare",
  "status",
  "revise",
  "reject",
  "retry_action",
  "mark_submitted",
  "record_outcome",
  "clarify",
  "ignore",
]);

const OUTCOME_STATUSES = new Set<ApplicationStatus>(["replied", "interview", "hired", "lost"]);

function confidence(value: unknown): SlackThreadBrainConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function cleanText(value: unknown, limit = 500): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/\b(final\s+submit|click\s+submit|send\s+proposal|send\s+for\s+\d+\s+connects)\b/gi, "manual submit")
    .replace(/\bplatformEligibility|lead decision|packet|source context|action id\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, limit) : null;
}

function normalizeDecision(raw: Partial<SlackThreadBrainDecision> | null | undefined): SlackThreadBrainDecision {
  const intent = typeof raw?.intent === "string" && INTENTS.has(raw.intent as SlackThreadBrainIntent)
    ? raw.intent as SlackThreadBrainIntent
    : "clarify";
  const outcomeStatus = typeof raw?.outcomeStatus === "string" && OUTCOME_STATUSES.has(raw.outcomeStatus as ApplicationStatus)
    ? raw.outcomeStatus as ApplicationStatus
    : null;
  return {
    intent,
    confidence: confidence(raw?.confidence),
    instruction: cleanText(raw?.instruction),
    actionId: typeof raw?.actionId === "number" && Number.isFinite(raw.actionId) && raw.actionId > 0 ? Math.floor(raw.actionId) : null,
    replyText: cleanText(raw?.replyText),
    reason: cleanText(raw?.reason, 240),
    outcomeStatus,
  };
}

export async function classifySlackThreadWithLlm(
  input: SlackThreadBrainInput,
  provider: SlackThreadBrainProvider = new OpenAiCompatibleProvider(),
): Promise<{ ok: true; decision: SlackThreadBrainDecision } | { ok: false; reason: string }> {
  if (!provider.isAvailable()) {
    return { ok: false, reason: "LLM provider unavailable" };
  }

  const response = await provider.completeJson<SlackThreadBrainDecision>({
    temperature: 0,
    maxTokens: 500,
    messages: [
      {
        role: "system",
        content: [
          "You are the Upwork agent's Slack thread brain.",
          "Read Steve/Natalie/Logan's thread reply and decide what it means.",
          "Return JSON only with intent, confidence, instruction, actionId, outcomeStatus, replyText, reason.",
          "Allowed intents: approve_prepare, status, revise, reject, retry_action, mark_submitted, record_outcome, clarify, ignore.",
          "approve_prepare means prepare the Upwork application page/draft only. It must never mean final submit.",
          "Treat phrases like 'yeah, prep drafts', 'send link to listing', 'prep it', 'go ahead', 'please proceed with the draft', 'looks good prep', 'apply', 'write it', and 'move forward' as approve_prepare when intent is clear.",
          "Questions like why, red flags, risks, status, proof, draft, or what still needs review are status.",
          "Rewrite/change/use/lower/remove instructions are revise and the instruction should preserve the user's requested change.",
          "Skip/pass/decline means reject. Retry prep means retry_action.",
          "Outcome updates like got reply, client replied, interview booked, hired, won, lost, or closed lost are record_outcome. Set outcomeStatus to replied, interview, hired, or lost.",
          "Casual discussion with no instruction is ignore. If the user seems to need the agent but intent is unclear, use clarify.",
          "replyText should be short, casual, and human. Do not use internal jargon. Do not mention final submit except to say it remains manual.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          message: input.text,
          botMentioned: input.botMentioned,
          threadMapped: input.threadMapped,
          jobId: input.jobId ?? null,
          upworkUrl: input.upworkUrl ?? null,
          threadStatus: input.threadStatus ?? null,
        }),
      },
    ],
  });

  if (!response.ok || !response.data) {
    return { ok: false, reason: response.error ?? response.skippedReason ?? "LLM did not return an intent" };
  }

  return { ok: true, decision: normalizeDecision(response.data) };
}
