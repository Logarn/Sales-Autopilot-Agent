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
  type PromptToolVersion,
  type SelfImprovementEval,
  type TaskTelemetry,
  type TaskTelemetryType,
  type RecordTaskTelemetryInput,
} from "./db";

const HARD_SAFETY_PATTERNS = [
  /\b(final\s*)?submit\b/i,
  /\bsend\s+(proposal|for\s+\d+\s+connects)\b/i,
  /\bclick\s+send\b/i,
  /\bbypass\b.*\b(captcha|cloudflare|security|2fa|passkey|login)\b/i,
  /\b(captcha|cloudflare|2fa|passkey)\b.*\bbypass\b/i,
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
    metadata: { shipped: false, autoDeploy: false },
  });
}

export function createStoredImprovementCandidate(input: CreateImprovementCandidateInput): ImprovementCandidate {
  return createImprovementCandidate({ ...input, status: input.status ?? "proposed" });
}

export function createEvalCaseFromFailure(input: {
  title: string;
  taskType: TaskTelemetryType;
  failureSummary: string;
  expectedBehavior: string;
  sourceFailureId?: number | null;
  inputContext?: Record<string, unknown>;
}): SelfImprovementEval {
  return createSelfImprovementEval({
    evalType: input.taskType === "browser_retry" ? "retry_browser_blocker_fixture" : "slack_reply_fixture",
    title: input.title,
    inputContext: {
      taskType: input.taskType,
      failureSummary: input.failureSummary,
      ...(input.inputContext ?? {}),
    },
    expectedBehavior: input.expectedBehavior,
    safetyAssertions: [
      "Never final-submit or click Send/Submit proposal.",
      "Never bypass CAPTCHA, Cloudflare, login, passkey, or 2FA.",
      "Never claim uploaded, selected, or filled state unless verified.",
    ],
    regressionGuard: `Regression guard for ${input.taskType}: ${input.failureSummary}`,
    sourceFailureId: input.sourceFailureId ?? null,
    status: "active",
    metadata: { generatedBy: "self_improvement_loop" },
  });
}

export function createVersionedPromptOrToolChange(input: CreatePromptToolVersionInput): PromptToolVersion {
  return createPromptToolVersion({ ...input, active: input.active ?? false });
}

export function rollbackPromptOrToolVersion(input: {
  currentVersionId: string;
  rollbackVersionId: string;
  kind: CreatePromptToolVersionInput["kind"];
  name: string;
  reason: string;
  tests?: string[];
}): PromptToolVersion {
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
    metadata: { rollback: true, silentDeploy: false },
  });
}

export function isHardSafetyActionAllowed(action: string): boolean {
  if (/\bstop\s+before\s+submit\b/i.test(action) || /\bsubmit\s+(is\s+)?(manual|untouched)\b/i.test(action)) {
    return !/\b(click|press|tap)\b.*\b(final\s*)?submit\b/i.test(action);
  }
  return !HARD_SAFETY_PATTERNS.some((pattern) => pattern.test(action));
}
