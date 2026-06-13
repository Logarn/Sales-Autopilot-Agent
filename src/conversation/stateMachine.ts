import type { SlackConversationIntent } from "../slackConversationPlanner";
import type { ParsedIntent } from "./intentParser";

export type ConversationActiveTask =
  | "awaiting_capture"
  | "awaiting_draft"
  | "awaiting_prep_decision"
  | "awaiting_revision"
  | "in_browser"
  | "awaiting_submit"
  | null;

export interface PendingDecision {
  id: string;
  type: "prep" | "revision" | "submit" | "proof" | "capture";
  description: string;
  createdAt: string;
}

export interface ConversationState {
  activeJobId: string | null;
  activeTask: ConversationActiveTask;
  pendingDecisions: PendingDecision[];
  informationGaps: string[];
  confirmedFacts: Map<string, unknown>;
  preferences: {
    draftTone?: "concise" | "detailed";
    proofStyle?: "metric_heavy" | "narrative";
    boostTolerance?: number;
  };
  messageCount: number;
  lastIntent: SlackConversationIntent | null;
  lastActionResult: "success" | "failed" | "partial" | null;
}

export interface ActionResult {
  action: string;
  success: boolean;
  partial?: boolean;
  jobId?: string | null;
  draftReady?: boolean;
  capturePending?: boolean;
  browserActive?: boolean;
  informationGaps?: string[];
  confirmedFacts?: Record<string, unknown>;
}

function blankState(): ConversationState {
  return {
    activeJobId: null,
    activeTask: null,
    pendingDecisions: [],
    informationGaps: [],
    confirmedFacts: new Map<string, unknown>(),
    preferences: {},
    messageCount: 0,
    lastIntent: null,
    lastActionResult: null,
  };
}

function cloneState(state: ConversationState): ConversationState {
  return {
    ...state,
    pendingDecisions: [...state.pendingDecisions],
    informationGaps: [...state.informationGaps],
    confirmedFacts: new Map(state.confirmedFacts),
    preferences: { ...state.preferences },
  };
}

function intentToSlackIntent(intent: ParsedIntent): SlackConversationIntent {
  switch (intent.primary) {
    case "prep":
      return intent.modifiers.negation ? "banter_no_action" : "prepare_application";
    case "retry":
      return "retry_capture";
    case "show":
      return intent.modifiers.scope === "proof" ? "explain_proof" : "show_cover_letter";
    case "revise":
      return intent.modifiers.scope === "proof" ? "revise_proof_plan" : "revise_draft";
    case "skip":
      return "skip_job";
    case "status":
      return "status_summary";
    default:
      return "unknown_clarify";
  }
}

function nextPendingDecision(intent: ParsedIntent, result: ActionResult): PendingDecision | null {
  if (intent.primary === "prep" && intent.modifiers.negation) return null;
  if (result.action === "queue_prepare_application") {
    return {
      id: "manual-submit",
      type: "submit",
      description: "Remote Chrome can be prepared, but final Upwork submit requires manual approval.",
      createdAt: new Date().toISOString(),
    };
  }
  if (intent.primary === "revise") {
    return {
      id: "review-revision",
      type: "revision",
      description: "Review the requested draft or proof revision before browser prep continues.",
      createdAt: new Date().toISOString(),
    };
  }
  return null;
}

function uniqueDecisions(decisions: PendingDecision[]): PendingDecision[] {
  const byId = new Map<string, PendingDecision>();
  for (const decision of decisions) {
    byId.set(decision.id, decision);
  }
  return [...byId.values()];
}

export class ConversationStateManager {
  private static readonly states = new Map<string, ConversationState>();

  static getOrCreate(threadTs: string): ConversationState {
    const existing = this.states.get(threadTs);
    if (existing) return existing;
    const state = blankState();
    this.states.set(threadTs, state);
    return state;
  }

  static update(threadTs: string, mutator: (s: ConversationState) => void): void {
    const state = this.getOrCreate(threadTs);
    mutator(state);
  }

  static reset(threadTs: string): void {
    this.states.delete(threadTs);
  }

  static resetAll(): void {
    this.states.clear();
  }
}

export function updateState(
  current: ConversationState,
  intent: ParsedIntent,
  result: ActionResult,
): ConversationState {
  const next = cloneState(current);
  next.messageCount += 1;
  next.activeJobId = result.jobId ?? intent.entities.jobId ?? next.activeJobId;
  next.lastIntent = intentToSlackIntent(intent);
  next.lastActionResult = result.partial ? "partial" : result.success ? "success" : "failed";

  for (const [key, value] of Object.entries(result.confirmedFacts ?? {})) {
    next.confirmedFacts.set(key, value);
  }
  if (typeof result.draftReady === "boolean") next.confirmedFacts.set("draftReady", result.draftReady);
  if (typeof result.capturePending === "boolean") next.confirmedFacts.set("capturePending", result.capturePending);
  if (typeof result.browserActive === "boolean") next.confirmedFacts.set("browserActive", result.browserActive);

  next.informationGaps = [...new Set(result.informationGaps ?? next.informationGaps)];

  const pending = nextPendingDecision(intent, result);
  next.pendingDecisions = uniqueDecisions(pending ? [...next.pendingDecisions, pending] : next.pendingDecisions);

  if (intent.primary === "revise") {
    next.activeTask = "awaiting_revision";
  } else if (result.browserActive || result.action === "queue_prepare_application") {
    next.activeTask = "in_browser";
  } else if (result.action === "retry_capture" || result.capturePending) {
    next.activeTask = "awaiting_capture";
  } else if (result.draftReady === false && next.activeJobId) {
    next.activeTask = "awaiting_draft";
  } else if (result.draftReady) {
    next.activeTask = "awaiting_prep_decision";
  } else if (intent.primary === "prep" && !result.success) {
    next.activeTask = "awaiting_draft";
  }

  return next;
}
