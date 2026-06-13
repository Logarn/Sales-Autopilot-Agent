import type { ApplicationDraft, BrowserAction, BrowserActionStatus, BrowserActionType, ScoredJob } from "./types";

export type SlackWorkflowStateName =
  | "url_received"
  | "capture_queued"
  | "capture_in_progress"
  | "capture_failed"
  | "job_captured"
  | "draft_requested"
  | "draft_generating"
  | "draft_ready"
  | "proof_plan_ready"
  | "prep_requested"
  | "prep_blocked_missing_draft"
  | "prep_queued"
  | "prep_in_progress"
  | "qa_ready"
  | "qa_blocked";

export type SlackWorkflowPromiseType =
  | "capture_draft_proof_plan"
  | "draft_preview"
  | "safe_prep";

export type SlackWorkflowPromiseStatus = "pending" | "fulfilled" | "blocked";

export interface SlackWorkflowPromiseSnapshot {
  type: SlackWorkflowPromiseType;
  status: SlackWorkflowPromiseStatus;
  text: string;
  createdAt: string;
  fulfilledAt?: string | null;
  blockedAt?: string | null;
  blocker?: string | null;
  requestedByUserText?: string | null;
}

export interface SlackWorkflowStateSnapshot {
  channelId: string;
  threadTs: string;
  workflowState: SlackWorkflowStateName;
  draftRequested: boolean;
  prepRequested: boolean;
  latestAgentPromise: SlackWorkflowPromiseSnapshot | null;
  lastUserMessage: string | null;
  lastAgentReply: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SlackThreadStateLike {
  channelId: string;
  messageTs: string;
  threadTs: string;
  upworkUrl: string;
  jobId: string | null;
  status: string;
}

export interface SlackWorkflowProofPlanSnapshot {
  files: string[];
  portfolioHighlights: string[];
  certificates: string[];
  mentionOnly: string[];
  unavailableOnPage: boolean;
}

export interface SlackWorkflowConnectsSnapshot {
  required: number | null;
  boost: number | null;
  total: number | null;
  boostReason?: string | null;
}

export interface UnifiedSlackJobContext {
  channelId: string;
  threadTs: string;
  latestUserMessage: string | null;
  threadState: SlackThreadStateLike | null;
  workflowStateRecord: SlackWorkflowStateSnapshot | null;
  explicitUpworkUrl: string | null;
  normalizedJobId: string | null;
  job: ScoredJob | null;
  draft: ApplicationDraft | null;
  proofPlan: SlackWorkflowProofPlanSnapshot;
  connects: SlackWorkflowConnectsSnapshot;
  captureAction: BrowserAction | null;
  prepAction: BrowserAction | null;
  latestBrowserAction: BrowserAction | null;
  applicationStatus: string | null;
  workflowState: SlackWorkflowStateName;
  captureState: "none" | "queued" | "in_progress" | "failed" | "done";
  draftState: "missing" | "requested" | "generating" | "ready";
  proofPlanState: "missing" | "ready";
  prepState: "none" | "requested" | "blocked_missing_draft" | "queued" | "in_progress" | "blocked" | "done";
  qaState: "none" | "waiting" | "blocked";
  latestAgentPromise: SlackWorkflowPromiseSnapshot | null;
  nextSafeAction: string;
  blocker: string | null;
  finalSubmitManual: true;
}

export interface BuildUnifiedSlackJobContextInput {
  channelId: string;
  threadTs: string;
  latestUserMessage?: string | null;
  threadState: SlackThreadStateLike | null;
  workflowStateRecord?: SlackWorkflowStateSnapshot | null;
  explicitUpworkUrl?: string | null;
  job: ScoredJob | null;
  draft: ApplicationDraft | null;
  proofPlan: SlackWorkflowProofPlanSnapshot;
  connects: SlackWorkflowConnectsSnapshot;
  captureAction?: BrowserAction | null;
  prepAction?: BrowserAction | null;
  latestBrowserAction?: BrowserAction | null;
  applicationStatus?: string | null;
}

function isActionStatus(action: BrowserAction | null | undefined, statuses: BrowserActionStatus[]): boolean {
  return Boolean(action && statuses.includes(action.status));
}

function isActionType(action: BrowserAction | null | undefined, type: BrowserActionType): boolean {
  return Boolean(action && action.actionType === type);
}

function hasDraft(draft: ApplicationDraft | null): boolean {
  return Boolean(draft?.proposalText?.trim());
}

function hasProofPlan(input: Pick<BuildUnifiedSlackJobContextInput, "draft" | "proofPlan">): boolean {
  return Boolean(
    input.draft?.proofStrategy ||
    input.draft?.selectedPortfolioItems?.length ||
    input.proofPlan.files.length ||
    input.proofPlan.portfolioHighlights.length ||
    input.proofPlan.certificates.length ||
    input.proofPlan.mentionOnly.length
  );
}

function deriveCaptureState(input: BuildUnifiedSlackJobContextInput): UnifiedSlackJobContext["captureState"] {
  if (isActionType(input.captureAction, "capture_job_from_url")) {
    if (isActionStatus(input.captureAction, ["pending"])) return "queued";
    if (isActionStatus(input.captureAction, ["in_progress"])) return "in_progress";
    if (isActionStatus(input.captureAction, ["failed", "paused", "cancelled"])) return "failed";
    if (isActionStatus(input.captureAction, ["completed"])) return "done";
  }
  if (input.threadState?.status === "capture_pending") return "queued";
  if (input.threadState?.status === "capture_failed" || input.threadState?.status === "error") return "failed";
  if (input.job || input.threadState?.status === "captured" || input.threadState?.status === "scored" || input.threadState?.status === "packet_sent") return "done";
  return input.threadState?.upworkUrl || input.explicitUpworkUrl ? "queued" : "none";
}

function derivePrepState(input: BuildUnifiedSlackJobContextInput, draftReady: boolean): UnifiedSlackJobContext["prepState"] {
  if (input.applicationStatus === "prepared_for_qa") return "done";
  if (isActionType(input.prepAction, "prepare_application_review")) {
    if (isActionStatus(input.prepAction, ["pending"])) return "queued";
    if (isActionStatus(input.prepAction, ["in_progress"])) return "in_progress";
    if (isActionStatus(input.prepAction, ["failed", "paused", "cancelled"])) return "blocked";
    if (isActionStatus(input.prepAction, ["completed"])) return "done";
  }
  if (input.workflowStateRecord?.prepRequested && !draftReady) return "blocked_missing_draft";
  if (input.workflowStateRecord?.prepRequested || input.threadState?.status === "prepare_draft_requested") return "requested";
  return "none";
}

function deriveWorkflowState(input: BuildUnifiedSlackJobContextInput): SlackWorkflowStateName {
  const draftReady = hasDraft(input.draft);
  const proofReady = hasProofPlan(input);
  const captureState = deriveCaptureState(input);
  const prepState = derivePrepState(input, draftReady);
  const latestPromise = input.workflowStateRecord?.latestAgentPromise;

  if (input.applicationStatus === "prepared_for_qa" || prepState === "done") return "qa_ready";
  if (prepState === "blocked") return "qa_blocked";
  if (prepState === "in_progress") return "prep_in_progress";
  if (prepState === "queued") return "prep_queued";
  if (prepState === "blocked_missing_draft") return "prep_blocked_missing_draft";
  if (prepState === "requested") return "prep_requested";
  if (proofReady) return "proof_plan_ready";
  if (draftReady) return "draft_ready";
  if (input.workflowStateRecord?.draftRequested && captureState === "done") return "draft_generating";
  if (input.workflowStateRecord?.draftRequested || latestPromise?.type === "draft_preview") return "draft_requested";
  if (captureState === "failed") return "capture_failed";
  if (captureState === "in_progress") return "capture_in_progress";
  if (captureState === "queued") return "capture_queued";
  if (input.job) return "job_captured";
  return "url_received";
}

function deriveDraftState(input: BuildUnifiedSlackJobContextInput, captureState: UnifiedSlackJobContext["captureState"]): UnifiedSlackJobContext["draftState"] {
  if (hasDraft(input.draft)) return "ready";
  if (input.workflowStateRecord?.draftRequested) return captureState === "queued" || captureState === "in_progress" ? "generating" : "requested";
  if (captureState === "queued" || captureState === "in_progress") return "generating";
  return "missing";
}

function buildBlocker(input: {
  workflowState: SlackWorkflowStateName;
  captureState: UnifiedSlackJobContext["captureState"];
  draftState: UnifiedSlackJobContext["draftState"];
  prepState: UnifiedSlackJobContext["prepState"];
  latestBrowserAction: BrowserAction | null;
  promise: SlackWorkflowPromiseSnapshot | null;
}): string | null {
  if (input.promise?.status === "blocked" && input.promise.blocker) return input.promise.blocker;
  if (input.workflowState === "prep_blocked_missing_draft") return "Safe browser prep is blocked until the proposal draft exists.";
  if (input.captureState === "failed") return input.latestBrowserAction?.lastError || "Capture failed or was paused before the draft was generated.";
  if (input.prepState === "blocked") return input.latestBrowserAction?.lastError || "Browser prep is blocked and needs review.";
  return null;
}

function buildNextSafeAction(input: {
  hasTarget: boolean;
  captureState: UnifiedSlackJobContext["captureState"];
  draftState: UnifiedSlackJobContext["draftState"];
  prepState: UnifiedSlackJobContext["prepState"];
  qaState: UnifiedSlackJobContext["qaState"];
  blocker: string | null;
}): string {
  if (!input.hasTarget) return "Send the Upwork job URL.";
  if (input.qaState === "waiting") return "Review the prepared application in QA; final submit remains manual.";
  if (input.qaState === "blocked") return "Clear or report the browser blocker, then ask me to retry.";
  if (input.prepState === "queued" || input.prepState === "in_progress") return "Wait for browser prep to finish, then QA the held application.";
  if (input.draftState === "ready") return "Ask me to show the draft or say \"prep it\" to queue safe browser prep.";
  if (input.captureState === "queued" || input.captureState === "in_progress") return "Wait for capture/draft generation, or say \"retry capture\" if it is stuck.";
  if (input.captureState === "failed") return "Say \"retry capture\" or send the listing link again.";
  return input.blocker ?? "Ask me to generate/show the draft first.";
}

export function buildUnifiedSlackJobContext(input: BuildUnifiedSlackJobContextInput): UnifiedSlackJobContext {
  const captureState = deriveCaptureState(input);
  const draftState = deriveDraftState(input, captureState);
  const prepState = derivePrepState(input, draftState === "ready");
  const qaState: UnifiedSlackJobContext["qaState"] = input.applicationStatus === "prepared_for_qa" || prepState === "done"
    ? "waiting"
    : prepState === "blocked"
      ? "blocked"
      : "none";
  const workflowState = deriveWorkflowState(input);
  const blocker = buildBlocker({
    workflowState,
    captureState,
    draftState,
    prepState,
    latestBrowserAction: input.latestBrowserAction ?? null,
    promise: input.workflowStateRecord?.latestAgentPromise ?? null,
  });
  const normalizedJobId = input.threadState?.jobId ?? input.job?.id ?? null;
  const hasTarget = Boolean(normalizedJobId || input.threadState?.upworkUrl || input.explicitUpworkUrl);
  return {
    channelId: input.channelId,
    threadTs: input.threadTs,
    latestUserMessage: input.latestUserMessage ?? null,
    threadState: input.threadState,
    workflowStateRecord: input.workflowStateRecord ?? null,
    explicitUpworkUrl: input.explicitUpworkUrl ?? null,
    normalizedJobId,
    job: input.job,
    draft: input.draft,
    proofPlan: input.proofPlan,
    connects: input.connects,
    captureAction: input.captureAction ?? null,
    prepAction: input.prepAction ?? null,
    latestBrowserAction: input.latestBrowserAction ?? null,
    applicationStatus: input.applicationStatus ?? null,
    workflowState,
    captureState,
    draftState,
    proofPlanState: hasProofPlan(input) ? "ready" : "missing",
    prepState,
    qaState,
    latestAgentPromise: input.workflowStateRecord?.latestAgentPromise ?? null,
    nextSafeAction: buildNextSafeAction({ hasTarget, captureState, draftState, prepState, qaState, blocker }),
    blocker,
    finalSubmitManual: true,
  };
}

export function workflowStateFromSlackThreadStatus(status: string | null | undefined): SlackWorkflowStateName {
  switch (status) {
    case "capture_pending":
      return "capture_queued";
    case "capture_failed":
    case "error":
      return "capture_failed";
    case "captured":
    case "scored":
      return "job_captured";
    case "packet_sent":
      return "proof_plan_ready";
    case "draft_preview_sent":
      return "draft_ready";
    case "prepare_draft_requested":
      return "prep_requested";
    case "prepared_draft":
      return "qa_ready";
    case "manual_attention_required":
    case "retry_requested":
      return "qa_blocked";
    default:
      return "url_received";
  }
}

export function buildThreadWorkflowStatusReply(ctx: UnifiedSlackJobContext): string {
  const label = ctx.job?.title?.trim() || ctx.threadState?.upworkUrl || ctx.explicitUpworkUrl || "this application";
  const capture = ctx.captureState === "none" ? "not started" : ctx.captureState.replace(/_/g, " ");
  const draft = ctx.draftState === "ready"
    ? "ready"
    : ctx.draftState === "generating"
      ? "being generated"
      : ctx.draftState;
  const proof = ctx.proofPlanState === "ready" ? "ready" : "not ready";
  const prep = ctx.prepState.replace(/_/g, " ");
  const qa = ctx.qaState === "waiting" ? "waiting for review" : ctx.qaState;
  return [
    `${label}:`,
    `Capture: ${capture}. Draft: ${draft}. Proof plan: ${proof}. Prep: ${prep}. QA: ${qa}.`,
    ctx.blocker ? `Blocker: ${ctx.blocker}` : null,
    `Next safe action: ${ctx.nextSafeAction}`,
    "Final submit remains manual.",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function isDraftPreviewStatusIntent(value: string): boolean {
  const text = value.toLowerCase().replace(/[.!?]+$/g, "").trim();
  return (
    /^(?:draft|proposal|cover\s*letter|cover letter\?|proposal\?|draft\?)$/.test(text) ||
    /\b(?:show|send|post)\s+(?:me\s+)?(?:the\s+)?(?:draft|proposal|cover\s*letter|cv)\b/.test(text) ||
    /\b(?:can|could)\s+i\s+see\s+(?:the\s+)?(?:draft|proposal|cover\s*letter|cv)\b/.test(text) ||
    /\bwhat\s+did\s+you\s+write\b/.test(text) ||
    /\b(?:send|post)\s+it\s+(?:here\s+)?(?:too\s+)?(?:once|when)\s+(?:it\s+is\s+)?ready\b/.test(text) ||
    /\b(?:send|post)\s+(?:me\s+)?(?:the\s+)?(?:draft|proposal|cover\s*letter|cv)\s+(?:here\s+)?(?:once|when)\s+(?:it\s+is\s+)?ready\b/.test(text)
  );
}

export function isExplicitRevisionIntent(value: string): boolean {
  const text = value.toLowerCase().replace(/[.!?]+$/g, "").trim();
  return /^(?:revise|rewrite|change|edit|adjust|update|fix|make)\b/.test(text) ||
    /\b(?:change|revise|rewrite|edit|fix|adjust|update)\s+(?:the\s+)?(?:opener|draft|proposal|cover\s*letter|cta|proof|tone|section)\b/.test(text);
}
