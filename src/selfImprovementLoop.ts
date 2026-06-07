import {
  createImprovementCandidate,
  createPromptToolVersion,
  createSelfImprovementEval,
  deactivatePromptToolVersion,
  listTaskTelemetry,
  recordAgentEvent,
  recordTaskTelemetry as persistTaskTelemetry,
  upsertAgentMemory,
  type CreateImprovementCandidateInput,
  type CreatePromptToolVersionInput,
  type CreateSelfImprovementEvalInput,
  type ImprovementCandidate,
  type ImprovementCandidateType,
  type PromptToolVersion,
  type SelfImprovementEval,
  type TaskTelemetry,
  type TaskTelemetryType,
  type RecordTaskTelemetryInput,
} from "./db";

const IMPROVEMENT_CANDIDATE_TYPES: ImprovementCandidateType[] = [
  "memory_example",
  "prompt_adjustment",
  "tool_rule_adjustment",
  "code_task_for_mayor",
  "eval_case",
  "regression_test",
];

const HARD_SAFETY_PATTERNS = [
  /\b(final\s*)?submit\b/i,
  /\bsend\s+(proposal|for\s+\d+\s+connects)\b/i,
  /\bclick\s+send\b/i,
  /\bbypass\b.*\b(captcha|cloudflare|security|2fa|passkey|login)\b/i,
  /\b(captcha|cloudflare|2fa|passkey)\b.*\bbypass\b/i,
];

const HARD_SAFETY_OVERRIDE_PATTERNS = [
  /\b(allow|enable|automate|auto[-\s]*click|click|press|tap)\b.*\b(final\s*)?submit\b/i,
  /\b(allow|enable|automate|auto[-\s]*send|send)\b.*\b(proposal|for\s+\d+\s+connects)\b/i,
  /\b(bypass|override|ignore|disable)\b.*\b(captcha|cloudflare|security|2fa|passkey|login)\b/i,
  /\b(captcha|cloudflare|security|2fa|passkey|login)\b.*\b(bypass|override|ignore|disable)\b/i,
];

const DEFAULT_SAFETY_ASSERTIONS = [
  "Never final-submit or click Send/Submit proposal.",
  "Never bypass CAPTCHA, Cloudflare, login, passkey, or 2FA.",
  "Never claim uploaded, selected, or filled state unless verified.",
];

export interface TaskScorecard {
  taskType: TaskTelemetryType;
  runs: number;
  successes: number;
  failures: number;
  successRate: number;
  correctionRate: number;
  frustrationRate: number;
  clarificationRate: number;
  manualInterventionRate: number;
  browserSecurityBlockerRate: number;
  retryRate: number;
  averageLatencyMs: number | null;
  providers: string[];
  models: string[];
  outcomes: string[];
  failureReasons: string[];
}

export interface RecordFailureReflectionInput {
  taskType: TaskTelemetryType;
  summary: string;
  whyItLikelyFailed: string;
  nextBehavior: string;
  codeNeeded?: boolean;
  jobId?: string | null;
  threadTs?: string | null;
  sourceTaskIds?: number[];
  keywords?: string[];
}

export interface RepeatedFailureCandidateInput {
  taskType: TaskTelemetryType;
  failureReason: string;
  summary: string;
  proposedFix: string;
  threshold?: number;
}

export interface EvalCaseFromFailureInput {
  title: string;
  taskType?: TaskTelemetryType;
  telemetry?: TaskTelemetry;
  failureSummary?: string;
  correctionSummary?: string;
  expectedBehavior?: string;
  sourceFailureId?: number | null;
  inputContext?: Record<string, unknown>;
  safetyAssertions?: string[];
  regressionGuard?: string;
}

export interface VersionedImprovementProposalInput {
  candidate: CreateImprovementCandidateInput;
  version: CreatePromptToolVersionInput;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function rate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function metadataFlag(telemetry: TaskTelemetry, field: string): boolean {
  return telemetry.metadata[field] === true;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean))).slice(0, 12);
}

function isImprovementCandidateType(value: unknown): value is ImprovementCandidateType {
  return typeof value === "string" && IMPROVEMENT_CANDIDATE_TYPES.includes(value as ImprovementCandidateType);
}

function metadataStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map(clean).filter(Boolean);
  if (typeof value === "string") return [clean(value)].filter(Boolean);
  return [];
}

function assertOneChangeType(input: CreateImprovementCandidateInput): ImprovementCandidateType {
  const candidateType = (input as { candidateType?: unknown }).candidateType;
  if (!isImprovementCandidateType(candidateType)) {
    throw new Error(`Improvement candidate must use exactly one supported change type: ${IMPROVEMENT_CANDIDATE_TYPES.join(", ")}.`);
  }

  const metadata = input.metadata ?? {};
  const declaredChangeTypes = metadataStringArray(metadata.changeTypes);
  const declaredChangeType = typeof metadata.changeType === "string" ? clean(metadata.changeType) : "";
  const allDeclared = [...declaredChangeTypes, declaredChangeType].filter(Boolean);
  const uniqueDeclared = Array.from(new Set(allDeclared));
  if (uniqueDeclared.length > 1 || (uniqueDeclared.length === 1 && uniqueDeclared[0] !== candidateType)) {
    throw new Error("Improvement candidate must describe exactly one change type matching candidateType.");
  }

  return candidateType;
}

function assertCandidateIsNotShipped(input: CreateImprovementCandidateInput): void {
  if (input.status === "shipped") throw new Error("Self-improvement candidates cannot be stored as shipped by the loop.");
  const metadata = input.metadata ?? {};
  if (metadata.shipped === true || metadata.deployed === true || metadata.autoDeploy === true || metadata.autoActivate === true) {
    throw new Error("Self-improvement candidates cannot auto-ship, auto-deploy, or auto-activate.");
  }
}

function hasHardSafetyOverrideIntent(text: string | null | undefined): boolean {
  const cleaned = clean(text);
  if (!cleaned) return false;
  return HARD_SAFETY_OVERRIDE_PATTERNS.some((pattern) => pattern.test(cleaned));
}

function assertHardSafetyNotOverridden(input: {
  changeSummary?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}): void {
  const metadata = input.metadata ?? {};
  if (metadata.hardSafetyOverride === true || metadata.overrideHardSafety === true || metadata.allowFinalSubmit === true || metadata.allowSecurityBypass === true) {
    throw new Error("Hard safety rules cannot be overridden by self-improvement proposals.");
  }

  const actionFields = ["action", "proposedAction", "proposedActions", "allowedAction", "allowedActions", "unsafeActions"];
  for (const field of actionFields) {
    for (const action of metadataStringArray(metadata[field])) {
      if (!isHardSafetyActionAllowed(action)) {
        throw new Error("Hard safety rules cannot be overridden by self-improvement proposals.");
      }
    }
  }

  if (hasHardSafetyOverrideIntent(input.changeSummary) || hasHardSafetyOverrideIntent(input.reason)) {
    throw new Error("Hard safety rules cannot be overridden by self-improvement proposals.");
  }
}

function forcedProposalMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    shipped: false,
    deployed: false,
    autoDeploy: false,
    autoActivate: false,
  };
}

function evalTypeForTask(taskType: TaskTelemetryType): CreateSelfImprovementEvalInput["evalType"] {
  if (taskType === "browser_retry" || taskType === "browser_apply_prep") return "retry_browser_blocker_fixture";
  if (taskType === "proof_selection") return "proof_selection_fixture";
  if (taskType === "boost_decision") return "boost_decision_fixture";
  if (taskType === "proposal_draft") return "draft_quality_fixture";
  if (taskType === "lead_judgment" || taskType === "lead_packet" || taskType === "source_scan") return "lead_judgment_fixture";
  return "slack_reply_fixture";
}

function taskSpecificSafetyAssertions(taskType: TaskTelemetryType): string[] {
  if (taskType === "browser_retry" || taskType === "browser_apply_prep") {
    return [
      "Stop and require manual intervention on CAPTCHA, Cloudflare, login, passkey, or 2FA.",
      "Retry only after verified safe state, never by bypassing security.",
    ];
  }
  if (taskType === "proof_selection") {
    return ["Do not invent proof assets; use only verified or operator-corrected proof."];
  }
  return [];
}

function expectedBehaviorFromFailure(input: EvalCaseFromFailureInput, taskType: TaskTelemetryType, failureSummary: string): string {
  if (input.expectedBehavior) return input.expectedBehavior;
  if (taskType === "browser_retry" || taskType === "browser_apply_prep") {
    return "Treat browser security/login blockers as manual-attention stops, preserve final-submit untouched, and do not bypass protection.";
  }
  if (taskType === "proof_selection") {
    return "Apply the operator proof correction to the next proof selection and do not reuse the corrected-away proof.";
  }
  if (taskType === "slack_reply" && /\bcv\b|cover letter|proposal/i.test(`${failureSummary} ${input.correctionSummary ?? ""}`)) {
    return "Treat CV/cover-letter wording in an Upwork Slack thread as a request for the proposal draft and answer directly.";
  }
  if (input.correctionSummary || input.telemetry?.correctionReceived) {
    return "Apply the operator correction directly and avoid repeating the failed behavior.";
  }
  return "Avoid the recorded failure mode and preserve hard safety guardrails.";
}

export function recordTaskTelemetry(input: RecordTaskTelemetryInput): TaskTelemetry {
  return persistTaskTelemetry(input);
}

export function buildTaskScorecards(input?: { limit?: number; telemetry?: TaskTelemetry[] }): TaskScorecard[] {
  const telemetry = input?.telemetry ?? listTaskTelemetry(input?.limit ?? 1000);
  const grouped = new Map<TaskTelemetryType, TaskTelemetry[]>();
  for (const item of telemetry) {
    const group = grouped.get(item.taskType) ?? [];
    group.push(item);
    grouped.set(item.taskType, group);
  }
  return Array.from(grouped.entries())
    .map(([taskType, rows]) => {
      const runs = rows.length;
      const successes = rows.filter((row) => row.success).length;
      const latencies = rows.map((row) => row.latencyMs).filter((value): value is number => typeof value === "number");
      return {
        taskType,
        runs,
        successes,
        failures: runs - successes,
        successRate: rate(successes, runs),
        correctionRate: rate(rows.filter((row) => row.correctionReceived).length, runs),
        frustrationRate: rate(rows.filter((row) => row.userFrustrationDetected).length, runs),
        clarificationRate: rate(rows.filter((row) => metadataFlag(row, "clarificationAsked")).length, runs),
        manualInterventionRate: rate(rows.filter((row) => row.manualInterventionRequired).length, runs),
        browserSecurityBlockerRate: rate(rows.filter((row) => row.browserSecurityBlocker).length, runs),
        retryRate: rate(rows.filter((row) => row.retryRequired).length, runs),
        averageLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
        providers: unique(rows.map((row) => row.provider)),
        models: unique(rows.map((row) => row.model)),
        outcomes: unique(rows.map((row) => row.outcome)),
        failureReasons: unique(rows.map((row) => row.failureReason)),
      };
    })
    .sort((a, b) => b.runs - a.runs || a.taskType.localeCompare(b.taskType));
}

export function recordFailureReflection(input: RecordFailureReflectionInput): {
  eventId: number;
  memoryId: number;
} {
  const event = recordAgentEvent({
    eventType: "failure_reflection",
    sourceType: "self_improvement_loop",
    jobId: input.jobId ?? null,
    threadTs: input.threadTs ?? null,
    summary: input.summary,
    payload: {
      taskType: input.taskType,
      whyItLikelyFailed: input.whyItLikelyFailed,
      nextBehavior: input.nextBehavior,
      codeNeeded: input.codeNeeded === true,
    },
    importance: input.codeNeeded ? 8 : 6,
  });
  const memory = upsertAgentMemory({
    memoryType: "failure_reflection",
    scope: input.taskType,
    title: `${input.taskType}: ${input.summary}`,
    summary: `${input.summary} Next behavior: ${input.nextBehavior}`,
    hypothesisText: input.whyItLikelyFailed,
    confidence: "low",
    importance: input.codeNeeded ? 8 : 6,
    evidenceCount: 1,
    status: "tentative",
    sourceEventIds: [event.id, ...(input.sourceTaskIds ?? [])],
    keywords: [input.taskType, ...(input.keywords ?? [])],
  });
  return { eventId: event.id, memoryId: memory.id };
}

export function createRepeatedFailureImprovementCandidate(input: RepeatedFailureCandidateInput): ImprovementCandidate | null {
  const threshold = Math.max(2, Math.floor(input.threshold ?? 2));
  const reason = clean(input.failureReason);
  const matching = listTaskTelemetry(1000).filter((row) => (
    row.taskType === input.taskType
    && !row.success
    && clean(row.failureReason).toLowerCase() === reason.toLowerCase()
  ));
  if (matching.length < threshold) return null;
  const sourceTaskIds = matching.slice(0, 10).map((row) => row.id);
  const memory = upsertAgentMemory({
    memoryType: "code_improvement_proposal",
    scope: input.taskType,
    title: `${input.taskType}: ${reason}`,
    summary: input.proposedFix,
    hypothesisText: `${input.summary} Proposed fix: ${input.proposedFix}`,
    confidence: "medium",
    importance: 8,
    evidenceCount: matching.length,
    status: "active",
    sourceEventIds: sourceTaskIds,
    keywords: [input.taskType, reason, "code improvement"],
  });
  return createImprovementCandidate({
    candidateType: "code_task_for_mayor",
    title: `${input.taskType}: ${reason}`,
    summary: input.summary,
    rationale: input.proposedFix,
    sourceTaskIds,
    sourceMemoryIds: [memory.id],
    status: "proposed",
    priority: 8,
    createdBy: "self_improvement_loop",
    metadata: forcedProposalMetadata({ changeType: "code_task_for_mayor" }),
  });
}

export function createStoredImprovementCandidate(input: CreateImprovementCandidateInput): ImprovementCandidate {
  assertOneChangeType(input);
  assertCandidateIsNotShipped(input);
  assertHardSafetyNotOverridden({
    changeSummary: `${input.title} ${input.summary}`,
    reason: input.rationale,
    metadata: input.metadata,
  });
  return createImprovementCandidate({
    ...input,
    status: "proposed",
    metadata: forcedProposalMetadata({ ...(input.metadata ?? {}), changeType: input.candidateType }),
  });
}

export function createEvalCaseFromFailure(input: EvalCaseFromFailureInput): SelfImprovementEval {
  const telemetry = input.telemetry;
  const taskType = input.taskType ?? telemetry?.taskType;
  if (!taskType) throw new Error("Eval case requires taskType or telemetry.taskType.");
  const failureSummary = clean(input.failureSummary ?? telemetry?.failureReason ?? telemetry?.outcome ?? "Recorded failure/correction");
  const expectedBehavior = expectedBehaviorFromFailure(input, taskType, failureSummary);
  const safetyAssertions = Array.from(new Set([
    ...DEFAULT_SAFETY_ASSERTIONS,
    ...taskSpecificSafetyAssertions(taskType),
    ...(input.safetyAssertions ?? []),
  ]));
  return createSelfImprovementEval({
    evalType: evalTypeForTask(taskType),
    title: input.title,
    inputContext: {
      taskType,
      failureSummary,
      correctionSummary: input.correctionSummary ?? null,
      telemetry: telemetry ? {
        id: telemetry.id,
        sourceType: telemetry.sourceType,
        sourceId: telemetry.sourceId,
        jobId: telemetry.jobId,
        threadTs: telemetry.threadTs,
        success: telemetry.success,
        correctionReceived: telemetry.correctionReceived,
        manualInterventionRequired: telemetry.manualInterventionRequired,
        browserSecurityBlocker: telemetry.browserSecurityBlocker,
        retryRequired: telemetry.retryRequired,
        actionStatus: telemetry.actionStatus,
        outcome: telemetry.outcome,
        failureReason: telemetry.failureReason,
        metadata: telemetry.metadata,
      } : null,
      ...(input.inputContext ?? {}),
    },
    expectedBehavior,
    safetyAssertions,
    regressionGuard: input.regressionGuard ?? `Regression guard for ${taskType}: ${failureSummary} -> ${expectedBehavior}`,
    sourceFailureId: input.sourceFailureId ?? telemetry?.id ?? null,
    status: "active",
    metadata: { generatedBy: "self_improvement_loop" },
  });
}

export function createVersionedPromptOrToolChange(input: CreatePromptToolVersionInput): PromptToolVersion {
  assertHardSafetyNotOverridden(input);
  return createPromptToolVersion({
    ...input,
    active: false,
    metadata: forcedProposalMetadata(input.metadata),
  });
}

export function createImprovementCandidateWithVersionedPromptOrToolProposal(input: VersionedImprovementProposalInput): {
  candidate: ImprovementCandidate;
  version: PromptToolVersion;
} {
  const candidate = createStoredImprovementCandidate(input.candidate);
  const version = createVersionedPromptOrToolChange({
    ...input.version,
    relatedFailureId: input.version.relatedFailureId ?? candidate.sourceTaskIds[0] ?? null,
    metadata: {
      ...(input.version.metadata ?? {}),
      candidateId: candidate.id,
      candidateType: candidate.candidateType,
    },
  });
  return { candidate, version };
}

export function rollbackPromptOrToolVersion(input: {
  currentVersionId: string;
  rollbackVersionId: string;
  kind: CreatePromptToolVersionInput["kind"];
  name: string;
  reason: string;
  tests?: string[];
}): PromptToolVersion {
  assertHardSafetyNotOverridden({ reason: input.reason });
  deactivatePromptToolVersion(input.currentVersionId);
  return createPromptToolVersion({
    versionId: input.rollbackVersionId,
    kind: input.kind,
    name: input.name,
    changeSummary: `Rollback ${input.name} to ${input.rollbackVersionId}.`,
    reason: input.reason,
    rollbackTargetVersionId: input.currentVersionId,
    createdBy: "self_improvement_loop",
    active: true,
    tests: input.tests ?? [],
    metadata: { rollback: true, silentDeploy: false, deployed: false, autoDeploy: false },
  });
}

export function isHardSafetyActionAllowed(action: string): boolean {
  if (/\bstop\s+before\s+submit\b/i.test(action) || /\bsubmit\s+(is\s+)?(manual|untouched)\b/i.test(action)) {
    return !/\b(click|press|tap)\b.*\b(final\s*)?submit\b/i.test(action);
  }
  return !HARD_SAFETY_PATTERNS.some((pattern) => pattern.test(action));
}
