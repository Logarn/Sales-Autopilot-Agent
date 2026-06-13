import { SLACK_COPY_TEMPERATURE } from "./config";
import {
  OpenAiCompatibleProvider,
  getSlackCopyProviderConfig,
  type LlmJsonRequest,
  type LlmJsonResult,
} from "./llm/provider";
import type { SlackBehaviorMemoryType } from "./db";
import { buildSoulPromptContext, buildSoulPromptSection } from "./soul";

export type SlackConversationBrainIntent =
  | "answer_file_capability_question"
  | "answer_health"
  | "explain_health_findings"
  | "show_cover_letter"
  | "full_safe_prep"
  | "draft_preview_first"
  | "retry_action"
  | "retry_capture"
  | "focus_qa_tab"
  | "open_application_page"
  | "qa_queue"
  | "capture_upwork_url"
  | "ingest_file"
  | "revise_proof_plan"
  | "revise_draft"
  | "status_summary"
  | "explain_risk"
  | "explain_proof"
  | "explain_boost"
  | "pause_hunting"
  | "start_hunting"
  | "check_browser"
  | "check_services"
  | "debug_details"
  | "reject"
  | "mark_submitted"
  | "record_outcome"
  | "clarify"
  | "ignore";

export type SlackConversationBrainAction =
  | "answer_health"
  | "explain_health_findings"
  | "queue_prepare_application"
  | "send_draft_preview"
  | "retry_browser_action"
  | "focus_qa_tab"
  | "open_application_page"
  | "show_qa_queue"
  | "capture_upwork_url"
  | "ingest_file"
  | "queue_proof_recheck"
  | "revise_draft"
  | "pause_hunting"
  | "start_hunting"
  | "check_browser"
  | "check_services"
  | "show_debug_details"
  | "mark_skip"
  | "record_outcome"
  | "mark_submitted"
  | "none"
  | "retry_capture";

export type SlackConversationBrainConfidence = "high" | "medium" | "low";
export type SlackConversationBrainFixType = "memory" | "prompt" | "config" | "code_pr";
export type SlackConversationBrainIntentCategory =
  | "question"
  | "command"
  | "approval"
  | "rejection_skip"
  | "correction"
  | "status_check"
  | "debug_request"
  | "feedback_opinion"
  | "unknown_ambiguous";
export type SlackConversationBrainTarget =
  | "current_thread_lead"
  | "explicit_upwork_url"
  | "qa_item_number"
  | "current_batch_item"
  | "unknown";
export type SlackConversationBrainSafetyDecision =
  | "safe_execute"
  | "clarify_before_execute"
  | "manual_submit_reminder"
  | "blocked_by_browser_security"
  | "debug_only"
  | "no_action";

export interface SlackConversationBrainProvider {
  isAvailable(): boolean;
  completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>>;
}

export interface SlackConversationMemoryUpdate {
  type: SlackBehaviorMemoryType;
  rule: string;
  scope?: string | null;
  confidence?: SlackConversationBrainConfidence | null;
}

export interface SlackConversationFailureReflection {
  whatHappened: string;
  whyItFailed: string;
  nextBehavior: string;
  fixType: SlackConversationBrainFixType;
  proposedTask?: string | null;
}

export interface SlackConversationBrainDecision {
  intentCategory: SlackConversationBrainIntentCategory;
  intent: SlackConversationBrainIntent;
  target: SlackConversationBrainTarget;
  safetyDecision: SlackConversationBrainSafetyDecision;
  confidence: SlackConversationBrainConfidence;
  reply: string | null;
  actions: SlackConversationBrainAction[];
  contextSignals: string[];
  memoryUpdate: SlackConversationMemoryUpdate | null;
  needsHumanClarification: boolean;
  codeImprovementNeeded: boolean;
  failureReflection: SlackConversationFailureReflection | null;
  progressReplyNeeded: boolean;
  progressReply: string | null;
  safety: {
    finalSubmit: "manual_only";
    rawIdsAllowed: boolean;
    browserChecksBypassAllowed: false;
  };
  instruction?: string | null;
  qaIndex?: number | null;
  qaQuery?: string | null;
  actionId?: number | null;
  outcomeStatus?: string | null;
}

export interface SlackConversationBrainInput {
  latestUserMessage: string;
  threadHistory: Array<{ role: "user" | "assistant"; text: string }>;
  thread: {
    channelId?: string | null;
    threadTs?: string | null;
    status?: string | null;
    jobId?: string | null;
    upworkUrl?: string | null;
  } | null;
  job: {
    id?: string | null;
    title?: string | null;
    url?: string | null;
    score?: number | null;
    matchLevel?: string | null;
    reasons?: string[];
    risks?: string[];
  } | null;
  application: {
    status?: string | null;
  } | null;
  draft: {
    exists: boolean;
    status?: string | null;
    proposalText?: string | null;
    proposalVersion?: number | null;
  };
  proof: {
    files: string[];
    portfolioHighlights: string[];
    certificates: string[];
    mentionOnly: string[];
    verified: boolean;
    missingFiles: string[];
  };
  connects: {
    required: number | null;
    boost: number | null;
    total: number | null;
  };
  browserAction: {
    actionType?: string | null;
    status?: string | null;
    retryable: boolean;
    lastError?: string | null;
  } | null;
  workflow?: {
    state: string;
    captureState: string;
    draftState: string;
    proofPlanState: string;
    prepState: string;
    qaState: string;
    blocker: string | null;
    nextSafeAction: string;
    latestAgentPromise?: {
      type: string;
      status: string;
      text: string;
      blocker?: string | null;
    } | null;
  } | null;
  browserSession?: {
    state?: string | null;
    blocked: boolean;
    reason?: string | null;
  } | null;
  activeCta?: {
    action: "prep_application" | "retry" | "review" | "none";
    source: "latest_bot_cta" | "thread_status" | "thread_reply" | "none";
    text: string | null;
  } | null;
  serviceState?: {
    slackListening?: boolean | null;
    leadEngine?: string | null;
    huntingPaused?: boolean | null;
    healthSummary?: string | null;
  } | null;
  inbound?: {
    botMentioned: boolean;
    hasSlackFiles: boolean;
    upworkUrl?: string | null;
    allowedUser: boolean;
    allowedChannel: boolean;
  } | null;
  qaQueue: Array<{
    index: number;
    title: string;
    state: string;
    proof: string;
    files: string;
    connects: string;
    boost: string;
    nextAction: string;
  }>;
  behaviorMemories: Array<{
    type: SlackBehaviorMemoryType;
    rule: string;
    scope: string;
    confidence: SlackConversationBrainConfidence;
  }>;
  previousCorrections?: Array<{
    userMessage: string;
    whatHappened: string;
    nextBehavior: string;
  }>;
  salesLearning?: {
    relevantMemories: Array<{
      type: string;
      scope: string;
      subject: string;
      hypothesis: string;
      confidence: string;
      evidenceCount: number;
      status: string;
      updatedAt: string;
    }>;
    guidance: string[];
  };
  allowedActions: SlackConversationBrainAction[];
  hardSafetyRules: string[];
}

interface RawSlackConversationBrainDecision {
  intentCategory?: unknown;
  intent?: unknown;
  target?: unknown;
  safetyDecision?: unknown;
  confidence?: unknown;
  reply?: unknown;
  actions?: unknown;
  contextSignals?: unknown;
  memoryUpdate?: unknown;
  memoryUpdates?: unknown;
  needsHumanClarification?: unknown;
  codeImprovementNeeded?: unknown;
  failureReflection?: unknown;
  progressReplyNeeded?: unknown;
  progressReply?: unknown;
  safety?: unknown;
  instruction?: unknown;
  qaIndex?: unknown;
  qaQuery?: unknown;
  actionId?: unknown;
  outcomeStatus?: unknown;
}

const INTENTS = new Set<SlackConversationBrainIntent>([
  "answer_file_capability_question",
  "answer_health",
  "explain_health_findings",
  "show_cover_letter",
  "full_safe_prep",
  "draft_preview_first",
  "retry_action",
  "retry_capture",
  "focus_qa_tab",
  "open_application_page",
  "qa_queue",
  "capture_upwork_url",
  "ingest_file",
  "revise_proof_plan",
  "revise_draft",
  "status_summary",
  "explain_risk",
  "explain_proof",
  "explain_boost",
  "pause_hunting",
  "start_hunting",
  "check_browser",
  "check_services",
  "debug_details",
  "reject",
  "mark_submitted",
  "record_outcome",
  "clarify",
  "ignore",
]);

const ACTIONS = new Set<SlackConversationBrainAction>([
  "answer_health",
  "explain_health_findings",
  "queue_prepare_application",
  "send_draft_preview",
  "retry_browser_action",
  "focus_qa_tab",
  "open_application_page",
  "show_qa_queue",
  "capture_upwork_url",
  "ingest_file",
  "queue_proof_recheck",
  "revise_draft",
  "pause_hunting",
  "start_hunting",
  "check_browser",
  "check_services",
  "show_debug_details",
  "mark_skip",
  "record_outcome",
  "mark_submitted",
  "none",
]);

const MEMORY_TYPES = new Set<SlackBehaviorMemoryType>([
  "operator_preference",
  "failed_intent",
  "proof_preference",
  "draft_style_preference",
  "retry_rule",
  "lead_packet_style_rule",
]);

const FIX_TYPES = new Set<SlackConversationBrainFixType>(["memory", "prompt", "config", "code_pr"]);

const INTENT_CATEGORIES = new Set<SlackConversationBrainIntentCategory>([
  "question",
  "command",
  "approval",
  "rejection_skip",
  "correction",
  "status_check",
  "debug_request",
  "feedback_opinion",
  "unknown_ambiguous",
]);

const TARGETS = new Set<SlackConversationBrainTarget>([
  "current_thread_lead",
  "explicit_upwork_url",
  "qa_item_number",
  "current_batch_item",
  "unknown",
]);

const SAFETY_DECISIONS = new Set<SlackConversationBrainSafetyDecision>([
  "safe_execute",
  "clarify_before_execute",
  "manual_submit_reminder",
  "blocked_by_browser_security",
  "debug_only",
  "no_action",
]);

export const SLACK_CONVERSATION_ALLOWED_ACTIONS: SlackConversationBrainAction[] = [
  "answer_health",
  "explain_health_findings",
  "queue_prepare_application",
  "send_draft_preview",
  "retry_browser_action",
  "focus_qa_tab",
  "open_application_page",
  "show_qa_queue",
  "capture_upwork_url",
  "ingest_file",
  "queue_proof_recheck",
  "revise_draft",
  "pause_hunting",
  "start_hunting",
  "check_browser",
  "check_services",
  "show_debug_details",
  "mark_skip",
  "record_outcome",
  "none",
  "retry_capture",
];

export const SLACK_CONVERSATION_HARD_SAFETY_RULES = [
  "Final submit remains manual. Never click or claim to click final submit/send proposal.",
  "Never bypass CAPTCHA, security checks, or browser eligibility checks.",
  "Only count files as verified after deterministic remote Chrome filename verification.",
  "Only count portfolio/profile proof as verified after deterministic remote Chrome selected-label verification.",
  "Use Proof planned until verification is explicit; use Proof verified only after deterministic page verification.",
  "Never show action ids, channel ids, thread ids, queue internals, or raw status unless the user asks for debug, raw status, or technical details.",
  "Do not show generic command menus for natural questions.",
];

function defaultProvider(): SlackConversationBrainProvider {
  return new OpenAiCompatibleProvider(getSlackCopyProviderConfig());
}

function confidence(value: unknown): SlackConversationBrainConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function hasOldCommandMenu(value: string): boolean {
  return /I can help with the draft, files, proof, boost, or status/i.test(value);
}

function hasRawIds(value: string): boolean {
  return [
    /\b(?:browser\s+)?action\s*#?\s*\d+\b/i,
    /\b(?:channel\s+(?:id|ts)|thread\s+(?:id|ts)|client_msg_id|event_ts|queue internals)\b/i,
    /\bjob id\s*[:#]\s*[A-Za-z0-9._~:-]+/i,
  ].some((pattern) => pattern.test(value));
}

function violatesSubmitBoundary(value: string): boolean {
  const normalized = value.replace(/\bmanually click\s+(?:\*?Send[^.\n]*\*?|\*?Submit\*?|submit)\b/gi, "manual_submit_safe");
  return [
    /\bI\s+(?:will|can|could|did|have)\s+(?:submit|send)\b/i,
    /\b(?:submitted|sent)\s+the\s+(?:proposal|application)\b/i,
    /\bclick(?:ed)?\s+(?:the\s+)?(?:submit|send)\b/i,
  ].some((pattern) => pattern.test(normalized));
}

function cleanText(value: unknown, limit = 1200, options: { rawIdsAllowed?: boolean } = {}): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+$/g, "").trim();
  if (!trimmed) return null;
  if (hasOldCommandMenu(trimmed)) return null;
  if (!options.rawIdsAllowed && hasRawIds(trimmed)) return null;
  if (!options.rawIdsAllowed && /\bthe agent\b/i.test(trimmed)) return null;
  if (violatesSubmitBoundary(trimmed)) return null;
  if (/Proof I used/i.test(trimmed)) return null;
  return trimmed.slice(0, limit);
}

function normalizeIntent(value: unknown): SlackConversationBrainIntent {
  return typeof value === "string" && INTENTS.has(value as SlackConversationBrainIntent)
    ? value as SlackConversationBrainIntent
    : "clarify";
}

function normalizeIntentCategory(value: unknown, intent: SlackConversationBrainIntent): SlackConversationBrainIntentCategory {
  if (typeof value === "string" && INTENT_CATEGORIES.has(value as SlackConversationBrainIntentCategory)) {
    return value as SlackConversationBrainIntentCategory;
  }
  if (intent === "debug_details") return "debug_request";
  if (intent === "reject") return "rejection_skip";
  if (intent === "answer_health" || intent === "check_browser" || intent === "check_services" || intent === "qa_queue") return "status_check";
  if (intent === "full_safe_prep" || intent === "draft_preview_first" || intent === "retry_action" || intent === "retry_capture" || intent === "focus_qa_tab" || intent === "open_application_page") return "command";
  if (intent === "clarify") return "unknown_ambiguous";
  return "question";
}

function normalizeTarget(value: unknown, input: SlackConversationBrainInput): SlackConversationBrainTarget {
  if (typeof value === "string" && TARGETS.has(value as SlackConversationBrainTarget)) {
    return value as SlackConversationBrainTarget;
  }
  if (input.inbound?.upworkUrl) return "explicit_upwork_url";
  if (input.thread?.jobId || input.thread?.upworkUrl) return "current_thread_lead";
  return "unknown";
}

function normalizeSafetyDecision(value: unknown, input: SlackConversationBrainInput, intent: SlackConversationBrainIntent): SlackConversationBrainSafetyDecision {
  if (typeof value === "string" && SAFETY_DECISIONS.has(value as SlackConversationBrainSafetyDecision)) {
    return value as SlackConversationBrainSafetyDecision;
  }
  if (intent === "debug_details") return "debug_only";
  if (input.browserSession?.blocked) return "blocked_by_browser_security";
  if (intent === "clarify") return "clarify_before_execute";
  if (intent === "mark_submitted") return "manual_submit_reminder";
  if (intent === "ignore") return "no_action";
  return "safe_execute";
}

function normalizeActions(value: unknown, allowed: SlackConversationBrainAction[]): SlackConversationBrainAction[] {
  const allowedSet = new Set(allowed);
  const raw = Array.isArray(value) ? value : [];
  const actions = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item as SlackConversationBrainAction)
    .filter((item) => ACTIONS.has(item) && allowedSet.has(item));
  const unique = [...new Set(actions)];
  return unique.length > 0 ? unique : ["none"];
}

function normalizeContextSignals(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeMemoryUpdate(value: unknown): SlackConversationMemoryUpdate | null {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!raw) return null;
  const type = typeof raw.type === "string" && MEMORY_TYPES.has(raw.type as SlackBehaviorMemoryType)
    ? raw.type as SlackBehaviorMemoryType
    : null;
  const rule = cleanText(raw.rule, 700, { rawIdsAllowed: false });
  if (!type || !rule) return null;
  const scope = typeof raw.scope === "string" && raw.scope.trim() ? raw.scope.trim().slice(0, 80) : "global";
  return {
    type,
    rule,
    scope,
    confidence: confidence(raw.confidence),
  };
}

function normalizeFailureReflection(value: unknown): SlackConversationFailureReflection | null {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!raw) return null;
  const whatHappened = cleanText(raw.whatHappened, 500);
  const whyItFailed = cleanText(raw.whyItFailed, 500);
  const nextBehavior = cleanText(raw.nextBehavior, 500);
  const fixType = typeof raw.fixType === "string" && FIX_TYPES.has(raw.fixType as SlackConversationBrainFixType)
    ? raw.fixType as SlackConversationBrainFixType
    : "memory";
  const proposedTask = cleanText(raw.proposedTask, 700);
  if (!whatHappened || !whyItFailed || !nextBehavior) return null;
  return {
    whatHappened,
    whyItFailed,
    nextBehavior,
    fixType,
    proposedTask,
  };
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(1, Math.floor(value));
}

function normalizeDecision(raw: RawSlackConversationBrainDecision, input: SlackConversationBrainInput): SlackConversationBrainDecision {
  const intent = normalizeIntent(raw.intent);
  const rawIdsAllowed = intent === "debug_details" || /\b(debug|raw status|technical details)\b/i.test(input.latestUserMessage);
  const rawMemoryUpdates = Array.isArray(raw.memoryUpdates) ? raw.memoryUpdates : [raw.memoryUpdate];
  const memoryUpdate = rawMemoryUpdates.map(normalizeMemoryUpdate).find(Boolean) ?? null;
  const intentCategory = normalizeIntentCategory(raw.intentCategory, intent);
  const target = normalizeTarget(raw.target, input);
  const safetyDecision = normalizeSafetyDecision(raw.safetyDecision, input, intent);
  return {
    intentCategory,
    intent,
    target,
    safetyDecision,
    confidence: confidence(raw.confidence),
    reply: cleanText(raw.reply, 1600, { rawIdsAllowed }),
    actions: normalizeActions(raw.actions, input.allowedActions),
    contextSignals: normalizeContextSignals(raw.contextSignals),
    memoryUpdate,
    needsHumanClarification: asBoolean(raw.needsHumanClarification),
    codeImprovementNeeded: asBoolean(raw.codeImprovementNeeded),
    failureReflection: normalizeFailureReflection(raw.failureReflection),
    progressReplyNeeded: asBoolean(raw.progressReplyNeeded),
    progressReply: cleanText(raw.progressReply, 400, { rawIdsAllowed }),
    safety: {
      finalSubmit: "manual_only",
      rawIdsAllowed,
      browserChecksBypassAllowed: false,
    },
    instruction: cleanText(raw.instruction, 700),
    qaIndex: numberOrNull(raw.qaIndex),
    qaQuery: cleanText(raw.qaQuery, 120),
    actionId: numberOrNull(raw.actionId),
    outcomeStatus: cleanText(raw.outcomeStatus, 40),
  };
}

function buildPromptInput(input: SlackConversationBrainInput): Record<string, unknown> {
  return {
    latestUserMessage: input.latestUserMessage,
    threadHistory: input.threadHistory.slice(-12),
    thread: input.thread,
    job: input.job,
    application: input.application,
    draft: input.draft.exists
      ? {
          exists: true,
          status: input.draft.status,
          proposalText: input.draft.proposalText,
          proposalVersion: input.draft.proposalVersion,
        }
      : { exists: false },
    proof: input.proof,
    connects: input.connects,
    browserAction: input.browserAction,
    workflow: input.workflow ?? null,
    browserSession: input.browserSession ?? null,
    activeCta: input.activeCta ?? null,
    serviceState: input.serviceState ?? null,
    inbound: input.inbound ?? null,
    qaQueue: input.qaQueue.slice(0, 5),
    behaviorMemories: input.behaviorMemories.slice(0, 25),
    previousCorrections: (input.previousCorrections ?? []).slice(0, 5),
    salesLearning: input.salesLearning ?? { relevantMemories: [], guidance: [] },
    allowedActions: input.allowedActions,
    hardSafetyRules: input.hardSafetyRules,
    soul: buildSoulPromptContext("slack_conversation"),
  };
}

export async function planSlackConversationWithLlm(
  input: SlackConversationBrainInput,
  provider: SlackConversationBrainProvider = defaultProvider(),
): Promise<{ ok: true; decision: SlackConversationBrainDecision } | { ok: false; reason: string }> {
  if (!provider.isAvailable()) {
    return { ok: false, reason: "Slack conversation brain provider unavailable" };
  }

  const response = await provider.completeJson<RawSlackConversationBrainDecision>({
    temperature: Math.min(SLACK_COPY_TEMPERATURE, 0.2),
    maxTokens: 1600,
    messages: [
      {
        role: "system",
        content: [
          "You are the Upwork agent's Slack conversation brain.",
          "Reason about Steve's latest message using the structured thread state before responding.",
          "Return JSON only with: intentCategory, intent, target, safetyDecision, confidence, reply, actions, contextSignals, progressReplyNeeded, progressReply, memoryUpdate, needsHumanClarification, codeImprovementNeeded, failureReflection, safety, instruction, qaIndex, qaQuery, actionId, outcomeStatus.",
          "intentCategory must be one of: question, command, approval, rejection_skip, correction, status_check, debug_request, feedback_opinion, unknown_ambiguous.",
          "target must be one of: current_thread_lead, explicit_upwork_url, qa_item_number, current_batch_item, unknown.",
          "safetyDecision must be one of: safe_execute, clarify_before_execute, manual_submit_reminder, blocked_by_browser_security, debug_only, no_action.",
          "Allowed intents: answer_file_capability_question, answer_health, explain_health_findings, show_cover_letter, full_safe_prep, draft_preview_first, retry_action, retry_capture, focus_qa_tab, open_application_page, qa_queue, capture_upwork_url, ingest_file, revise_proof_plan, revise_draft, status_summary, explain_risk, explain_proof, explain_boost, pause_hunting, start_hunting, check_browser, check_services, debug_details, reject, mark_submitted, record_outcome, clarify, ignore.",
          "Allowed actions are provided in the user payload. Propose only those action names.",
          "Every normal inbound Slack message is coming through this gateway. Reason first from context, then select one or more allowed actions.",
          "For service/browser questions, use answer_health/check_services/check_browser and explain in human language.",
          "For Upwork links, use capture_upwork_url when the message is relevant to this agent.",
          "For Slack file attachments in a tracked thread, use ingest_file.",
          "Use action queue_prepare_application for full safe prep. It means draft/files/proof/portfolio/Connects/boost only, then stop before submit.",
          "If activeCta.action is prep_application and Steve replies with an affirmative like yes, yep, yeah, go for it, do it, sounds good, move on it, let's run it, handle it, prep it, or go ahead, classify as intentCategory approval, target current_thread_lead, intent full_safe_prep, action queue_prepare_application.",
          "If no active CTA and no target are present, vague affirmatives such as go for it or sounds good require clarify and no browser action.",
          "Correction language like 'no, I meant you can prep it' must re-run intent against the thread state. If target and action are clear, execute the corrected safe action.",
          "Dangerous submit-adjacent language like send it, submit it, or fire it off must not submit. Use safetyDecision manual_submit_reminder and offer prep/review instead.",
          "Composite status questions should answer each requested part, for example blocked plus needs attention.",
          "Use action send_draft_preview when Steve asks to see the draft here first. Do not fill Upwork for that request.",
          "Use action retry_browser_action for retry. If the thread has a retryable browser action, do not require an action id.",
          "Use action focus_qa_tab for open this, bring this up, show application page, or open draft in Chrome.",
          "Use action show_qa_queue for what's ready, QA queue, or blocked queue questions.",
          "If the selected action may take more than a few seconds, set progressReplyNeeded true and provide a short human progressReply.",
          "Treat CV in an Upwork thread as the cover letter/proposal draft unless context proves otherwise.",
          "When Steve is frustrated, acknowledge the bad prior response briefly and answer directly.",
          "Do not show command menus. Only ask clarification when genuinely ambiguous.",
          "Normal replies must hide raw ids and internals. Raw ids are allowed only when the user asks debug, raw status, or technical details.",
          "Never claim proof is verified unless proof.verified is true. Use Proof planned otherwise. Never say Proof I used.",
          "Never click, promise, or claim final submit. Final submit remains manual.",
          "Never bypass CAPTCHA/security/browser checks.",
          "If Steve corrects you, include a concise memoryUpdate rule. If code is needed, include failureReflection with fixType code_pr and proposedTask.",
          "Use salesLearning memories as evidence-weighted hypotheses for sales judgment, not rigid rules.",
          "Current user instructions override learned preferences unless they conflict with hard safety.",
          buildSoulPromptSection("slack_conversation"),
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(buildPromptInput(input)),
      },
    ],
  });

  if (!response.ok || !response.data) {
    return { ok: false, reason: response.error ?? response.skippedReason ?? "Slack conversation brain returned no data" };
  }

  return { ok: true, decision: normalizeDecision(response.data, input) };
}
