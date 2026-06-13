import { App } from "@slack/bolt";
import {
  clearBrowserManualAttention,
  getBrowserSessionStatus,
  listUnresolvedBrowserChallengeQuarantines,
  markBrowserChallengeRetried,
  markBrowserChallengeSkipped,
} from "./browserSession";
import { buildBrowserApplyPlan } from "./browserApply";
import {
  applyApplicationRevision,
  createBatchApplyWorkspace,
  enqueueBrowserActionDeduped,
  getActiveBatchApplyWorkspace,
  getApplicationDraft,
  getApplicationProofPlanOverrides,
  getApplicationStatus,
  getBrowserActionById,
  getScoredJobForSlackPreview,
  getSlackConversationOwnership,
  getSlackThreadStateByJobId,
  getSlackThreadStateByThreadTs,
  getOperatorReportDbSnapshot,
  listActiveSlackBehaviorMemories,
  listBatchApplyCandidateThreads,
  listBatchApplyWorkspaceItems,
  listBrowserActions,
  listRecentSlackFailureReflections,
  getLatestProposalVersion,
  recordLatestVerifiedProposalFallback,
  recordProposalVersion,
  recordSlackFailureReflection,
  updateApplicationStatus,
  updateBatchApplyWorkspaceItemStatus,
  updateSlackThreadStateStatus,
  upsertBatchApplyWorkspaceItem,
  upsertSlackThreadState,
  upsertSlackBehaviorMemory,
  upsertSlackConversationOwnership,
  recordApplicationRevisionRequest,
  mergeBrowserActionPayload,
  updateBrowserActionStatus,
  updateApplicationProofPlanOverrides,
} from "./db";
import {
  buildCaptureActionPayload,
  canonicalizeUpworkJobUrl,
  deriveCaptureThreadJobId,
  extractUpworkJobIdFromUrl,
  isSupportedUpworkJobUrl,
} from "./browserCapture";
import { buildConfiguredDiscoverySources } from "./browserDiscoveryTool";
import {
  clearPausedDiscoverySourceHealth,
  formatDiscoverySourceHealthForSlack,
  pauseDiscoverySources,
} from "./browserDiscoverySourceHealth";
import {
  BROWSER_QA_MAX_PROTECTED_TABS,
  SLACK_APP_TOKEN,
  SLACK_BOT_TOKEN,
  SLACK_SOCKET_MODE_ENABLED,
  SLACK_ALLOWED_CHANNEL_IDS,
  SLACK_AGENT_AMBIENT_CHANNEL_IDS,
  SLACK_ALLOWED_USER_IDS,
} from "./config";
import { logger } from "./logger";
import { buildProposalContextPack } from "./skills/profileContextSkill";
import { formatConnectsStrategy } from "./connectsStrategy";
import { classifySlackThreadWithLlm, type SlackThreadBrainProvider, type SlackThreadBrainDecision } from "./slackThreadBrain";
import { planSlackConversation, type SlackConversationPlan } from "./slackConversationPlanner";
import {
  planSlackConversationWithLlm,
  SLACK_CONVERSATION_ALLOWED_ACTIONS,
  SLACK_CONVERSATION_HARD_SAFETY_RULES,
  type SlackConversationBrainDecision,
  type SlackConversationBrainProvider,
  type SlackConversationBrainInput,
} from "./slackConversationBrain";
import { buildSoulRuntimeGuidance } from "./soul";
import {
  buildSalesLearningPromptContext,
  forgetSalesLearning,
  recordApplicationOutcomeLearning,
  recordCodeImprovementTask,
  recordProofPreferenceSignal,
  recordProposalStyleSignal,
  recordProposalVersionDiffLearning,
  reflectOnSalesOutcomeWithLlm,
  rememberSalesLearning,
  retrieveRelevantSalesLearningMemories,
} from "./salesLearningMemory";
import { buildSalesLearningInsightReply } from "./salesLearningInsights";
import { formatSlackFileIntakeReply, ingestSlackFilesForThread, type SlackFileLike } from "./slackFileIntake";
import { looksLikeProofPlanRevision, parseProofPlanOverrides, reviseProofPlanOverrides } from "./proofPlanOverrides";
import {
  canQueueNewQaPreparation,
  focusProtectedQaApplicationTab,
  formatBatchApplyWorkspaceReply,
  getBatchApplyWorkspaceView,
  getProtectedQaQueueItems,
  type BatchApplyWorkspaceItemView,
  type ProtectedQaFocusResult,
} from "./browserQaWorkspace";
import { rewriteSlackCopyWithKimi, type SlackCopyProvider, type SlackCopyResult } from "./slackCopywriter";
import {
  buildSlackOperatorReply,
  parseSlackOperatorIntent,
  type SlackOperatorControlDeps,
} from "./slackOperatorControlPlane";
import {
  answerMonthlyOperatorQuestion,
  buildFridayOperatorHandoff,
  buildMonthlyOperatorReview,
} from "./operatorReports";
import { buildSourceStrategyAnswer } from "./sourceStrategy";
import type { ApplicationStatus, ProposalVersionSource } from "./types";

const THREAD_MENTIONS = "<@U0A2X5BCNKC> <@U0AHJFYV42K>";
const SLACK_EVENT_DEDUPE_TTL_MS = 10 * 60 * 1000;
const SLACK_EVENT_DEDUPE_MAX_KEYS = 1000;
const SLACK_PROMPT_DEBOUNCE_MS = 750;
const processedSlackEventKeys = new Map<string, number>();
const recentSlackPromptKeys = new Map<string, number>();

function cleanupSlackEventDedupe(now = Date.now()): void {
  for (const [key, seenAt] of processedSlackEventKeys.entries()) {
    if (now - seenAt > SLACK_EVENT_DEDUPE_TTL_MS || processedSlackEventKeys.size > SLACK_EVENT_DEDUPE_MAX_KEYS) {
      processedSlackEventKeys.delete(key);
    }
  }
}

function cleanupSlackPromptDebounce(now = Date.now()): void {
  for (const [key, seenAt] of recentSlackPromptKeys.entries()) {
    if (now - seenAt > SLACK_PROMPT_DEBOUNCE_MS || recentSlackPromptKeys.size > SLACK_EVENT_DEDUPE_MAX_KEYS) {
      recentSlackPromptKeys.delete(key);
    }
  }
}

function slackEventDedupeKeys(event: SlackSocketTextEvent, normalizedText: string): string[] {
  const threadTs = event.thread_ts ?? event.ts;
  return [
    event.event_id ? `event:${event.event_id}` : null,
    event.client_msg_id ? `client:${event.channel}:${event.client_msg_id}` : null,
    event.ts ? `ts:${event.channel}:${event.ts}` : null,
    event.event_ts ? `event_ts:${event.channel}:${event.event_ts}` : null,
    normalizedText ? `text:${event.channel}:${threadTs}:${event.ts}:${normalizedText}` : null,
  ].filter((key): key is string => Boolean(key));
}

export function resetSlackSocketEventDedupeForTests(): void {
  processedSlackEventKeys.clear();
  recentSlackPromptKeys.clear();
}

function shouldSkipDuplicateSlackEvent(event: SlackSocketTextEvent, normalizedText: string): boolean {
  const now = Date.now();
  cleanupSlackEventDedupe(now);
  const keys = slackEventDedupeKeys(event, normalizedText);
  if (keys.some((key) => processedSlackEventKeys.has(key))) {
    return true;
  }
  for (const key of keys) {
    processedSlackEventKeys.set(key, now);
  }
  return false;
}

function shouldDebounceRapidSlackPrompt(event: SlackSocketTextEvent, threadTs: string, normalizedText: string): boolean {
  const now = Date.now();
  cleanupSlackPromptDebounce(now);
  const key = `${event.channel}:${threadTs}:${event.user ?? "unknown"}:${normalizedText}`;
  const previous = recentSlackPromptKeys.get(key);
  if (previous && now - previous <= SLACK_PROMPT_DEBOUNCE_MS) {
    return true;
  }
  recentSlackPromptKeys.set(key, now);
  return false;
}

export type SlackSocketParsedCommandType =
  | "status"
  | "approve"
  | "reject"
  | "revise"
  | "proof_revision"
  | "approve_prepare"
  | "prepare_draft"
  | "draft_preview"
  | "batch_prep"
  | "qa_queue"
  | "focus_qa_tab"
  | "skip_batch_item"
  | "prep_issue_report"
  | "retry_action"
  | "retry_capture"
  | "discovery_keep_hunting"
  | "discovery_retry_sources"
  | "discovery_best_matches_only"
  | "discovery_block_status"
  | "discovery_clear_browser"
  | "reread_application"
  | "mark_submitted"
  | "mark_batch_submitted"
  | "record_outcome"
  | "operator_report"
  | "source_strategy"
  | "memory_query"
  | "memory_remember"
  | "memory_forget"
  | "clarify"
  | "ignore"
  | "unknown";

export interface ParsedSlackSocketCommand {
  type: SlackSocketParsedCommandType;
  rawText: string;
  instruction?: string;
  actionId?: number;
  qaIndex?: number;
  qaQuery?: string;
  batchTargetCount?: number;
  proposalVersionSource?: ProposalVersionSource;
  markSubmittedAfterCapture?: boolean;
  confidence?: "high" | "medium" | "low";
  replyText?: string;
  source?: "llm" | "fallback";
  outcomeStatus?: ApplicationStatus;
  outcomeLabel?: string;
  operatorReportKind?: "friday" | "monthly" | "question";
}

export interface ParsedUpworkUrl {
  originalUrl: string;
  normalizedUrl: string;
  canonicalJobUrl: string;
  jobId: string | null;
}

function normalizeSlackTextInput(value: string): string {
  return value
    .replace(/<@[A-Za-z0-9_]+(?:\|[^>]+)?>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSlackMention(value: string): boolean {
  return /<@[A-Za-z0-9_]+(?:\|[^>]+)?>/.test(value);
}

function matchesApprovePrepareIntent(value: string, mentioned: boolean): boolean {
  const text = value.toLowerCase();
  return (
    /\b(?:yeah|yes|yep|yup|sure|ok|okay|looks good)\b.*\b(?:prep|prepare|draft|drafts|apply|applications?|write|proceed|move forward)\b/.test(text) ||
    /\b(?:use this|put it in upwork|put this in upwork|fill it in upwork|fill this in upwork)\b/.test(text) ||
    /\b(?:prep|prepare)\s+(?:it|this|draft|drafts|the\s+(?:draft|application|applications|proposal)|one\s+(?:application|app)|next\s+(?:application|app))\b/.test(text) ||
    /\b(?:please\s+)?proceed(?:\s+with)?(?:\s+the)?\s+(?:drafts?|applications?|apps?|proposal|prep)\b/.test(text) ||
    /\b(?:start|prep|prepare)\s+(?:with\s+)?one\s+(?:application|app)\b/.test(text) ||
    /\b(?:do|handle)\s+the\s+next\s+(?:application|app)\b/.test(text) ||
    /\b(?:can you|could you)\s+handle\s+(?:an|one)\s+(?:application|app)\s+now\b/.test(text) ||
    /\b(?:go ahead|move forward|do it)\b(?:\s+and\s+\b(?:prep|prepare|draft|apply|applications?|write)\b.*)?$/.test(text) ||
    /\b(?:write\s+(?:it|the\s+draft)|apply)\b$/.test(text) ||
    (mentioned && /\b(?:prep|prepare|draft|drafts|apply|write|listing|link)\b/.test(text))
  );
}

function matchesNegatedPrepareIntent(value: string): boolean {
  const text = value.toLowerCase();
  return /\b(?:don['’]?t|do not|dont|never|not|stop)\b.*\b(?:prep|prepare|put (?:it|this) in upwork|fill (?:it|this) in upwork|apply|browser|chrome)\b/.test(text) ||
    /\b(?:no|nope)\b.*\b(?:prep|prepare|upwork|browser|chrome)\b/.test(text);
}

function matchesDraftPreviewIntent(value: string): boolean {
  const text = value.toLowerCase();
  return (
    /\b(?:show|send|post)\s+me\b.*\bdraft\b.*\b(?:here|first|slack)\b/.test(text) ||
    /\b(?:show|send|post)\s+me\b.*\bdraft\s+cv\b/.test(text) ||
    /\bdraft\s+(?:cv|proposal)\b.*\b(?:here|first|slack)\b/.test(text) ||
    /\bprepare\b.*\bshow\s+me\b.*\bdraft\b.*\bfirst\b/.test(text)
  );
}

export function shouldAskClarifyingThreadQuestion(text: string): boolean {
  const normalized = normalizeSlackTextInput(text).toLowerCase();
  return hasSlackMention(text) ||
    /\b(?:prep|prepare|draft|cover\s*letter|apply|listing|link|connects|rate|proof|file|red flags?|risk|why|status|next|should|can you|please|reply|replied|interview|hired|lost|outcome|submitted|ready|qa queue|blocked|everything)\b/.test(normalized) ||
    /\b(?:cv|proposal)\b/.test(normalized);
}

function parseUrlSafely(value: string): ParsedUpworkUrl | null {
  const trimmed = value
    .trim()
    .replace(/^</, "")
    .replace(/>$/, "")
    .replace(/^\((https?:\/\/[^)]+)\)$/, "$1");
  const withNoLabel = trimmed.split("|")[0].trim();

  if (!isSupportedUpworkJobUrl(withNoLabel)) {
    return null;
  }

  const canonicalJobUrl = canonicalizeUpworkJobUrl(withNoLabel);
  const jobId = extractUpworkJobIdFromUrl(withNoLabel);
  if (!canonicalJobUrl || !jobId) {
    return null;
  }

  return {
    originalUrl: withNoLabel,
    normalizedUrl: canonicalJobUrl,
    canonicalJobUrl,
    jobId,
  };
}

export function parseUpworkJobUrlFromText(text: string): ParsedUpworkUrl | null {
  const matches = text.match(/https?:\/\/[^\s<>]+/gi);
  if (!matches) {
    return null;
  }

  for (const raw of matches) {
    const parsed = parseUrlSafely(raw);
    if (!parsed) continue;
    return {
      ...parsed,
      originalUrl: parsed.originalUrl.replace(/[\n\r\t]+/g, ""),
      normalizedUrl: parsed.normalizedUrl.replace(/[\n\r\t]+/g, ""),
      canonicalJobUrl: parsed.canonicalJobUrl.replace(/[\n\r\t]+/g, ""),
    };
  }
  return null;
}

function parseOutcomeCommand(commandText: string, rawText: string): ParsedSlackSocketCommand | null {
  const outcomePatterns: Array<{ status: ApplicationStatus; label: string; pattern: RegExp }> = [
    {
      status: "replied",
      label: "reply received",
      pattern: /^(?:got\s+(?:a\s+)?reply|client\s+replied|they\s+replied|reply\s+received|mark\s+(?:as\s+)?replied|replied)$/i,
    },
    {
      status: "interview",
      label: "interview booked",
      pattern: /^(?:interview\s+booked|booked\s+(?:an\s+)?interview|call\s+booked|mark\s+(?:as\s+)?interview|interview)$/i,
    },
    {
      status: "hired",
      label: "hired",
      pattern: /^(?:hired|got\s+hired|we\s+got\s+hired|mark\s+(?:as\s+)?hired)$/i,
    },
    {
      status: "hired",
      label: "won",
      pattern: /^(?:won(?:\s+this)?|closed\s+won)$/i,
    },
    {
      status: "lost",
      label: "lost",
      pattern: /^(?:lost(?:\s+this)?|closed\s+lost|did\s+not\s+win|didn't\s+win|not\s+hired|mark\s+(?:as\s+)?lost)$/i,
    },
    {
      status: "lost",
      label: "client ghosted",
      pattern: /^(?:ghosted|client\s+ghosted|ignored|no\s+reply|no\s+response|mark\s+(?:as\s+)?ignored)$/i,
    },
    {
      status: "lost",
      label: "bad lead",
      pattern: /^(?:bad\s+lead)$/i,
    },
  ];
  const match = outcomePatterns.find((candidate) => candidate.pattern.test(commandText));
  if (!match) return null;
  return {
    type: "record_outcome",
    rawText,
    outcomeStatus: match.status,
    outcomeLabel: match.label,
  };
}

function outcomeLabelForStatus(status?: ApplicationStatus | null): string | undefined {
  switch (status) {
    case "replied":
      return "reply received";
    case "interview":
      return "interview booked";
    case "hired":
      return "hired";
    case "lost":
      return "lost";
    default:
      return undefined;
  }
}

function matchesSourceStrategyQuestion(text: string): boolean {
  return /\b(?:which|what)\s+(?:sources?|search(?:es)?|lead\s+sources?)\b.*\b(?:working|best|performing|wasting|worth|back\s*off|avoid|use|winning)\b/i.test(text) ||
    /\b(?:source|search)\s+strategy\b/i.test(text) ||
    /\bwhich\s+(?:sources?|search(?:es)?)\s+should\s+(?:we|you)\s+(?:use|keep|avoid|back\s*off)\b/i.test(text);
}

function matchesOperatorReportRequest(text: string): ParsedSlackSocketCommand["operatorReportKind"] | null {
  if (/\b(?:friday\s+(?:operator\s+)?(?:handoff|report)|weekly\s+(?:operator\s+)?(?:handoff|report)|operator\s+handoff)\b/i.test(text)) {
    return "friday";
  }
  if (/\b(?:monthly\s+(?:operator\s+)?(?:review|report)|month(?:ly)?\s+review)\b/i.test(text)) {
    return "monthly";
  }
  if (/\boperator\s+report\b/i.test(text)) {
    return "question";
  }
  return null;
}

export function parseSlackThreadCommand(text: string): ParsedSlackSocketCommand {
  const mentioned = hasSlackMention(text);
  const normalized = normalizeSlackTextInput(text).trim();
  const commandText = normalized.replace(/[.!?]+$/g, "").trim();
  const rememberMatch = commandText.match(/^(?:remember this|remember|learn this|save this):?\s+(.+)$/i);
  if (rememberMatch?.[1]?.trim()) {
    return {
      type: "memory_remember",
      rawText: normalized,
      instruction: rememberMatch[1].trim(),
      source: "fallback",
    };
  }
  const forgetMatch = commandText.match(/^(?:forget this|forget that|forget|archive that memory|remove that memory):?\s*(.*)$/i);
  if (forgetMatch) {
    return {
      type: "memory_forget",
      rawText: normalized,
      instruction: forgetMatch[1]?.trim() || "latest relevant memory",
      source: "fallback",
    };
  }
  const operatorReportKind = matchesOperatorReportRequest(commandText);
  if (operatorReportKind) {
    return {
      type: "operator_report",
      rawText: normalized,
      instruction: commandText,
      operatorReportKind,
      source: "fallback",
    };
  }
  if (matchesSourceStrategyQuestion(commandText)) {
    return {
      type: "source_strategy",
      rawText: normalized,
      instruction: commandText,
      source: "fallback",
    };
  }
  if (/\b(?:what did you learn|what have you learned|what patterns are working|what proof is working|what boost strategy is working|how many connects are we wasting|connects waste|wasting connects|why did you choose that|what would you do differently next time|what should mayor fix|what should codex fix|what improvement ideas do you have|what failed recently|what has failed recently)\b/i.test(commandText) ||
    /\bhow\s+should\s+(?:you|we)\s+(?:write|draft|open)\b.*\b(?:upwork\s+)?(?:proposal|proposals|cover\s*letter|cover\s*letters|cv)\b/i.test(commandText)) {
    return {
      type: "memory_query",
      rawText: normalized,
      instruction: commandText,
      source: "fallback",
    };
  }
  if (/^(?:debug blocker|debug blocked|blocker debug|blocked debug|debug browser blocker)$/i.test(commandText)) {
    return { type: "status", rawText: normalized, source: "fallback" };
  }
  const batchPrepMatch = commandText.match(/^(?:prep|prepare)\s+(?:the\s+)?(?:next\s+|strong(?:est)?\s+)?(\d{1,2})(?:\s+(?:applications?|apps?|drafts?|leads?|jobs?))?$/i);
  if (batchPrepMatch) {
    return {
      type: "batch_prep",
      rawText: normalized,
      batchTargetCount: Number.parseInt(batchPrepMatch[1] ?? "10", 10),
      source: "fallback",
    };
  }
  if (/^(?:prep|prepare)\s+(?:the\s+)?(?:strong|strongest|best|next)\s+(?:ones|applications?|apps?|drafts?|leads?|jobs?)$/i.test(commandText)) {
    return {
      type: "batch_prep",
      rawText: normalized,
      batchTargetCount: BROWSER_QA_MAX_PROTECTED_TABS,
      source: "fallback",
    };
  }
  if (/^(?:what(?:'|’)?s blocked|what is blocked|what needs unblocking|blocked\??)$/i.test(commandText)) {
    return { type: "qa_queue", rawText: normalized, qaQuery: "blocked", source: "fallback" };
  }
  const qaQueueMatch = /\b(?:what[’']?s ready|what is ready|what needs me|what needs my review|what needs review|show qa queue|qa queue|what is blocked|what[’']?s blocked|what needs unblocking)\b/i.test(commandText);
  if (qaQueueMatch) {
    return { type: "qa_queue", rawText: normalized, source: "fallback" };
  }
  if (/\b(?:keep hunting|continue hunting|keep looking|keep searching|keep going)\b/i.test(commandText)) {
    return { type: "discovery_keep_hunting", rawText: normalized, source: "fallback" };
  }
  if (/\b(?:try|retry)\b.*\b(?:search|searches|blocked search|blocked searches)\b/i.test(commandText)) {
    return { type: "discovery_retry_sources", rawText: normalized, source: "fallback" };
  }
  if (/\b(?:what got blocked|what is blocked|what's blocked|blocked search|blocked searches|which search|which searches)\b/i.test(commandText)) {
    return { type: "discovery_block_status", rawText: normalized, source: "fallback" };
  }
  if (/\b(?:stick to|use only|only use|best matches only|just use)\b.*\bbest matches\b/i.test(commandText)) {
    return { type: "discovery_best_matches_only", rawText: normalized, source: "fallback" };
  }
  if (/\b(?:i cleared chrome|chrome is clear|cleared chrome|remote browser is clear|browser is clear|done clearing chrome)\b/i.test(commandText)) {
    return { type: "discovery_clear_browser", rawText: normalized, source: "fallback" };
  }
  const focusApplicationIndexMatch = commandText.match(/^(?:open|bring up|show|focus)\s+(?:the\s+)?(?:application|app|draft)\s+(?:number\s+)?(?:(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)|#?(\d+))(?:\s+in\s+chrome)?$/i);
  const ordinalIndex: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  if (focusApplicationIndexMatch) {
    return {
      type: "focus_qa_tab",
      rawText: normalized,
      qaIndex: focusApplicationIndexMatch[1] ? ordinalIndex[focusApplicationIndexMatch[1].toLowerCase()] : Number.parseInt(focusApplicationIndexMatch[2] ?? "", 10),
      source: "fallback",
    };
  }
  const skipBatchIndexMatch = commandText.match(/^(?:skip|archive|drop)\s+(?:the\s+)?(?:application|app|draft|number)?\s*#?(\d+)$/i);
  if (skipBatchIndexMatch) {
    return {
      type: "skip_batch_item",
      rawText: normalized,
      qaIndex: Number.parseInt(skipBatchIndexMatch[1] ?? "", 10),
      source: "fallback",
    };
  }
  const submittedBatchIndexMatch = commandText.match(/^(?:(?:mark\s+)?(?:application|app|draft)\s+#?(\d+)\s+(?:submitted|sent)|(?:submitted|sent)\s+(?:application|app|draft)\s+#?(\d+))$/i);
  if (submittedBatchIndexMatch) {
    return {
      type: "mark_batch_submitted",
      rawText: normalized,
      qaIndex: Number.parseInt(submittedBatchIndexMatch[1] ?? submittedBatchIndexMatch[2] ?? "", 10),
      proposalVersionSource: "final_submitted",
      markSubmittedAfterCapture: true,
      source: "fallback",
    };
  }
  const focusIndexMatch = commandText.match(/^(?:open|bring up|show|focus|retry)\s+(?:the\s+)?(?:number\s+)?(?:(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)|#?(\d+))(?:\s+(?:one|application|draft|in chrome))?$/i);
  if (focusIndexMatch && !/^retry\b/i.test(commandText)) {
    return {
      type: "focus_qa_tab",
      rawText: normalized,
      qaIndex: focusIndexMatch[1] ? ordinalIndex[focusIndexMatch[1].toLowerCase()] : Number.parseInt(focusIndexMatch[2] ?? "", 10),
      source: "fallback",
    };
  }
  if (/^(?:focus|open|bring up|show)\s+(?:the\s+)?blocked\s+(?:page|application|draft)$/i.test(commandText)) {
    return { type: "focus_qa_tab", rawText: normalized, qaQuery: "blocked", source: "fallback" };
  }
  const focusThisMatch = /^(?:open this(?: in chrome)?|open this one(?: in chrome)?|bring this(?: one)? up|show me the application page|show the application page|open (?:the )?draft(?: in chrome)?|focus the draft|bring up the application page)$/i.test(commandText);
  if (focusThisMatch) {
    return { type: "focus_qa_tab", rawText: normalized, source: "fallback" };
  }
  const focusNamedMatch = commandText.match(/^(?:open|bring up|focus)\s+(.+?)(?:\s+(?:in chrome|application|application page|draft))?$/i) ??
    commandText.match(/^show\s+(.+?)\s+(?:application page|in chrome)$/i);
  if (focusNamedMatch && !matchesDraftPreviewIntent(commandText) && /\b(?:chrome|application|draft|shopify|klaviyo|qa)\b/i.test(commandText)) {
    return {
      type: "focus_qa_tab",
      rawText: normalized,
      qaQuery: focusNamedMatch[1]?.replace(/\b(?:the|application|page|draft|in chrome)\b/gi, "").trim(),
      source: "fallback",
    };
  }
  if (/\b(?:show|send|post|what'?s)\b.*\bfinal\s+submitted\s+version\b/i.test(commandText)) {
    return { type: "draft_preview", rawText: normalized, proposalVersionSource: "final_submitted", source: "fallback" };
  }
  if (/\b(?:what did you put in upwork|show(?: me)? what you put in upwork|show(?: me)? the upwork draft|cover\s*letter used|cv used)\b/i.test(commandText)) {
    return { type: "draft_preview", rawText: normalized, proposalVersionSource: "upwork_inserted", source: "fallback" };
  }
  if (matchesDraftPreviewIntent(normalized) || matchesDraftPreviewIntent(commandText)) {
    return { type: "draft_preview", rawText: normalized, source: "fallback" };
  }
  const statusMatch = /^(status)$/i.test(normalized) ||
    /\b(details|show details|show proof|show draft|which skills|skills did you use|skill trace|skill-use trace|why\b|why did you pick|why pick|what are the red flags|red flags|risks|what'?s the deal here|what is the deal here|what still needs manual review|what needs manual review|what is missing|what still needs|manual review)\b/i.test(normalized);
  if (statusMatch) return { type: "status", rawText: normalized };

  if (/^(approve)$/i.test(commandText)) return { type: "approve", rawText: normalized };
  if (/^(?:(?:nah|no|nope),?\s+)?(?:reject|skip|skip this one|pass|decline|close this|close this one|archive this|archive this one)$/i.test(commandText)) return { type: "reject", rawText: normalized };

  if (looksLikeProofPlanRevision(normalized)) {
    return {
      type: "proof_revision",
      rawText: normalized,
      instruction: normalized,
      source: "fallback",
    };
  }

  if (matchesApprovePrepareIntent(commandText, mentioned) || matchesApprovePrepareIntent(normalized, mentioned)) {
    if (matchesNegatedPrepareIntent(commandText) || matchesNegatedPrepareIntent(normalized)) {
      return { type: "clarify", rawText: normalized, source: "fallback" };
    }
    if (/\b(?:use this|put it in upwork|put this in upwork|fill it in upwork|fill this in upwork)\b/i.test(commandText)) {
      return { type: "approve_prepare", rawText: normalized, source: "fallback" };
    }
  }

  const reviseMatch = normalized.match(/^revise\s*:\s*(.+)$/i) ??
    normalized.match(/^(make|use|lower|raise|remove|rewrite|change|edit|adjust|update)\b\s*(.+)$/i);
  if (reviseMatch) {
    return {
      type: "revise",
      rawText: normalized,
      instruction: (reviseMatch[2] ?? reviseMatch[1])?.trim() || "",
    };
  }

  if (
    /^(prepare\s+draft|prepare\s+application|prepare\s+proposal)$/i.test(commandText)
  ) {
    return { type: "prepare_draft", rawText: normalized };
  }

  if (matchesApprovePrepareIntent(commandText, mentioned) || matchesApprovePrepareIntent(normalized, mentioned)) {
    if (matchesNegatedPrepareIntent(commandText) || matchesNegatedPrepareIntent(normalized)) {
      return { type: "clarify", rawText: normalized, source: "fallback" };
    }
    return { type: "approve_prepare", rawText: normalized, source: "fallback" };
  }

  if (/\b(?:do\s+not|don't|cant|can't|cannot|not)\s+see\b.*\b(?:cover\s*letter|filled|attached|file|portfolio|proof|highlight|rate|boost|connects)\b/i.test(normalized) ||
    /\b(?:cover\s*letter|field|answer|attachment|file|portfolio|proof|highlight|rate|boost)\b.*\b(?:empty|blank|missing|not\s+filled|not\s+there|not\s+attached|not\s+selected|not\s+set)\b/i.test(normalized) ||
    /\bit['’]?s\s+(?:empty|blank|not\s+filled)\b/i.test(normalized)) {
    return { type: "prep_issue_report", rawText: normalized, source: "fallback" };
  }

  if (/\b(?:i edited it|i edited the draft|re-?read the draft|re-?read the application|re-?read the cover\s*letter|save this version|learn from this version|this is the final version|save the current version)\b/i.test(normalized)) {
    return {
      type: "reread_application",
      rawText: normalized,
      proposalVersionSource: "human_edit_reread",
      source: "fallback",
    };
  }

  const retryMatch = commandText.match(/^retry(?:\s+(?:preparation|prep))?(?:\s+(\d+))?$/i);
  if (retryMatch) {
    return {
      type: "retry_action",
      rawText: normalized,
      actionId: retryMatch[1] ? Number.parseInt(retryMatch[1], 10) : undefined,
    };
  }
  if (/^(?:retry\s+capture|recapture|re-capture|capture\s+again|retry\s+the\s+capture)$/i.test(commandText)) {
    return { type: "retry_capture", rawText: normalized, source: "fallback" };
  }

  if (/^(?:mark\s+submitted|submitted|i\s+sent\s+it|sent\s+it|i\s+submitted\s+it|it'?s\s+submitted|it\s+is\s+submitted|submitted\s+after\s+editing)$/i.test(commandText)) {
    return {
      type: "mark_submitted",
      rawText: normalized,
      proposalVersionSource: "final_submitted",
      markSubmittedAfterCapture: true,
    };
  }

  const outcomeCommand = parseOutcomeCommand(commandText, normalized);
  if (outcomeCommand) return outcomeCommand;

  return { type: "unknown", rawText: normalized };
}

function commandFromBrainDecision(text: string, decision: SlackThreadBrainDecision): ParsedSlackSocketCommand {
  const type = decision.intent === "approve_prepare" ? "approve_prepare" : decision.intent;
  const outcomeStatus = type === "record_outcome" ? decision.outcomeStatus ?? undefined : undefined;
  return {
    type,
    rawText: normalizeSlackTextInput(text),
    instruction: decision.instruction ?? undefined,
    actionId: decision.actionId ?? undefined,
    confidence: decision.confidence,
    replyText: decision.replyText ?? undefined,
    source: "llm",
    outcomeStatus,
    outcomeLabel: outcomeLabelForStatus(outcomeStatus),
  };
}

async function resolveSlackThreadCommand(input: {
  channelId: string;
  threadTs: string;
  text: string;
  state: ReturnType<typeof getSlackThreadStateByThreadTs>;
  provider?: SlackThreadBrainProvider;
}): Promise<ParsedSlackSocketCommand> {
  const fallback = parseSlackThreadCommand(input.text);
  if (fallback.type === "prep_issue_report" || fallback.type === "record_outcome" || fallback.type === "draft_preview" || fallback.type === "proof_revision") {
    return { ...fallback, source: "fallback" };
  }

  const llm = await classifySlackThreadWithLlm({
    text: input.text,
    botMentioned: hasSlackMention(input.text),
    threadMapped: Boolean(input.state),
    jobId: input.state?.jobId ?? null,
    upworkUrl: input.state?.upworkUrl ?? null,
    threadStatus: input.state?.status ?? null,
  }, input.provider);

  if (llm.ok && llm.decision.intent !== "ignore" && llm.decision.confidence !== "low") {
    return commandFromBrainDecision(input.text, llm.decision);
  }
  if (llm.ok && llm.decision.intent === "ignore") {
    return commandFromBrainDecision(input.text, llm.decision);
  }

  return { ...fallback, source: "fallback" };
}

export interface SlackSocketStartupConfig {
  socketEnabled: boolean;
  botToken: string;
  appToken: string;
}

export function buildSlackSocketStartupError(config: SlackSocketStartupConfig): string | null {
  if (!config.socketEnabled) {
    return "Set SLACK_SOCKET_MODE_ENABLED=true before running npm run slack:socket.";
  }
  if (!config.botToken || !config.appToken) {
    return "Missing Slack Socket Mode credentials: set SLACK_BOT_TOKEN and SLACK_APP_TOKEN.\nDo not print token values.";
  }
  return null;
}

export function getSlackSocketStartupError(): string | null {
  return buildSlackSocketStartupError({
    socketEnabled: SLACK_SOCKET_MODE_ENABLED,
    botToken: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
  });
}

function isAllowedChannel(channelId: string): boolean {
  if (SLACK_ALLOWED_CHANNEL_IDS.length === 0) {
    return true;
  }
  return SLACK_ALLOWED_CHANNEL_IDS.includes(channelId);
}

function isAllowedUser(userId: string | null | undefined): boolean {
  if (SLACK_ALLOWED_USER_IDS.length === 0) {
    return true;
  }
  return Boolean(userId && SLACK_ALLOWED_USER_IDS.includes(userId));
}

function isSlackDmEvent(event: SlackSocketTextEvent): boolean {
  return event.channel_type === "im" || event.channel.startsWith("D");
}

function isAmbientAgentChannel(channelId: string): boolean {
  return SLACK_AGENT_AMBIENT_CHANNEL_IDS.includes(channelId);
}

function stripSlackBotMentions(value: string): string {
  return normalizeSlackTextInput(value);
}

interface SlackPromptAdmission {
  prompt: boolean;
  mode?: "dm" | "bot_owned_thread" | "claimed_thread" | "ambient_agent_channel";
  ownedConversation?: boolean;
  reason: string;
}

function registerSlackPromptOwnership(input: {
  channelId: string;
  rootTs: string;
  mode: "dm" | "bot_owned_thread" | "claimed_thread" | "ambient_agent_channel";
  userId?: string | null;
  state?: SlackThreadStateRecord;
  activeCta?: SlackActiveCta | null;
  upworkUrl?: ParsedUpworkUrl | null;
}): void {
  upsertSlackConversationOwnership({
    channelId: input.channelId,
    rootTs: input.rootTs,
    mode: input.mode,
    ownerUserId: input.userId ?? null,
    rootJobUrl: input.state?.upworkUrl ?? input.upworkUrl?.canonicalJobUrl ?? null,
    applicationId: input.state?.jobId ?? input.upworkUrl?.jobId ?? null,
    latestBotCta: input.activeCta?.text ?? null,
    pendingAction: input.activeCta?.action && input.activeCta.action !== "none" ? input.activeCta.action : null,
    activeTarget: input.state?.jobId ?? input.upworkUrl?.canonicalJobUrl ?? null,
    disabled: false,
    closed: false,
  });
}

function shouldTreatAsPrompt(input: {
  event: SlackSocketTextEvent;
  text: string;
  threadTs: string;
  state: SlackThreadStateRecord;
  botMentioned: boolean;
}): SlackPromptAdmission {
  const { event, state, botMentioned } = input;
  const ownership = getSlackConversationOwnership(event.channel, input.threadTs);
  if (ownership && !ownership.disabled && !ownership.closed) {
    return {
      prompt: true,
      mode: ownership.mode,
      ownedConversation: true,
      reason: `owned_${ownership.mode}`,
    };
  }
  if (state) {
    return {
      prompt: true,
      mode: "bot_owned_thread",
      ownedConversation: true,
      reason: "mapped_slack_thread_state",
    };
  }
  if (isSlackDmEvent(event)) {
    return {
      prompt: true,
      mode: "dm",
      ownedConversation: true,
      reason: "dm_with_bot",
    };
  }
  if (isAmbientAgentChannel(event.channel)) {
    return {
      prompt: true,
      mode: "ambient_agent_channel",
      ownedConversation: true,
      reason: "ambient_agent_channel",
    };
  }
  if (botMentioned) {
    return {
      prompt: true,
      mode: "claimed_thread",
      ownedConversation: true,
      reason: "mention_claimed_thread",
    };
  }
  return { prompt: false, ownedConversation: false, reason: "unowned_unmentioned_channel_message" };
}

function statusLabel(status?: string | null): string {
  if (!status) return "unknown";
  return status;
}

function cleanRevisionInstruction(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildDeterministicProposalRevision(currentText: string, instruction: string): string {
  const current = currentText.trim();
  const cleanInstruction = cleanRevisionInstruction(instruction);
  if (!cleanInstruction) return current;

  const paragraphs = current.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const nextParagraphs = paragraphs.length > 0 ? [...paragraphs] : [current];
  let changed = false;

  if (/(opener|opening|first line|first sentence|lead\b)/i.test(cleanInstruction) && /(direct|clear|short|tight|strong)/i.test(cleanInstruction)) {
    nextParagraphs[0] = "I can help tighten this by focusing first on the highest-leverage retention work, then turning it into clear Klaviyo/SMS execution.";
    changed = true;
  }

  const addMatch = cleanInstruction.match(/\b(?:add|include|mention)\s+(.+)$/i);
  if (addMatch?.[1]) {
    nextParagraphs.push(`I would also address ${addMatch[1].replace(/[.]+$/g, "").trim()}.`);
    changed = true;
  }

  if (!changed) {
    nextParagraphs.push(`Revision guidance applied: ${cleanInstruction}.`);
  }

  return nextParagraphs.join("\n\n");
}

function describeQueuedBrowserDraft(jobId: string): string {
  const activeDraftActions = listBrowserActions(null, 1000)
    .filter((action) =>
      action.jobId === jobId &&
      action.actionType === "prepare_application_review" &&
      !["cancelled", "failed"].includes(action.status)
    );

  if (activeDraftActions.length === 0) {
    return "Browser draft status: no browser draft has been queued yet.";
  }

  const latest = activeDraftActions[activeDraftActions.length - 1];
  return `Browser draft needs update: yes - current browser prep is ${latest.status}. Re-run prepare draft after reviewing this revision.`;
}

function buildThreadStatusDetails(state: NonNullable<ReturnType<typeof getSlackThreadStateByThreadTs>>): string[] {
  if (!state.jobId) return [];
  const job = getScoredJobForSlackPreview(state.jobId);
  const draft = getApplicationDraft(state.jobId);
  const profileContext = job ? buildProposalContextPack(job) : null;
  const latestActions = listBrowserActions(null, 1000)
    .filter((action) => action.jobId === state.jobId)
    .slice(-3)
    .map((action) => `#${action.id} ${action.actionType} ${action.status}${action.lastError ? ` (${action.lastError})` : ""}`);
  const blockedActions = listBrowserActions(null, 1000)
    .filter((action) =>
      action.jobId === state.jobId &&
      (action.status === "paused" || action.status === "failed") &&
      actionHasPausedChallengeQuarantine(action)
    )
    .slice(-5)
    .map((action) => `#${action.id} ${action.actionType} ${action.status}${action.lastError ? ` (${action.lastError})` : ""}`);
  const strategy = draft?.connectsStrategy ?? job?.scoreBreakdown.connectsStrategy;
  const skillTrace = draft?.skillUseTrace;
  const skillsUsed = skillTrace?.selectedSkills.map((skill) => `${skill.stage}:${skill.name}`).join("; ");
  return [
    job ? `Fit: ${job.score}/100 (${job.matchLevel})` : null,
    job?.scoreBreakdown.reasons.length ? `Why picked: ${job.scoreBreakdown.reasons.slice(0, 5).join("; ")}` : null,
    job?.scoreBreakdown.risks.length ? `Red flags/risks: ${job.scoreBreakdown.risks.slice(0, 5).join("; ")}` : "Red flags/risks: none recorded",
    strategy ? `Connects: ${formatConnectsStrategy(strategy)}` : "Connects: not calculated",
    draft ? `Draft: ${draft.status}, v${(draft as { proposalVersion?: number }).proposalVersion ?? "stored"}, ${draft.proposalText.length} chars` : "Draft: missing",
    skillTrace ? `Skills used: ${skillsUsed}` : "Skills used: missing trace",
    skillTrace ? `Skill gate: browserFillAllowed=${skillTrace.browserFillAllowed}; qualityGateReady=${skillTrace.qualityGateReady}; captureConfidence=${skillTrace.captureConfidence}; brandResearch=${skillTrace.brandResearchProvider}; sources=${skillTrace.brandResearchSourceCount}` : null,
    draft?.brandFactPack ? `Brand fact pack: ${draft.brandFactPack.researchSummary}` : null,
    draft?.copyStrategy ? `Copy strategy: ${draft.copyStrategy.one_sentence_sales_argument}` : null,
    draft?.proofStrategy ? `Proof strategy: ${draft.proofStrategy.summary}` : null,
    draft?.proposalText ? `Draft preview: ${draft.proposalText.replace(/\s+/g, " ").trim().slice(0, 900)}` : null,
    profileContext?.selectedAttachments.length ? `Proof selected: ${profileContext.selectedAttachments.join(", ")}` : null,
    profileContext?.selectedProofPoints.length ? `Proof points: ${profileContext.selectedProofPoints.slice(0, 5).join("; ")}` : null,
    draft?.selectedPortfolioItems.length ? `Selected portfolio: ${draft.selectedPortfolioItems.map((item) => item.name).join(", ")}` : "Selected portfolio: none",
    blockedActions.length ? `Blocked browser actions: ${blockedActions.join(" | ")}` : null,
    latestActions.length ? `Browser actions: ${latestActions.join(" | ")}` : "Browser actions: none",
  ].filter((line): line is string => Boolean(line));
}

function latestBrowserActionForThreadState(state: NonNullable<ReturnType<typeof getSlackThreadStateByThreadTs>>) {
  const jobIds = new Set<string>();
  if (state.jobId) jobIds.add(state.jobId);
  const parsedUpworkJobId = extractUpworkJobIdFromUrl(state.upworkUrl);
  if (state.upworkUrl) jobIds.add(deriveCaptureThreadJobId(state.upworkUrl, parsedUpworkJobId));
  return listBrowserActions(null, 1000).filter((action) => jobIds.has(action.jobId)).slice(-1)[0] ?? null;
}

function isDebugStatusRequest(value: string): boolean {
  return /\b(debug|details|technical details|raw status|full details|dump|which skills|skills did you use|skill trace|skill-use trace)\b/i.test(value);
}

function isDiscoveryHuntingCommand(type: SlackSocketParsedCommandType): boolean {
  return type === "discovery_keep_hunting" ||
    type === "discovery_retry_sources" ||
    type === "discovery_best_matches_only" ||
    type === "discovery_block_status" ||
    type === "discovery_clear_browser";
}

async function handleDiscoveryHuntingCommand(params: {
  command: ParsedSlackSocketCommand;
  text: string;
  channelId: string;
  threadTs: string;
  client: App["client"];
  copyProvider?: SlackCopyProvider;
}): Promise<void> {
  if (params.command.type === "discovery_block_status") {
    const debugRequested = isDebugStatusRequest(params.text);
    const deterministicText = formatDiscoverySourceHealthForSlack({ debug: debugRequested });
    const text = debugRequested
      ? deterministicText
      : await userFacingSlackCopy({
        deterministicText,
        userMessage: params.text,
        intent: "discovery_block_status",
        copyProvider: params.copyProvider,
      });
    await postThreadReply(params.client, params.channelId, params.threadTs, text, debugRequested ? {
      inboundMessage: params.text,
      classifiedIntent: "discovery_block_status_debug",
      executionPath: "slackSocket:discovery_block_status_debug",
      handler: "slackSocket:discovery_block_status_debug",
      debugOrSystemOnly: true,
    } : undefined);
    return;
  }

  if (params.command.type === "discovery_keep_hunting") {
    const text = await userFacingSlackCopy({
      deterministicText: "I’ll keep hunting from the safer feed. If Upwork checks one search page, I’m leaving that one alone for now.",
      userMessage: params.text,
      intent: "discovery_keep_hunting",
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (params.command.type === "discovery_best_matches_only") {
    pauseDiscoverySources(buildConfiguredDiscoverySources(), {
      exceptSourceTypes: ["best_matches"],
      reason: "operator_requested_best_matches_only",
    });
    const text = await userFacingSlackCopy({
      deterministicText: "I’ll stick to Best Matches for now and leave the other searches alone.",
      userMessage: params.text,
      intent: "discovery_best_matches_only",
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (params.command.type === "discovery_clear_browser") {
    clearPausedDiscoverySourceHealth();
    const session = getBrowserSessionStatus();
    if (session.blocked) {
      clearBrowserManualAttention();
    }
    const text = await userFacingSlackCopy({
      deterministicText: "Got it — I’ll try the blocked search again and keep hunting. Chrome itself is clear, and final submit remains manual.",
      userMessage: params.text,
      intent: "discovery_clear_browser",
      preservePhrases: ["final submit remains manual"],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  clearPausedDiscoverySourceHealth();
  const text = await userFacingSlackCopy({
    deterministicText: "I’ll try the searches again and keep hunting from Best Matches if one checks out.",
    userMessage: params.text,
    intent: "discovery_retry_sources",
    copyProvider: params.copyProvider,
  });
  await postThreadReply(params.client, params.channelId, params.threadTs, text);
}

function buildShortStatusReply(state: NonNullable<ReturnType<typeof getSlackThreadStateByThreadTs>>): string {
  if (!state.jobId) {
    return "I have the listing URL, but I do not have a parsed job id yet. Send the Upwork listing link again and I’ll pick it up.";
  }
  const job = getScoredJobForSlackPreview(state.jobId);
  const draft = getApplicationDraft(state.jobId);
  const plan = buildBrowserApplyPlan(state.jobId).plan;
  const missing = plan?.missingLocalAssets.map((item) => item.split(/[\\/]/).pop() ?? item) ?? [];
  const connects = plan?.connects.required === null
    ? "Connects unknown"
    : `${plan?.connects.required ?? "unknown"} required${plan?.connects.boost ? `, ${plan.connects.boost} boost` : ", no boost"}`;
  const next = missing.length > 0
    ? `Attach ${missing.slice(0, 3).join(", ")} here and I’ll ingest them.`
    : draft?.proposalText
      ? "Say “put it in Upwork” when you want me to fill remote Chrome."
      : "I still need a generated draft before I can prep Upwork.";
  return `${job?.title ?? state.jobId}: ${draft?.proposalText ? "draft ready" : "draft not ready"}; ${connects}; ${missing.length} missing file${missing.length === 1 ? "" : "s"}. ${next}`;
}

function humanApplicationLabel(jobId: string | null | undefined): string {
  if (!jobId) return "this application";
  const job = getScoredJobForSlackPreview(jobId);
  return job?.title?.trim() || "this application";
}

type SlackThreadStateRecord = ReturnType<typeof getSlackThreadStateByThreadTs>;
type SlackActiveCta = NonNullable<SlackConversationBrainInput["activeCta"]>;

function deriveSlackActiveCta(state: SlackThreadStateRecord): SlackActiveCta | null {
  if (!state?.jobId) return null;
  const draft = getApplicationDraft(state.jobId);
  const hasDraft = Boolean(draft?.proposalText.trim());
  switch (state.status) {
    case "packet_sent":
    case "scored":
    case "captured":
      return hasDraft
        ? {
          action: "prep_application",
          source: "latest_bot_cta",
          text: "Reply \"prep it\" if you want me to handle the draft and proof.",
        }
        : null;
    case "draft_preview_sent":
      return {
        action: "prep_application",
        source: "latest_bot_cta",
        text: "Reply \"use this\", \"looks good\", or \"put it in Upwork\" when you want me to fill the remote Chrome apply page.",
      };
    case "retry_requested":
      return {
        action: "retry",
        source: "thread_status",
        text: "Reply \"retry\" after the visible browser check is cleared.",
      };
    default:
      return null;
  }
}

function threadHistoryForBrain(activeCta: SlackActiveCta | null): SlackConversationBrainInput["threadHistory"] {
  if (!activeCta?.text) return [];
  return [{ role: "assistant", text: activeCta.text }];
}

function previousCorrectionsForBrain(state: SlackThreadStateRecord): NonNullable<SlackConversationBrainInput["previousCorrections"]> {
  const corrections = listRecentSlackFailureReflections(25).filter((reflection) => {
    if (state?.channelId && reflection.channelId === state.channelId) return true;
    if (state?.threadTs && reflection.threadTs === state.threadTs) return true;
    if (state?.jobId && reflection.jobId === state.jobId) return true;
    return /\b(?:no,?\s+i meant|not that|wrong|correction|wtf|what the fuck)\b/i.test(reflection.userMessage);
  });
  return corrections.slice(0, 5).map((reflection) => ({
    userMessage: reflection.userMessage,
    whatHappened: reflection.whatHappened,
    nextBehavior: reflection.nextBehavior,
  }));
}

function matchesVagueAffirmative(text: string): boolean {
  const normalized = normalizeSlackTextInput(text)
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim();
  return /^(?:yes|yep|yeah|yup|sure|sure thing|ok|okay|go for it|do it|sounds good|move on it|let'?s run it|handle it|prep it|go ahead)(?:\s+please)?$/.test(normalized) ||
    /^(?:yes|yep|yeah|yup|sure|ok|okay),?\s+(?:go for it|do it|sounds good|move on it|let'?s run it|handle it|prep it|go ahead)$/.test(normalized) ||
    /\b(?:go for it|sounds good|move on it|let'?s run it|handle it|prep it|go ahead)\b/.test(normalized);
}

function matchesPrepCorrectionIntent(text: string): boolean {
  const normalized = normalizeSlackTextInput(text).toLowerCase();
  return /\b(?:no|nope|not that|i meant|meant|instead)\b.*\b(?:prep|prepare|put (?:it|this) in upwork|fill (?:it|this) in upwork|open the app|open the application)\b/.test(normalized);
}

function matchesDangerousSubmitAdjacent(text: string): boolean {
  const normalized = normalizeSlackTextInput(text)
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim();
  if (/^(?:i|we)\s+(?:sent|submitted)\b/.test(normalized)) return false;
  if (/^submitted(?:\s+after\s+editing)?$/.test(normalized)) return false;
  return /^(?:send it|submit it|fire it off|send this|submit this|send the proposal|submit the proposal|send application|submit application|send the application|submit the application)$/.test(normalized) ||
    /\b(?:please\s+)?(?:send|submit)\s+(?:it|this|the\s+(?:proposal|application))\b/.test(normalized) ||
    /\bfire\s+(?:it|this)\s+off\b/.test(normalized) ||
    /\bcan\s+(?:you|we)\b.*\b(?:send|submit)\b.*\b(?:automatically|auto|on\s+your\s+own|without\s+(?:me|steve|manual|human))\b/.test(normalized);
}

function buildManualSubmitReminderText(state: SlackThreadStateRecord): string {
  const label = humanApplicationLabel(state?.jobId);
  return `I can prep or review ${label}, but final submit stays manual. I will not click the final Upwork submit button; tell me “prep it” if you want the safe fields filled and held for your review.`;
}

function matchesCompositeBlockedAttentionStatusIntent(text: string): boolean {
  const normalized = normalizeSlackTextInput(text).replace(/[.!?]+$/g, "").trim().toLowerCase();
  return /\bblocked\b/.test(normalized) &&
    /\b(?:needs? attention|waiting on me|needs? me|what needs|attention)\b/.test(normalized);
}

function buildCompositeBlockedAttentionStatusText(): string {
  return [
    "Blocked:",
    buildBlockedApplicationsStatusText("blocked"),
    "",
    "Needs attention:",
    buildBlockedApplicationsStatusText("attention"),
  ].join("\n");
}

function matchesNaturalStatusIntent(text: string): boolean {
  const normalized = normalizeSlackTextInput(text).replace(/[.!?]+$/g, "").trim().toLowerCase();
  return /^(?:what the fuck are you up to|wtf are you up to|what are you up to|are we live|are you live|you running|are you running|are you active|you active|are you alive|you alive|you there|talk to me|what(?:'|’)?s happening|where are we|are we good|how(?:'|’)?s it going|how is your day going|can you help me|can you help me with something|i need a reply please|need a reply please|what(?:'|’)?s waiting on me|what is waiting on me|what needs me now)$/.test(normalized);
}

function activeCtaApprovesPrep(text: string, activeCta: SlackActiveCta | null): boolean {
  if (matchesDraftPreviewIntent(text)) return false;
  return activeCta?.action === "prep_application" &&
    (matchesVagueAffirmative(text) || matchesPrepCorrectionIntent(text) || matchesApprovePrepareIntent(text, hasSlackMention(text)));
}

function matchesApplicationProceedIntent(text: string): boolean {
  const normalized = normalizeSlackTextInput(text).replace(/[.!?]+$/g, "").trim().toLowerCase();
  return matchesApprovePrepareIntent(normalized, hasSlackMention(text)) ||
    /^(?:please\s+)?(?:proceed|move forward|go ahead|prep one|start with one application|do the next one|handle an app now|handle one app|handle one application)(?:\s+(?:with|on))?(?:\s+(?:the|one|next|applications?|apps?|application prep|prep))?$/.test(normalized);
}

function buildApplicationProceedClarificationText(): string {
  const qaItems = getProtectedQaQueueItems(1000);
  if (qaItems.length > 0) {
    const ready = qaItems.filter((item) => item.state === "ready").length;
    const blocked = qaItems.filter((item) => item.state === "blocked").length;
    return [
      `I can help. I see ${qaItems.length} QA application${qaItems.length === 1 ? "" : "s"} waiting (${ready} ready, ${blocked} blocked).`,
      "Do you want me to open/focus the waiting QA item, or prep one controlled application from the strongest queued lead?",
      "Final submit stays manual.",
    ].join("\n");
  }
  return "I can’t find the job tied to this thread. Do you want me to prep one controlled application from the strongest queued lead, or do you want to send a job URL?";
}

function buildUnknownHumanPromptReply(): string {
  return [
    "I’m here, but I’m not sure what you mean yet.",
    "I can check status, show what’s waiting, prep one controlled application from a job URL, or open a QA item.",
    "Final submit stays manual.",
  ].join("\n");
}

function buildConversationPlanForThread(input: {
  state: NonNullable<ReturnType<typeof getSlackThreadStateByThreadTs>>;
  text: string;
  hasSlackFiles?: boolean;
}): SlackConversationPlan {
  const job = input.state.jobId ? getScoredJobForSlackPreview(input.state.jobId) : null;
  const draft = input.state.jobId ? getApplicationDraft(input.state.jobId) : null;
  const applyPlan = input.state.jobId ? buildBrowserApplyPlan(input.state.jobId).plan : null;
  const latestAction = latestBrowserActionForThreadState(input.state);
  return planSlackConversation({
    threadTs: input.state.threadTs,
    latestMessage: input.text,
    threadHistory: [],
    activeCta: deriveSlackActiveCta(input.state),
    job,
    draft,
    currentBrowserAction: latestAction,
    missingFiles: applyPlan?.missingLocalAssets ?? [],
    proofPlan: {
      files: applyPlan?.attachments.map((attachment) => attachment.filePath) ?? [],
      portfolioHighlights: applyPlan?.profileHighlights ?? [],
      certificates: [],
      mentionOnly: applyPlan?.mentionOnlyProof ?? [],
      unavailableOnPage: false,
    },
    connects: {
      required: applyPlan?.connects.required ?? draft?.connectsStrategy?.requiredConnects ?? null,
      boost: applyPlan?.connects.boost ?? draft?.connectsStrategy?.suggestedBoostConnects ?? null,
      total: applyPlan?.connects.total ?? draft?.connectsStrategy?.totalConnects ?? null,
      boostReason: applyPlan?.connects.notes.find((note) => /boost/i.test(note)) ?? null,
    },
    hasSlackFiles: Boolean(input.hasSlackFiles),
  });
}

function compactBrainText(value: string | null | undefined, limit = 1800): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

function buildSlackConversationBrainInput(input: {
  state: ReturnType<typeof getSlackThreadStateByThreadTs>;
  text: string;
  hasSlackFiles?: boolean;
  botMentioned?: boolean;
  upworkUrl?: ParsedUpworkUrl | null;
  allowedUser?: boolean;
  allowedChannel?: boolean;
}): SlackConversationBrainInput {
  const state = input.state;
  const job = state?.jobId ? getScoredJobForSlackPreview(state.jobId) : null;
  const draft = state?.jobId ? getApplicationDraft(state.jobId) : null;
  const applicationStatus = state?.jobId ? getApplicationStatus(state.jobId) : null;
  const applyPlan = state?.jobId ? buildBrowserApplyPlan(state.jobId).plan : null;
  const latestAction = state ? latestBrowserActionForThreadState(state) : null;
  const qaQueue = getProtectedQaQueueItems(1000).map((item) => ({
    index: item.index,
    title: item.title,
    state: item.state,
    proof: item.proof,
    files: item.files,
    connects: item.connects,
    boost: item.boost,
    nextAction: item.nextAction,
  }));
  const behaviorMemories = listActiveSlackBehaviorMemories(25).map((memory) => ({
    type: memory.type,
    rule: memory.rule,
    scope: memory.scope,
    confidence: memory.confidence,
  }));
  const salesLearning = buildSalesLearningPromptContext({
    jobId: state?.jobId ?? null,
    job,
    text: input.text,
    limit: 8,
  });
  const proofVerified = Boolean(latestAction?.status === "completed" && applicationStatus === "prepared_for_qa");
  const activeCta = deriveSlackActiveCta(state);
  return {
    latestUserMessage: input.text,
    threadHistory: threadHistoryForBrain(activeCta),
    thread: state ? {
      channelId: state.channelId,
      threadTs: state.threadTs,
      status: state.status,
      jobId: state.jobId,
      upworkUrl: state.upworkUrl,
    } : null,
    job: job ? {
      id: job.id,
      title: job.title,
      url: job.url,
      score: job.score,
      matchLevel: job.matchLevel,
      reasons: job.scoreBreakdown.reasons.slice(0, 5),
      risks: job.scoreBreakdown.risks.slice(0, 5),
    } : null,
    application: { status: applicationStatus },
    draft: {
      exists: Boolean(draft?.proposalText.trim()),
      status: draft?.status ?? null,
      proposalText: compactBrainText(draft?.proposalText),
      proposalVersion: (draft as { proposalVersion?: number } | null)?.proposalVersion ?? null,
    },
    proof: {
      files: applyPlan?.attachments.map((attachment) => attachment.filePath) ?? [],
      portfolioHighlights: applyPlan?.profileHighlights ?? [],
      certificates: [],
      mentionOnly: applyPlan?.mentionOnlyProof ?? [],
      verified: proofVerified,
      missingFiles: applyPlan?.missingLocalAssets ?? [],
    },
    connects: {
      required: applyPlan?.connects.required ?? draft?.connectsStrategy?.requiredConnects ?? null,
      boost: applyPlan?.connects.boost ?? draft?.connectsStrategy?.suggestedBoostConnects ?? null,
      total: applyPlan?.connects.total ?? draft?.connectsStrategy?.totalConnects ?? null,
    },
    browserAction: latestAction ? {
      actionType: latestAction.actionType,
      status: latestAction.status,
      retryable: latestAction.status === "paused" || latestAction.status === "failed",
      lastError: latestAction.lastError,
    } : null,
    browserSession: (() => {
      const session = getBrowserSessionStatus();
      return {
        state: session.state,
        blocked: Boolean(session.blocked),
        reason: session.reason,
      };
    })(),
    activeCta,
    serviceState: {
      slackListening: true,
      leadEngine: null,
      huntingPaused: null,
      healthSummary: null,
    },
    inbound: {
      botMentioned: Boolean(input.botMentioned),
      hasSlackFiles: Boolean(input.hasSlackFiles),
      upworkUrl: input.upworkUrl?.canonicalJobUrl ?? null,
      allowedUser: input.allowedUser ?? true,
      allowedChannel: input.allowedChannel ?? true,
    },
    qaQueue,
    behaviorMemories,
    previousCorrections: previousCorrectionsForBrain(state),
    salesLearning,
    allowedActions: SLACK_CONVERSATION_ALLOWED_ACTIONS,
    hardSafetyRules: SLACK_CONVERSATION_HARD_SAFETY_RULES,
  };
}

function learnFromSlackMessage(input: {
  channelId: string;
  threadTs: string;
  text: string;
  state: ReturnType<typeof getSlackThreadStateByThreadTs>;
}): void {
  const text = normalizeSlackTextInput(input.text);
  const lower = text.toLowerCase();
  const base = {
    threadChannelId: input.channelId,
    threadTs: input.threadTs,
    jobId: input.state?.jobId ?? null,
    source: "slack_message",
    confidence: "high" as const,
  };
  if (/\bcv\b/.test(lower) && /\b(show|send|post|need|used|draft|proposal|cover|wtf|what the fuck|just need)\b/.test(lower)) {
    upsertSlackBehaviorMemory({
      ...base,
      type: "operator_preference",
      rule: "When Steve says CV in an Upwork Slack thread, interpret it as the cover letter/proposal draft and show the draft or explain that no draft exists.",
      metadata: { trigger: "cv_cover_letter" },
    });
  }
  if (/\b(everything that needs to be done|do everything|handle everything|all safe prep)\b/.test(lower)) {
    upsertSlackBehaviorMemory({
      ...base,
      type: "operator_preference",
      rule: "When Steve says everything that needs to be done, treat it as approval for full safe prep: draft, files, proof, portfolio, Connects, and boost, but stop before submit.",
      metadata: { trigger: "full_safe_prep" },
    });
  }
  if (/^retry\b/.test(lower)) {
    upsertSlackBehaviorMemory({
      ...base,
      type: "retry_rule",
      rule: "When Steve says retry in a blocker thread, find the most recent paused or failed browser action for that Slack thread; do not require raw action ids.",
      metadata: { trigger: "thread_retry" },
    });
  }
  if (/\b(can|could|are you able to|would you be able to)\b.*\b(upload|attach|use)\b.*\b(file|files|pdf|pdfs|asset|assets)\b/.test(lower)) {
    upsertSlackBehaviorMemory({
      ...base,
      type: "failed_intent",
      rule: "Answer Slack file upload capability questions directly with reusable proof assets, Slack file intake requirements, and the next safe action; never show a command menu.",
      metadata: { trigger: "file_capability_question" },
    });
  }
  if (/\bproof i used\b/.test(lower) || /\bproof planned\b/.test(lower) || /\bproof verified\b/.test(lower)) {
    upsertSlackBehaviorMemory({
      ...base,
      type: "proof_preference",
      rule: "Use Proof planned until remote Chrome verifies uploaded filenames and selected portfolio labels; use Proof verified only after deterministic verification.",
      metadata: { trigger: "proof_wording" },
    });
  }
  if (/\b(wtf|what the fuck|just need)\b/.test(lower)) {
    recordSlackFailureReflection({
      channelId: input.channelId,
      threadTs: input.threadTs,
      jobId: input.state?.jobId ?? null,
      userMessage: text,
      whatHappened: "Steve corrected a Slack response that did not answer the actual draft/CV request.",
      whyItFailed: "The conversation layer treated a natural correction as an unknown command instead of resolving it against the thread draft state.",
      nextBehavior: "Acknowledge the bad response briefly, treat CV as the cover letter/proposal draft, and show the draft or explain that no draft exists.",
      fixType: "memory",
    });
    rememberSalesLearning({
      text: `Frustrated Slack correction: ${text}. Answer the concrete draft/proof/boost/status request directly; do not fall back to a command menu.`,
      jobId: input.state?.jobId ?? null,
      channelId: input.channelId,
      threadTs: input.threadTs,
    });
  }
}

function persistConversationBrainLearning(input: {
  channelId: string;
  threadTs: string;
  text: string;
  state: ReturnType<typeof getSlackThreadStateByThreadTs>;
  decision: SlackConversationBrainDecision;
}): void {
  const memory = input.decision.memoryUpdate;
  if (memory) {
    upsertSlackBehaviorMemory({
      type: memory.type,
      rule: memory.rule,
      scope: memory.scope ?? "global",
      source: "slack_conversation_brain",
      threadChannelId: input.channelId,
      threadTs: input.threadTs,
      jobId: input.state?.jobId ?? null,
      confidence: memory.confidence ?? input.decision.confidence,
      metadata: {
        intent: input.decision.intent,
        actions: input.decision.actions,
        soulGuidance: buildSoulRuntimeGuidance("self_improvement_memory"),
      },
    });
  }
  const reflection = input.decision.failureReflection;
  if (reflection) {
    recordSlackFailureReflection({
      channelId: input.channelId,
      threadTs: input.threadTs,
      jobId: input.state?.jobId ?? null,
      userMessage: normalizeSlackTextInput(input.text),
      whatHappened: reflection.whatHappened,
      whyItFailed: reflection.whyItFailed,
      nextBehavior: reflection.nextBehavior,
      fixType: reflection.fixType,
      proposedTask: reflection.proposedTask,
    });
    if (reflection.fixType === "code_pr" && reflection.proposedTask?.trim()) {
      recordCodeImprovementTask({
        task: reflection.proposedTask.trim(),
        why: reflection.whyItFailed,
        jobId: input.state?.jobId ?? null,
        channelId: input.channelId,
        threadTs: input.threadTs,
        source: "slack_conversation_brain",
      });
    }
  }
}

export function applySlackThreadRevision(input: {
  channelId: string;
  threadTs: string;
  instruction: string;
}): { ok: boolean; text: string; proposalVersion?: number } {
  const state = getSlackThreadStateByThreadTs(input.channelId, input.threadTs);
  if (!state?.jobId) {
    return { ok: false, text: "I cannot revise a draft without a tracked job id for this thread." };
  }

  const instruction = cleanRevisionInstruction(input.instruction);
  if (!instruction) {
    return { ok: false, text: `I cannot revise ${state.jobId} without a revision instruction.` };
  }

  const draft = getApplicationDraft(state.jobId);
  if (!draft?.proposalText.trim()) {
    recordApplicationRevisionRequest(state.jobId, instruction);
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "revise_requested");
    return {
      ok: false,
      text: `Revision request recorded for ${state.jobId}: ${instruction} (no stored proposal draft was found to update).`,
    };
  }

  const revisedText = buildDeterministicProposalRevision(draft.proposalText, instruction);
  const revision = applyApplicationRevision(state.jobId, instruction, revisedText);
  updateSlackThreadStateStatus(state.channelId, state.threadTs, "revise_requested");

  if (!revision) {
    return { ok: false, text: `I could not apply the revision for ${state.jobId}; no stored draft row was updated.` };
  }
  recordProposalStyleSignal({
    jobId: state.jobId,
    instruction,
    beforeText: draft.proposalText,
    afterText: revision.proposalText,
    channelId: state.channelId,
    threadTs: state.threadTs,
    source: "slack_thread_revision",
  });
  recordProposalVersionDiffLearning({
    jobId: state.jobId,
    source: "slack_thread_revision_version",
    editor: "Steve",
    channelId: state.channelId,
    threadTs: state.threadTs,
  });

  return {
    ok: true,
    proposalVersion: revision.proposalVersion,
    text: [
      `Revision applied to stored proposal draft for ${state.jobId}.`,
      `Stored proposal version: v${revision.proposalVersion}`,
      `Instruction: ${instruction}`,
      describeQueuedBrowserDraft(state.jobId),
      "Final submit remains manual.",
    ].join("\n"),
  };
}

export function applySlackProofPlanRevision(input: {
  channelId: string;
  threadTs: string;
  instruction: string;
}): { ok: boolean; text: string } {
  const state = getSlackThreadStateByThreadTs(input.channelId, input.threadTs);
  if (!state?.jobId) {
    return { ok: false, text: "I cannot revise proof without a tracked job id for this thread." };
  }
  const current = parseProofPlanOverrides(getApplicationProofPlanOverrides(state.jobId) ?? {});
  const revised = reviseProofPlanOverrides(current, input.instruction);
  if (!revised.summary.changed) {
    return { ok: false, text: revised.summary.reply };
  }
  const updated = updateApplicationProofPlanOverrides(state.jobId, revised.overrides, input.instruction);
  if (!updated) {
    return { ok: false, text: `I could not update the proof plan for ${state.jobId}.` };
  }
  recordProofPreferenceSignal({
    jobId: state.jobId,
    instruction: input.instruction,
    plannedProofIds: [
      ...revised.overrides.includeProofIds,
      ...revised.overrides.includeAssetIds,
      ...revised.overrides.includePortfolioItemIds,
    ],
    channelId: state.channelId,
    threadTs: state.threadTs,
    source: "slack_proof_revision",
  });
  updateSlackThreadStateStatus(state.channelId, state.threadTs, "prepare_draft_requested");
  return { ok: true, text: revised.summary.reply };
}

export function buildPrepareDraftQueueReply(input: {
  jobId: string;
  threadTitle: string;
  upworkUrl: string;
  actionId: number;
  duplicate: boolean;
  duplicateStatus?: string | null;
  requeued?: boolean;
  ackText?: string | null;
}): string {
  const ack = input.ackText?.trim() || "Got it — I’ll prep this now and come back here when it’s ready for QA.";
  return [
    input.requeued
      ? ack
      : input.duplicate
      ? input.ackText?.trim() || "Already on it — I already have this queued and I’ll come back here when it’s ready for QA."
      : ack,
    "I’ll fill what’s safe on Upwork and stop before submit.",
    `Listing: ${input.upworkUrl}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function buildNoDraftPrepareBlocker(state: NonNullable<ReturnType<typeof getSlackThreadStateByThreadTs>>): { text: string; threadStatus: "capture_pending" | "error" } {
  const latestAction = latestBrowserActionForThreadState(state);
  const capturePending = latestAction?.actionType === "capture_job_from_url" &&
    ["pending", "in_progress", "queued"].includes(latestAction.status);
  if (capturePending) {
    return {
      text: `Capture is still running for ${state.upworkUrl}. I can't prep Upwork until the draft is generated. Check back in a moment or say "retry capture" if it's stuck.`,
      threadStatus: "capture_pending",
    };
  }
  return {
    text: `I don't have a generated draft for ${state.upworkUrl} yet. The capture may have failed or not started. Say "retry capture" or send the listing link again.`,
    threadStatus: "error",
  };
}

export function queuePrepareDraftFromSlackThread(input: { channelId: string; threadTs: string; ackText?: string | null; forceRetryPaused?: boolean }): { ok: boolean; text: string; actionId?: number; threadStatus?: "capture_pending" | "error" } {
  const state = getSlackThreadStateByThreadTs(input.channelId, input.threadTs);
  if (!state?.jobId) {
    return { ok: false, text: "I cannot queue a browser draft without a tracked job id for this thread." };
  }

  const draft = getApplicationDraft(state.jobId);
  const scoredJob = getScoredJobForSlackPreview(state.jobId);
  if (!draft || !scoredJob || !draft.proposalText.trim()) {
    return { ok: false, ...buildNoDraftPrepareBlocker(state) };
  }
  const qaCapacity = canQueueNewQaPreparation(state.jobId);
  if (!qaCapacity.ok) {
    return {
      ok: false,
      text: `I have ${qaCapacity.count} applications waiting for QA. I’ll pause new prep until you submit/skip one.`,
    };
  }
  const browserSession = getBrowserSessionStatus();
  if (browserSession.blocked) {
    return { ok: false, text: "Quick blocker: Upwork is asking for a human check, so I paused. Clear the browser and I’ll retry." };
  }

  const action = enqueueBrowserActionDeduped({
    jobId: state.jobId,
    actionType: "prepare_application_review",
    payload: {
      url: state.upworkUrl,
      channelId: state.channelId,
      threadTs: state.threadTs,
      messageTs: state.messageTs,
      applicationId: state.jobId,
      notes: "Slack socket: prepare request from tracked thread. Prepare browser review only; do not submit.",
    },
  });
  const duplicateAction = action.duplicate ? getBrowserActionById(action.id) : null;
  const requeuedPaused = Boolean(input.forceRetryPaused && duplicateAction?.status === "paused" && duplicateAction.actionType === "prepare_application_review");
  if (requeuedPaused) {
    updateBrowserActionStatus(action.id, "pending", "Slack socket prep issue report requested remote Chrome re-check.");
  }
  updateSlackThreadStateStatus(state.channelId, state.threadTs, "prepare_draft_requested");
  return {
    ok: true,
    actionId: action.id,
    text: buildPrepareDraftQueueReply({
      jobId: state.jobId,
      threadTitle: scoredJob.title,
      upworkUrl: state.upworkUrl,
      actionId: action.id,
      duplicate: action.duplicate,
      duplicateStatus: requeuedPaused ? "pending" : duplicateAction?.status ?? null,
      requeued: requeuedPaused,
      ackText: input.ackText,
    }),
  };
}

function latestApplySnapshotUrl(jobId: string, fallbackUrl: string): string {
  const latestQaAction = listBrowserActions(null, 1000)
    .filter((action) => action.jobId === jobId && action.actionType === "prepare_application_review")
    .slice(-1)[0] as { payload?: { qaHold?: { applyUrl?: string }; applyPlan?: { applyUrl?: string }; url?: string } } | undefined;
  return latestQaAction?.payload?.qaHold?.applyUrl ?? latestQaAction?.payload?.applyPlan?.applyUrl ?? latestQaAction?.payload?.url ?? fallbackUrl;
}

export function queueApplicationSnapshotFromSlackThread(input: {
  channelId: string;
  threadTs: string;
  source: ProposalVersionSource;
  markSubmittedAfterCapture?: boolean;
  note?: string;
}): { ok: boolean; text: string; actionId?: number } {
  const state = getSlackThreadStateByThreadTs(input.channelId, input.threadTs);
  if (!state?.jobId) {
    return { ok: false, text: "I cannot re-read the application without a tracked job id for this thread." };
  }
  const url = latestApplySnapshotUrl(state.jobId, state.upworkUrl);
  const action = enqueueBrowserActionDeduped({
    jobId: state.jobId,
    actionType: "capture_application_snapshot",
    payload: {
      url,
      channelId: state.channelId,
      threadTs: state.threadTs,
      messageTs: state.messageTs,
      applicationId: state.jobId,
      proposalVersionSource: input.source,
      markSubmittedAfterCapture: Boolean(input.markSubmittedAfterCapture),
      notes: input.note ?? "Read current remote Chrome application text for proposal audit trail. Do not fill or submit.",
    },
  });
  if (input.markSubmittedAfterCapture) {
    updateApplicationStatus(state.jobId, "submitted", "Marked submitted from Slack after Steve submitted manually; queued read-only final page capture.");
    recordApplicationOutcomeLearning({
      jobId: state.jobId,
      outcome: "submitted",
      note: "Marked submitted from Slack after Steve submitted manually; queued read-only final page capture.",
      source: "slack_mark_submitted_command",
    });
  }
  updateSlackThreadStateStatus(state.channelId, state.threadTs, input.markSubmittedAfterCapture ? "submitted_marked" : "status_checked");
  return {
    ok: true,
    actionId: action.id,
    text: input.markSubmittedAfterCapture
      ? `I queued a read-only final version capture for ${humanApplicationLabel(state.jobId)} if the application tab is visible; otherwise I will preserve the latest verified version as a lower-confidence fallback. Final submit remains manual on my side.`
      : `I queued a read-only re-read of the remote Chrome application for ${humanApplicationLabel(state.jobId)}. I’ll save the current cover letter/screening text as a new version if the page is readable.`,
  };
}

function clampBatchTarget(value: number | null | undefined): number {
  const parsed = Number.isFinite(value ?? NaN) ? Math.floor(value ?? BROWSER_QA_MAX_PROTECTED_TABS) : BROWSER_QA_MAX_PROTECTED_TABS;
  return Math.min(BROWSER_QA_MAX_PROTECTED_TABS, Math.max(1, parsed));
}

function screeningSummary(count: number): string {
  return count > 0 ? `${count} answer${count === 1 ? "" : "s"}` : "none captured";
}

export function startBatchApplyWorkspaceFromSlack(input: {
  channelId: string;
  threadTs: string;
  targetCount?: number;
}): { ok: boolean; text: string; batchId?: number; queued: number; ready: number; blocked: number; skipped: number } {
  const targetCount = clampBatchTarget(input.targetCount);
  const batch = createBatchApplyWorkspace({
    targetCount,
    source: "slack_batch_command",
    channelId: input.channelId,
    threadTs: input.threadTs,
  });
  const existingProtected = new Map(getProtectedQaQueueItems(1000).map((item) => [item.jobId, item]));
  const candidates = listBatchApplyCandidateThreads(Math.max(25, targetCount * 3));
  let position = 0;
  let queued = 0;
  let ready = 0;
  let blocked = 0;
  let skipped = 0;
  let stopReason: string | null = null;

  for (const candidate of candidates) {
    if (position >= targetCount) break;
    if (getApplicationStatus(candidate.jobId) === "submitted") continue;
    position += 1;
    const existing = existingProtected.get(candidate.jobId);
    if (existing) {
      const status = existing.state === "blocked" ? "blocked" : "ready";
      if (status === "blocked") blocked += 1;
      else ready += 1;
      upsertBatchApplyWorkspaceItem({
        batchId: batch.id,
        position,
        jobId: candidate.jobId,
        channelId: candidate.channelId,
        threadTs: candidate.threadTs,
        applyUrl: existing.applyUrl ?? candidate.upworkUrl,
        tabReference: existing.tabReference ?? existing.applyUrl ?? candidate.upworkUrl,
        proposalVersion: existing.proposalVersion ?? candidate.proposalVersion,
        status,
        title: candidate.title,
        screeningSummary: existing.screening,
        proofSummary: existing.proof,
        portfolioSummary: existing.portfolio,
        connectsSummary: existing.connects,
        boostSummary: existing.boost,
        lastVerifiedAt: existing.lastVerifiedAt,
      });
      continue;
    }

    const result = queuePrepareDraftFromSlackThread({
      channelId: candidate.channelId,
      threadTs: candidate.threadTs,
      ackText: "Batch prep queued.",
    });
    if (!result.ok) {
      position -= 1;
      if (/applications waiting for QA|pause new prep/i.test(result.text)) {
        stopReason = result.text;
        break;
      }
      skipped += 1;
      continue;
    }
    queued += 1;
    upsertBatchApplyWorkspaceItem({
      batchId: batch.id,
      position,
      jobId: candidate.jobId,
      channelId: candidate.channelId,
      threadTs: candidate.threadTs,
      applyUrl: candidate.upworkUrl,
      tabReference: candidate.upworkUrl,
      proposalVersion: candidate.proposalVersion,
      status: "queued",
      title: candidate.title,
      screeningSummary: screeningSummary(candidate.screeningAnswers.length),
      proofSummary: candidate.proofSummary,
      portfolioSummary: candidate.portfolioSummary,
      connectsSummary: candidate.connectsSummary,
      boostSummary: candidate.boostSummary,
      lastVerifiedAt: null,
    });
  }

  const tracked = listBatchApplyWorkspaceItems(batch.id).length;
  if (tracked === 0) {
    return {
      ok: false,
      batchId: batch.id,
      queued,
      ready,
      blocked,
      skipped,
      text: "I do not have draft-ready Slack leads to batch prep yet. No browser tabs were opened and final submit remains manual.",
    };
  }
  return {
    ok: true,
    batchId: batch.id,
    queued,
    ready,
    blocked,
    skipped,
    text: [
      `Batch workspace started for ${tracked}/${targetCount} application${targetCount === 1 ? "" : "s"}.`,
      `${queued} queued for safe browser prep; ${ready} already ready for QA; ${blocked} blocked.`,
      stopReason ? `Stopped early: ${stopReason}` : null,
      "I will fill only safe fields, preserve protected tabs, and stop before submit. Final submit remains manual.",
    ].filter((line): line is string => Boolean(line)).join("\n"),
  };
}

function findBatchWorkspaceItem(index: number | undefined): BatchApplyWorkspaceItemView | null {
  if (!index || index < 1) return null;
  return getBatchApplyWorkspaceView().items.find((item) => item.index === index) ?? null;
}

function skipBatchApplyWorkspaceItem(index: number | undefined): { ok: boolean; text: string } {
  const item = findBatchWorkspaceItem(index);
  if (!item) {
    return { ok: false, text: "I could not find that application in the batch workspace. Ask what’s ready to refresh the current batch state." };
  }
  const batch = getActiveBatchApplyWorkspace();
  if (item.action && item.action.status !== "completed") {
    updateBrowserActionStatus(item.action.id, "cancelled", "Skipped from Batch Apply Workspace.");
  }
  if (getApplicationStatus(item.jobId)) {
    updateApplicationStatus(item.jobId, "rejected", "Skipped from Batch Apply Workspace.");
  }
  if (batch) {
    updateBatchApplyWorkspaceItemStatus({
      batchId: batch.id,
      jobId: item.jobId,
      status: "skipped",
      lastVerifiedAt: new Date().toISOString(),
    });
  }
  return {
    ok: true,
    text: `Skipped application ${item.index} from the batch workspace. I did not submit anything.`,
  };
}

function markBatchApplyWorkspaceItemSubmitted(index: number | undefined): { ok: boolean; text: string } {
  const item = findBatchWorkspaceItem(index);
  if (!item) {
    return { ok: false, text: "I could not find that application in the batch workspace. Ask what’s ready to refresh the current batch state." };
  }
  const batch = getActiveBatchApplyWorkspace();
  const state = item.channelId && item.threadTs
    ? getSlackThreadStateByThreadTs(item.channelId, item.threadTs)
    : getSlackThreadStateByJobId(item.jobId);
  const capture = state
    ? queueApplicationSnapshotFromSlackThread({
      channelId: state.channelId,
      threadTs: state.threadTs,
      source: "final_submitted",
      markSubmittedAfterCapture: true,
      note: "Human marked this batch application submitted manually; capture current remote Chrome text first when possible.",
    })
    : null;
  if (!capture?.ok && getApplicationStatus(item.jobId)) {
    updateApplicationStatus(item.jobId, "submitted", "Marked submitted from Batch Apply Workspace after human submitted manually.");
  }
  if (batch) {
    updateBatchApplyWorkspaceItemStatus({
      batchId: batch.id,
      jobId: item.jobId,
      status: "submitted",
      lastVerifiedAt: new Date().toISOString(),
    });
  }
  return {
    ok: true,
    text: capture?.ok
      ? `Application ${item.index} is marked submitted after the human sent it manually. I queued a read-only final version capture. Final submit remains manual on my side.`
      : `Application ${item.index} is marked submitted after the human sent it manually. I could not queue a page capture, so the final version is the latest captured QA version if available. Final submit remains manual.`,
  };
}

function isBatchWorkspaceCommand(command: ParsedSlackSocketCommand): boolean {
  return ["batch_prep", "qa_queue", "focus_qa_tab", "skip_batch_item", "mark_batch_submitted"].includes(command.type);
}

function isProductInsightCommand(command: ParsedSlackSocketCommand): boolean {
  return command.type === "operator_report" || command.type === "source_strategy";
}

function hasDeterministicProductInsightIntent(text: string): boolean {
  return isProductInsightCommand(parseSlackThreadCommand(text));
}

const OPERATOR_REPORT_DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildWeeklyOperatorReportPeriod(now = new Date()) {
  const end = now;
  const start = new Date(end.getTime() - 7 * OPERATOR_REPORT_DAY_MS);
  return {
    label: `Last 7 days ending ${isoDay(end)}`,
    start,
    end,
    now,
  };
}

function buildMonthlyOperatorReportPeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    label: `Month to date ${now.toISOString().slice(0, 7)}`,
    start,
    end: now,
    now,
  };
}

function buildOperatorReportSlackText(command: ParsedSlackSocketCommand): string {
  if (command.operatorReportKind === "friday") {
    const snapshot = getOperatorReportDbSnapshot(buildWeeklyOperatorReportPeriod());
    return buildFridayOperatorHandoff(snapshot);
  }
  const snapshot = getOperatorReportDbSnapshot(buildMonthlyOperatorReportPeriod());
  if (command.operatorReportKind === "monthly") {
    return buildMonthlyOperatorReview(snapshot);
  }
  return answerMonthlyOperatorQuestion(snapshot, command.instruction ?? command.rawText).text;
}

async function handleProductInsightCommand(params: SlackReasoningGatewayParams, command: ParsedSlackSocketCommand): Promise<boolean> {
  if (command.type === "source_strategy") {
    const answer = buildSourceStrategyAnswer({ question: command.instruction ?? params.text });
    const text = await userFacingSlackCopy({
      deterministicText: answer.text,
      userMessage: params.text,
      intent: "source_strategy",
      context: { metricCount: answer.metrics.length, schemaVersion: answer.schema.schemaVersion },
      preservePhrases: [
        answer.text.includes("Evidence level") ? "Evidence level" : null,
        answer.text.includes("not certainty") ? "not certainty" : null,
      ].filter((phrase): phrase is string => Boolean(phrase)),
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return true;
  }

  if (command.type === "operator_report") {
    const report = buildOperatorReportSlackText(command);
    const text = await userFacingSlackCopy({
      deterministicText: report,
      userMessage: params.text,
      intent: `operator_report_${command.operatorReportKind ?? "question"}`,
      context: { reportKind: command.operatorReportKind ?? "question" },
      preservePhrases: [
        report.includes("Final submit remains manual") ? "Final submit remains manual" : null,
        report.includes("This report is read-only") ? "This report is read-only" : null,
      ].filter((phrase): phrase is string => Boolean(phrase)),
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return true;
  }

  return false;
}

async function handleBatchWorkspaceCommand(params: {
  command: ParsedSlackSocketCommand;
  state: ReturnType<typeof getSlackThreadStateByThreadTs>;
  channelId: string;
  threadTs: string;
  text: string;
  client: App["client"];
  copyProvider?: SlackCopyProvider;
  focusQaTab?: (input: { jobId?: string | null; index?: number; query?: string | null }) => Promise<ProtectedQaFocusResult>;
}): Promise<boolean> {
  const { command } = params;
  if (command.type === "batch_prep") {
    const result = startBatchApplyWorkspaceFromSlack({
      channelId: params.channelId,
      threadTs: params.threadTs,
      targetCount: command.batchTargetCount,
    });
    const text = await userFacingSlackCopy({
      deterministicText: result.text,
      userMessage: params.text,
      intent: "batch_prep",
      context: {
        batchId: result.batchId,
        queued: result.queued,
        ready: result.ready,
        blocked: result.blocked,
        finalSubmitManual: true,
      },
      preservePhrases: result.text.includes("Final submit remains manual") ? ["Final submit remains manual"] : [],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return true;
  }

  if (command.type === "qa_queue") {
    const text = await userFacingSlackCopy({
      deterministicText: formatBatchApplyWorkspaceReply(),
      userMessage: params.text,
      intent: "batch_workspace_status",
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return true;
  }

  if (command.type === "focus_qa_tab") {
    const focus = await (params.focusQaTab ?? focusProtectedQaApplicationTab)({
      jobId: command.qaIndex ? null : params.state?.jobId ?? null,
      index: command.qaIndex,
      query: command.qaQuery,
    });
    const text = await userFacingSlackCopy({
      deterministicText: focus.text,
      userMessage: params.text,
      intent: "focus_qa_tab",
      context: { jobId: params.state?.jobId ?? null, ok: focus.ok },
      preservePhrases: focus.text.includes("Final submit is still untouched") ? ["Final submit is still untouched."] : [],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    if (focus.ok && params.state) {
      updateSlackThreadStateStatus(params.state.channelId, params.state.threadTs, "status_checked");
    }
    return true;
  }

  if (command.type === "skip_batch_item") {
    const result = skipBatchApplyWorkspaceItem(command.qaIndex);
    const text = await userFacingSlackCopy({
      deterministicText: result.text,
      userMessage: params.text,
      intent: "skip_batch_item",
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return true;
  }

  if (command.type === "mark_batch_submitted") {
    const result = markBatchApplyWorkspaceItemSubmitted(command.qaIndex);
    const text = await userFacingSlackCopy({
      deterministicText: result.text,
      userMessage: params.text,
      intent: "mark_batch_submitted",
      preservePhrases: result.text.includes("Final submit remains manual") ? ["Final submit remains manual"] : [],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return true;
  }

  return false;
}

export function buildDraftPreviewFromSlackThread(input: {
  channelId: string;
  threadTs: string;
  source?: ProposalVersionSource;
}): { ok: boolean; text: string } {
  const state = getSlackThreadStateByThreadTs(input.channelId, input.threadTs);
  if (!state?.jobId) {
    return { ok: false, text: "I cannot show a draft preview without a tracked job id for this thread." };
  }
  const draft = getApplicationDraft(state.jobId);
  const scoredJob = getScoredJobForSlackPreview(state.jobId);
  const requestedVersion = input.source ? getLatestProposalVersion(state.jobId, input.source) : null;
  const latestVersion = requestedVersion ?? getLatestProposalVersion(state.jobId);
  const textToShow = requestedVersion?.proposalText ?? (!input.source ? draft?.proposalText.trim() : latestVersion?.proposalText) ?? "";
  if (!textToShow.trim()) {
    return { ok: false, text: "Quick blocker: I do not have the generated draft for this lead yet, so I have not filled the Upwork form." };
  }
  const previewVersion = input.source
    ? requestedVersion
    : recordProposalVersion({
        jobId: state.jobId,
        source: "slack_preview",
        proposalText: textToShow,
        screeningAnswers: draft?.structuredProposal?.clientRequestAnswers ?? latestVersion?.screeningAnswers ?? [],
        note: "Slack draft/CV preview shown to Steve.",
  });
  updateSlackThreadStateStatus(state.channelId, state.threadTs, "draft_preview_sent");
  const shownVersion = requestedVersion ?? previewVersion ?? latestVersion;
  const label = shownVersion?.label ?? "current draft";
  const sourceLine = input.source && !requestedVersion
    ? shownVersion?.isFallback
      ? `I do not have a ${input.source.replace(/_/g, " ")} readback; showing the lower-confidence latest verified fallback instead (${label}).`
      : `I do not have a ${input.source.replace(/_/g, " ")} capture yet; showing the latest captured draft instead (${label}).`
    : `Version: ${label}`;
  const finalSubmittedQualifier = shownVersion?.isFallback
    ? "This is a lower-confidence latest verified fallback, not a visible final submitted readback."
    : "I only call this final submitted text when Steve marked it submitted or the page was captured before that outcome update.";
  return {
    ok: true,
    text: [
      `Draft preview for ${scoredJob?.title ?? state.jobId}:`,
      sourceLine,
      "",
      textToShow,
      "",
      input.source === "final_submitted"
        ? finalSubmittedQualifier
        : !input.source
          ? "I have not filled the Upwork form yet."
        : "I have not filled the Upwork form yet unless an Upwork inserted/QA version is shown above.",
      "Reply \"use this\", \"looks good\", or \"put it in Upwork\" when you want me to fill the remote Chrome apply page.",
      "Final submit remains manual.",
    ].join("\n"),
  };
}

interface UserFacingSlackCopyInput {
  deterministicText: string;
  userMessage?: string | null;
  intent?: string | null;
  context?: Record<string, unknown>;
  preservePhrases?: string[];
  copyProvider?: SlackCopyProvider;
  executionPath?: string;
}

interface SlackReplyPathTrace {
  inboundMessage: string | null;
  classifiedIntent: string | null;
  executionPath: string;
  handler: string;
  finalComposerRan: boolean;
  finalComposerUsedLlm: boolean | null;
  finalComposerProvider: SlackCopyResult["provider"] | null;
  finalComposerReason: string | null;
  replyPosted: boolean;
  suppressionReason: string | null;
  debugOrSystemOnly: boolean;
  exactBodyPreserved: boolean;
}

const pendingSlackReplyPathTraces = new Map<string, SlackReplyPathTrace[]>();
const MAX_PENDING_SLACK_REPLY_TRACES = 200;

function redactSlackTraceText(value: string | null): string | null {
  if (!value) return value;
  return value
    .replace(/\b(MEMORI_API_KEY\s*[:=]\s*)[^\s]+/gi, "$1[redacted]")
    .replace(/\b([A-Z0-9_]*(?:API|TOKEN|SECRET|KEY)[A-Z0-9_]*\s*[:=]\s*)[^\s]+/gi, "$1[redacted]")
    .replace(/\b(?:xox[baprs]?|xapp)-[A-Za-z0-9-]+/g, "[redacted-slack-token]");
}

function logSlackReplyPathTrace(trace: SlackReplyPathTrace): void {
  logger.debug(JSON.stringify({
    slackReplyPathTrace: true,
    debugOnly: true,
    inboundMessage: redactSlackTraceText(trace.inboundMessage),
    classifiedIntent: trace.classifiedIntent,
    executionPath: trace.executionPath,
    handler: trace.handler,
    finalComposerRan: trace.finalComposerRan,
    finalComposerUsedLlm: trace.finalComposerUsedLlm,
    finalComposerProvider: trace.finalComposerProvider,
    finalComposerReason: trace.finalComposerReason,
    replyPosted: trace.replyPosted,
    suppressionReason: trace.suppressionReason,
    debugOrSystemOnly: trace.debugOrSystemOnly,
    exactBodyPreserved: trace.exactBodyPreserved,
  }));
}

function inferSlackReplyExecutionPath(intent?: string | null): string {
  const value = intent ?? "";
  if (value.endsWith(":progress")) return "slackReasoningGateway:progress_reply";
  if (value.startsWith("operator_")) return "slackReasoningGateway:operator_control_plane";
  if (value === "skip_blocked_applications") return "slackReasoningGateway:skip_blocked_applications";
  if (value === "blocked_status") return "slackReasoningGateway:blocked_status";
  if (value === "attention_status") return "slackReasoningGateway:attention_status";
  if (value === "capture_upwork_url") return "slackReasoningGateway:capture_upwork_url";
  if (value === "ingest_file") return "slackReasoningGateway:ingest_file";
  if (value === "draft_preview" || value === "show_cover_letter") return "slackReasoningGateway:exact_body_reply";
  return "slackReasoningGateway:conversation_reply";
}

function buildComposedReplyTrace(input: UserFacingSlackCopyInput, result: SlackCopyResult, overrides: Partial<SlackReplyPathTrace> = {}): SlackReplyPathTrace {
  const executionPath = overrides.executionPath ?? input.executionPath ?? inferSlackReplyExecutionPath(input.intent);
  return {
    inboundMessage: input.userMessage ?? null,
    classifiedIntent: input.intent ?? null,
    executionPath,
    handler: executionPath,
    finalComposerRan: true,
    finalComposerUsedLlm: result.usedLlm,
    finalComposerProvider: result.provider,
    finalComposerReason: result.reason ?? null,
    replyPosted: false,
    suppressionReason: null,
    debugOrSystemOnly: false,
    exactBodyPreserved: false,
    ...overrides,
  };
}

function rememberPendingSlackReplyTrace(text: string, trace: SlackReplyPathTrace): void {
  if (!text.trim()) return;
  const traces = pendingSlackReplyPathTraces.get(text) ?? [];
  traces.push(trace);
  pendingSlackReplyPathTraces.set(text, traces);
  while (pendingSlackReplyPathTraces.size > MAX_PENDING_SLACK_REPLY_TRACES) {
    const firstKey = pendingSlackReplyPathTraces.keys().next().value;
    if (!firstKey) break;
    pendingSlackReplyPathTraces.delete(firstKey);
  }
}

function takePendingSlackReplyTrace(text: string): SlackReplyPathTrace | null {
  const traces = pendingSlackReplyPathTraces.get(text);
  if (!traces?.length) return null;
  const trace = traces.shift() ?? null;
  if (traces.length === 0) {
    pendingSlackReplyPathTraces.delete(text);
  }
  return trace;
}

function uncomposedThreadReplyTrace(overrides: Partial<SlackReplyPathTrace> = {}): SlackReplyPathTrace {
  const executionPath = overrides.executionPath ?? "slackSocket:postThreadReply";
  return {
    inboundMessage: null,
    classifiedIntent: "unclassified_direct_post",
    executionPath,
    handler: executionPath,
    finalComposerRan: false,
    finalComposerUsedLlm: null,
    finalComposerProvider: null,
    finalComposerReason: null,
    replyPosted: false,
    suppressionReason: null,
    debugOrSystemOnly: false,
    exactBodyPreserved: false,
    ...overrides,
  };
}

function logSlackReplySuppressed(input: {
  inboundMessage: string | null;
  classifiedIntent: string | null;
  executionPath: string;
  suppressionReason: string;
  debugOrSystemOnly?: boolean;
}): void {
  logSlackReplyPathTrace(uncomposedThreadReplyTrace({
    inboundMessage: input.inboundMessage,
    classifiedIntent: input.classifiedIntent,
    executionPath: input.executionPath,
    handler: input.executionPath,
    suppressionReason: input.suppressionReason,
    debugOrSystemOnly: Boolean(input.debugOrSystemOnly),
  }));
}

async function postThreadReply(
  client: App["client"],
  channel: string,
  threadTs: string,
  text: string,
  traceOverride?: Partial<SlackReplyPathTrace>,
): Promise<void> {
  const trace = traceOverride
    ? uncomposedThreadReplyTrace(traceOverride)
    : takePendingSlackReplyTrace(text) ?? uncomposedThreadReplyTrace();
  let replyPosted = false;
  try {
    await client.chat.postMessage({ channel, thread_ts: threadTs, text });
    replyPosted = true;
  } finally {
    logSlackReplyPathTrace({
      ...trace,
      replyPosted,
      suppressionReason: replyPosted ? trace.suppressionReason : "slack_post_failed",
    });
  }
}

function splitExactBodyReply(text: string): { lead: string; body: string; tail: string } | null {
  const firstBreak = text.indexOf("\n\n");
  const lastBreak = text.lastIndexOf("\n\n");
  if (firstBreak === -1 || lastBreak === -1 || firstBreak === lastBreak) {
    return null;
  }
  const lead = text.slice(0, firstBreak).trim();
  const body = text.slice(firstBreak + 2, lastBreak).trim();
  const tail = text.slice(lastBreak + 2).trim();
  if (!lead || !body || !tail) {
    return null;
  }
  return { lead, body, tail };
}

async function composeUserFacingSlackCopy(input: UserFacingSlackCopyInput): Promise<SlackCopyResult> {
  return rewriteSlackCopyWithKimi({
    path: "conversation_reply",
    deterministicText: input.deterministicText,
    userMessage: input.userMessage,
    intent: input.intent,
    context: input.context,
    preservePhrases: input.preservePhrases,
  }, input.copyProvider);
}

async function userFacingSlackCopyWithExactBody(input: UserFacingSlackCopyInput): Promise<string> {
  const split = splitExactBodyReply(input.deterministicText);
  if (!split) {
    return userFacingSlackCopy({
      deterministicText: input.deterministicText,
      userMessage: input.userMessage,
      intent: input.intent,
      context: input.context,
      preservePhrases: [input.deterministicText],
      copyProvider: input.copyProvider,
    });
  }
  const envelope = await composeUserFacingSlackCopy({
    deterministicText: [split.lead, split.tail].join("\n"),
    userMessage: input.userMessage,
    intent: input.intent,
    context: input.context,
    copyProvider: input.copyProvider,
  });
  const safeEnvelope = /\b(?:copywriter|omitted|proposal body|draft body)\b/i.test(envelope.text)
    ? [split.lead, split.tail].join("\n")
    : envelope.text;
  const text = [safeEnvelope, split.body].join("\n\n");
  rememberPendingSlackReplyTrace(text, buildComposedReplyTrace(input, envelope, { exactBodyPreserved: true }));
  return text;
}

async function userFacingSlackCopy(input: UserFacingSlackCopyInput): Promise<string> {
  const result = await composeUserFacingSlackCopy(input);
  rememberPendingSlackReplyTrace(result.text, buildComposedReplyTrace(input, result));
  return result.text;
}

export function queueCaptureFromSlackUrl(input: {
  channelId: string;
  messageTs: string;
  threadTs: string;
  text: string;
}): { parsed: ParsedUpworkUrl; state: ReturnType<typeof upsertSlackThreadState>; action: ReturnType<typeof enqueueBrowserActionDeduped> } | null {
  const upworkUrl = parseUpworkJobUrlFromText(input.text);
  if (!upworkUrl) {
    return null;
  }

  const state = upsertSlackThreadState({
    channelId: input.channelId,
    messageTs: input.messageTs,
    threadTs: input.threadTs,
    upworkUrl: upworkUrl.canonicalJobUrl,
    jobId: upworkUrl.jobId,
    status: "capture_pending",
  });

  const jobIdForAction = deriveCaptureThreadJobId(upworkUrl.canonicalJobUrl, upworkUrl.jobId);
  const action = enqueueBrowserActionDeduped({
    jobId: jobIdForAction,
    actionType: "capture_job_from_url",
    payload: {
      ...buildCaptureActionPayload(
        upworkUrl.canonicalJobUrl,
        input.channelId,
        input.messageTs,
        input.threadTs,
        { originalUrl: upworkUrl.originalUrl, canonicalJobUrl: upworkUrl.canonicalJobUrl },
      ),
      sourceQuery: "slack_url",
      notes: "Slack socket URL posted; browser capture required before scoring and draft prep.",
    },
  });

  return { parsed: upworkUrl, state, action };
}

async function handleUrlMessage(params: {
  channelId: string;
  messageTs: string;
  text: string;
  threadTs: string;
  client: App["client"];
  copyProvider?: SlackCopyProvider;
}): Promise<void> {
  const queued = queueCaptureFromSlackUrl(params);
  if (!queued) {
    return;
  }

  const { parsed: upworkUrl, action } = queued;

  const details = [
    "Got the Upwork link. Capture is queued — I'll score it and generate the draft once the browser worker processes it.",
    action.duplicate
      ? "Capture is already queued for this posting."
      : "Capture queued.",
    `Listing: ${upworkUrl.canonicalJobUrl}`,
  ].join("\n");

  const text = await userFacingSlackCopy({
    deterministicText: details,
    userMessage: params.text,
    intent: "capture_upwork_url",
    context: {
      upworkUrl: upworkUrl.canonicalJobUrl,
      duplicate: action.duplicate,
    },
    preservePhrases: [upworkUrl.canonicalJobUrl],
    copyProvider: params.copyProvider,
  });
  await postThreadReply(params.client, params.channelId, params.threadTs, text);
}

async function handleSlackFilesMessage(params: {
  state: NonNullable<ReturnType<typeof getSlackThreadStateByThreadTs>>;
  files: SlackFileLike[];
  channelId: string;
  threadTs: string;
  client: App["client"];
  copyProvider?: SlackCopyProvider;
}): Promise<void> {
  const result = await ingestSlackFilesForThread({
    state: params.state,
    files: params.files,
    token: SLACK_BOT_TOKEN,
  });
  if (params.state.jobId && result.accepted.length > 0) {
    updateSlackThreadStateStatus(params.state.channelId, params.state.threadTs, "files_ingested");
  }
  const text = await userFacingSlackCopy({
    deterministicText: formatSlackFileIntakeReply(result),
    userMessage: "Slack file attachment",
    intent: "ingest_file",
    context: {
      jobId: params.state.jobId,
      acceptedCount: result.accepted.length,
      rejectedCount: result.rejected.length,
    },
    copyProvider: params.copyProvider,
  });
  await postThreadReply(params.client, params.channelId, params.threadTs, text);
}

async function executeConversationPlan(params: {
  plan: SlackConversationPlan;
  state: NonNullable<ReturnType<typeof getSlackThreadStateByThreadTs>>;
  channelId: string;
  threadTs: string;
  client: App["client"];
  userMessage: string;
  copyProvider?: SlackCopyProvider;
}): Promise<void> {
  if (params.plan.actions.includes("send_draft_preview")) {
    const result = buildDraftPreviewFromSlackThread({ channelId: params.channelId, threadTs: params.threadTs });
    if (!result.ok) updateSlackThreadStateStatus(params.state.channelId, params.state.threadTs, "error");
    const text = result.ok
      ? await userFacingSlackCopyWithExactBody({
        deterministicText: result.text,
        userMessage: params.userMessage,
        intent: "draft_preview",
        context: { jobId: params.state.jobId, ok: result.ok, exactProposalBodyPreserved: true },
        copyProvider: params.copyProvider,
      })
      : await userFacingSlackCopy({
        deterministicText: result.text,
        userMessage: params.userMessage,
        intent: "draft_preview",
        context: { jobId: params.state.jobId, ok: result.ok },
        preservePhrases: result.text.includes("Final submit remains manual") ? ["Final submit remains manual"] : [],
        copyProvider: params.copyProvider,
      });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }
  if (params.plan.actions.includes("queue_prepare_application") || params.plan.actions.includes("retry_prepare_after_files")) {
    const ackText = await userFacingSlackCopy({
      deterministicText: params.plan.reply,
      userMessage: params.userMessage,
      intent: params.plan.intent,
      context: { jobId: params.state.jobId, threadStatus: params.state.status },
      preservePhrases: params.plan.reply.toLowerCase().includes("stop before submit") ? ["stop before submit"] : [],
      copyProvider: params.copyProvider,
    });
    const result = queuePrepareDraftFromSlackThread({
      channelId: params.channelId,
      threadTs: params.threadTs,
      ackText,
      forceRetryPaused: params.plan.actions.includes("retry_prepare_after_files"),
    });
    if (!result.ok) updateSlackThreadStateStatus(params.state.channelId, params.state.threadTs, result.threadStatus ?? "error");
    const text = await userFacingSlackCopy({
      deterministicText: result.text,
      userMessage: params.userMessage,
      intent: params.plan.intent,
      context: { jobId: params.state.jobId, threadStatus: params.state.status, queued: result.ok },
      preservePhrases: [
        ...(params.state.upworkUrl ? [params.state.upworkUrl] : []),
        ...(result.text.toLowerCase().includes("stop before submit") ? ["stop before submit"] : []),
      ],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }
  if (params.plan.actions.includes("retry_capture")) {
    const state = params.state;
    const parsedUpworkJobId = state.upworkUrl ? extractUpworkJobIdFromUrl(state.upworkUrl) : null;
    if (!state.jobId || !state.upworkUrl || !parsedUpworkJobId) {
      const text = await userFacingSlackCopy({
        deterministicText: "I can't retry capture without a tracked Upwork listing for this thread. Send the listing link again and I'll queue capture from that URL.",
        userMessage: params.userMessage,
        intent: params.plan.intent,
        context: { jobId: state.jobId ?? null, threadStatus: state.status },
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return;
    }
    const jobIdForAction = deriveCaptureThreadJobId(state.upworkUrl, parsedUpworkJobId);
    const action = enqueueBrowserActionDeduped({
      jobId: jobIdForAction,
      actionType: "capture_job_from_url",
      payload: {
        ...buildCaptureActionPayload(
          state.upworkUrl,
          state.channelId,
          state.messageTs,
          state.threadTs,
          { originalUrl: state.upworkUrl, canonicalJobUrl: state.upworkUrl },
        ),
        sourceQuery: "slack_retry_capture",
        notes: "Slack socket: user requested capture retry.",
      },
    });
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "capture_pending");
    const text = await userFacingSlackCopy({
      deterministicText: `Capture re-queued for ${state.upworkUrl}. I'll score it and generate the draft once the browser worker processes it.`,
      userMessage: params.userMessage,
      intent: params.plan.intent,
      context: { jobId: state.jobId, threadStatus: state.status, actionId: action.id },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }
  if (params.plan.actions.includes("mark_skip")) {
    if (params.state.jobId && getApplicationStatus(params.state.jobId)) {
      updateApplicationStatus(params.state.jobId, "rejected", "Skipped from Slack conversation planner.");
    }
    updateSlackThreadStateStatus(params.state.channelId, params.state.threadTs, "reject_requested");
    const text = await userFacingSlackCopy({
      deterministicText: params.plan.reply,
      userMessage: params.userMessage,
      intent: params.plan.intent,
      context: { jobId: params.state.jobId, threadStatus: params.state.status },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }
  if (params.plan.intent === "show_cover_letter") {
    const text = await userFacingSlackCopyWithExactBody({
      deterministicText: params.plan.reply,
      userMessage: params.userMessage,
      intent: params.plan.intent,
      context: { jobId: params.state.jobId, threadStatus: params.state.status, exactProposalBodyPreserved: true },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }
  const text = await userFacingSlackCopy({
    deterministicText: params.plan.reply,
    userMessage: params.userMessage,
    intent: params.plan.intent,
    context: { jobId: params.state.jobId, threadStatus: params.state.status },
    preservePhrases: params.plan.intent === "answer_file_capability_question"
      ? ["reusable proof", "attach them in this Slack thread", "stop before submit"]
      : [],
    copyProvider: params.copyProvider,
  });
  await postThreadReply(params.client, params.channelId, params.threadTs, text);
}

export interface SlackSocketTextEvent {
  channel: string;
  channel_type?: string;
  ts: string;
  text?: string;
  thread_ts?: string;
  event_ts?: string;
  event_id?: string;
  client_msg_id?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  files?: SlackFileLike[];
}

function logSlackEventRouteTrace(input: {
  event: SlackSocketTextEvent;
  route: "ignored" | "admitted";
  reason: string;
  promptMode?: SlackPromptAdmission["mode"];
  ownedConversation?: boolean;
  botMentioned?: boolean;
  upworkUrlDetected?: boolean;
  allowedChannel?: boolean;
  allowedUser?: boolean;
}): void {
  logger.debug(JSON.stringify({
    slackEventRouteTrace: true,
    debugOnly: true,
    route: input.route,
    reason: input.reason,
    channelId: input.event.channel,
    channelType: input.event.channel_type ?? null,
    isDm: isSlackDmEvent(input.event),
    isAmbientAgentChannel: isAmbientAgentChannel(input.event.channel),
    inAllowedChannelList: input.allowedChannel ?? isAllowedChannel(input.event.channel),
    allowedUser: input.allowedUser ?? isAllowedUser(input.event.user),
    hasUser: Boolean(input.event.user),
    hasThread: Boolean(input.event.thread_ts),
    hasText: Boolean(input.event.text?.trim()),
    fileCount: input.event.files?.length ?? 0,
    botMentioned: Boolean(input.botMentioned),
    upworkUrlDetected: Boolean(input.upworkUrlDetected),
    promptMode: input.promptMode ?? null,
    ownedConversation: Boolean(input.ownedConversation),
  }));
}

export async function handleSlackSocketTextEvent(rawEvent: SlackSocketTextEvent, client: App["client"]): Promise<void> {
  const files = rawEvent.files ?? [];
  if (!rawEvent.text && files.length === 0) {
    logSlackEventRouteTrace({ event: rawEvent, route: "ignored", reason: "empty_event" });
    return;
  }
  if (rawEvent.bot_id || rawEvent.subtype === "bot_message" || rawEvent.subtype === "message_changed") {
    logSlackEventRouteTrace({ event: rawEvent, route: "ignored", reason: "bot_or_changed_message" });
    return;
  }

  const channelId = rawEvent.channel;
  const text = rawEvent.text?.trim() ?? "";
  const botMentioned = hasSlackMention(text);
  const allowedChannel = isAllowedChannel(channelId);
  const allowedUser = isAllowedUser(rawEvent.user);
  if (!allowedUser) {
    logSlackEventRouteTrace({ event: rawEvent, route: "ignored", reason: "user_not_allowed", allowedChannel, allowedUser, botMentioned });
    return;
  }
  if (!allowedChannel && !isSlackDmEvent(rawEvent) && !isAmbientAgentChannel(channelId) && !botMentioned) {
    logSlackEventRouteTrace({ event: rawEvent, route: "ignored", reason: "channel_not_allowed", allowedChannel, allowedUser, botMentioned });
    return;
  }

  if (shouldSkipDuplicateSlackEvent(rawEvent, text)) {
    logSlackEventRouteTrace({ event: rawEvent, route: "ignored", reason: "duplicate_event", allowedChannel, allowedUser, botMentioned });
    return;
  }
  const threadTs = rawEvent.thread_ts ?? rawEvent.ts;
  const mappedThread = getSlackThreadStateByThreadTs(channelId, threadTs);
  const upworkUrl = parseUpworkJobUrlFromText(text);
  const admission = shouldTreatAsPrompt({
    event: rawEvent,
    text,
    threadTs,
    state: mappedThread,
    botMentioned,
  });
  if (!admission.prompt) {
    logSlackEventRouteTrace({
      event: rawEvent,
      route: "ignored",
      reason: admission.reason,
      botMentioned,
      upworkUrlDetected: Boolean(upworkUrl),
      allowedChannel,
      allowedUser,
    });
    logSlackReplySuppressed({
      inboundMessage: text,
      classifiedIntent: "not_a_prompt",
      executionPath: "slackSocket:prompt_admission",
      suppressionReason: admission.reason,
    });
    return;
  }
  const promptText = stripSlackBotMentions(text);
  if (shouldDebounceRapidSlackPrompt(rawEvent, threadTs, promptText)) {
    logSlackEventRouteTrace({
      event: rawEvent,
      route: "ignored",
      reason: "rapid_duplicate_prompt",
      promptMode: admission.mode,
      ownedConversation: admission.ownedConversation,
      botMentioned,
      upworkUrlDetected: Boolean(upworkUrl),
      allowedChannel,
      allowedUser,
    });
    logSlackReplySuppressed({
      inboundMessage: promptText,
      classifiedIntent: "debounced_prompt",
      executionPath: "slackSocket:prompt_debounce",
      suppressionReason: "rapid_duplicate_prompt",
    });
    return;
  }
  const activeCta = deriveSlackActiveCta(mappedThread);
  registerSlackPromptOwnership({
    channelId,
    rootTs: threadTs,
    mode: admission.mode ?? "claimed_thread",
    userId: rawEvent.user ?? null,
    state: mappedThread,
    activeCta,
    upworkUrl,
  });
  logSlackEventRouteTrace({
    event: rawEvent,
    route: "admitted",
    reason: admission.reason,
    promptMode: admission.mode,
    ownedConversation: admission.ownedConversation,
    botMentioned,
    upworkUrlDetected: Boolean(upworkUrl),
    allowedChannel,
    allowedUser,
  });
  await handleSlackReasoningGateway({
    channelId,
    messageTs: rawEvent.ts,
    threadTs,
    text: promptText,
    files,
    botMentioned,
    upworkUrl,
    ownedConversation: admission.ownedConversation,
    promptSurface: admission.mode,
    client,
  });
}

type SlackThreadStateForRetry = NonNullable<ReturnType<typeof getSlackThreadStateByThreadTs>>;
type BrowserActionRecord = NonNullable<ReturnType<typeof getBrowserActionById>>;

function actionHasPausedChallengeQuarantine(action: BrowserActionRecord): boolean {
  const quarantine = action.payload.challengeQuarantine as { status?: unknown; challengeType?: unknown } | undefined;
  if (quarantine?.status === "paused") return true;
  const value = `${action.lastError ?? ""} ${String(quarantine?.challengeType ?? "")}`.toLowerCase();
  return /\b(captcha_or_security_challenge|login_required|two_factor_required|passkey|security check|just a moment|cloudflare|captcha)\b/.test(value);
}

function matchesBlockedStatusIntent(text: string): boolean {
  const normalized = normalizeSlackTextInput(text).replace(/[.!?]+$/g, "").trim();
  return /^(?:what(?:'|’)?s blocked|what is blocked|what(?:'|’)?s blocking(?: you)?|what needs unblocking|blocked|why are you blocked)$/i.test(normalized);
}

function matchesAttentionStatusIntent(text: string): boolean {
  const normalized = normalizeSlackTextInput(text).replace(/[.!?]+$/g, "").trim();
  return /^(?:what needs attention|what needs me|what(?:'|’)?s wrong|why are you paused|why is hunting paused|what is stopping you|what needs fixing)$/i.test(normalized);
}

function matchesSkipBlockedApplicationsIntent(text: string): boolean {
  const normalized = normalizeSlackTextInput(text).replace(/[.!?]+$/g, "").trim();
  return /\b(?:skip|clear|archive|move on from|drop)\b.*\b(?:blocked|stale|paused)\b.*\b(?:application|applications|app|apps|apply items|ones|items)\b/i.test(normalized) ||
    /^(?:skip|clear|archive)\s+all\s+blocked(?:\s+(?:applications|apps|apply items))?$/i.test(normalized) ||
    /^(?:move on from those|clear the stale blocked ones|skip the stale ones)$/i.test(normalized);
}

function updateActionQuarantineStatus(action: BrowserActionRecord, status: "retried" | "skipped" | "resolved"): void {
  const current = action.payload.challengeQuarantine && typeof action.payload.challengeQuarantine === "object"
    ? action.payload.challengeQuarantine as Record<string, unknown>
    : {};
  mergeBrowserActionPayload(action.id, {
    challengeQuarantine: {
      ...current,
      status,
      lastSeenAt: new Date().toISOString(),
    },
  });
}

function uniqueActions(actions: BrowserActionRecord[]): BrowserActionRecord[] {
  const seen = new Set<number>();
  const out: BrowserActionRecord[] = [];
  for (const action of actions) {
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    out.push(action);
  }
  return out;
}

function collectBlockedApplicationActions(): BrowserActionRecord[] {
  const all = listBrowserActions(null, 1000);
  const quarantinedIds = new Set(
    listUnresolvedBrowserChallengeQuarantines()
      .map((item) => item.actionId)
      .filter((id): id is number => typeof id === "number")
  );
  const blockedQaIds = new Set(
    getProtectedQaQueueItems(1000)
      .filter((item) => item.state === "blocked")
      .map((item) => item.action.id)
  );
  return uniqueActions(
    all.filter((action) =>
      quarantinedIds.has(action.id) ||
      blockedQaIds.has(action.id) ||
      ((action.status === "paused" || action.status === "failed") && actionHasPausedChallengeQuarantine(action))
    )
  );
}

function buildBlockedApplicationsStatusText(kind: "blocked" | "attention"): string {
  const session = getBrowserSessionStatus();
  const blockedActions = collectBlockedApplicationActions();
  const qaItems = getProtectedQaQueueItems(1000);
  const readyQa = qaItems.filter((item) => item.state === "ready").length;
  const blockedQa = qaItems.filter((item) => item.state === "blocked").length;

  if (session.blocked) {
    return [
      "Chrome is blocked right now.",
      "Upwork is showing a browser/security check in remote Chrome. Clear that visible check first, then say “retry.”",
      "I will not bypass it or submit anything.",
    ].join("\n");
  }

  if (blockedActions.length > 0) {
    return [
      "Nothing is blocking Chrome right now.",
      `The stale issue is ${blockedActions.length} blocked apply item${blockedActions.length === 1 ? "" : "s"} from the earlier Upwork check. ${blockedQa > 0 ? `${blockedQa} also show up as blocked QA item${blockedQa === 1 ? "" : "s"}.` : "They are not useful unless we rebuild or retry them."}`,
      readyQa > 0 ? `${readyQa} QA item${readyQa === 1 ? " is" : "s are"} still ready.` : "No ready QA item is waiting.",
      "My recommendation: skip the stale blocked applications, then run a clean check and restart hunting.",
    ].join("\n");
  }

  if (qaItems.length > 0) {
    return [
      kind === "attention" ? "The main thing needing attention is QA, not Chrome." : "Chrome is not blocked.",
      `${qaItems.length} QA application${qaItems.length === 1 ? " is" : "s are"} waiting; ${readyQa} ready, ${blockedQa} blocked.`,
      readyQa > 0 ? "Best move: open the ready application and review it." : "Best move: skip or rebuild the blocked QA item.",
    ].join("\n");
  }

  return [
    kind === "attention" ? "Nothing obvious needs Steve right now." : "Nothing is blocked right now.",
    "Chrome is clean, there are no blocked apply items, and no prepared applications are waiting.",
    "Best move: run a clean check and restart hunting.",
  ].join("\n");
}

function skipBlockedApplications(): {
  skipped: number;
  browserBlocked: boolean;
  text: string;
} {
  const session = getBrowserSessionStatus();
  if (session.blocked) {
    return {
      skipped: 0,
      browserBlocked: true,
      text: [
        "I did not skip anything because Chrome is actively blocked.",
        "Clear the visible browser/security check in remote Chrome first, then say “skip all blocked applications” if you still want me to clear the stale items.",
        "I will not bypass the check or submit anything.",
      ].join("\n"),
    };
  }

  const blockedActions = collectBlockedApplicationActions();
  for (const action of blockedActions) {
    updateBrowserActionStatus(action.id, "cancelled", "Skipped from Slack blocked-application cleanup.");
    updateActionQuarantineStatus(action, "skipped");
    markBrowserChallengeSkipped(action.id);
    const payload = action.payload as { channelId?: string; threadTs?: string };
    if (payload.channelId && payload.threadTs) {
      updateSlackThreadStateStatus(payload.channelId, payload.threadTs, "reject_requested");
    }
    if (getApplicationStatus(action.jobId)) {
      updateApplicationStatus(action.jobId, "rejected", "Skipped from Slack blocked-application cleanup.");
    }
  }

  if (blockedActions.length === 0) {
    return {
      skipped: 0,
      browserBlocked: false,
      text: [
        "There were no blocked applications to skip.",
        "Chrome is clean, and I did not submit anything.",
        "Run a check now and I’ll restart hunting if it’s clean.",
      ].join("\n"),
    };
  }

  return {
    skipped: blockedActions.length,
    browserBlocked: false,
    text: [
      `Done — I skipped ${blockedActions.length} stale blocked apply item${blockedActions.length === 1 ? "" : "s"}.`,
      "Chrome is clean, and I did not submit anything.",
      "Run a check now and I’ll restart hunting if it’s clean.",
    ].join("\n"),
  };
}

function actionMatchesSlackThread(action: BrowserActionRecord, state: SlackThreadStateForRetry): boolean {
  const payload = action.payload as { channelId?: string; threadTs?: string; applicationId?: string };
  const matchesThread = payload.channelId === state.channelId && payload.threadTs === state.threadTs;
  const matchesJob = action.jobId === state.jobId || payload.applicationId === state.jobId;
  return Boolean(matchesThread || matchesJob);
}

function threadBrowserActions(state: SlackThreadStateForRetry) {
  if (!state.jobId) return [];
  return listBrowserActions(null, 1000)
    .filter((candidate) => {
      if (!["capture_job_from_url", "prepare_application_review"].includes(candidate.actionType)) return false;
      return actionMatchesSlackThread(candidate, state);
    });
}

function resolvePausedChallengeActionForThread(state: SlackThreadStateForRetry): BrowserActionRecord | null {
  return threadBrowserActions(state).filter(actionHasPausedChallengeQuarantine).slice(-1)[0] ?? null;
}

function resolveRetryAction(input: {
  state: SlackThreadStateForRetry;
  actionId?: number;
}): { action: BrowserActionRecord; reason?: never } | { action: null; reason: string } {
  if (input.actionId) {
    const direct = getBrowserActionById(input.actionId);
    if (direct && (input.actionId > 20 || actionMatchesSlackThread(direct, input.state))) {
      if (direct.status === "paused" || direct.status === "failed") {
        return { action: direct };
      }
      return { action: null, reason: `I found that browser work, but it is ${direct.status}, so there is nothing to retry. If you want a new pass, ask me to prepare it again.` };
    }
    const queueItem = getProtectedQaQueueItems(1000).find((item) => item.index === input.actionId);
    if (queueItem) {
      if (queueItem.action.status === "paused" || queueItem.action.status === "failed") {
        return { action: queueItem.action };
      }
      return { action: null, reason: `QA item ${input.actionId} is ${queueItem.state}, not paused or failed. Ask me to open it or request a change instead.` };
    }
    if (direct) {
      return { action: null, reason: "I found that browser action, but it does not belong to this Slack thread. Ask for debug details if you want the raw queue state." };
    }
    return { action: null, reason: "I could not find that browser action anymore. It may already have been cleared or archived." };
  }

  const candidates = threadBrowserActions(input.state);
  const retryable = candidates.filter((candidate) => candidate.status === "paused" || candidate.status === "failed").slice(-1)[0] ?? null;
  if (retryable) {
    return { action: retryable };
  }
  const latest = candidates.slice(-1)[0] ?? null;
  if (latest) {
    return { action: null, reason: `I found the latest browser work for this thread, but it is ${latest.status}, so there is nothing to retry. If you want a fresh pass, ask me to prepare it again.` };
  }
  return { action: null, reason: "I do not have a paused or failed browser step tied to this thread yet. If this is a prepared application, ask “what’s ready?” and then “retry 1” for the blocked queue item." };
}

async function executeConversationBrainDecision(params: {
  decision: SlackConversationBrainDecision;
  state: ReturnType<typeof getSlackThreadStateByThreadTs>;
  channelId: string;
  threadTs: string;
  text: string;
  client: App["client"];
  copyProvider?: SlackCopyProvider;
  focusQaTab?: (input: { jobId?: string | null; index?: number; query?: string | null }) => Promise<ProtectedQaFocusResult>;
  operatorDeps?: SlackOperatorControlDeps;
  files?: SlackFileLike[];
  upworkUrl?: ParsedUpworkUrl | null;
  messageTs?: string;
}): Promise<boolean> {
  const { decision } = params;
  if (decision.intent === "ignore") {
    if (parseSlackOperatorIntent(params.text)) {
      return false;
    }
    if (params.files?.length && params.state) {
      await handleSlackFilesMessage({
        state: params.state,
        files: params.files,
        channelId: params.channelId,
        threadTs: params.threadTs,
        client: params.client,
        copyProvider: params.copyProvider,
      });
      return true;
    }
    if (params.upworkUrl && params.messageTs) {
      await handleUrlMessage({
        channelId: params.channelId,
        messageTs: params.messageTs,
        threadTs: params.threadTs,
        text: params.text,
        client: params.client,
        copyProvider: params.copyProvider,
      });
      return true;
    }
    logSlackReplySuppressed({
      inboundMessage: params.text,
      classifiedIntent: decision.intent,
      executionPath: "slackReasoningGateway:conversation_brain_ignore",
      suppressionReason: "brain_decision_ignore",
    });
    return false;
  }
  if (decision.confidence === "low" && decision.intent !== "clarify") {
    return false;
  }

  const parsedOperatorIntent = parseSlackOperatorIntent(params.text);
  if (parsedOperatorIntent) {
    const deterministicText = await buildSlackOperatorReply(parsedOperatorIntent, params.operatorDeps);
    const text = await userFacingSlackCopy({
      deterministicText,
      userMessage: params.text,
      intent: `operator_${parsedOperatorIntent.type}`,
      context: { operatorIntent: parsedOperatorIntent.type, plannedActions: decision.actions },
      preservePhrases: [
        deterministicText.includes("Final submit remains manual") ? "Final submit remains manual" : null,
        deterministicText.includes("did not click through login, CAPTCHA, security checks, or submit anything")
          ? "did not click through login, CAPTCHA, security checks, or submit anything"
          : null,
        deterministicText.includes("did not paste through VNC or click submit")
          ? "did not paste through VNC or click submit"
          : null,
      ].filter((phrase): phrase is string => Boolean(phrase)),
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return true;
  }

  if (
    decision.reply &&
    (
      decision.intent === "explain_health_findings" ||
      decision.intent === "clarify" ||
      decision.needsHumanClarification ||
      (!params.state && decision.actions.includes("none") && ![
        "answer_health",
        "check_browser",
        "check_services",
        "pause_hunting",
        "start_hunting",
        "capture_upwork_url",
        "ingest_file",
      ].includes(decision.intent)) ||
      (decision.actions.includes("none") && ![
        "answer_file_capability_question",
        "answer_health",
        "check_browser",
        "check_services",
        "show_cover_letter",
        "full_safe_prep",
        "draft_preview_first",
        "retry_action",
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
        "reject",
        "mark_submitted",
        "record_outcome",
      ].includes(decision.intent))
    )
  ) {
    const text = await userFacingSlackCopy({
      deterministicText: decision.reply,
      userMessage: params.text,
      intent: decision.intent,
      context: { jobId: params.state?.jobId ?? null, threadStatus: params.state?.status ?? null },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return true;
  }

  if (
    decision.intent === "answer_health" ||
    decision.intent === "explain_health_findings" ||
    decision.intent === "check_browser" ||
    decision.intent === "check_services" ||
    decision.intent === "pause_hunting" ||
    decision.intent === "start_hunting" ||
    decision.actions.includes("answer_health") ||
    decision.actions.includes("explain_health_findings") ||
    decision.actions.includes("check_browser") ||
    decision.actions.includes("check_services") ||
    decision.actions.includes("pause_hunting") ||
    decision.actions.includes("start_hunting")
  ) {
    const intent = decision.intent === "pause_hunting" || decision.actions.includes("pause_hunting")
      ? { type: "pause_hunting" as const }
      : decision.intent === "start_hunting" || decision.actions.includes("start_hunting")
        ? { type: "start_hunting" as const }
        : { type: "service_status" as const };
    const deterministicText = await buildSlackOperatorReply(intent, params.operatorDeps);
    const text = await userFacingSlackCopy({
      deterministicText,
      userMessage: params.text,
      intent: decision.intent,
      context: { operatorIntent: intent.type, plannedActions: decision.actions },
      preservePhrases: [
        deterministicText.includes("Final submit remains manual") ? "Final submit remains manual" : null,
      ].filter((phrase): phrase is string => Boolean(phrase)),
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return true;
  }

  if ((decision.intent === "capture_upwork_url" || decision.actions.includes("capture_upwork_url")) && params.upworkUrl && params.messageTs) {
    await handleUrlMessage({
      channelId: params.channelId,
      messageTs: params.messageTs,
      threadTs: params.threadTs,
      text: params.text,
      client: params.client,
      copyProvider: params.copyProvider,
    });
    return true;
  }

  if ((decision.intent === "ingest_file" || decision.actions.includes("ingest_file")) && params.files?.length && params.state) {
    await handleSlackFilesMessage({
      state: params.state,
      files: params.files,
      channelId: params.channelId,
      threadTs: params.threadTs,
      client: params.client,
      copyProvider: params.copyProvider,
    });
    return true;
  }

  if (decision.intent === "qa_queue" || decision.actions.includes("show_qa_queue")) {
    const text = await userFacingSlackCopy({
      deterministicText: formatBatchApplyWorkspaceReply(),
      userMessage: params.text,
      intent: "qa_queue",
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return true;
  }

  if (
    decision.intent === "focus_qa_tab" ||
    decision.intent === "open_application_page" ||
    decision.actions.includes("focus_qa_tab") ||
    decision.actions.includes("open_application_page")
  ) {
    const focus = await (params.focusQaTab ?? focusProtectedQaApplicationTab)({
      jobId: decision.qaIndex ? null : params.state?.jobId ?? null,
      index: decision.qaIndex ?? undefined,
      query: decision.qaQuery ?? null,
    });
    const text = await userFacingSlackCopy({
      deterministicText: focus.text,
      userMessage: params.text,
      intent: "focus_qa_tab",
      context: { jobId: params.state?.jobId ?? null, ok: focus.ok },
      preservePhrases: focus.text.includes("Final submit is still untouched") ? ["Final submit is still untouched."] : [],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    if (focus.ok && params.state) {
      updateSlackThreadStateStatus(params.state.channelId, params.state.threadTs, "status_checked");
    }
    return true;
  }

  if (decision.intent === "retry_action" || decision.actions.includes("retry_browser_action")) {
    if (!params.state && decision.actionId) {
      const queueItem = getProtectedQaQueueItems(1000).find((item) => item.index === decision.actionId);
      const action = queueItem?.action ?? getBrowserActionById(decision.actionId);
      if (!action) {
        const text = await userFacingSlackCopy({
          deterministicText: "I could not find that browser step or prepared application anymore. Ask “what’s ready?” to refresh the current state.",
          userMessage: params.text,
          intent: "retry_action",
          copyProvider: params.copyProvider,
        });
        await postThreadReply(params.client, params.channelId, params.threadTs, text);
        return true;
      }
      if (action.status !== "paused" && action.status !== "failed") {
        const text = await userFacingSlackCopy({
          deterministicText: `That browser work is ${action.status}, so there is nothing to retry. Ask “what’s ready?” to see the current queue.`,
          userMessage: params.text,
          intent: "retry_action",
          context: { actionStatus: action.status },
          copyProvider: params.copyProvider,
        });
        await postThreadReply(params.client, params.channelId, params.threadTs, text);
        return true;
      }
      updateBrowserActionStatus(action.id, "pending", "Slack conversation brain queue retry request.");
      const text = await userFacingSlackCopy({
        deterministicText: "Retry queued — I’ll re-check the remote Chrome page and stop before submit.",
        userMessage: params.text,
        intent: "retry_action",
        preservePhrases: ["stop before submit"],
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return true;
    }

    if (!params.state) {
      return false;
    }
    const resolved = resolveRetryAction({ state: params.state, actionId: decision.actionId ?? undefined });
    const action = resolved.action;
    if (!action) {
      const text = await userFacingSlackCopy({
        deterministicText: resolved.reason,
        userMessage: params.text,
        intent: "retry_action",
        context: { jobId: params.state.jobId, threadStatus: params.state.status },
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return true;
    }
    updateBrowserActionStatus(action.id, "pending", "Slack conversation brain retry request.");
    updateActionQuarantineStatus(action, "retried");
    markBrowserChallengeRetried(action.id);
    const session = getBrowserSessionStatus();
    if (session.blocked) {
      const clearResult = await clearBrowserManualAttention(action.id);
      logger.info(`Cleared browser manual attention for action #${action.id}; state=${clearResult.state}.`);
      markBrowserChallengeRetried(action.id);
    }
    updateSlackThreadStateStatus(params.state.channelId, params.state.threadTs, "retry_requested");
    const text = await userFacingSlackCopy({
      deterministicText: "Retry queued — I’ll re-check the remote Chrome page and stop before submit.",
      userMessage: params.text,
      intent: "retry_action",
      context: { jobId: params.state.jobId, threadStatus: params.state.status },
      preservePhrases: ["stop before submit"],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return true;
  }

  if (params.state && (decision.intent === "full_safe_prep" || decision.actions.includes("queue_prepare_application"))) {
    const ackText = decision.reply?.trim() || "Got it — I’ll prep this lead safely and come back when it’s ready for QA.";
    const result = queuePrepareDraftFromSlackThread({ channelId: params.channelId, threadTs: params.threadTs, ackText });
    if (!result.ok) updateSlackThreadStateStatus(params.state.channelId, params.state.threadTs, result.threadStatus ?? "error");
    const text = await userFacingSlackCopy({
      deterministicText: result.text,
      userMessage: params.text,
      intent: "llm_safe_prepare_application",
      context: { jobId: params.state.jobId, threadStatus: params.state.status, queued: result.ok },
      preservePhrases: [
        ...(params.state.upworkUrl ? [params.state.upworkUrl] : []),
        ...(result.text.toLowerCase().includes("stop before submit") ? ["stop before submit"] : []),
      ],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return true;
  }

  if (!params.state) {
    return false;
  }

  if (decision.intent === "revise_proof_plan" || decision.actions.includes("queue_proof_recheck")) {
    return false;
  }
  if (decision.intent === "revise_draft" || decision.actions.includes("revise_draft")) {
    return false;
  }
  if (decision.intent === "debug_details" || decision.actions.includes("show_debug_details")) {
    return false;
  }
  if (decision.intent === "reject" || decision.actions.includes("mark_skip")) {
    return false;
  }
  if (decision.intent === "mark_submitted" || decision.actions.includes("mark_submitted")) {
    return false;
  }
  if (decision.intent === "record_outcome" || decision.actions.includes("record_outcome")) {
    return false;
  }

  if (
    decision.intent === "answer_file_capability_question" ||
    decision.intent === "show_cover_letter" ||
    decision.intent === "full_safe_prep" ||
    decision.intent === "draft_preview_first" ||
    decision.intent === "status_summary" ||
    decision.intent === "explain_risk" ||
    decision.intent === "explain_proof" ||
    decision.intent === "explain_boost" ||
    decision.intent === "clarify" ||
    decision.actions.includes("queue_prepare_application") ||
    decision.actions.includes("send_draft_preview") ||
    decision.intent === "retry_capture" ||
    decision.actions.includes("retry_capture")
  ) {
    const plan = buildConversationPlanForThread({ state: params.state, text: params.text });
    await executeConversationPlan({
      plan,
      state: params.state,
      channelId: params.channelId,
      threadTs: params.threadTs,
      client: params.client,
      userMessage: params.text,
      copyProvider: params.copyProvider,
    });
    return true;
  }

  return false;
}

export interface SlackReasoningGatewayParams {
  channelId: string;
  threadTs: string;
  text: string;
  client: App["client"];
  intentProvider?: SlackThreadBrainProvider;
  conversationProvider?: SlackConversationBrainProvider;
  copyProvider?: SlackCopyProvider;
  focusQaTab?: (input: { jobId?: string | null; index?: number; query?: string | null }) => Promise<ProtectedQaFocusResult>;
  operatorDeps?: SlackOperatorControlDeps;
  files?: SlackFileLike[];
  messageTs?: string;
  botMentioned?: boolean;
  upworkUrl?: ParsedUpworkUrl | null;
  ownedConversation?: boolean;
  promptSurface?: "dm" | "bot_owned_thread" | "claimed_thread" | "ambient_agent_channel";
}

function shouldFallbackWithoutLlm(params: SlackReasoningGatewayParams, state: ReturnType<typeof getSlackThreadStateByThreadTs>): boolean {
  if (params.ownedConversation || params.promptSurface) return true;
  if (state || params.botMentioned || params.files?.length || params.upworkUrl || parseSlackOperatorIntent(params.text)) return true;
  if (hasDeterministicProductInsightIntent(params.text)) return true;
  return hasExplicitAgentSlackContext(params.text);
}

function hasExplicitAgentSlackContext(text: string): boolean {
  const withoutUrls = text.replace(/https?:\/\/\S+/gi, " ");
  return /\b(?:application|proposal|drafts?|prep|listing|cover letter|qa|queue|chrome|browser|blocked|blocker|attention|wrong|paused|stopping|waiting on me|deal here|proof|portfolio|connects|boost|hunting|running|active|alive|reply please|help me|health|retry|submitted|interview|hired|lost|sources?|search(?:es)?|operator\s+reports?|friday\s+handoff|monthly\s+review|upwork\s+(?:agent|bot|application|listing|proposal)|upload\s+files?|attach\s+files?)\b/i.test(withoutUrls);
}

function shouldAllowSlackLearningAndActions(params: SlackReasoningGatewayParams, state: ReturnType<typeof getSlackThreadStateByThreadTs>): boolean {
  return Boolean(params.ownedConversation || params.promptSurface || state || params.botMentioned || parseSlackOperatorIntent(params.text) || hasDeterministicProductInsightIntent(params.text) || hasExplicitAgentSlackContext(params.text));
}

async function postGatewayProgressReply(params: SlackReasoningGatewayParams, decision: SlackConversationBrainDecision): Promise<void> {
  if (!decision.progressReplyNeeded) return;
  const progress = decision.progressReply?.trim() || "I’m on it — checking the current context before I act.";
  const text = await userFacingSlackCopy({
    deterministicText: progress,
    userMessage: params.text,
    intent: `${decision.intent}:progress`,
    context: { plannedActions: decision.actions },
    copyProvider: params.copyProvider,
  });
  await postThreadReply(params.client, params.channelId, params.threadTs, text);
}

export async function handleSlackReasoningGateway(params: SlackReasoningGatewayParams): Promise<void> {
  const state = getSlackThreadStateByThreadTs(params.channelId, params.threadTs);
  const upworkUrl = params.upworkUrl ?? parseUpworkJobUrlFromText(params.text);
  const hasFiles = Boolean(params.files?.length);
  const relevant = shouldFallbackWithoutLlm({ ...params, upworkUrl }, state);
  const allowLearningAndActions = shouldAllowSlackLearningAndActions({ ...params, upworkUrl }, state);
  const canExecuteConversationBrainAction = relevant && allowLearningAndActions;
  let learnedFromGateway = false;

  if (allowLearningAndActions && params.text.trim()) {
    learnFromSlackMessage({
      channelId: params.channelId,
      threadTs: params.threadTs,
      text: params.text,
      state,
    });
    learnedFromGateway = true;
  }

  const deterministicFirstOperatorIntent = parseSlackOperatorIntent(params.text);
  if (
    canExecuteConversationBrainAction &&
    deterministicFirstOperatorIntent &&
    (
      deterministicFirstOperatorIntent.type === "service_status" ||
      deterministicFirstOperatorIntent.type === "restart_browser_session" ||
      deterministicFirstOperatorIntent.type === "open_remote_chrome"
    )
  ) {
    const deterministicText = await buildSlackOperatorReply(deterministicFirstOperatorIntent, params.operatorDeps);
    const preservePhrases = [
      deterministicText.includes("Final submit remains manual") ? "Final submit remains manual" : null,
      deterministicText.includes("did not click through login, CAPTCHA, security checks, or submit anything")
        ? "did not click through login, CAPTCHA, security checks, or submit anything"
        : null,
      deterministicText.includes("did not paste through VNC or click submit")
        ? "did not paste through VNC or click submit"
        : null,
    ].filter((phrase): phrase is string => Boolean(phrase));
    const text = await userFacingSlackCopy({
      deterministicText,
      userMessage: params.text,
      intent: `operator_${deterministicFirstOperatorIntent.type}`,
      context: {
        operatorIntent: deterministicFirstOperatorIntent.type,
        hasTrackedThread: Boolean(state),
      },
      preservePhrases,
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (canExecuteConversationBrainAction && matchesSkipBlockedApplicationsIntent(params.text)) {
    const result = skipBlockedApplications();
    const text = await userFacingSlackCopy({
      deterministicText: result.text,
      userMessage: params.text,
      intent: "skip_blocked_applications",
      context: {
        skipped: result.skipped,
        browserBlocked: result.browserBlocked,
        finalSubmitManual: true,
      },
      preservePhrases: result.text.includes("I did not submit anything") ? ["I did not submit anything"] : [],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (canExecuteConversationBrainAction && matchesDangerousSubmitAdjacent(params.text)) {
    const deterministicText = buildManualSubmitReminderText(state);
    const text = await userFacingSlackCopy({
      deterministicText,
      userMessage: params.text,
      intent: "manual_submit_reminder",
      context: { jobId: state?.jobId ?? null, finalSubmitManual: true },
      preservePhrases: ["final submit stays manual"],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (canExecuteConversationBrainAction && matchesCompositeBlockedAttentionStatusIntent(params.text)) {
    const deterministicText = buildCompositeBlockedAttentionStatusText();
    const text = await userFacingSlackCopy({
      deterministicText,
      userMessage: params.text,
      intent: "composite_blocked_attention_status",
      context: {
        blockedApplications: collectBlockedApplicationActions().length,
        unresolvedChallengeActions: listUnresolvedBrowserChallengeQuarantines().length,
        browserBlocked: getBrowserSessionStatus().blocked,
      },
      preservePhrases: ["Blocked:", "Needs attention:"],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (canExecuteConversationBrainAction && matchesBlockedStatusIntent(params.text)) {
    const deterministicText = buildBlockedApplicationsStatusText("blocked");
    const text = await userFacingSlackCopy({
      deterministicText,
      userMessage: params.text,
      intent: "blocked_status",
      context: {
        blockedApplications: collectBlockedApplicationActions().length,
        unresolvedChallengeActions: listUnresolvedBrowserChallengeQuarantines().length,
        browserBlocked: getBrowserSessionStatus().blocked,
      },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (canExecuteConversationBrainAction && matchesAttentionStatusIntent(params.text)) {
    const deterministicText = buildBlockedApplicationsStatusText("attention");
    const text = await userFacingSlackCopy({
      deterministicText,
      userMessage: params.text,
      intent: "attention_status",
      context: {
        blockedApplications: collectBlockedApplicationActions().length,
        unresolvedChallengeActions: listUnresolvedBrowserChallengeQuarantines().length,
        browserBlocked: getBrowserSessionStatus().blocked,
      },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (canExecuteConversationBrainAction && matchesNaturalStatusIntent(params.text) && !parseSlackOperatorIntent(params.text)) {
    const deterministicText = state
      ? buildShortStatusReply(state)
      : await buildSlackOperatorReply({ type: "service_status" }, params.operatorDeps);
    const text = await userFacingSlackCopy({
      deterministicText,
      userMessage: params.text,
      intent: "natural_status_check",
      context: { jobId: state?.jobId ?? null, promptSurface: params.promptSurface ?? null },
      preservePhrases: deterministicText.includes("Final submit remains manual") ? ["Final submit remains manual"] : [],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (canExecuteConversationBrainAction && hasFiles && state) {
    await handleSlackFilesMessage({
      state,
      files: params.files ?? [],
      channelId: params.channelId,
      threadTs: params.threadTs,
      client: params.client,
      copyProvider: params.copyProvider,
    });
    return;
  }

  if (canExecuteConversationBrainAction && upworkUrl && (params.botMentioned || state || params.ownedConversation || params.promptSurface) && params.messageTs) {
    await handleUrlMessage({
      channelId: params.channelId,
      messageTs: params.messageTs,
      threadTs: params.threadTs,
      text: params.text,
      client: params.client,
      copyProvider: params.copyProvider,
    });
    return;
  }

  const activeCta = deriveSlackActiveCta(state);
  if (canExecuteConversationBrainAction && activeCtaApprovesPrep(params.text, activeCta) && state) {
    const ackText = await userFacingSlackCopy({
      deterministicText: "Got it — I’ll prep this lead safely and come back when it’s ready for QA.",
      userMessage: params.text,
      intent: "active_cta_approval_prepare_application",
      context: {
        jobId: state.jobId,
        threadStatus: state.status,
        activeCta: activeCta?.text ?? null,
      },
      copyProvider: params.copyProvider,
    });
    const result = queuePrepareDraftFromSlackThread({ channelId: params.channelId, threadTs: params.threadTs, ackText });
    if (!result.ok) updateSlackThreadStateStatus(state.channelId, state.threadTs, result.threadStatus ?? "error");
    const text = await userFacingSlackCopy({
      deterministicText: result.text,
      userMessage: params.text,
      intent: "active_cta_approval_prepare_application",
      context: { jobId: state.jobId, threadStatus: state.status, queued: result.ok },
      preservePhrases: [
        ...(state.upworkUrl ? [state.upworkUrl] : []),
        ...(result.text.toLowerCase().includes("stop before submit") ? ["stop before submit"] : []),
      ],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (canExecuteConversationBrainAction && !state && !activeCta && matchesApplicationProceedIntent(params.text)) {
    const deterministicText = buildApplicationProceedClarificationText();
    const text = await userFacingSlackCopy({
      deterministicText,
      userMessage: params.text,
      intent: "clarify_application_proceed_target",
      preservePhrases: deterministicText.includes("Final submit stays manual") ? ["Final submit stays manual"] : [],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (canExecuteConversationBrainAction && !state && !activeCta && matchesVagueAffirmative(params.text)) {
    const text = await userFacingSlackCopy({
      deterministicText: "I can do that, but I need the lead, QA item, or Upwork link you mean before I touch the browser.",
      userMessage: params.text,
      intent: "clarify_missing_target_for_affirmative",
      preservePhrases: ["need the lead, QA item, or Upwork link"],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  const deterministicBatchCommand = parseSlackThreadCommand(params.text);
  if (canExecuteConversationBrainAction && isProductInsightCommand(deterministicBatchCommand)) {
    const handled = await handleProductInsightCommand(params, deterministicBatchCommand);
    if (handled) return;
  }
  if (canExecuteConversationBrainAction && isBatchWorkspaceCommand(deterministicBatchCommand)) {
    const handled = await handleBatchWorkspaceCommand({
      command: deterministicBatchCommand,
      state,
      channelId: params.channelId,
      threadTs: params.threadTs,
      text: params.text,
      client: params.client,
      copyProvider: params.copyProvider,
      focusQaTab: params.focusQaTab,
    });
    if (handled) return;
  }

  const conversationBrain = await planSlackConversationWithLlm(
    buildSlackConversationBrainInput({
      state,
      text: params.text,
      hasSlackFiles: hasFiles,
      botMentioned: params.botMentioned,
      upworkUrl,
      allowedUser: true,
      allowedChannel: true,
    }),
    params.conversationProvider,
  );
  if (conversationBrain.ok) {
    if (canExecuteConversationBrainAction) {
      persistConversationBrainLearning({
        channelId: params.channelId,
        threadTs: params.threadTs,
        text: params.text,
        state,
        decision: conversationBrain.decision,
      });
      await postGatewayProgressReply(params, conversationBrain.decision);
      const handled = await executeConversationBrainDecision({
        decision: conversationBrain.decision,
        state,
        channelId: params.channelId,
        threadTs: params.threadTs,
        text: params.text,
        client: params.client,
        copyProvider: params.copyProvider,
        focusQaTab: params.focusQaTab,
        operatorDeps: params.operatorDeps,
        files: params.files,
        upworkUrl,
        messageTs: params.messageTs,
      });
      if (handled) return;
    }
  }

  if (!relevant && conversationBrain.ok) {
    logSlackReplySuppressed({
      inboundMessage: params.text,
      classifiedIntent: conversationBrain.decision.intent,
      executionPath: "slackReasoningGateway:irrelevant_conversation",
      suppressionReason: "irrelevant_channel_context",
    });
    return;
  }

  if (!relevant) {
    logSlackReplySuppressed({
      inboundMessage: params.text,
      classifiedIntent: "unclassified_irrelevant",
      executionPath: "slackReasoningGateway:irrelevant_message",
      suppressionReason: "irrelevant_no_agent_context",
    });
    return;
  }

  await handleThreadCommandFallback(params, { skipLearning: learnedFromGateway });
}

export async function handleThreadCommand(params: SlackReasoningGatewayParams): Promise<void> {
  await handleSlackReasoningGateway(params);
}

async function handleThreadCommandFallback(params: SlackReasoningGatewayParams, options: { skipLearning?: boolean } = {}): Promise<void> {
  const state = getSlackThreadStateByThreadTs(params.channelId, params.threadTs);
  const operatorIntent = parseSlackOperatorIntent(params.text);
  if (operatorIntent) {
    const deterministicText = await buildSlackOperatorReply(operatorIntent, params.operatorDeps);
    const preservePhrases = [
      deterministicText.includes("Final submit remains manual") ? "Final submit remains manual" : null,
      deterministicText.includes("did not click through login, CAPTCHA, security checks, or submit anything")
        ? "did not click through login, CAPTCHA, security checks, or submit anything"
        : null,
      deterministicText.includes("did not paste through VNC or click submit")
        ? "did not paste through VNC or click submit"
        : null,
    ].filter((phrase): phrase is string => Boolean(phrase));
    const text = await userFacingSlackCopy({
      deterministicText,
      userMessage: params.text,
      intent: `operator_${operatorIntent.type}`,
      context: {
        operatorIntent: operatorIntent.type,
        hasTrackedThread: Boolean(state),
      },
      preservePhrases,
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (!options.skipLearning) {
    learnFromSlackMessage({
      channelId: params.channelId,
      threadTs: params.threadTs,
      text: params.text,
      state,
    });
  }

  const conversationBrain = await planSlackConversationWithLlm(
    buildSlackConversationBrainInput({
      state,
      text: params.text,
    }),
    params.conversationProvider,
  );
  if (conversationBrain.ok) {
    persistConversationBrainLearning({
      channelId: params.channelId,
      threadTs: params.threadTs,
      text: params.text,
      state,
      decision: conversationBrain.decision,
    });
    const handled = await executeConversationBrainDecision({
      decision: conversationBrain.decision,
      state,
      channelId: params.channelId,
      threadTs: params.threadTs,
      text: params.text,
      client: params.client,
      copyProvider: params.copyProvider,
      focusQaTab: params.focusQaTab,
    });
    if (handled) {
      return;
    }
  }

  const command = await resolveSlackThreadCommand({
    channelId: params.channelId,
    threadTs: params.threadTs,
    text: params.text,
    state,
    provider: params.intentProvider,
  });

  if (command.type === "ignore") {
    const text = await userFacingSlackCopy({
      deterministicText: buildUnknownHumanPromptReply(),
      userMessage: params.text,
      intent: "unknown_human_prompt",
      preservePhrases: ["Final submit stays manual"],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (isProductInsightCommand(command)) {
    const handled = await handleProductInsightCommand(params, command);
    if (handled) return;
  }

  if (isBatchWorkspaceCommand(command)) {
    await handleBatchWorkspaceCommand({
      command,
      state,
      channelId: params.channelId,
      threadTs: params.threadTs,
      text: params.text,
      client: params.client,
      copyProvider: params.copyProvider,
      focusQaTab: params.focusQaTab,
    });
    return;
  }

  if (isDiscoveryHuntingCommand(command.type)) {
    await handleDiscoveryHuntingCommand({
      command,
      text: params.text,
      channelId: params.channelId,
      threadTs: params.threadTs,
      client: params.client,
      copyProvider: params.copyProvider,
    });
    return;
  }

  if (command.type === "retry_action" && !state && command.actionId) {
    const queueItem = getProtectedQaQueueItems(1000).find((item) => item.index === command.actionId);
    const action = queueItem?.action ?? getBrowserActionById(command.actionId);
    if (!action) {
      const text = await userFacingSlackCopy({
        deterministicText: "I could not find that browser step or prepared application anymore. Ask “what’s ready?” to refresh the current state.",
        userMessage: params.text,
        intent: "retry_action",
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return;
    }
    if (action.status !== "paused" && action.status !== "failed") {
      const text = await userFacingSlackCopy({
        deterministicText: `That browser work is ${action.status}, so there is nothing to retry. Ask “what’s ready?” to see the current queue.`,
        userMessage: params.text,
        intent: "retry_action",
        context: { actionStatus: action.status },
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return;
    }
    updateBrowserActionStatus(action.id, "pending", "Slack socket queue retry request.");
    const text = await userFacingSlackCopy({
      deterministicText: "Retry queued — I’ll re-check the remote Chrome page and stop before submit.",
      userMessage: params.text,
      intent: "retry_action",
      preservePhrases: ["stop before submit"],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "memory_query") {
    const reply = buildSalesLearningInsightReply({
      question: command.instruction ?? params.text,
      memories: retrieveRelevantSalesLearningMemories({
        jobId: state?.jobId ?? null,
        text: params.text,
        limit: 20,
      }),
      limit: 4,
    });
    const text = await userFacingSlackCopy({
      deterministicText: reply.text,
      userMessage: params.text,
      intent: "memory_query",
      context: { jobId: state?.jobId ?? null },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "memory_remember") {
    const instruction = command.instruction?.trim();
    if (!instruction) {
      const text = await userFacingSlackCopy({
        deterministicText: "Tell me exactly what to remember.",
        userMessage: params.text,
        intent: "memory_remember",
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return;
    }
    const memory = rememberSalesLearning({
      text: instruction,
      jobId: state?.jobId ?? null,
      channelId: params.channelId,
      threadTs: params.threadTs,
    });
    const text = await userFacingSlackCopy({
      deterministicText: `Got it — I’ll remember that as a ${memory.scope} sales rule.`,
      userMessage: params.text,
      intent: "memory_remember",
      context: { scope: memory.scope },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "memory_forget") {
    const rawInstruction = command.instruction?.trim() ?? "";
    const explicitQuery = rawInstruction && rawInstruction !== "latest relevant memory" ? rawInstruction : null;
    const relevant = explicitQuery ? [] : retrieveRelevantSalesLearningMemories({
      jobId: state?.jobId ?? null,
      text: params.text,
      limit: 1,
    });
    const forgotten = explicitQuery
      ? forgetSalesLearning({ query: explicitQuery })
      : relevant[0]
        ? forgetSalesLearning({ id: relevant[0].id })
        : 0;
    const text = await userFacingSlackCopy({
      deterministicText: forgotten > 0
        ? "Done — I forgot that learning signal."
        : "I could not find a matching sales-learning memory to forget. Name the proof, source, boost, or draft pattern and I’ll remove it.",
      userMessage: params.text,
      intent: "memory_forget",
      context: { forgotten },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "clarify") {
    if (state) {
      const plan = buildConversationPlanForThread({ state, text: params.text });
      await executeConversationPlan({ plan, state, channelId: params.channelId, threadTs: params.threadTs, client: params.client, userMessage: params.text, copyProvider: params.copyProvider });
      return;
    }
    const text = await userFacingSlackCopy({
      deterministicText: buildUnknownHumanPromptReply(),
      userMessage: params.text,
      intent: "clarify_without_thread_state",
      preservePhrases: ["Final submit stays manual"],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "unknown") {
    if (state && shouldAskClarifyingThreadQuestion(params.text)) {
      const plan = buildConversationPlanForThread({ state, text: params.text });
      await executeConversationPlan({ plan, state, channelId: params.channelId, threadTs: params.threadTs, client: params.client, userMessage: params.text, copyProvider: params.copyProvider });
      return;
    }
    const text = await userFacingSlackCopy({
      deterministicText: buildUnknownHumanPromptReply(),
      userMessage: params.text,
      intent: "unknown_human_prompt",
      preservePhrases: ["Final submit stays manual"],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (!state) {
    const text = await userFacingSlackCopy({
      deterministicText: "I heard you, but I can’t find the job tied to this thread. Send the Upwork listing link here and I’ll pick it up.",
      userMessage: params.text,
      intent: "missing_thread_state",
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  const maybeJobStatus = state.jobId ? getApplicationStatus(state.jobId) : null;

  if (command.type === "status") {
    if (!isDebugStatusRequest(params.text)) {
      const plan = buildConversationPlanForThread({ state, text: params.text });
      const deterministicText = plan.intent === "unknown_clarify" ? buildShortStatusReply(state) : plan.reply;
      const text = await userFacingSlackCopy({
        deterministicText,
        userMessage: params.text,
        intent: plan.intent,
        context: { jobId: state.jobId, threadStatus: state.status },
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      updateSlackThreadStateStatus(state.channelId, state.threadTs, "status_checked");
      return;
    }
    const statusText = [
      `Status: ${statusLabel(state.status)}`,
      `Channel message: ${state.messageTs}`,
      `Thread: ${state.threadTs}`,
      `URL: ${state.upworkUrl}`,
      state.jobId ? `Job ID: ${state.jobId}` : "Job ID: unknown",
      state.jobId && maybeJobStatus ? `Application status: ${maybeJobStatus}` : "Application status: not yet created",
      ...buildThreadStatusDetails(state),
    ].join("\n");
    await postThreadReply(params.client, params.channelId, params.threadTs, statusText, {
      inboundMessage: params.text,
      classifiedIntent: "debug_status",
      executionPath: "slackThreadCommandFallback:debug_status",
      handler: "slackThreadCommandFallback:debug_status",
      debugOrSystemOnly: true,
    });
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "status_checked");
    return;
  }

  if (!state.jobId && ["approve", "reject", "revise", "proof_revision", "approve_prepare", "prepare_draft", "draft_preview", "prep_issue_report", "reread_application", "mark_submitted", "record_outcome", "retry_action"].includes(command.type)) {
    const response = `This thread tracks ${state.upworkUrl} but no job id was parsed. ${
      command.type === "approve_prepare" || command.type === "prepare_draft" || command.type === "draft_preview" ? "I can’t prep it until I have the job id. Send the Upwork listing link here and I’ll pick it up." : "Please share a supported Upwork job URL first."
    }`;
    const text = await userFacingSlackCopy({
      deterministicText: response,
      userMessage: params.text,
      intent: command.type,
      context: { upworkUrl: state.upworkUrl },
      preservePhrases: [state.upworkUrl],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "error");
    return;
  }

  if (command.type === "approve") {
    if (state.jobId && maybeJobStatus) {
      updateApplicationStatus(state.jobId, "approved", "Approved from Slack socket thread command.");
    }
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "approve_requested");
    const text = await userFacingSlackCopy({
      deterministicText: `I marked ${humanApplicationLabel(state.jobId)} approved.`,
      userMessage: params.text,
      intent: "approve",
      context: { jobId: state.jobId },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "reject") {
    const blockedAction = resolvePausedChallengeActionForThread(state);
    if (blockedAction) {
      updateBrowserActionStatus(blockedAction.id, "cancelled", "Skipped from Slack after browser challenge quarantine.");
      updateActionQuarantineStatus(blockedAction, "skipped");
      markBrowserChallengeSkipped(blockedAction.id);
      const session = getBrowserSessionStatus();
      if (session.blocked) {
        clearBrowserManualAttention(blockedAction.id);
        markBrowserChallengeSkipped(blockedAction.id);
      }
    }
    if (state.jobId && maybeJobStatus) {
      updateApplicationStatus(state.jobId, "rejected", "Rejected from Slack socket thread command.");
    }
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "reject_requested");
    const text = await userFacingSlackCopy({
      deterministicText: `I archived ${humanApplicationLabel(state.jobId)} from the active QA flow.`,
      userMessage: params.text,
      intent: "reject",
      context: { jobId: state.jobId },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "revise") {
    const result = applySlackThreadRevision({
      channelId: params.channelId,
      threadTs: params.threadTs,
      instruction: command.instruction ?? "",
    });
    if (!result.ok) {
      updateSlackThreadStateStatus(state.channelId, state.threadTs, "error");
    }
    const text = await userFacingSlackCopy({
      deterministicText: result.text,
      userMessage: params.text,
      intent: "revise",
      context: { jobId: state.jobId, ok: result.ok },
      preservePhrases: result.text.includes("Final submit remains manual") ? ["Final submit remains manual"] : [],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "proof_revision") {
    const revision = applySlackProofPlanRevision({
      channelId: params.channelId,
      threadTs: params.threadTs,
      instruction: command.instruction ?? params.text,
    });
    if (!revision.ok) {
      updateSlackThreadStateStatus(state.channelId, state.threadTs, "error");
      const text = await userFacingSlackCopy({
        deterministicText: revision.text,
        userMessage: params.text,
        intent: "proof_revision",
        context: { jobId: state.jobId, ok: false },
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return;
    }
    const result = queuePrepareDraftFromSlackThread({
      channelId: params.channelId,
      threadTs: params.threadTs,
      ackText: revision.text,
      forceRetryPaused: true,
    });
    if (!result.ok) updateSlackThreadStateStatus(state.channelId, state.threadTs, result.threadStatus ?? "error");
    const text = await userFacingSlackCopy({
      deterministicText: result.text,
      userMessage: params.text,
      intent: "proof_revision",
      context: { jobId: state.jobId, threadStatus: state.status, queued: result.ok },
      preservePhrases: state.upworkUrl ? [state.upworkUrl] : [],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "draft_preview") {
    const result = buildDraftPreviewFromSlackThread({
      channelId: params.channelId,
      threadTs: params.threadTs,
      source: command.proposalVersionSource,
    });
    if (!result.ok) {
      updateSlackThreadStateStatus(state.channelId, state.threadTs, "error");
    }
    const text = result.ok
      ? result.text
      : await userFacingSlackCopy({
        deterministicText: result.text,
        userMessage: params.text,
        intent: "draft_preview",
        context: { jobId: state.jobId, ok: result.ok },
        preservePhrases: result.text.includes("Final submit remains manual") ? ["Final submit remains manual"] : [],
        copyProvider: params.copyProvider,
      });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "approve_prepare" || command.type === "prepare_draft") {
    const statefulPlan = command.type === "approve_prepare"
      ? buildConversationPlanForThread({ state, text: params.text })
      : null;
    if (statefulPlan && !statefulPlan.actions.includes("queue_prepare_application")) {
      await executeConversationPlan({
        plan: statefulPlan,
        state,
        channelId: params.channelId,
        threadTs: params.threadTs,
        client: params.client,
        userMessage: params.text,
        copyProvider: params.copyProvider,
      });
      return;
    }
    const ackText = command.replyText
      ? await userFacingSlackCopy({
        deterministicText: command.replyText,
        userMessage: params.text,
        intent: command.type,
        context: { jobId: state.jobId, threadStatus: state.status },
        copyProvider: params.copyProvider,
      })
      : statefulPlan ? await userFacingSlackCopy({
        deterministicText: statefulPlan.reply,
        userMessage: params.text,
        intent: statefulPlan.intent,
        context: { jobId: state.jobId, threadStatus: state.status },
        preservePhrases: statefulPlan.reply.toLowerCase().includes("stop before submit") ? ["stop before submit"] : [],
        copyProvider: params.copyProvider,
      }) : undefined;
    const result = queuePrepareDraftFromSlackThread({ channelId: params.channelId, threadTs: params.threadTs, ackText });
    if (!result.ok) {
      updateSlackThreadStateStatus(state.channelId, state.threadTs, result.threadStatus ?? "error");
    }
    const text = await userFacingSlackCopy({
      deterministicText: result.text,
      userMessage: params.text,
      intent: command.type,
      context: { jobId: state.jobId, threadStatus: state.status, queued: result.ok },
      preservePhrases: [
        ...(state.upworkUrl ? [state.upworkUrl] : []),
        ...(result.text.toLowerCase().includes("stop before submit") ? ["stop before submit"] : []),
      ],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "prep_issue_report") {
    const result = queuePrepareDraftFromSlackThread({
      channelId: params.channelId,
      threadTs: params.threadTs,
      ackText: "Thanks for the catch — I’ll re-check the apply page and only report fields that verify on-page.",
      forceRetryPaused: true,
    });
    if (!result.ok) {
      updateSlackThreadStateStatus(state.channelId, state.threadTs, result.threadStatus ?? "error");
      const text = await userFacingSlackCopy({
        deterministicText: result.text,
        userMessage: params.text,
        intent: "prep_issue_report",
        context: { jobId: state.jobId, threadStatus: state.status, queued: false },
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return;
    }
    const text = await userFacingSlackCopy({
      deterministicText: result.text,
      userMessage: params.text,
      intent: "prep_issue_report",
      context: { jobId: state.jobId, threadStatus: state.status, queued: result.ok },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "reread_application") {
    const result = queueApplicationSnapshotFromSlackThread({
      channelId: params.channelId,
      threadTs: params.threadTs,
      source: command.proposalVersionSource ?? "human_edit_reread",
      note: command.rawText,
    });
    if (!result.ok) updateSlackThreadStateStatus(state.channelId, state.threadTs, "error");
    const text = await userFacingSlackCopy({
      deterministicText: result.text,
      userMessage: params.text,
      intent: "reread_application",
      context: { jobId: state.jobId, queued: result.ok },
      preservePhrases: result.text.includes("read-only") ? ["read-only"] : [],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "retry_action") {
    const resolved = resolveRetryAction({ state, actionId: command.actionId });
    const action = resolved.action;
    if (!action) {
      const text = await userFacingSlackCopy({
        deterministicText: resolved.reason,
        userMessage: params.text,
        intent: "retry_action",
        context: { jobId: state.jobId, threadStatus: state.status },
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return;
    }
    updateBrowserActionStatus(action.id, "pending", "Slack socket retry request.");
    updateActionQuarantineStatus(action, "retried");
    markBrowserChallengeRetried(action.id);
    const session = getBrowserSessionStatus();
    if (session.blocked) {
      const clearResult = await clearBrowserManualAttention(action.id);
      logger.info(`Cleared browser manual attention for action #${action.id}; state=${clearResult.state}.`);
      markBrowserChallengeRetried(action.id);
    }
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "retry_requested");
    const text = await userFacingSlackCopy({
      deterministicText: "Retry queued — I’ll re-check the remote Chrome page and stop before submit.",
      userMessage: params.text,
      intent: "retry_action",
      context: { jobId: state.jobId, threadStatus: state.status },
      preservePhrases: ["stop before submit"],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "retry_capture") {
    const plan = buildConversationPlanForThread({ state, text: params.text });
    await executeConversationPlan({
      plan,
      state,
      channelId: params.channelId,
      threadTs: params.threadTs,
      client: params.client,
      userMessage: params.text,
      copyProvider: params.copyProvider,
    });
    return;
  }

  if (command.type === "mark_submitted") {
    const result = queueApplicationSnapshotFromSlackThread({
      channelId: params.channelId,
      threadTs: params.threadTs,
      source: command.proposalVersionSource ?? "final_submitted",
      markSubmittedAfterCapture: true,
      note: "Steve said the application was submitted; capture current remote Chrome text first when possible.",
    });
    if (!result.ok && state.jobId) {
      const fallback = recordLatestVerifiedProposalFallback({
        jobId: state.jobId,
        reason: "Current remote Chrome text could not be queued for read-only final capture.",
        note: "Steve said submitted; capture action could not be queued.",
      });
      updateApplicationStatus(
        state.jobId,
        "submitted",
        fallback
          ? `Marked submitted from Slack after Steve submitted manually. Preserved ${fallback.label} as a lower-confidence latest verified fallback.`
          : "Marked submitted from Slack after Steve submitted manually. Current remote Chrome text could not be queued; final version is last captured QA version if available."
      );
      updateSlackThreadStateStatus(state.channelId, state.threadTs, "submitted_marked");
    }
    const text = await userFacingSlackCopy({
      deterministicText: result.ok
        ? result.text
        : `I marked ${humanApplicationLabel(state.jobId)} as submitted in local state. I could not queue a final page capture, so I preserved the latest verified version as a lower-confidence fallback if one was available. Final submit remains manual.`,
      userMessage: params.text,
      intent: "mark_submitted",
      context: { jobId: state.jobId, queued: result.ok },
      preservePhrases: ["Final submit remains manual"],
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }

  if (command.type === "record_outcome") {
    if (!command.outcomeStatus) {
      const text = await userFacingSlackCopy({
        deterministicText: "I understand this is an outcome update, but I need one of: got reply, interview booked, hired, or lost.",
        userMessage: params.text,
        intent: "record_outcome",
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return;
    }
    if (!state.jobId) {
      const text = await userFacingSlackCopy({
        deterministicText: "I can’t record that outcome until this thread is tied to a job.",
        userMessage: params.text,
        intent: "record_outcome",
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return;
    }
    if (!maybeJobStatus) {
      updateSlackThreadStateStatus(state.channelId, state.threadTs, "error");
      const text = await userFacingSlackCopy({
        deterministicText: "I found the thread, but there is no application record to update yet.",
        userMessage: params.text,
        intent: "record_outcome",
        context: { jobId: state.jobId },
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return;
    }

    const updated = updateApplicationStatus(
      state.jobId,
      command.outcomeStatus,
      `Outcome recorded from Slack socket thread command: ${command.rawText}`
    );
    if (!updated) {
      updateSlackThreadStateStatus(state.channelId, state.threadTs, "error");
      const text = await userFacingSlackCopy({
        deterministicText: "I couldn’t record that outcome for this application.",
        userMessage: params.text,
        intent: "record_outcome",
        context: { jobId: state.jobId },
        copyProvider: params.copyProvider,
      });
      await postThreadReply(params.client, params.channelId, params.threadTs, text);
      return;
    }

    updateSlackThreadStateStatus(state.channelId, state.threadTs, "outcome_recorded");
    recordApplicationOutcomeLearning({
      jobId: state.jobId,
      outcome: command.outcomeStatus,
      note: `Outcome recorded from Slack socket thread command: ${command.rawText}`,
      source: "slack_outcome_command",
    });
    void reflectOnSalesOutcomeWithLlm({
      jobId: state.jobId,
      outcome: command.outcomeStatus,
      note: `Outcome recorded from Slack socket thread command: ${command.rawText}`,
      source: "slack_outcome_command",
    }).catch((error) => {
      logger.warn(`Sales learning reflection skipped: ${error instanceof Error ? error.message : String(error)}`);
    });
    const outcomeLabel = command.outcomeLabel ?? command.outcomeStatus;
    const text = await userFacingSlackCopy({
      deterministicText: `Outcome recorded: ${humanApplicationLabel(state.jobId)} is now ${outcomeLabel}. I’ll use that signal in future fit/proof learning.`,
      userMessage: params.text,
      intent: "record_outcome",
      context: { jobId: state.jobId, outcome: outcomeLabel },
      copyProvider: params.copyProvider,
    });
    await postThreadReply(params.client, params.channelId, params.threadTs, text);
    return;
  }
}

export async function runSlackSocket(): Promise<void> {
  const startupError = getSlackSocketStartupError();
  if (startupError) {
    throw new Error(startupError);
  }

  const app = new App({
    token: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
    socketMode: true,
  });

  app.error(async (error) => {
    logger.error(`Slack socket error: ${String((error as Error).message || error)}`);
  });

  app.event("message", async ({ event, client }) => {
    await handleSlackSocketTextEvent(event as SlackSocketTextEvent, client);
  });

  app.event("app_mention", async ({ event, client }) => {
    await handleSlackSocketTextEvent(event as SlackSocketTextEvent, client);
  });

  await app.start();
  logger.info("Slack Socket Mode started.");
  const allowed = SLACK_ALLOWED_CHANNEL_IDS.length ? SLACK_ALLOWED_CHANNEL_IDS.join(", ") : "all configured channels";
  const allowedUsers = SLACK_ALLOWED_USER_IDS.length ? SLACK_ALLOWED_USER_IDS.join(", ") : "all configured users";
  logger.info(`Listening on channel(s): ${allowed}; user scope: ${allowedUsers}`);
}

if (require.main === module) {
  runSlackSocket().catch((error) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
