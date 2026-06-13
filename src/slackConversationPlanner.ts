import type { ApplicationDraft, BrowserAction, ScoredJob } from "./types";
import { IntentParser } from "./conversation/intentParser";
import type { ParsedIntent } from "./conversation/intentParser";
import {
  ConversationStateManager,
  updateState,
  type ActionResult,
  type ConversationState,
} from "./conversation/stateMachine";
import { looksLikeProofPlanRevision } from "./proofPlanOverrides";

export type SlackConversationIntent =
  | "answer_file_capability_question"
  | "show_cover_letter"
  | "show_qa_queue"
  | "prepare_application"
  | "draft_preview_first"
  | "attach_uploaded_files"
  | "retry_after_files"
  | "revise_proof_plan"
  | "revise_draft"
  | "explain_risk"
  | "explain_proof"
  | "explain_boost"
  | "status_summary"
  | "skip_job"
  | "debug_details"
  | "banter_no_action"
  | "unknown_clarify"
  | "retry_capture";

export type SlackConversationAction =
  | "queue_prepare_application"
  | "send_draft_preview"
  | "retry_prepare_after_files"
  | "queue_proof_recheck"
  | "show_debug_details"
  | "mark_skip"
  | "none"
  | "retry_capture";

export interface SlackConversationPlannerInput {
  threadTs?: string;
  latestMessage: string;
  threadHistory: string[];
  activeCta?: {
    action: "prep_application" | "retry" | "review" | "none";
    source: "latest_bot_cta" | "thread_status" | "thread_reply" | "none";
    text: string | null;
  } | null;
  job: ScoredJob | null;
  draft: ApplicationDraft | null;
  currentBrowserAction: BrowserAction | null;
  missingFiles: string[];
  proofPlan: {
    files: string[];
    portfolioHighlights: string[];
    certificates: string[];
    mentionOnly: string[];
    unavailableOnPage: boolean;
  };
  connects: {
    required: number | null;
    boost: number | null;
    total: number | null;
    boostReason?: string | null;
  };
  hasSlackFiles: boolean;
}

export interface SlackConversationPlan {
  intent: SlackConversationIntent;
  confidence: "high" | "medium" | "low";
  reply: string;
  actions: SlackConversationAction[];
  clarificationNeeded: boolean;
  debugRequested: boolean;
}

function isBrowserActionActive(action: BrowserAction | null): boolean {
  return Boolean(action && ["pending", "in_progress", "queued"].includes(action.status));
}

function isCapturePending(action: BrowserAction | null): boolean {
  return Boolean(
    action?.actionType === "capture_job_from_url" &&
    ["pending", "in_progress", "queued"].includes(action.status),
  );
}

function syncConversationStateFromInput(state: ConversationState, input: SlackConversationPlannerInput): void {
  const hasDraft = Boolean(input.draft?.proposalText?.trim());
  const capturePending = isCapturePending(input.currentBrowserAction);
  const browserActive = isBrowserActionActive(input.currentBrowserAction);
  const gaps = [
    !input.job ? "job" : null,
    !hasDraft ? "draft" : null,
    input.missingFiles.length > 0 ? "files" : null,
  ].filter((item): item is string => Boolean(item));

  state.activeJobId = input.job?.id ?? state.activeJobId;
  state.confirmedFacts.set("draftReady", hasDraft);
  state.confirmedFacts.set("capturePending", capturePending);
  state.confirmedFacts.set("browserActive", browserActive);
  state.confirmedFacts.set("missingFileCount", input.missingFiles.length);
  state.informationGaps = gaps;

  if (browserActive) {
    state.activeTask = "in_browser";
  } else if (capturePending) {
    state.activeTask = "awaiting_capture";
  } else if (input.job && !hasDraft) {
    state.activeTask = "awaiting_draft";
  } else if (hasDraft) {
    state.activeTask = "awaiting_prep_decision";
  }
}

function actionResultFromPlan(plan: SlackConversationPlan, input: SlackConversationPlannerInput): ActionResult {
  const action = plan.actions.find((candidate) => candidate !== "none") ?? "none";
  return {
    action,
    success: !plan.clarificationNeeded && plan.confidence !== "low",
    partial: plan.clarificationNeeded || plan.confidence === "medium",
    jobId: input.job?.id ?? null,
    draftReady: Boolean(input.draft?.proposalText?.trim()),
    capturePending: isCapturePending(input.currentBrowserAction),
    browserActive: isBrowserActionActive(input.currentBrowserAction) || action === "queue_prepare_application",
    informationGaps: [
      !input.job ? "job" : null,
      !input.draft?.proposalText?.trim() ? "draft" : null,
      input.missingFiles.length > 0 ? "files" : null,
    ].filter((item): item is string => Boolean(item)),
    confirmedFacts: {
      hasSlackFiles: input.hasSlackFiles,
      pendingSequentialIntent: Boolean(plan.actions.includes("queue_prepare_application")),
    },
  };
}

function applyPlannerStateUpdate(
  threadTs: string | undefined,
  state: ConversationState | null,
  intent: ParsedIntent | null,
  plan: SlackConversationPlan,
  input: SlackConversationPlannerInput,
): SlackConversationPlan {
  if (!threadTs || !state || !intent) return plan;
  const next = updateState(state, intent, actionResultFromPlan(plan, input));
  ConversationStateManager.update(threadTs, (current) => {
    current.activeJobId = next.activeJobId;
    current.activeTask = next.activeTask;
    current.pendingDecisions = next.pendingDecisions;
    current.informationGaps = next.informationGaps;
    current.confirmedFacts = next.confirmedFacts;
    current.preferences = next.preferences;
    current.messageCount = next.messageCount;
    current.lastIntent = next.lastIntent;
    current.lastActionResult = next.lastActionResult;
  });
  return plan;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function fileNames(paths: string[]): string[] {
  return paths.map((item) => item.split(/[\\/]/).pop() ?? item).filter(Boolean);
}

function conciseJobLabel(job: ScoredJob | null): string {
  if (!job) return "this lead";
  return job.title.length > 72 ? `${job.title.slice(0, 69)}...` : job.title;
}

function isVagueAffirmative(text: string): boolean {
  return /^(?:yes|yep|yeah|yup|sure|sure thing|ok|okay|go for it|do it|sounds good|move on it|let'?s run it|handle it|prep it|go ahead)(?:\s+please)?$/.test(text) ||
    /^(?:yes|yep|yeah|yup|sure|ok|okay),?\s+(?:go for it|do it|sounds good|move on it|let'?s run it|handle it|prep it|go ahead)$/.test(text) ||
    /\b(?:go for it|sounds good|move on it|let'?s run it|handle it|prep it|go ahead)\b/.test(text);
}

function isPrepCorrection(text: string): boolean {
  return /\b(?:no|nope|not that|i meant|meant|instead)\b.*\b(?:prep|prepare|put (?:it|this) in upwork|fill (?:it|this) in upwork|open the app|open the application)\b/.test(text);
}

function isProceedWithApplicationIntent(text: string): boolean {
  return /\b(?:please\s+)?proceed(?:\s+with)?(?:\s+the)?\s+(?:drafts?|applications?|apps?|proposal|prep)\b/.test(text) ||
    /\b(?:start|prep|prepare)\s+(?:with\s+)?one\s+(?:application|app)\b/.test(text) ||
    /\b(?:do|handle)\s+the\s+next\s+(?:application|app)\b/.test(text) ||
    /\b(?:can you|could you)\s+handle\s+(?:an|one)\s+(?:application|app)\s+now\b/.test(text) ||
    /\b(?:let'?s\s+move\s+forward|move\s+forward|go\s+ahead)\b.*\b(?:applications?|apps?|prep|drafts?)\b/.test(text);
}

function isDangerousSubmitAdjacent(text: string): boolean {
  if (/^(?:i|we)\s+(?:sent|submitted)\b/.test(text)) return false;
  if (/^submitted(?:\s+after\s+editing)?$/.test(text)) return false;
  return /^(?:send it|submit it|fire it off|send this|submit this|send the proposal|submit the proposal|send application|submit application|send the application|submit the application)$/.test(text) ||
    /\b(?:please\s+)?(?:send|submit)\s+(?:it|this|the\s+(?:proposal|application))\b/.test(text) ||
    /\bfire\s+(?:it|this)\s+off\b/.test(text);
}

function isNaturalStatus(text: string): boolean {
  const clean = text.replace(/[.!?]+$/g, "").trim();
  return /^(?:what the fuck are you up to|wtf are you up to|what are you up to|are we live|are you live|you running|are you running|are you active|you active|are you alive|you alive|you there|talk to me|what(?:'|’)?s happening|where are we|are we good|how(?:'|’)?s it going|how is your day going|can you help me|can you help me with something|i need a reply please|need a reply please|what(?:'|’)?s waiting on me|what is waiting on me|what needs me now)$/.test(clean);
}

function fileCapabilityReply(input: SlackConversationPlannerInput): string {
  const reusable = fileNames(input.proofPlan.files);
  const missing = fileNames(input.missingFiles);
  const reusableLine = reusable.length > 0
    ? `For this job, I already have these reusable files available: ${reusable.slice(0, 4).join(", ")}.`
    : "For this job, I do not have a reusable file selected yet.";
  const missingLine = missing.length > 0 ? ` I’m currently missing: ${missing.slice(0, 4).join(", ")}.` : "";
  return [
    "Yes. For reusable proof, I can use files already in my proof-assets folder.",
    "For one-off files, attach them in this Slack thread and I can ingest them when Slack files access is enabled.",
    reusableLine + missingLine,
    "Next, I can attach the available proof in remote Chrome or ingest files you add here, then stop before submit.",
  ].join(" ");
}

function statusReply(input: SlackConversationPlannerInput): string {
  const bits = [
    input.draft?.proposalText ? "draft ready" : "draft not ready",
    input.missingFiles.length > 0 ? `${input.missingFiles.length} file${input.missingFiles.length === 1 ? "" : "s"} missing` : "files ok or not needed",
    input.connects.required === null ? "Connects unknown" : `${input.connects.required} required Connects`,
    input.connects.boost && input.connects.boost > 0 ? `${input.connects.boost} boost` : "no boost set",
  ];
  const next = input.missingFiles.length > 0
    ? "Attach the missing files here and I’ll ingest them."
    : input.draft?.proposalText
      ? "Say “put it in Upwork” when you want me to fill the page."
      : "Send the listing or retry capture so I can generate the draft.";
  return `${conciseJobLabel(input.job)}: ${bits.join("; ")}. ${next}`;
}

function proofReply(input: SlackConversationPlannerInput): string {
  const parts = [
    input.proofPlan.files.length > 0 ? `Files: ${fileNames(input.proofPlan.files).slice(0, 4).join(", ")}` : "Files: none selected yet",
    input.proofPlan.portfolioHighlights.length > 0 ? `Portfolio/profile: ${input.proofPlan.portfolioHighlights.slice(0, 3).join(", ")}` : "Portfolio/profile: none selected yet",
    input.proofPlan.certificates.length > 0 ? `Certificates: ${input.proofPlan.certificates.slice(0, 3).join(", ")}` : "Certificates: none selected yet",
    input.proofPlan.mentionOnly.length > 0 ? `Mention-only: ${input.proofPlan.mentionOnly.slice(0, 3).join(", ")}` : "Mention-only: none",
  ];
  const unavailable = input.proofPlan.unavailableOnPage ? " If Upwork only shows add-portfolio/add-certificate controls, I’ll report proof unavailable instead of claiming it was selected." : "";
  return `${parts.join(". ")}.${unavailable}`;
}

function boostReply(input: SlackConversationPlannerInput): string {
  if (input.connects.required === null) {
    return "Required Connects are still unknown. I won’t set a boost until the apply page exposes the Connects and boost table.";
  }
  if (!input.connects.boost || input.connects.boost <= 0) {
    return input.connects.boostReason || "No boost is set. I only boost high-fit jobs when the visible table shows a safe top-4 bid under 50 Connects.";
  }
  return `Boost is planned at ${input.connects.boost} Connects. I will never set optional boost above 50, and final submit remains manual.`;
}

function coverLetterReply(input: SlackConversationPlannerInput): string {
  const draft = input.draft?.proposalText?.trim();
  if (!draft) {
    return "I haven’t generated the cover letter/CV draft yet. I can draft it here first, then wait for your approval before filling Upwork.";
  }
  const frustrated = /\b(wtf|what the fuck|just need|need the cv|cv you used)\b/i.test(input.latestMessage);
  const intro = frustrated
    ? "You’re right — here’s the draft/CV I have for this thread."
    : "Here’s the cover letter I drafted.";
  const verificationLine = input.currentBrowserAction?.status === "paused" || input.currentBrowserAction?.status === "failed"
    ? "I have not verified it on the Upwork page yet because the browser prep is paused."
    : input.currentBrowserAction?.status === "completed"
      ? "The last remote Chrome prep completed, but final submit is still manual."
      : "I have not filled Upwork unless you explicitly told me to put it in the remote Chrome page.";
  return [
    intro,
    verificationLine,
    "",
    draft,
    "",
    "Want me to revise it before filling or retrying remote Chrome?",
  ].join("\n");
}

export function planSlackConversation(input: SlackConversationPlannerInput): SlackConversationPlan {
  const text = normalize(input.latestMessage);
  const debugRequested = /\b(debug|technical details|raw status|full details|dump|which skills|skills did you use|skill trace|skill-use trace)\b/.test(text);
  const conversationState = input.threadTs ? ConversationStateManager.getOrCreate(input.threadTs) : null;
  if (conversationState) {
    syncConversationStateFromInput(conversationState, input);
  }
  const parsedIntent = conversationState ? IntentParser.parse(input.latestMessage, conversationState, input.job) : null;
  const finish = (plan: SlackConversationPlan): SlackConversationPlan =>
    applyPlannerStateUpdate(input.threadTs, conversationState, parsedIntent, plan, input);

  // ===== LAYER 1 FIX: State-aware intent routing =====
  // If user wants to prep but no draft exists, route to status/capture-retry instead
  const hasDraft = Boolean(input.draft?.proposalText?.trim());
  const wantsToPrep = (parsedIntent?.primary === "prep" && !parsedIntent.modifiers.negation) ||
                       /\b(use this|looks good|put it in upwork|fill it in upwork|prepare it|prep it|prepare applications?|prepare application)\b/.test(text) ||
                       /\b(everything that needs to be done|do everything|all safe prep|handle everything)\b/.test(text) ||
                       isProceedWithApplicationIntent(text) ||
                       (input.activeCta?.action === "prep_application" && (isVagueAffirmative(text) || isPrepCorrection(text)));

  if (parsedIntent?.primary === "prep" && parsedIntent.modifiers.negation) {
    return finish({
      intent: "banter_no_action",
      confidence: "high",
      reply: "Got it. I won't prep the Upwork page for this yet. Final submit stays manual.",
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (wantsToPrep && !hasDraft) {
    // Check if capture is still pending
    const capturePending = input.currentBrowserAction?.actionType === "capture_job_from_url" &&
                           ["pending", "in_progress", "queued"].includes(input.currentBrowserAction?.status ?? "");

    if (capturePending) {
      return finish({
        intent: "status_summary",
        confidence: "high",
        reply: `Capture is still running for ${conciseJobLabel(input.job)}. I can't prep Upwork until the draft is generated. Check back in a moment or say "retry capture" if it's stuck.`,
        actions: ["none"],
        clarificationNeeded: false,
        debugRequested: false,
      });
    }

    // Capture failed or never completed
    return finish({
      intent: "status_summary",
      confidence: "high",
      reply: `I don't have a draft for ${conciseJobLabel(input.job)} yet. The capture may have failed or not started. Say "retry capture" or send the listing link again.`,
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }
  // ===== END LAYER 1 FIX =====

  if (debugRequested) {
    return finish({
      intent: "debug_details",
      confidence: "high",
      reply: "I’ll show the technical details for this thread.",
      actions: ["show_debug_details"],
      clarificationNeeded: false,
      debugRequested: true,
    });
  }

  if (input.hasSlackFiles) {
    return finish({
      intent: "attach_uploaded_files",
      confidence: "high",
      reply: "I’ll ingest the attached files for this application.",
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (isDangerousSubmitAdjacent(text)) {
    return finish({
      intent: "status_summary",
      confidence: "high",
      reply: `I can prep or review ${conciseJobLabel(input.job)}, but final submit stays manual. I will not click the final Upwork submit button.`,
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (parsedIntent?.primary === "prep" && !parsedIntent.modifiers.negation && hasDraft) {
    return finish({
      intent: "prepare_application",
      confidence: parsedIntent.confidence,
      reply: "I’ll fill the safe fields in remote Chrome and stop before submit.",
      actions: ["queue_prepare_application"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (input.activeCta?.action === "prep_application" && (isVagueAffirmative(text) || isPrepCorrection(text) || isProceedWithApplicationIntent(text))) {
    return finish({
      intent: "prepare_application",
      confidence: "high",
      reply: "Got it — I’ll prep the safe fields for this lead and stop before submit.",
      actions: ["queue_prepare_application"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (!input.activeCta && isVagueAffirmative(text)) {
    return finish({
      intent: "unknown_clarify",
      confidence: "medium",
      reply: "I can do that, but I need the lead, QA item, or Upwork link you mean before I touch the browser.",
      actions: ["none"],
      clarificationNeeded: true,
      debugRequested: false,
    });
  }

  if (/\b(can|could|are you able to|would you be able to)\b.*\b(upload|attach|use)\b.*\b(file|files|pdf|pdfs|asset|assets)\b/.test(text) ||
    /\b(upload|attach)\b.*\bfrom here\b/.test(text)) {
    return finish({
      intent: "answer_file_capability_question",
      confidence: "high",
      reply: fileCapabilityReply(input),
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/\b(show|send|post|what'?s|where'?s)\b.*\bcover\s*letter\b/.test(text) ||
    /\b(show|send|post)\b.*\bdraft\b.*\b(used|wrote|filled)\b/.test(text) ||
    /\bcover\s*letter\b.*\b(used|drafted|wrote|show|send|post)\b/.test(text) ||
    /\b(?:cv|proposal)\b.*\b(?:used|show|send|post|need|wrote|drafted)\b/.test(text) ||
    /\b(?:show|send|post|need)\b.*\b(?:cv|proposal)\b/.test(text)) {
    return finish({
      intent: "show_cover_letter",
      confidence: "high",
      reply: coverLetterReply(input),
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/\b(what[’']?s ready|show qa queue|qa queue|what is blocked|what[’']?s blocked)\b/.test(text)) {
    return finish({
      intent: "show_qa_queue",
      confidence: "high",
      reply: "I’ll show the current QA queue.",
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (looksLikeProofPlanRevision(input.latestMessage)) {
    return finish({
      intent: "revise_proof_plan",
      confidence: "high",
      reply: "Got it - I’ll update the proof plan and recheck the remote Chrome draft.",
      actions: ["queue_proof_recheck"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/\b(show|send|post)\b.*\bdraft\b.*\b(here|first|before filling|before fill|slack)\b/.test(text) ||
    /\bdraft\b.*\bhere first\b/.test(text) ||
    /\blet me see\b.*\bdraft\b/.test(text)) {
    return finish({
      intent: "draft_preview_first",
      confidence: "high",
      reply: "I’ll show the draft here first and won’t fill Upwork yet.",
      actions: ["send_draft_preview"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/\b(everything that needs to be done|do everything|all safe prep|handle everything)\b/.test(text)) {
    return finish({
      intent: "prepare_application",
      confidence: "high",
      reply: "Got it — I’ll do all safe prep steps: draft, files, portfolio, Connects, and boost. I’ll still stop before submit.",
      actions: ["queue_prepare_application"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/\b(use this|looks good|put it in upwork|fill it in upwork|prepare it|prep it|prepare applications?|prepare application)\b/.test(text) || isProceedWithApplicationIntent(text)) {
    return finish({
      intent: "prepare_application",
      confidence: "high",
      reply: "I’ll fill the safe fields in remote Chrome and stop before submit.",
      actions: ["queue_prepare_application"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/\b(retry after files|retry.*files|try again.*files)\b/.test(text)) {
    return finish({
      intent: "retry_after_files",
      confidence: "high",
      reply: "I'll retry application prep using the ingested files.",
      actions: ["retry_prepare_after_files"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/\b(retry capture|recapture|re-capture|capture again|retry the capture|retry capture)\b/.test(text)) {
    return finish({
      intent: "retry_capture",
      confidence: "high",
      reply: "I'll re-queue the browser capture for this job.",
      actions: ["retry_capture"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/\b(why|risk|red flags?|concern|what'?s the deal here|what is the deal here|deal here)\b/.test(text)) {
    const risk = input.job?.scoreBreakdown.risks.slice(0, 2).join("; ") || input.draft?.redFlags.slice(0, 2).join("; ") || "No major risk is recorded yet.";
    return finish({
      intent: "explain_risk",
      confidence: "medium",
      reply: `Main risk: ${risk}`,
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/\b(proof|portfolio|certificate|file|attachment)\b/.test(text)) {
    return finish({
      intent: "explain_proof",
      confidence: "medium",
      reply: proofReply(input),
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/\b(boost|bid|connects)\b/.test(text)) {
    return finish({
      intent: "explain_boost",
      confidence: "medium",
      reply: boostReply(input),
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/^(status|where are we|what now|what's next|next)$/i.test(input.latestMessage.trim()) || isNaturalStatus(text)) {
    return finish({
      intent: "status_summary",
      confidence: "high",
      reply: statusReply(input),
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/\b(skip|pass|decline)\b/.test(text)) {
    return finish({
      intent: "skip_job",
      confidence: "high",
      reply: "Got it. I’ll mark this one skipped.",
      actions: ["mark_skip"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  if (/^(thanks|thank you|nice|cool|ok|okay|got it|👍)$/i.test(input.latestMessage.trim())) {
    return finish({
      intent: "banter_no_action",
      confidence: "medium",
      reply: "Got it.",
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    });
  }

  return finish({
    intent: "unknown_clarify",
    confidence: "low",
    reply: "I’m not sure which part you want changed. Tell me the specific draft, proof, file, boost, or QA update and I’ll apply it.",
    actions: ["none"],
    clarificationNeeded: true,
    debugRequested: false,
  });
}
