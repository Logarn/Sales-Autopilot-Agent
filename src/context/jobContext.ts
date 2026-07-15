import { buildBrowserApplyPlan, type BrowserApplyPlanResult } from "../browserApply";
import { deriveCaptureThreadJobId, extractUpworkJobIdFromUrl } from "../browserCapture";
import {
  getApplicationDraft,
  getApplicationJobLink,
  getApplicationProofPlanOverrides,
  getBrowserActionById,
  getScoredJobForSlackPreview,
  getSlackThreadStateByJobId,
  getSlackThreadStateByThreadTs,
  listBrowserActions,
  type ApplicationJobLink,
  type SlackThreadState,
} from "../db";
import { buildSalesLearningPromptContext, type SalesLearningPromptContext } from "../salesLearningMemory";
import type {
  ApplicationDraft,
  BrowserAction,
  BrowserApplyFillPlan,
  BrowserApplyValidationIssue,
  DraftQualityGateResult,
  JobIntelligence,
  ProofPlanOverrideState,
  ScoredJob,
  SkillUseTrace,
  SourceBackedConnects,
} from "../types";

export type JobContextBuildSource = "job_id" | "slack_thread" | "browser_action" | "unresolved";

export type JobContextActiveTask =
  | "awaiting_capture"
  | "awaiting_draft"
  | "awaiting_prep_decision"
  | "in_browser"
  | "awaiting_submit"
  | "complete"
  | "unknown";

export type JobContextConnectsLevel =
  | "unknown"
  | "job_estimate"
  | "source_backed_draft"
  | "browser_plan"
  | "browser_action_payload";

export interface JobContextBuildInput {
  jobId?: string | null;
  channelId?: string | null;
  threadTs?: string | null;
  browserActionId?: number | null;
  includeBrowserPlan?: boolean;
  salesLearningLimit?: number;
}

export interface JobContextConversationState {
  activeJobId: string | null;
  activeTask: JobContextActiveTask;
  informationGaps: string[];
  lastThreadStatus: string | null;
  lastBrowserActionStatus: string | null;
}

export interface JobContextConnectsStatus {
  known: boolean;
  level: JobContextConnectsLevel;
  required: number | null;
  boost: number | null;
  total: number | null;
  confidence: SourceBackedConnects["confidence"];
  approvalRequired: boolean | null;
  decision: string | null;
  evidence: string[];
  issues: string[];
}

export interface JobContextProofState {
  selectedPortfolioItems: string[];
  proofStrategySummary: string | null;
  proofStrategyWarnings: string[];
  browserHighlights: string[];
  mentionOnlyProof: string[];
  missingLocalAssets: string[];
}

export interface JobContext {
  buildSource: JobContextBuildSource;
  jobId: string | null;
  sourceQuery: string | null;
  upworkUrl: string | null;
  job: ScoredJob | null;
  draft: ApplicationDraft | null;
  intelligence: JobIntelligence | null;
  applicationLink: ApplicationJobLink | null;
  threadState: SlackThreadState | null;
  latestBrowserAction: BrowserAction | null;
  browserPlanResult: BrowserApplyPlanResult | null;
  browserPlan: BrowserApplyFillPlan | null;
  browserPlanIssues: BrowserApplyValidationIssue[];
  conversationState: JobContextConversationState;
  salesLearning: SalesLearningPromptContext;
  proofOverrides: ProofPlanOverrideState | null;
  proofState: JobContextProofState;
  connectsStatus: JobContextConnectsStatus;
  connectsKnown: boolean;
  requiredConnects: number | null;
  skillUseTrace: SkillUseTrace | null;
  qualityGate: DraftQualityGateResult | null;
}

export interface JobContextDependencies {
  getApplicationDraft: typeof getApplicationDraft;
  getApplicationJobLink: typeof getApplicationJobLink;
  getApplicationProofPlanOverrides: typeof getApplicationProofPlanOverrides;
  getBrowserActionById: typeof getBrowserActionById;
  getScoredJobForSlackPreview: typeof getScoredJobForSlackPreview;
  getSlackThreadStateByJobId: typeof getSlackThreadStateByJobId;
  getSlackThreadStateByThreadTs: typeof getSlackThreadStateByThreadTs;
  listBrowserActions: typeof listBrowserActions;
  buildBrowserApplyPlan: typeof buildBrowserApplyPlan;
  buildSalesLearningPromptContext: typeof buildSalesLearningPromptContext;
}

const DEFAULT_DEPS: JobContextDependencies = {
  getApplicationDraft,
  getApplicationJobLink,
  getApplicationProofPlanOverrides,
  getBrowserActionById,
  getScoredJobForSlackPreview,
  getSlackThreadStateByJobId,
  getSlackThreadStateByThreadTs,
  listBrowserActions,
  buildBrowserApplyPlan,
  buildSalesLearningPromptContext,
};

function normalizeJobId(value: string | null | undefined): string | null {
  return value && value.trim() ? value.trim() : null;
}

function actionPayloadString(action: BrowserAction | null, key: string): string | null {
  const value = action?.payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function deriveThreadCaptureJobId(thread: SlackThreadState | null): string | null {
  if (!thread?.upworkUrl) return null;
  const parsed = extractUpworkJobIdFromUrl(thread.upworkUrl);
  return deriveCaptureThreadJobId(thread.upworkUrl, parsed);
}

function latestActionForCandidates(
  deps: JobContextDependencies,
  candidates: Set<string>,
): BrowserAction | null {
  if (candidates.size === 0) return null;
  return deps.listBrowserActions(null, 1000)
    .filter((action) => candidates.has(action.jobId))
    .slice(-1)[0] ?? null;
}

function resolveLatestBrowserAction(
  input: JobContextBuildInput,
  deps: JobContextDependencies,
  resolvedJobId: string | null,
  threadState: SlackThreadState | null,
): BrowserAction | null {
  if (input.browserActionId) {
    const explicit = deps.getBrowserActionById(input.browserActionId);
    if (explicit) return explicit;
  }

  const candidates = new Set<string>();
  if (resolvedJobId) candidates.add(resolvedJobId);
  const threadCaptureId = deriveThreadCaptureJobId(threadState);
  if (threadCaptureId) candidates.add(threadCaptureId);
  return latestActionForCandidates(deps, candidates);
}

function chooseUpworkUrl(input: {
  threadState: SlackThreadState | null;
  action: BrowserAction | null;
  applicationLink: ApplicationJobLink | null;
  job: ScoredJob | null;
}): string | null {
  return input.threadState?.upworkUrl ||
    actionPayloadString(input.action, "canonicalJobUrl") ||
    actionPayloadString(input.action, "url") ||
    input.applicationLink?.url ||
    input.job?.url ||
    null;
}

function chooseBuildSource(input: JobContextBuildInput, threadState: SlackThreadState | null, action: BrowserAction | null, jobId: string | null): JobContextBuildSource {
  if (threadState) return "slack_thread";
  if (action) return "browser_action";
  if (jobId) return "job_id";
  return "unresolved";
}

function inferActiveTask(input: {
  threadState: SlackThreadState | null;
  draft: ApplicationDraft | null;
  latestBrowserAction: BrowserAction | null;
  browserPlanResult: BrowserApplyPlanResult | null;
}): JobContextActiveTask {
  const threadStatus = input.threadState?.status;
  const action = input.latestBrowserAction;
  if (
    threadStatus === "capture_pending" ||
    (action?.actionType === "capture_job_from_url" && ["pending", "in_progress"].includes(action.status))
  ) {
    return "awaiting_capture";
  }
  if (!input.draft?.proposalText?.trim()) return "awaiting_draft";
  if (action?.actionType === "prepare_application_review" && ["pending", "in_progress", "paused"].includes(action.status)) {
    return "in_browser";
  }
  if (threadStatus === "prepared_draft" || input.draft.status === "prepared_for_qa") return "awaiting_submit";
  if (threadStatus === "submitted_marked" || input.draft.status === "applied" || input.draft.status === "submitted") return "complete";
  if (input.browserPlanResult?.valid) return "awaiting_prep_decision";
  return "unknown";
}

function buildInformationGaps(input: {
  job: ScoredJob | null;
  draft: ApplicationDraft | null;
  latestBrowserAction: BrowserAction | null;
  connectsStatus: JobContextConnectsStatus;
  browserPlanResult: BrowserApplyPlanResult | null;
}): string[] {
  const gaps = new Set<string>();
  if (!input.job) gaps.add("job");
  if (!input.job?.description?.trim()) gaps.add("job_description");
  if (!input.draft?.proposalText?.trim()) gaps.add("draft");
  if (!input.connectsStatus.known) gaps.add("connects");
  if (!input.draft?.skillUseTrace) gaps.add("skill_use_trace");
  if (!input.draft?.copyStrategy) gaps.add("copy_strategy");
  if (!input.draft?.draftQualityGate) gaps.add("draft_quality_gate");
  for (const issue of input.browserPlanResult?.issues ?? []) {
    if (issue.severity === "error") gaps.add(issue.code);
  }
  if (input.latestBrowserAction?.status === "failed") gaps.add("browser_action_failed");
  if (input.latestBrowserAction?.status === "paused") gaps.add("browser_action_paused");
  return [...gaps];
}

function connectsFromActionPayload(action: BrowserAction | null): SourceBackedConnects | null {
  const candidate = action?.payload.capturedConnects;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Partial<SourceBackedConnects>;
  const confidence = record.confidence;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low" && confidence !== "unknown") return null;
  return {
    requiredConnects: typeof record.requiredConnects === "number" ? record.requiredConnects : null,
    boostConnects: typeof record.boostConnects === "number" ? record.boostConnects : null,
    totalConnects: typeof record.totalConnects === "number" ? record.totalConnects : null,
    confidence,
    sourceText: typeof record.sourceText === "string" ? record.sourceText : null,
    sourceLocation: typeof record.sourceLocation === "string" ? record.sourceLocation : null,
    extractionMethod: record.extractionMethod ?? "not_found",
  };
}

export function deriveConnectsStatus(input: {
  draft: ApplicationDraft | null;
  job: ScoredJob | null;
  browserPlanResult: BrowserApplyPlanResult | null;
  latestBrowserAction: BrowserAction | null;
}): JobContextConnectsStatus {
  const payloadConnects = connectsFromActionPayload(input.latestBrowserAction);
  if (payloadConnects && payloadConnects.requiredConnects !== null) {
    return {
      known: true,
      level: "browser_action_payload",
      required: payloadConnects.requiredConnects,
      boost: payloadConnects.boostConnects,
      total: payloadConnects.totalConnects,
      confidence: payloadConnects.confidence,
      approvalRequired: null,
      decision: null,
      evidence: [payloadConnects.sourceText, payloadConnects.sourceLocation, payloadConnects.extractionMethod].filter((item): item is string => Boolean(item)),
      issues: [],
    };
  }

  const sourceBacked = input.draft?.connectsStrategy?.sourceBackedConnects;
  if (sourceBacked?.requiredConnects !== null && sourceBacked?.requiredConnects !== undefined) {
    return {
      known: true,
      level: "source_backed_draft",
      required: sourceBacked.requiredConnects,
      boost: sourceBacked.boostConnects,
      total: sourceBacked.totalConnects,
      confidence: sourceBacked.confidence,
      approvalRequired: input.draft?.connectsStrategy?.decision === "manual_review" ? true : null,
      decision: input.draft?.connectsStrategy?.decision ?? null,
      evidence: [sourceBacked.sourceText, sourceBacked.sourceLocation, sourceBacked.extractionMethod].filter((item): item is string => Boolean(item)),
      issues: input.draft?.connectsStrategy?.risks ?? [],
    };
  }

  const plan = input.browserPlanResult?.plan;
  if (plan?.connects.required !== null && plan?.connects.required !== undefined) {
    return {
      known: true,
      level: "browser_plan",
      required: plan.connects.required,
      boost: plan.connects.boost,
      total: plan.connects.total,
      confidence: plan.connectsStrategy.sourceBackedConnects?.confidence ?? "low",
      approvalRequired: plan.connects.approvalRequired,
      decision: plan.connectsStrategy.decision,
      evidence: plan.connectsEvidence,
      issues: plan.connects.notes,
    };
  }

  const scoreConnects = input.job?.scoreBreakdown.connectsStrategy;
  if (scoreConnects?.requiredConnects !== null && scoreConnects?.requiredConnects !== undefined) {
    return {
      known: false,
      level: "job_estimate",
      required: scoreConnects.requiredConnects,
      boost: scoreConnects.suggestedBoostConnects,
      total: scoreConnects.totalConnects,
      confidence: scoreConnects.sourceBackedConnects?.confidence ?? "unknown",
      approvalRequired: scoreConnects.decision === "manual_review",
      decision: scoreConnects.decision,
      evidence: scoreConnects.reasons,
      issues: scoreConnects.risks,
    };
  }

  return {
    known: false,
    level: "unknown",
    required: null,
    boost: null,
    total: null,
    confidence: "unknown",
    approvalRequired: null,
    decision: null,
    evidence: [],
    issues: ["Required Connects are not known from source-backed capture or browser plan."],
  };
}

function buildProofState(draft: ApplicationDraft | null, browserPlan: BrowserApplyFillPlan | null): JobContextProofState {
  return {
    selectedPortfolioItems: draft?.selectedPortfolioItems.map((item) => item.name) ?? [],
    proofStrategySummary: draft?.proofStrategy?.summary ?? null,
    proofStrategyWarnings: draft?.proofStrategy?.warnings ?? [],
    browserHighlights: browserPlan?.highlights ?? [],
    mentionOnlyProof: browserPlan?.mentionOnlyProof ?? [],
    missingLocalAssets: browserPlan?.missingLocalAssets ?? [],
  };
}

export class JobContextManager {
  constructor(private readonly deps: JobContextDependencies = DEFAULT_DEPS) {}

  build(input: JobContextBuildInput): JobContext {
    const threadState = input.channelId && input.threadTs
      ? this.deps.getSlackThreadStateByThreadTs(input.channelId, input.threadTs)
      : null;
    const explicitAction = input.browserActionId ? this.deps.getBrowserActionById(input.browserActionId) : null;
    const resolvedJobId = normalizeJobId(input.jobId) ||
      normalizeJobId(threadState?.jobId) ||
      normalizeJobId(explicitAction?.jobId) ||
      null;
    const job = resolvedJobId ? this.deps.getScoredJobForSlackPreview(resolvedJobId) : null;
    const draft = resolvedJobId ? this.deps.getApplicationDraft(resolvedJobId) : null;
    const applicationLink = resolvedJobId ? this.deps.getApplicationJobLink(resolvedJobId) : null;
    const latestBrowserAction = explicitAction ?? resolveLatestBrowserAction(input, this.deps, resolvedJobId, threadState);
    const effectiveJobId = resolvedJobId ??
      normalizeJobId(job?.id) ??
      normalizeJobId(draft?.jobId) ??
      normalizeJobId(latestBrowserAction?.jobId) ??
      null;
    const effectiveThreadState = threadState ?? (effectiveJobId ? this.deps.getSlackThreadStateByJobId(effectiveJobId) : null);
    const browserPlanResult = input.includeBrowserPlan === false || !effectiveJobId
      ? null
      : this.safeBuildBrowserPlan(effectiveJobId);
    const browserPlan = browserPlanResult?.plan ?? null;
    const connectsStatus = deriveConnectsStatus({ draft, job, browserPlanResult, latestBrowserAction });
    const sourceText = [
      job?.title,
      job?.description,
      draft?.proposalText,
      draft?.jobUnderstanding?.commercialPain,
      draft?.copyStrategy?.one_sentence_sales_argument,
      draft?.proofStrategy?.summary,
    ].filter((item): item is string => Boolean(item && item.trim())).join("\n");
    const salesLearning = this.deps.buildSalesLearningPromptContext({
      jobId: effectiveJobId,
      job,
      text: sourceText,
      limit: input.salesLearningLimit ?? 8,
    });
    const conversationState: JobContextConversationState = {
      activeJobId: effectiveJobId,
      activeTask: inferActiveTask({ threadState: effectiveThreadState, draft, latestBrowserAction, browserPlanResult }),
      informationGaps: buildInformationGaps({ job, draft, latestBrowserAction, connectsStatus, browserPlanResult }),
      lastThreadStatus: effectiveThreadState?.status ?? null,
      lastBrowserActionStatus: latestBrowserAction?.status ?? null,
    };

    return {
      buildSource: chooseBuildSource(input, threadState, latestBrowserAction, effectiveJobId),
      jobId: effectiveJobId,
      sourceQuery: job?.sourceQuery ?? null,
      upworkUrl: chooseUpworkUrl({ threadState: effectiveThreadState, action: latestBrowserAction, applicationLink, job }),
      job,
      draft,
      intelligence: draft?.jobIntelligence ?? job?.applicationDraft?.jobIntelligence ?? null,
      applicationLink,
      threadState: effectiveThreadState,
      latestBrowserAction,
      browserPlanResult,
      browserPlan,
      browserPlanIssues: browserPlanResult?.issues ?? [],
      conversationState,
      salesLearning,
      proofOverrides: effectiveJobId ? this.deps.getApplicationProofPlanOverrides(effectiveJobId) : null,
      proofState: buildProofState(draft, browserPlan),
      connectsStatus,
      connectsKnown: connectsStatus.known,
      requiredConnects: connectsStatus.required,
      skillUseTrace: draft?.skillUseTrace ?? null,
      qualityGate: draft?.draftQualityGate ?? null,
    };
  }

  buildForJob(jobId: string, input: Omit<JobContextBuildInput, "jobId"> = {}): JobContext {
    return this.build({ ...input, jobId });
  }

  buildForThread(channelId: string, threadTs: string, input: Omit<JobContextBuildInput, "channelId" | "threadTs"> = {}): JobContext {
    return this.build({ ...input, channelId, threadTs });
  }

  buildForBrowserAction(browserActionId: number, input: Omit<JobContextBuildInput, "browserActionId"> = {}): JobContext {
    return this.build({ ...input, browserActionId });
  }

  private safeBuildBrowserPlan(jobId: string): BrowserApplyPlanResult | null {
    try {
      return this.deps.buildBrowserApplyPlan(jobId);
    } catch (error) {
      return {
        plan: null,
        valid: false,
        issues: [{
          severity: "error",
          code: "browser_plan_context_build_failed",
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }
}

export const jobContextManager = new JobContextManager();

export function buildJobContext(input: JobContextBuildInput): JobContext {
  return jobContextManager.build(input);
}

export function buildJobContextForJob(jobId: string, input: Omit<JobContextBuildInput, "jobId"> = {}): JobContext {
  return jobContextManager.buildForJob(jobId, input);
}

export function buildJobContextForThread(channelId: string, threadTs: string, input: Omit<JobContextBuildInput, "channelId" | "threadTs"> = {}): JobContext {
  return jobContextManager.buildForThread(channelId, threadTs, input);
}

export function buildJobContextForBrowserAction(browserActionId: number, input: Omit<JobContextBuildInput, "browserActionId"> = {}): JobContext {
  return jobContextManager.buildForBrowserAction(browserActionId, input);
}
