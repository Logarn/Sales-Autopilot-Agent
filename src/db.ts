import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH, TIMEZONE } from "./config";
import { areNearDuplicateJobs, buildJobFingerprint } from "./dedupe";
import {
  ApplicationDraft,
  ApplicationStatus,
  BrowserAction,
  BrowserActionEnqueueResult,
  BrowserActionInput,
  BrowserActionPayload,
  BrowserActionStatus,
  BrowserActionType,
  ConnectsStrategySnapshot,
  DailySummary,
  JobIntelligence,
  JobPosting,
  MatchLevel,
  PortfolioItem,
  ProofPlanOverrideState,
  ProposalVersionSnapshot,
  ProposalVersionSource,
  ScoredJob,
  ScreeningCoverageItem,
  ScreeningCoverageStatus,
  StructuredProposalDraft,
} from "./types";

interface SeenStats {
  total: number;
  high: number;
  medium: number;
  low: number;
  skip: number;
}

interface CountRow {
  count: number;
}

interface SeenRow {
  found: number;
}

interface SeenFingerprintRow {
  id: string;
  title: string;
  url: string;
  description: string | null;
  posted_at: string | null;
  budget: string | null;
  client_country: string | null;
  client_rating: number | null;
  client_spend: number | null;
  client_hire_rate: number | null;
  skills: string | null;
  experience_level: string | null;
  connects_cost: number | null;
  proposal_count?: number | null;
  competition_level?: string | null;
  fingerprint: string | null;
}

interface MatchCountRow {
  match_level: MatchLevel;
  count: number;
}

interface DailyRow {
  title: string;
  score: number;
  match_level: MatchLevel;
  seen_at: string;
}

interface SlackPreviewJobRow {
  id: string;
  title: string;
  url: string;
  description: string | null;
  score: number | null;
  match_level: MatchLevel | null;
  budget: string | null;
  client_country: string | null;
  client_rating: number | null;
  client_spend: number | null;
  client_hire_rate: number | null;
  skills: string | null;
  experience_level: string | null;
  connects_cost: number | null;
  proposal_count: number | null;
  competition_level: string | null;
  posted_at: string | null;
  status: ApplicationStatus | null;
  fit_score: number | null;
  fit_reasons: string | null;
  red_flags: string | null;
  suggested_bid: string | null;
  suggested_connects: number | null;
  suggested_boost_connects: number | null;
  connects_warnings: string | null;
  selected_portfolio_items: string | null;
  proposal_text: string | null;
  structured_proposal: string | null;
  generated_at: string | null;
  job_intelligence: string | null;
  connects_strategy: string | null;
}

export interface ApplicationJobLink {
  jobId: string;
  url: string | null;
  title: string | null;
}

export interface ApplicationSummaryRow {
  status: ApplicationStatus;
  count: number;
}

export interface ApplicationListRow {
  job_id: string;
  status: ApplicationStatus;
  fit_score: number;
  title: string | null;
  url: string | null;
  suggested_bid: string | null;
  suggested_connects: number;
  actual_total_connects: number | null;
  actual_boost_connects: number | null;
  boost_rank: number | null;
  actual_client_spend: number | null;
  attachments_used: string | null;
  profile_highlights_used: string | null;
  updated_at: string;
}

export interface ApplicationAnalytics {
  total: number;
  applied: number;
  replied: number;
  interviews: number;
  hired: number;
  lost: number;
  totalConnectsSpent: number;
  averageConnectsPerApplied: number;
  connectsPerReply: number | null;
  replyRate: number;
  interviewRate: number;
  hireRate: number;
  topAttachments: Array<{ name: string; count: number }>;
  topHighlights: Array<{ name: string; count: number }>;
}

export interface OutcomeLearningSegment {
  name: string;
  total: number;
  submitted: number;
  replied: number;
  interviews: number;
  hired: number;
  lost: number;
  replyRate: number;
  hireRate: number;
}

export interface OutcomeLearningSummary {
  generatedAt: string;
  totalTracked: number;
  bySourceQuery: OutcomeLearningSegment[];
  byBudgetBand: OutcomeLearningSegment[];
  byClientSpendBand: OutcomeLearningSegment[];
}

interface OutcomeLearningRow {
  status: ApplicationStatus;
  source_query: string | null;
  budget: string | null;
  client_spend: number | null;
}

export interface ApplicationNoteRow {
  id: number;
  job_id: string;
  note: string;
  created_at: string;
}

export type ApplicationAssetSource = "slack" | "manifest" | "manual";
export type ApplicationAssetProofType = "file" | "upwork_portfolio" | "certificate" | "mention_only" | "do_not_attach";
export type ApplicationAssetAttachPolicy = "auto_attach" | "manual_review" | "mention_only" | "do_not_attach";

export interface ApplicationAsset {
  id: number;
  jobId: string;
  source: ApplicationAssetSource;
  sourceFileId: string | null;
  originalName: string;
  relativePath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  proofType: ApplicationAssetProofType;
  attachPolicy: ApplicationAssetAttachPolicy;
  createdAt: string;
}

interface ApplicationAssetRow {
  id: number;
  job_id: string;
  source: ApplicationAssetSource;
  source_file_id: string | null;
  original_name: string;
  relative_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  proof_type: ApplicationAssetProofType;
  attach_policy: ApplicationAssetAttachPolicy;
  created_at: string;
}

export interface RegisterApplicationAssetInput {
  jobId: string;
  source: ApplicationAssetSource;
  sourceFileId?: string | null;
  originalName: string;
  relativePath?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  proofType: ApplicationAssetProofType;
  attachPolicy: ApplicationAssetAttachPolicy;
}

export interface ApplicationSubmissionInput {
  jobId: string;
  requiredConnects: number;
  boostConnects: number;
  boostRank: number | null;
  clientSpend: number | null;
  rate: number | null;
  profileUsed: string;
  attachmentsUsed: string[];
  profileHighlightsUsed: string[];
  submittedProposalText?: string;
  note?: string;
}

export interface RecordProposalVersionInput {
  jobId: string;
  source: ProposalVersionSource;
  proposalText: string;
  screeningAnswers?: string[];
  label?: string;
  note?: string | null;
  versionNumber?: number;
}

export type HeartbeatStatus = "starting" | "running" | "success" | "error" | "stale";

export interface HeartbeatRecord {
  worker: string;
  status: HeartbeatStatus;
  lastRunAt: string;
  lastSuccessAt: string | null;
  runCount: number;
  successCount: number;
  errorCount: number;
  lastError: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

interface HeartbeatRow {
  worker: string;
  status: HeartbeatStatus;
  last_run_at: string;
  last_success_at: string | null;
  run_count: number;
  success_count: number;
  error_count: number;
  last_error: string | null;
  metadata: string | null;
  updated_at: string;
}

export interface HeartbeatWriteInput {
  worker: string;
  status: Exclude<HeartbeatStatus, "stale">;
  error?: string | null;
  metadata?: Record<string, unknown>;
  at?: Date;
}

export interface SlackQueueItem {
  id: number;
  payload: string;
  attempts: number;
}

export interface SlackQueueStats {
  count: number;
  maxAttempts: number;
}

export type SlackThreadStatus =
  | "capture_pending"
  | "capture_recorded"
  | "captured"
  | "scored"
  | "packet_sent"
  | "manual_attention_required"
  | "capture_failed"
  | "approve_requested"
  | "reject_requested"
  | "revise_requested"
  | "prepare_draft_requested"
  | "draft_preview_sent"
  | "files_ingested"
  | "prepared_draft"
  | "retry_requested"
  | "submitted_marked"
  | "outcome_recorded"
  | "status_checked"
  | "error";

interface SlackThreadStateRow {
  id: number;
  channel_id: string;
  message_ts: string;
  thread_ts: string;
  upwork_url: string;
  job_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SlackThreadState {
  id: number;
  channelId: string;
  messageTs: string;
  threadTs: string;
  upworkUrl: string;
  jobId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export type SlackBehaviorMemoryType =
  | "operator_preference"
  | "failed_intent"
  | "proof_preference"
  | "draft_style_preference"
  | "retry_rule"
  | "lead_packet_style_rule";

export type SlackBehaviorMemoryConfidence = "high" | "medium" | "low";

interface SlackBehaviorMemoryRow {
  id: number;
  type: SlackBehaviorMemoryType;
  rule: string;
  scope: string;
  source: string;
  thread_channel_id: string | null;
  thread_ts: string | null;
  job_id: string | null;
  confidence: SlackBehaviorMemoryConfidence;
  active: number;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface SlackBehaviorMemory {
  id: number;
  type: SlackBehaviorMemoryType;
  rule: string;
  scope: string;
  source: string;
  threadChannelId: string | null;
  threadTs: string | null;
  jobId: string | null;
  confidence: SlackBehaviorMemoryConfidence;
  active: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSlackBehaviorMemoryInput {
  type: SlackBehaviorMemoryType;
  rule: string;
  scope?: string;
  source?: string;
  threadChannelId?: string | null;
  threadTs?: string | null;
  jobId?: string | null;
  confidence?: SlackBehaviorMemoryConfidence;
  metadata?: Record<string, unknown>;
}

interface SlackFailureReflectionRow {
  id: number;
  channel_id: string | null;
  thread_ts: string | null;
  job_id: string | null;
  user_message: string;
  what_happened: string;
  why_it_failed: string;
  next_behavior: string;
  fix_type: string;
  proposed_task: string | null;
  created_at: string;
}

export interface SlackFailureReflection {
  id: number;
  channelId: string | null;
  threadTs: string | null;
  jobId: string | null;
  userMessage: string;
  whatHappened: string;
  whyItFailed: string;
  nextBehavior: string;
  fixType: string;
  proposedTask: string | null;
  createdAt: string;
}

export interface RecordSlackFailureReflectionInput {
  channelId?: string | null;
  threadTs?: string | null;
  jobId?: string | null;
  userMessage: string;
  whatHappened: string;
  whyItFailed: string;
  nextBehavior: string;
  fixType: "memory" | "prompt" | "config" | "code_pr";
  proposedTask?: string | null;
}

export type SalesLearningEventType =
  | "application_seen"
  | "proposal_draft_created"
  | "proposal_revision"
  | "draft_style_signal"
  | "proof_decision"
  | "proof_correction"
  | "boost_decision"
  | "timing_signal"
  | "source_signal"
  | "outcome_recorded"
  | "failure_reflection"
  | "operator_correction";

export type SalesLearningMemoryType =
  | "proposal_style"
  | "proof_preference"
  | "boost_strategy"
  | "timing_hypothesis"
  | "source_quality"
  | "operator_preference"
  | "failure_pattern"
  | "code_improvement_task";

export type SalesLearningConfidence = "low" | "medium" | "high";
export type SalesLearningMemoryStatus = "tentative" | "active" | "archived" | "forgotten";

interface SalesLearningEventRow {
  id: number;
  event_type: SalesLearningEventType;
  job_id: string | null;
  channel_id: string | null;
  thread_ts: string | null;
  source: string;
  payload: string;
  created_at: string;
}

interface SalesLearningMemoryRow {
  id: number;
  type: SalesLearningMemoryType;
  scope: string;
  subject: string;
  hypothesis: string;
  rationale: string;
  confidence: SalesLearningConfidence;
  evidence_count: number;
  status: SalesLearningMemoryStatus;
  source: string;
  job_id: string | null;
  channel_id: string | null;
  thread_ts: string | null;
  examples: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface SalesLearningEvent {
  id: number;
  eventType: SalesLearningEventType;
  jobId: string | null;
  channelId: string | null;
  threadTs: string | null;
  source: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SalesLearningMemory {
  id: number;
  type: SalesLearningMemoryType;
  scope: string;
  subject: string;
  hypothesis: string;
  rationale: string;
  confidence: SalesLearningConfidence;
  evidenceCount: number;
  status: SalesLearningMemoryStatus;
  source: string;
  jobId: string | null;
  channelId: string | null;
  threadTs: string | null;
  examples: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RecordSalesLearningEventInput {
  eventType: SalesLearningEventType;
  jobId?: string | null;
  channelId?: string | null;
  threadTs?: string | null;
  source?: string;
  payload?: Record<string, unknown>;
}

export interface UpsertSalesLearningMemoryInput {
  type: SalesLearningMemoryType;
  scope?: string;
  subject: string;
  hypothesis: string;
  rationale?: string;
  confidence?: SalesLearningConfidence;
  evidenceCount?: number;
  status?: SalesLearningMemoryStatus;
  source?: string;
  jobId?: string | null;
  channelId?: string | null;
  threadTs?: string | null;
  examples?: string[];
  metadata?: Record<string, unknown>;
}

export type AgentMemoryStatus = "active" | "tentative" | "archived" | "forgotten";
export type AgentMemoryConfidence = SalesLearningConfidence;
export type AgentMemoryPrivacyLevel = "normal" | "sensitive" | "debug_only";

interface AgentEventRow {
  id: number;
  created_at: string;
  event_type: string;
  source_type: string;
  source_id: string | null;
  job_id: string | null;
  application_id: string | null;
  thread_ts: string | null;
  actor: string;
  summary: string;
  payload_json: string;
  importance: number;
  privacy_level: AgentMemoryPrivacyLevel;
  embedding_id: number | null;
}

interface AgentMemoryRow {
  id: number;
  memory_type: string;
  scope: string;
  title: string;
  summary: string;
  rule_text: string | null;
  hypothesis_text: string | null;
  confidence: AgentMemoryConfidence;
  importance: number;
  evidence_count: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  decay_score: number;
  status: AgentMemoryStatus;
  version: number;
  supersedes_memory_id: number | null;
  contradicted_by_memory_id: number | null;
  source_event_ids: string;
  keywords: string;
  embedding_id: number | null;
}

interface MemoryEmbeddingRow {
  id: number;
  owner_type: string;
  owner_id: number;
  provider: string;
  model: string;
  vector_json_or_blob: string;
  created_at: string;
}

interface MemoryConsolidationRow {
  id: number;
  created_at: string;
  period_start: string;
  period_end: string;
  summary_type: string;
  summary: string;
  source_memory_ids: string;
  source_event_ids: string;
  confidence: AgentMemoryConfidence;
  status: AgentMemoryStatus;
}

interface MemoryLinkRow {
  id: number;
  source_memory_id: number;
  target_memory_id: number;
  relationship_type: string;
  strength: number;
  reason: string;
  created_at: string;
  updated_at: string;
}

interface MemoryRelationRow {
  id: number;
  source_entity: string;
  relation: string;
  target_entity: string;
  confidence: AgentMemoryConfidence;
  source_memory_ids: string;
  evidence_count: number;
  status: AgentMemoryStatus;
  created_at: string;
  updated_at: string;
}

interface MemoryThreadSummaryRow {
  id: number;
  owner_type: string;
  owner_id: string;
  channel_id: string | null;
  thread_ts: string | null;
  job_id: string | null;
  summary: string;
  recent_messages_json: string;
  source_event_ids: string;
  source_memory_ids: string;
  version: number;
  status: AgentMemoryStatus;
  created_at: string;
  updated_at: string;
}

export interface AgentEvent {
  id: number;
  createdAt: string;
  eventType: string;
  sourceType: string;
  sourceId: string | null;
  jobId: string | null;
  applicationId: string | null;
  threadTs: string | null;
  actor: string;
  summary: string;
  payload: Record<string, unknown>;
  importance: number;
  privacyLevel: AgentMemoryPrivacyLevel;
  embeddingId: number | null;
}

export interface AgentMemory {
  id: number;
  memoryType: string;
  scope: string;
  title: string;
  summary: string;
  ruleText: string | null;
  hypothesisText: string | null;
  confidence: AgentMemoryConfidence;
  importance: number;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  decayScore: number;
  status: AgentMemoryStatus;
  version: number;
  supersedesMemoryId: number | null;
  contradictedByMemoryId: number | null;
  sourceEventIds: number[];
  keywords: string[];
  embeddingId: number | null;
}

export interface MemoryEmbedding {
  id: number;
  ownerType: string;
  ownerId: number;
  provider: string;
  model: string;
  vectorJsonOrBlob: string;
  createdAt: string;
}

export interface MemoryConsolidation {
  id: number;
  createdAt: string;
  periodStart: string;
  periodEnd: string;
  summaryType: string;
  summary: string;
  sourceMemoryIds: number[];
  sourceEventIds: number[];
  confidence: AgentMemoryConfidence;
  status: AgentMemoryStatus;
}

export interface MemoryLink {
  id: number;
  sourceMemoryId: number;
  targetMemoryId: number;
  relationshipType: string;
  strength: number;
  reason: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRelation {
  id: number;
  sourceEntity: string;
  relation: string;
  targetEntity: string;
  confidence: AgentMemoryConfidence;
  sourceMemoryIds: number[];
  evidenceCount: number;
  status: AgentMemoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryThreadSummary {
  id: number;
  ownerType: string;
  ownerId: string;
  channelId: string | null;
  threadTs: string | null;
  jobId: string | null;
  summary: string;
  recentMessages: string[];
  sourceEventIds: number[];
  sourceMemoryIds: number[];
  version: number;
  status: AgentMemoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RecordAgentEventInput {
  eventType: string;
  sourceType?: string;
  sourceId?: string | null;
  jobId?: string | null;
  applicationId?: string | null;
  threadTs?: string | null;
  actor?: string;
  summary: string;
  payload?: Record<string, unknown>;
  importance?: number;
  privacyLevel?: AgentMemoryPrivacyLevel;
  embeddingId?: number | null;
}

export interface UpsertAgentMemoryInput {
  memoryType: string;
  scope?: string;
  title: string;
  summary: string;
  ruleText?: string | null;
  hypothesisText?: string | null;
  confidence?: AgentMemoryConfidence;
  importance?: number;
  evidenceCount?: number;
  status?: AgentMemoryStatus;
  version?: number;
  supersedesMemoryId?: number | null;
  contradictedByMemoryId?: number | null;
  sourceEventIds?: number[];
  keywords?: string[];
  embeddingId?: number | null;
}

export interface UpsertMemoryLinkInput {
  sourceMemoryId: number;
  targetMemoryId: number;
  relationshipType: string;
  strength?: number;
  reason?: string;
}

export interface UpsertMemoryRelationInput {
  sourceEntity: string;
  relation: string;
  targetEntity: string;
  confidence?: AgentMemoryConfidence;
  sourceMemoryIds?: number[];
  evidenceCount?: number;
  status?: AgentMemoryStatus;
}

export interface UpsertMemoryThreadSummaryInput {
  ownerType: string;
  ownerId: string;
  channelId?: string | null;
  threadTs?: string | null;
  jobId?: string | null;
  summary: string;
  recentMessages?: string[];
  sourceEventIds?: number[];
  sourceMemoryIds?: number[];
  status?: AgentMemoryStatus;
}

export type TaskTelemetryType =
  | "slack_reply"
  | "lead_packet"
  | "lead_judgment"
  | "proposal_draft"
  | "proof_selection"
  | "portfolio_selection"
  | "boost_decision"
  | "browser_apply_prep"
  | "browser_retry"
  | "source_scan"
  | "qa_handoff"
  | "outcome_recording";

export type TaskTelemetryActionStatus = "completed" | "paused" | "skipped" | "failed" | "queued";

export type ImprovementCandidateType =
  | "memory_example"
  | "prompt_adjustment"
  | "tool_rule_adjustment"
  | "code_task_for_mayor"
  | "eval_case"
  | "regression_test";

export type ImprovementCandidateStatus = "proposed" | "testing" | "shipped" | "rejected" | "archived";
export type PromptToolVersionKind = "prompt" | "tool_rule" | "memory_rule" | "eval_rule";

export type SelfImprovementEvalType =
  | "slack_reply_fixture"
  | "lead_judgment_fixture"
  | "proof_selection_fixture"
  | "boost_decision_fixture"
  | "draft_quality_fixture"
  | "retry_browser_blocker_fixture";

interface TaskTelemetryRow {
  id: number;
  created_at: string;
  task_type: TaskTelemetryType;
  source_type: string;
  source_id: string | null;
  job_id: string | null;
  thread_ts: string | null;
  success: number;
  correction_received: number;
  user_frustration_detected: number;
  manual_intervention_required: number;
  browser_security_blocker: number;
  retry_required: number;
  latency_ms: number | null;
  provider: string | null;
  model: string | null;
  action_status: TaskTelemetryActionStatus;
  outcome: string | null;
  confidence: AgentMemoryConfidence;
  failure_reason: string | null;
  metadata_json: string;
}

interface ImprovementCandidateRow {
  id: number;
  created_at: string;
  candidate_type: ImprovementCandidateType;
  title: string;
  summary: string;
  rationale: string;
  source_task_ids: string;
  source_memory_ids: string;
  status: ImprovementCandidateStatus;
  priority: number;
  created_by: string;
  shipped_at: string | null;
  metadata_json: string;
}

interface PromptToolVersionRow {
  id: number;
  version_id: string;
  created_at: string;
  kind: PromptToolVersionKind;
  name: string;
  change_summary: string;
  reason: string;
  related_scorecard_json: string;
  related_failure_id: number | null;
  created_by: string;
  active: number;
  rollback_target_version_id: string | null;
  tests_json: string;
  metadata_json: string;
}

interface SelfImprovementEvalRow {
  id: number;
  created_at: string;
  eval_type: SelfImprovementEvalType;
  title: string;
  input_context_json: string;
  expected_behavior: string;
  safety_assertions_json: string;
  regression_guard: string;
  source_failure_id: number | null;
  status: string;
  metadata_json: string;
}

export interface TaskTelemetry {
  id: number;
  createdAt: string;
  taskType: TaskTelemetryType;
  sourceType: string;
  sourceId: string | null;
  jobId: string | null;
  threadTs: string | null;
  success: boolean;
  correctionReceived: boolean;
  userFrustrationDetected: boolean;
  manualInterventionRequired: boolean;
  browserSecurityBlocker: boolean;
  retryRequired: boolean;
  latencyMs: number | null;
  provider: string | null;
  model: string | null;
  actionStatus: TaskTelemetryActionStatus;
  outcome: string | null;
  confidence: AgentMemoryConfidence;
  failureReason: string | null;
  metadata: Record<string, unknown>;
}

export interface ImprovementCandidate {
  id: number;
  createdAt: string;
  candidateType: ImprovementCandidateType;
  title: string;
  summary: string;
  rationale: string;
  sourceTaskIds: number[];
  sourceMemoryIds: number[];
  status: ImprovementCandidateStatus;
  priority: number;
  createdBy: string;
  shippedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface PromptToolVersion {
  id: number;
  versionId: string;
  createdAt: string;
  kind: PromptToolVersionKind;
  name: string;
  changeSummary: string;
  reason: string;
  relatedScorecard: Record<string, unknown>;
  relatedFailureId: number | null;
  createdBy: string;
  active: boolean;
  rollbackTargetVersionId: string | null;
  tests: string[];
  metadata: Record<string, unknown>;
}

export interface SelfImprovementEval {
  id: number;
  createdAt: string;
  evalType: SelfImprovementEvalType;
  title: string;
  inputContext: Record<string, unknown>;
  expectedBehavior: string;
  safetyAssertions: string[];
  regressionGuard: string;
  sourceFailureId: number | null;
  status: string;
  metadata: Record<string, unknown>;
}

export interface RecordTaskTelemetryInput {
  taskType: TaskTelemetryType;
  sourceType?: string;
  sourceId?: string | null;
  jobId?: string | null;
  threadTs?: string | null;
  success: boolean;
  correctionReceived?: boolean;
  userFrustrationDetected?: boolean;
  manualInterventionRequired?: boolean;
  browserSecurityBlocker?: boolean;
  retryRequired?: boolean;
  latencyMs?: number | null;
  provider?: string | null;
  model?: string | null;
  actionStatus?: TaskTelemetryActionStatus;
  outcome?: string | null;
  confidence?: AgentMemoryConfidence;
  failureReason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateImprovementCandidateInput {
  candidateType: ImprovementCandidateType;
  title: string;
  summary: string;
  rationale?: string;
  sourceTaskIds?: number[];
  sourceMemoryIds?: number[];
  status?: ImprovementCandidateStatus;
  priority?: number;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePromptToolVersionInput {
  versionId: string;
  kind: PromptToolVersionKind;
  name: string;
  changeSummary: string;
  reason: string;
  relatedScorecard?: Record<string, unknown>;
  relatedFailureId?: number | null;
  createdBy?: string;
  active?: boolean;
  rollbackTargetVersionId?: string | null;
  tests?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateSelfImprovementEvalInput {
  evalType: SelfImprovementEvalType;
  title: string;
  inputContext: Record<string, unknown>;
  expectedBehavior: string;
  safetyAssertions?: string[];
  regressionGuard: string;
  sourceFailureId?: number | null;
  status?: string;
  metadata?: Record<string, unknown>;
}

interface ApplicationDraftRow {
  job_id: string;
  status: ApplicationStatus;
  fit_score: number;
  fit_reasons: string | null;
  red_flags: string | null;
  suggested_bid: string | null;
  suggested_connects: number | null;
  suggested_boost_connects: number | null;
  connects_warnings: string | null;
  selected_portfolio_items: string | null;
  proposal_text: string;
  structured_proposal: string | null;
  generated_at: string;
  proposal_version: number | null;
  revision_requests: string | null;
  job_intelligence: string | null;
  connects_strategy: string | null;
}

interface ApplicationProposalVersionRow {
  id: number;
  job_id: string;
  version_number: number;
  source: ProposalVersionSource;
  label: string;
  proposal_text: string;
  screening_answers: string | null;
  note: string | null;
  created_at: string;
}

interface ApplicationScreeningCoverageRow {
  job_id: string;
  question_index: number;
  question_text: string | null;
  planned_answer: string | null;
  filled_answer: string | null;
  verified_answer: string | null;
  human_edited_answer: string | null;
  final_answer: string | null;
  status: ScreeningCoverageStatus;
  updated_at: string;
}

export interface ApplicationRevisionResult {
  jobId: string;
  proposalVersion: number;
  proposalText: string;
  revisionRequests: string[];
  applied: boolean;
}

interface BrowserActionRow {
  id: number;
  job_id: string;
  action_type: BrowserActionType;
  status: BrowserActionStatus;
  payload: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const dbDirectory = path.dirname(DB_PATH);
if (!fs.existsSync(dbDirectory)) {
  fs.mkdirSync(dbDirectory, { recursive: true });
}

const db = new Database(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS seen_jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  score INTEGER DEFAULT 0,
  match_level TEXT,
  budget TEXT,
  client_country TEXT,
  client_rating REAL,
  client_spend REAL,
  client_hire_rate REAL,
  skills TEXT,
  experience_level TEXT,
  connects_cost INTEGER,
  source_query TEXT,
  proposal_count INTEGER,
  competition_level TEXT,
  posted_at TEXT,
  fingerprint TEXT,
  seen_at TEXT DEFAULT (datetime('now')),
  notified BOOLEAN DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_seen_at ON seen_jobs(seen_at);
CREATE INDEX IF NOT EXISTS idx_match_level ON seen_jobs(match_level);

CREATE TABLE IF NOT EXISTS slack_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS slack_thread_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  upwork_url TEXT NOT NULL,
  job_id TEXT,
  status TEXT NOT NULL DEFAULT 'capture_pending',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(channel_id, message_ts)
);
CREATE INDEX IF NOT EXISTS idx_slack_thread_state_channel_thread ON slack_thread_state(channel_id, thread_ts);
CREATE INDEX IF NOT EXISTS idx_slack_thread_state_job_id ON slack_thread_state(job_id);

CREATE TABLE IF NOT EXISTS slack_behavior_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  rule TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  source TEXT NOT NULL DEFAULT 'slack_correction',
  thread_channel_id TEXT,
  thread_ts TEXT,
  job_id TEXT,
  confidence TEXT NOT NULL DEFAULT 'medium',
  active INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(type, rule, scope)
);

CREATE INDEX IF NOT EXISTS idx_slack_behavior_memory_active ON slack_behavior_memory(active, updated_at);
CREATE INDEX IF NOT EXISTS idx_slack_behavior_memory_type ON slack_behavior_memory(type);

CREATE TABLE IF NOT EXISTS slack_failure_reflections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT,
  thread_ts TEXT,
  job_id TEXT,
  user_message TEXT NOT NULL,
  what_happened TEXT NOT NULL,
  why_it_failed TEXT NOT NULL,
  next_behavior TEXT NOT NULL,
  fix_type TEXT NOT NULL,
  proposed_task TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_slack_failure_reflections_thread ON slack_failure_reflections(channel_id, thread_ts);
CREATE INDEX IF NOT EXISTS idx_slack_failure_reflections_created_at ON slack_failure_reflections(created_at);

CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'system',
  source_id TEXT,
  job_id TEXT,
  application_id TEXT,
  thread_ts TEXT,
  actor TEXT NOT NULL DEFAULT 'agent',
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  importance INTEGER NOT NULL DEFAULT 3,
  privacy_level TEXT NOT NULL DEFAULT 'normal',
  embedding_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_job_id ON agent_events(job_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_thread ON agent_events(thread_ts);
CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events(created_at);

CREATE TABLE IF NOT EXISTS agent_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_type TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  rule_text TEXT,
  hypothesis_text TEXT,
  confidence TEXT NOT NULL DEFAULT 'low',
  importance INTEGER NOT NULL DEFAULT 3,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT,
  decay_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'tentative',
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_memory_id INTEGER,
  contradicted_by_memory_id INTEGER,
  source_event_ids TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]',
  embedding_id INTEGER,
  UNIQUE(memory_type, scope, title, summary)
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_status ON agent_memories(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_memories_type_scope ON agent_memories(memory_type, scope);
CREATE INDEX IF NOT EXISTS idx_agent_memories_importance ON agent_memories(importance, confidence, updated_at);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  vector_json_or_blob TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_owner ON memory_embeddings(owner_type, owner_id);

CREATE TABLE IF NOT EXISTS memory_consolidations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  summary_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_memory_ids TEXT NOT NULL DEFAULT '[]',
  source_event_ids TEXT NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL DEFAULT 'low',
  status TEXT NOT NULL DEFAULT 'tentative'
);

CREATE INDEX IF NOT EXISTS idx_memory_consolidations_period ON memory_consolidations(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_memory_consolidations_type ON memory_consolidations(summary_type, status);

CREATE TABLE IF NOT EXISTS memory_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_memory_id INTEGER NOT NULL,
  target_memory_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 0.5,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_memory_id, target_memory_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links(source_memory_id, strength);
CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_memory_id, strength);

CREATE TABLE IF NOT EXISTS memory_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_entity TEXT NOT NULL,
  relation TEXT NOT NULL,
  target_entity TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'low',
  source_memory_ids TEXT NOT NULL DEFAULT '[]',
  evidence_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'tentative',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_entity, relation, target_entity)
);

CREATE INDEX IF NOT EXISTS idx_memory_relations_subject ON memory_relations(source_entity, relation, status);
CREATE INDEX IF NOT EXISTS idx_memory_relations_target ON memory_relations(target_entity, status);

CREATE TABLE IF NOT EXISTS memory_thread_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  channel_id TEXT,
  thread_ts TEXT,
  job_id TEXT,
  summary TEXT NOT NULL,
  recent_messages_json TEXT NOT NULL DEFAULT '[]',
  source_event_ids TEXT NOT NULL DEFAULT '[]',
  source_memory_ids TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(owner_type, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_thread_summaries_thread ON memory_thread_summaries(channel_id, thread_ts);
CREATE INDEX IF NOT EXISTS idx_memory_thread_summaries_job ON memory_thread_summaries(job_id);

CREATE TABLE IF NOT EXISTS task_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  task_type TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'system',
  source_id TEXT,
  job_id TEXT,
  thread_ts TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  correction_received INTEGER NOT NULL DEFAULT 0,
  user_frustration_detected INTEGER NOT NULL DEFAULT 0,
  manual_intervention_required INTEGER NOT NULL DEFAULT 0,
  browser_security_blocker INTEGER NOT NULL DEFAULT 0,
  retry_required INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  provider TEXT,
  model TEXT,
  action_status TEXT NOT NULL DEFAULT 'completed',
  outcome TEXT,
  confidence TEXT NOT NULL DEFAULT 'low',
  failure_reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_task_telemetry_type_created ON task_telemetry(task_type, created_at);
CREATE INDEX IF NOT EXISTS idx_task_telemetry_job ON task_telemetry(job_id);
CREATE INDEX IF NOT EXISTS idx_task_telemetry_thread ON task_telemetry(thread_ts);
CREATE INDEX IF NOT EXISTS idx_task_telemetry_status ON task_telemetry(action_status, success);

CREATE TABLE IF NOT EXISTS improvement_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  candidate_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  source_task_ids TEXT NOT NULL DEFAULT '[]',
  source_memory_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'proposed',
  priority INTEGER NOT NULL DEFAULT 3,
  created_by TEXT NOT NULL DEFAULT 'agent',
  shipped_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_improvement_candidates_status ON improvement_candidates(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_improvement_candidates_type ON improvement_candidates(candidate_type);

CREATE TABLE IF NOT EXISTS prompt_tool_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  reason TEXT NOT NULL,
  related_scorecard_json TEXT NOT NULL DEFAULT '{}',
  related_failure_id INTEGER,
  created_by TEXT NOT NULL DEFAULT 'agent',
  active INTEGER NOT NULL DEFAULT 0,
  rollback_target_version_id TEXT,
  tests_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_prompt_tool_versions_active ON prompt_tool_versions(kind, name, active);

CREATE TABLE IF NOT EXISTS self_improvement_evals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  eval_type TEXT NOT NULL,
  title TEXT NOT NULL,
  input_context_json TEXT NOT NULL DEFAULT '{}',
  expected_behavior TEXT NOT NULL,
  safety_assertions_json TEXT NOT NULL DEFAULT '[]',
  regression_guard TEXT NOT NULL,
  source_failure_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_self_improvement_evals_type ON self_improvement_evals(eval_type, status);
CREATE INDEX IF NOT EXISTS idx_self_improvement_evals_failure ON self_improvement_evals(source_failure_id);

CREATE TABLE IF NOT EXISTS sales_learning_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  job_id TEXT,
  channel_id TEXT,
  thread_ts TEXT,
  source TEXT NOT NULL DEFAULT 'system',
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sales_learning_events_type ON sales_learning_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sales_learning_events_job_id ON sales_learning_events(job_id);
CREATE INDEX IF NOT EXISTS idx_sales_learning_events_created_at ON sales_learning_events(created_at);

CREATE TABLE IF NOT EXISTS sales_learning_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  subject TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'low',
  evidence_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'tentative',
  source TEXT NOT NULL DEFAULT 'system',
  job_id TEXT,
  channel_id TEXT,
  thread_ts TEXT,
  examples TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(type, scope, subject, hypothesis)
);

CREATE INDEX IF NOT EXISTS idx_sales_learning_memories_status ON sales_learning_memories(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_sales_learning_memories_type_scope ON sales_learning_memories(type, scope);
CREATE INDEX IF NOT EXISTS idx_sales_learning_memories_subject ON sales_learning_memories(subject);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  fit_score INTEGER NOT NULL DEFAULT 0,
  fit_reasons TEXT NOT NULL DEFAULT '[]',
  red_flags TEXT NOT NULL DEFAULT '[]',
  suggested_bid TEXT,
  suggested_connects INTEGER DEFAULT 0,
  suggested_boost_connects INTEGER DEFAULT 0,
  connects_warnings TEXT NOT NULL DEFAULT '[]',
  selected_portfolio_items TEXT NOT NULL DEFAULT '[]',
  proposal_text TEXT NOT NULL,
  structured_proposal TEXT,
  generated_at TEXT NOT NULL,
  proposal_version INTEGER NOT NULL DEFAULT 1,
  revision_requests TEXT NOT NULL DEFAULT '[]',
  job_intelligence TEXT,
  connects_strategy TEXT,
  reviewed_at TEXT,
  submitted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(job_id) REFERENCES seen_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

CREATE TABLE IF NOT EXISTS application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_application_events_job_id ON application_events(job_id);
CREATE INDEX IF NOT EXISTS idx_application_events_type ON application_events(event_type);

CREATE TABLE IF NOT EXISTS application_proposal_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  source TEXT NOT NULL,
  label TEXT NOT NULL,
  proposal_text TEXT NOT NULL,
  screening_answers TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(job_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_application_proposal_versions_job_id ON application_proposal_versions(job_id, version_number);
CREATE INDEX IF NOT EXISTS idx_application_proposal_versions_source ON application_proposal_versions(source);

CREATE TABLE IF NOT EXISTS application_screening_coverage (
  job_id TEXT NOT NULL,
  question_index INTEGER NOT NULL,
  question_text TEXT,
  planned_answer TEXT,
  filled_answer TEXT,
  verified_answer TEXT,
  human_edited_answer TEXT,
  final_answer TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(job_id, question_index)
);

CREATE INDEX IF NOT EXISTS idx_application_screening_coverage_job_id ON application_screening_coverage(job_id, question_index);

CREATE TABLE IF NOT EXISTS application_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_file_id TEXT,
  original_name TEXT NOT NULL,
  relative_path TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  proof_type TEXT NOT NULL,
  attach_policy TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(job_id, source, source_file_id, original_name)
);

CREATE INDEX IF NOT EXISTS idx_application_assets_job_id ON application_assets(job_id);
CREATE INDEX IF NOT EXISTS idx_application_assets_source ON application_assets(source);

CREATE TABLE IF NOT EXISTS browser_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_browser_actions_status ON browser_actions(status);
CREATE INDEX IF NOT EXISTS idx_browser_actions_job_id ON browser_actions(job_id);
CREATE INDEX IF NOT EXISTS idx_browser_actions_created_at ON browser_actions(created_at);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_run_at TEXT NOT NULL,
  last_success_at TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS health_alerts (
  alert_key TEXT PRIMARY KEY,
  last_sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_updated_at ON worker_heartbeats(updated_at);
CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_status ON worker_heartbeats(status);
`);

function ensureSeenJobsColumn(name: string, definition: string): void {
  const columns = db.prepare<[], { name: string }>("PRAGMA table_info(seen_jobs)").all();
  const exists = columns.some((column) => column.name === name);
  if (!exists) {
    db.exec(`ALTER TABLE seen_jobs ADD COLUMN ${name} ${definition}`);
  }
}

ensureSeenJobsColumn("description", "TEXT");
ensureSeenJobsColumn("budget", "TEXT");
ensureSeenJobsColumn("client_country", "TEXT");
ensureSeenJobsColumn("client_rating", "REAL");
ensureSeenJobsColumn("client_spend", "REAL");
ensureSeenJobsColumn("client_hire_rate", "REAL");
ensureSeenJobsColumn("skills", "TEXT");
ensureSeenJobsColumn("experience_level", "TEXT");
ensureSeenJobsColumn("connects_cost", "INTEGER");
ensureSeenJobsColumn("source_query", "TEXT");
ensureSeenJobsColumn("proposal_count", "INTEGER");
ensureSeenJobsColumn("competition_level", "TEXT");

function ensureApplicationsColumn(name: string, definition: string): void {
  const columns = db.prepare<[], { name: string }>("PRAGMA table_info(applications)").all();
  const exists = columns.some((column) => column.name === name);
  if (!exists) {
    db.exec(`ALTER TABLE applications ADD COLUMN ${name} ${definition}`);
  }
}

ensureApplicationsColumn("actual_required_connects", "INTEGER");
ensureApplicationsColumn("actual_boost_connects", "INTEGER");
ensureApplicationsColumn("actual_total_connects", "INTEGER");
ensureApplicationsColumn("boost_rank", "INTEGER");
ensureApplicationsColumn("actual_client_spend", "REAL");
ensureApplicationsColumn("actual_rate", "REAL");
ensureApplicationsColumn("profile_used", "TEXT");
ensureApplicationsColumn("attachments_used", "TEXT DEFAULT '[]'");
ensureApplicationsColumn("profile_highlights_used", "TEXT DEFAULT '[]'");
ensureApplicationsColumn("submitted_proposal_text", "TEXT");
ensureApplicationsColumn("proposal_version", "INTEGER NOT NULL DEFAULT 1");
ensureApplicationsColumn("revision_requests", "TEXT NOT NULL DEFAULT '[]'");
ensureApplicationsColumn("job_intelligence", "TEXT");
ensureApplicationsColumn("connects_strategy", "TEXT");
ensureApplicationsColumn("structured_proposal", "TEXT");
ensureApplicationsColumn("proof_plan_overrides", "TEXT NOT NULL DEFAULT '{}'");
ensureSeenJobsColumn("fingerprint", "TEXT");
db.exec("CREATE INDEX IF NOT EXISTS idx_seen_jobs_fingerprint ON seen_jobs(fingerprint)");

const countStmt = db.prepare<[], CountRow>("SELECT COUNT(*) as count FROM seen_jobs");
const isSeenStmt = db.prepare<[string], SeenRow>(
  "SELECT 1 as found FROM seen_jobs WHERE id = ? LIMIT 1"
);
const upsertSeenStmt = db.prepare(
  `INSERT INTO seen_jobs (
    id,
    title,
    url,
    description,
    score,
    match_level,
    budget,
    client_country,
    client_rating,
    client_spend,
    client_hire_rate,
    skills,
    experience_level,
    connects_cost,
    source_query,
    proposal_count,
    competition_level,
    posted_at,
    fingerprint,
    notified
  )
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     title = excluded.title,
     url = excluded.url,
     description = excluded.description,
     score = excluded.score,
     match_level = excluded.match_level,
     budget = excluded.budget,
     client_country = excluded.client_country,
     client_rating = excluded.client_rating,
     client_spend = excluded.client_spend,
     client_hire_rate = excluded.client_hire_rate,
     skills = excluded.skills,
     experience_level = excluded.experience_level,
     connects_cost = excluded.connects_cost,
     source_query = excluded.source_query,
     proposal_count = excluded.proposal_count,
     competition_level = excluded.competition_level,
     posted_at = excluded.posted_at,
     fingerprint = excluded.fingerprint,
     notified = CASE WHEN seen_jobs.notified = 1 OR excluded.notified = 1 THEN 1 ELSE 0 END,
     seen_at = datetime('now')`
);
const seenFingerprintStmt = db.prepare<[string], SeenRow>(
  "SELECT 1 as found FROM seen_jobs WHERE fingerprint = ? LIMIT 1"
);
const recentSeenFingerprintsStmt = db.prepare<[], SeenFingerprintRow>(
  `SELECT id, title, url, description, posted_at, budget, client_country, client_rating, client_spend,
          client_hire_rate, skills, experience_level, connects_cost, proposal_count, competition_level, fingerprint
   FROM seen_jobs
   WHERE fingerprint IS NOT NULL
   ORDER BY seen_at DESC
   LIMIT 500`
);
const cleanupStmt = db.prepare("DELETE FROM seen_jobs WHERE seen_at < datetime('now', '-30 days')");
const queueInsertStmt = db.prepare("INSERT INTO slack_queue (payload, attempts) VALUES (?, 0)");
const queueSelectStmt = db.prepare<[], SlackQueueItem>(
  "SELECT id, payload, attempts FROM slack_queue ORDER BY id ASC LIMIT 25"
);
const queueDeleteStmt = db.prepare("DELETE FROM slack_queue WHERE id = ?");
const queueAttemptStmt = db.prepare(
  "UPDATE slack_queue SET attempts = attempts + 1 WHERE id = ?"
);
const queueStatsStmt = db.prepare<[], SlackQueueStats>(
  "SELECT COUNT(*) as count, COALESCE(MAX(attempts), 0) as maxAttempts FROM slack_queue"
);
const insertSlackThreadStateStmt = db.prepare(
  `INSERT INTO slack_thread_state (
    channel_id,
    message_ts,
    thread_ts,
    upwork_url,
    job_id,
    status
  )
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(channel_id, message_ts) DO UPDATE SET
    thread_ts = excluded.thread_ts,
    upwork_url = excluded.upwork_url,
    job_id = COALESCE(excluded.job_id, slack_thread_state.job_id),
    status = excluded.status,
    updated_at = datetime('now')`
);
const getSlackThreadStateByChannelThreadStmt = db.prepare<[string, string], SlackThreadStateRow>(
  `SELECT id, channel_id, message_ts, thread_ts, upwork_url, job_id, status, created_at, updated_at
   FROM slack_thread_state
   WHERE channel_id = ? AND thread_ts = ?
   ORDER BY created_at DESC, id DESC
   LIMIT 1`
);
const getSlackThreadStateByChannelMessageStmt = db.prepare<[string, string], SlackThreadStateRow>(
  `SELECT id, channel_id, message_ts, thread_ts, upwork_url, job_id, status, created_at, updated_at
   FROM slack_thread_state
   WHERE channel_id = ? AND message_ts = ?
   LIMIT 1`
);
const getSlackThreadStateByJobIdStmt = db.prepare<[string], SlackThreadStateRow>(
  `SELECT id, channel_id, message_ts, thread_ts, upwork_url, job_id, status, created_at, updated_at
   FROM slack_thread_state
   WHERE job_id = ?
   ORDER BY updated_at DESC, id DESC
   LIMIT 1`
);
const updateSlackThreadStateStatusStmt = db.prepare(
  `UPDATE slack_thread_state
   SET status = ?, job_id = COALESCE(?, job_id), upwork_url = COALESCE(?, upwork_url), updated_at = datetime('now')
   WHERE channel_id = ? AND thread_ts = ?`
);
const listSlackThreadStatesStmt = db.prepare<[string, number], SlackThreadStateRow>(
  `SELECT id, channel_id, message_ts, thread_ts, upwork_url, job_id, status, created_at, updated_at
   FROM slack_thread_state
   WHERE channel_id = ?
   ORDER BY updated_at DESC
   LIMIT ?`
);
const upsertSlackBehaviorMemoryStmt = db.prepare(
  `INSERT INTO slack_behavior_memory (
    type,
    rule,
    scope,
    source,
    thread_channel_id,
    thread_ts,
    job_id,
    confidence,
    active,
    metadata,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))
  ON CONFLICT(type, rule, scope) DO UPDATE SET
    source = excluded.source,
    thread_channel_id = COALESCE(excluded.thread_channel_id, slack_behavior_memory.thread_channel_id),
    thread_ts = COALESCE(excluded.thread_ts, slack_behavior_memory.thread_ts),
    job_id = COALESCE(excluded.job_id, slack_behavior_memory.job_id),
    confidence = excluded.confidence,
    active = 1,
    metadata = excluded.metadata,
    updated_at = datetime('now')`
);
const getSlackBehaviorMemoryByKeyStmt = db.prepare<[SlackBehaviorMemoryType, string, string], SlackBehaviorMemoryRow>(
  `SELECT id, type, rule, scope, source, thread_channel_id, thread_ts, job_id, confidence, active, metadata, created_at, updated_at
   FROM slack_behavior_memory
   WHERE type = ? AND rule = ? AND scope = ?
   LIMIT 1`
);
const listActiveSlackBehaviorMemoriesStmt = db.prepare<[number], SlackBehaviorMemoryRow>(
  `SELECT id, type, rule, scope, source, thread_channel_id, thread_ts, job_id, confidence, active, metadata, created_at, updated_at
   FROM slack_behavior_memory
   WHERE active = 1
   ORDER BY updated_at DESC, id DESC
   LIMIT ?`
);
const insertSlackFailureReflectionStmt = db.prepare(
  `INSERT INTO slack_failure_reflections (
    channel_id,
    thread_ts,
    job_id,
    user_message,
    what_happened,
    why_it_failed,
    next_behavior,
    fix_type,
    proposed_task
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const listRecentSlackFailureReflectionsStmt = db.prepare<[number], SlackFailureReflectionRow>(
  `SELECT id, channel_id, thread_ts, job_id, user_message, what_happened, why_it_failed, next_behavior, fix_type, proposed_task, created_at
   FROM slack_failure_reflections
   ORDER BY created_at DESC, id DESC
   LIMIT ?`
);
const insertAgentEventStmt = db.prepare(
  `INSERT INTO agent_events (
    event_type,
    source_type,
    source_id,
    job_id,
    application_id,
    thread_ts,
    actor,
    summary,
    payload_json,
    importance,
    privacy_level,
    embedding_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const getAgentEventByIdStmt = db.prepare<[number], AgentEventRow>(
  `SELECT id, created_at, event_type, source_type, source_id, job_id, application_id, thread_ts, actor,
          summary, payload_json, importance, privacy_level, embedding_id
   FROM agent_events
   WHERE id = ?`
);
const listRecentAgentEventsStmt = db.prepare<[number], AgentEventRow>(
  `SELECT id, created_at, event_type, source_type, source_id, job_id, application_id, thread_ts, actor,
          summary, payload_json, importance, privacy_level, embedding_id
   FROM agent_events
   ORDER BY created_at DESC, id DESC
   LIMIT ?`
);
const upsertAgentMemoryStmt = db.prepare(
  `INSERT INTO agent_memories (
    memory_type,
    scope,
    title,
    summary,
    rule_text,
    hypothesis_text,
    confidence,
    importance,
    evidence_count,
    status,
    version,
    supersedes_memory_id,
    contradicted_by_memory_id,
    source_event_ids,
    keywords,
    embedding_id,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(memory_type, scope, title, summary) DO UPDATE SET
    rule_text = COALESCE(excluded.rule_text, agent_memories.rule_text),
    hypothesis_text = COALESCE(excluded.hypothesis_text, agent_memories.hypothesis_text),
    confidence = CASE
      WHEN agent_memories.confidence = 'high' OR excluded.confidence = 'high' THEN 'high'
      WHEN agent_memories.confidence = 'medium' OR excluded.confidence = 'medium' THEN 'medium'
      ELSE 'low'
    END,
    importance = MAX(agent_memories.importance, excluded.importance),
    evidence_count = agent_memories.evidence_count + excluded.evidence_count,
    status = CASE
      WHEN excluded.status = 'forgotten' THEN 'forgotten'
      WHEN agent_memories.status = 'forgotten' THEN 'forgotten'
      WHEN agent_memories.status = 'archived' THEN 'archived'
      WHEN agent_memories.status = 'active' AND excluded.status = 'tentative' THEN 'active'
      WHEN agent_memories.evidence_count + excluded.evidence_count >= 2 AND excluded.status = 'tentative' THEN 'active'
      ELSE excluded.status
    END,
    version = MAX(agent_memories.version + 1, excluded.version),
    supersedes_memory_id = COALESCE(excluded.supersedes_memory_id, agent_memories.supersedes_memory_id),
    contradicted_by_memory_id = COALESCE(excluded.contradicted_by_memory_id, agent_memories.contradicted_by_memory_id),
    source_event_ids = excluded.source_event_ids,
    keywords = excluded.keywords,
    embedding_id = COALESCE(excluded.embedding_id, agent_memories.embedding_id),
    updated_at = datetime('now')`
);
const getAgentMemoryByKeyStmt = db.prepare<[string, string, string, string], AgentMemoryRow>(
  `SELECT id, memory_type, scope, title, summary, rule_text, hypothesis_text, confidence, importance, evidence_count,
          created_at, updated_at, last_used_at, decay_score, status, version, supersedes_memory_id,
          contradicted_by_memory_id, source_event_ids, keywords, embedding_id
   FROM agent_memories
   WHERE memory_type = ? AND scope = ? AND title = ? AND summary = ?
   LIMIT 1`
);
const getAgentMemoryByIdStmt = db.prepare<[number], AgentMemoryRow>(
  `SELECT id, memory_type, scope, title, summary, rule_text, hypothesis_text, confidence, importance, evidence_count,
          created_at, updated_at, last_used_at, decay_score, status, version, supersedes_memory_id,
          contradicted_by_memory_id, source_event_ids, keywords, embedding_id
   FROM agent_memories
   WHERE id = ?
   LIMIT 1`
);
const listAgentMemoriesStmt = db.prepare<[number], AgentMemoryRow>(
  `SELECT id, memory_type, scope, title, summary, rule_text, hypothesis_text, confidence, importance, evidence_count,
          created_at, updated_at, last_used_at, decay_score, status, version, supersedes_memory_id,
          contradicted_by_memory_id, source_event_ids, keywords, embedding_id
   FROM agent_memories
   WHERE status IN ('tentative', 'active')
   ORDER BY importance DESC, evidence_count DESC, updated_at DESC, id DESC
   LIMIT ?`
);
const listAgentMemoriesByTypeStmt = db.prepare<[string, number], AgentMemoryRow>(
  `SELECT id, memory_type, scope, title, summary, rule_text, hypothesis_text, confidence, importance, evidence_count,
          created_at, updated_at, last_used_at, decay_score, status, version, supersedes_memory_id,
          contradicted_by_memory_id, source_event_ids, keywords, embedding_id
   FROM agent_memories
   WHERE memory_type = ? AND status IN ('tentative', 'active')
   ORDER BY importance DESC, evidence_count DESC, updated_at DESC, id DESC
   LIMIT ?`
);
const touchAgentMemoryStmt = db.prepare<[number]>(
  `UPDATE agent_memories SET last_used_at = datetime('now') WHERE id = ?`
);
const forgetAgentMemoryByIdStmt = db.prepare<[number]>(
  `UPDATE agent_memories SET status = 'forgotten', updated_at = datetime('now') WHERE id = ?`
);
const updateAgentMemoryStateStmt = db.prepare<[AgentMemoryStatus | null, number | null, number | null, number | null, number | null, number]>(
  `UPDATE agent_memories
   SET status = COALESCE(?, status),
       importance = COALESCE(?, importance),
       decay_score = COALESCE(?, decay_score),
       supersedes_memory_id = COALESCE(?, supersedes_memory_id),
       contradicted_by_memory_id = COALESCE(?, contradicted_by_memory_id),
       updated_at = datetime('now')
   WHERE id = ?`
);
const updateAgentMemoryContentStmt = db.prepare<[
  string | null,
  string | null,
  string | null,
  string | null,
  AgentMemoryConfidence | null,
  AgentMemoryConfidence | null,
  AgentMemoryConfidence | null,
  number | null,
  number | null,
  AgentMemoryStatus | null,
  AgentMemoryStatus | null,
  AgentMemoryStatus | null,
  number | null,
  string | null,
  string | null,
  number,
]>(
  `UPDATE agent_memories
   SET title = COALESCE(?, title),
       summary = COALESCE(?, summary),
       rule_text = COALESCE(?, rule_text),
       hypothesis_text = COALESCE(?, hypothesis_text),
       confidence = CASE
         WHEN ? IS NULL THEN confidence
         WHEN confidence = 'high' OR ? = 'high' THEN 'high'
         WHEN confidence = 'medium' OR ? = 'medium' THEN 'medium'
         ELSE 'low'
       END,
       importance = COALESCE(?, importance),
       evidence_count = evidence_count + COALESCE(?, 0),
       status = CASE
         WHEN status = 'forgotten' THEN 'forgotten'
         WHEN status = 'archived' THEN 'archived'
         WHEN ? IS NULL THEN status
         WHEN status = 'active' AND ? = 'tentative' THEN 'active'
         ELSE ?
       END,
       version = version + COALESCE(?, 1),
       source_event_ids = COALESCE(?, source_event_ids),
       keywords = COALESCE(?, keywords),
       updated_at = datetime('now')
   WHERE id = ?`
);
const forgetAgentMemoriesMatchingStmt = db.prepare<[string, string, string, string, string]>(
  `UPDATE agent_memories
   SET status = 'forgotten', updated_at = datetime('now')
   WHERE status IN ('tentative', 'active')
     AND (? = '' OR memory_type = ?)
     AND (LOWER(title) LIKE LOWER(?) OR LOWER(summary) LIKE LOWER(?) OR LOWER(COALESCE(hypothesis_text, '')) LIKE LOWER(?))`
);
const insertMemoryEmbeddingStmt = db.prepare(
  `INSERT INTO memory_embeddings (owner_type, owner_id, provider, model, vector_json_or_blob)
   VALUES (?, ?, ?, ?, ?)`
);
const getMemoryEmbeddingByIdStmt = db.prepare<[number], MemoryEmbeddingRow>(
  `SELECT id, owner_type, owner_id, provider, model, vector_json_or_blob, created_at
   FROM memory_embeddings
   WHERE id = ?
   LIMIT 1`
);
const listMemoryEmbeddingsByOwnerStmt = db.prepare<[string, number], MemoryEmbeddingRow>(
  `SELECT id, owner_type, owner_id, provider, model, vector_json_or_blob, created_at
   FROM memory_embeddings
   WHERE owner_type = ? AND owner_id = ?
   ORDER BY created_at DESC, id DESC`
);
const updateAgentMemoryEmbeddingIdStmt = db.prepare<[number, number]>(
  `UPDATE agent_memories
   SET embedding_id = ?, updated_at = datetime('now')
   WHERE id = ?`
);
const insertMemoryConsolidationStmt = db.prepare(
  `INSERT INTO memory_consolidations (
    period_start,
    period_end,
    summary_type,
    summary,
    source_memory_ids,
    source_event_ids,
    confidence,
    status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const upsertMemoryLinkStmt = db.prepare(
  `INSERT INTO memory_links (
    source_memory_id,
    target_memory_id,
    relationship_type,
    strength,
    reason,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(source_memory_id, target_memory_id, relationship_type) DO UPDATE SET
    strength = MAX(memory_links.strength, excluded.strength),
    reason = CASE WHEN excluded.reason != '' THEN excluded.reason ELSE memory_links.reason END,
    updated_at = datetime('now')`
);
const getMemoryLinkStmt = db.prepare<[number, number, string], MemoryLinkRow>(
  `SELECT id, source_memory_id, target_memory_id, relationship_type, strength, reason, created_at, updated_at
   FROM memory_links
   WHERE source_memory_id = ? AND target_memory_id = ? AND relationship_type = ?
   LIMIT 1`
);
const listMemoryLinksForMemoryStmt = db.prepare<[number, number, number], MemoryLinkRow>(
  `SELECT id, source_memory_id, target_memory_id, relationship_type, strength, reason, created_at, updated_at
   FROM memory_links
   WHERE source_memory_id = ? OR target_memory_id = ?
   ORDER BY strength DESC, updated_at DESC, id DESC
   LIMIT ?`
);
const upsertMemoryRelationStmt = db.prepare(
  `INSERT INTO memory_relations (
    source_entity,
    relation,
    target_entity,
    confidence,
    source_memory_ids,
    evidence_count,
    status,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(source_entity, relation, target_entity) DO UPDATE SET
    confidence = excluded.confidence,
    source_memory_ids = excluded.source_memory_ids,
    evidence_count = memory_relations.evidence_count + excluded.evidence_count,
    status = CASE
      WHEN excluded.status = 'forgotten' THEN 'forgotten'
      WHEN memory_relations.status = 'forgotten' THEN excluded.status
      WHEN memory_relations.evidence_count + excluded.evidence_count >= 2 AND excluded.status = 'tentative' THEN 'active'
      ELSE excluded.status
    END,
    updated_at = datetime('now')`
);
const getMemoryRelationStmt = db.prepare<[string, string, string], MemoryRelationRow>(
  `SELECT id, source_entity, relation, target_entity, confidence, source_memory_ids, evidence_count, status, created_at, updated_at
   FROM memory_relations
   WHERE source_entity = ? AND relation = ? AND target_entity = ?
   LIMIT 1`
);
const listMemoryRelationsStmt = db.prepare<[number], MemoryRelationRow>(
  `SELECT id, source_entity, relation, target_entity, confidence, source_memory_ids, evidence_count, status, created_at, updated_at
   FROM memory_relations
   WHERE status IN ('tentative', 'active')
   ORDER BY evidence_count DESC, updated_at DESC, id DESC
   LIMIT ?`
);
const upsertMemoryThreadSummaryStmt = db.prepare(
  `INSERT INTO memory_thread_summaries (
    owner_type,
    owner_id,
    channel_id,
    thread_ts,
    job_id,
    summary,
    recent_messages_json,
    source_event_ids,
    source_memory_ids,
    status,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(owner_type, owner_id) DO UPDATE SET
    channel_id = COALESCE(excluded.channel_id, memory_thread_summaries.channel_id),
    thread_ts = COALESCE(excluded.thread_ts, memory_thread_summaries.thread_ts),
    job_id = COALESCE(excluded.job_id, memory_thread_summaries.job_id),
    summary = excluded.summary,
    recent_messages_json = excluded.recent_messages_json,
    source_event_ids = excluded.source_event_ids,
    source_memory_ids = excluded.source_memory_ids,
    status = excluded.status,
    version = memory_thread_summaries.version + 1,
    updated_at = datetime('now')`
);
const getMemoryThreadSummaryStmt = db.prepare<[string, string], MemoryThreadSummaryRow>(
  `SELECT id, owner_type, owner_id, channel_id, thread_ts, job_id, summary, recent_messages_json,
          source_event_ids, source_memory_ids, version, status, created_at, updated_at
   FROM memory_thread_summaries
   WHERE owner_type = ? AND owner_id = ?
   LIMIT 1`
);
const listMemoryThreadSummariesStmt = db.prepare<[number], MemoryThreadSummaryRow>(
  `SELECT id, owner_type, owner_id, channel_id, thread_ts, job_id, summary, recent_messages_json,
          source_event_ids, source_memory_ids, version, status, created_at, updated_at
   FROM memory_thread_summaries
   WHERE status IN ('tentative', 'active')
   ORDER BY updated_at DESC, id DESC
   LIMIT ?`
);
const insertTaskTelemetryStmt = db.prepare(
  `INSERT INTO task_telemetry (
    task_type,
    source_type,
    source_id,
    job_id,
    thread_ts,
    success,
    correction_received,
    user_frustration_detected,
    manual_intervention_required,
    browser_security_blocker,
    retry_required,
    latency_ms,
    provider,
    model,
    action_status,
    outcome,
    confidence,
    failure_reason,
    metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const getTaskTelemetryByIdStmt = db.prepare<[number], TaskTelemetryRow>(
  `SELECT id, created_at, task_type, source_type, source_id, job_id, thread_ts, success,
          correction_received, user_frustration_detected, manual_intervention_required,
          browser_security_blocker, retry_required, latency_ms, provider, model,
          action_status, outcome, confidence, failure_reason, metadata_json
   FROM task_telemetry
   WHERE id = ?`
);
const listTaskTelemetryStmt = db.prepare<[number], TaskTelemetryRow>(
  `SELECT id, created_at, task_type, source_type, source_id, job_id, thread_ts, success,
          correction_received, user_frustration_detected, manual_intervention_required,
          browser_security_blocker, retry_required, latency_ms, provider, model,
          action_status, outcome, confidence, failure_reason, metadata_json
   FROM task_telemetry
   ORDER BY created_at DESC, id DESC
   LIMIT ?`
);
const insertImprovementCandidateStmt = db.prepare(
  `INSERT INTO improvement_candidates (
    candidate_type,
    title,
    summary,
    rationale,
    source_task_ids,
    source_memory_ids,
    status,
    priority,
    created_by,
    metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const getImprovementCandidateByIdStmt = db.prepare<[number], ImprovementCandidateRow>(
  `SELECT id, created_at, candidate_type, title, summary, rationale, source_task_ids,
          source_memory_ids, status, priority, created_by, shipped_at, metadata_json
   FROM improvement_candidates
   WHERE id = ?`
);
const listImprovementCandidatesStmt = db.prepare<[number], ImprovementCandidateRow>(
  `SELECT id, created_at, candidate_type, title, summary, rationale, source_task_ids,
          source_memory_ids, status, priority, created_by, shipped_at, metadata_json
   FROM improvement_candidates
   ORDER BY priority DESC, created_at DESC, id DESC
   LIMIT ?`
);
const insertPromptToolVersionStmt = db.prepare(
  `INSERT INTO prompt_tool_versions (
    version_id,
    kind,
    name,
    change_summary,
    reason,
    related_scorecard_json,
    related_failure_id,
    created_by,
    active,
    rollback_target_version_id,
    tests_json,
    metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const getPromptToolVersionByVersionIdStmt = db.prepare<[string], PromptToolVersionRow>(
  `SELECT id, version_id, created_at, kind, name, change_summary, reason, related_scorecard_json,
          related_failure_id, created_by, active, rollback_target_version_id, tests_json, metadata_json
   FROM prompt_tool_versions
   WHERE version_id = ?`
);
const listPromptToolVersionsStmt = db.prepare<[number], PromptToolVersionRow>(
  `SELECT id, version_id, created_at, kind, name, change_summary, reason, related_scorecard_json,
          related_failure_id, created_by, active, rollback_target_version_id, tests_json, metadata_json
   FROM prompt_tool_versions
   ORDER BY created_at DESC, id DESC
   LIMIT ?`
);
const deactivatePromptToolVersionStmt = db.prepare<[string]>(
  `UPDATE prompt_tool_versions SET active = 0 WHERE version_id = ?`
);
const insertSelfImprovementEvalStmt = db.prepare(
  `INSERT INTO self_improvement_evals (
    eval_type,
    title,
    input_context_json,
    expected_behavior,
    safety_assertions_json,
    regression_guard,
    source_failure_id,
    status,
    metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const getSelfImprovementEvalByIdStmt = db.prepare<[number], SelfImprovementEvalRow>(
  `SELECT id, created_at, eval_type, title, input_context_json, expected_behavior,
          safety_assertions_json, regression_guard, source_failure_id, status, metadata_json
   FROM self_improvement_evals
   WHERE id = ?`
);
const listSelfImprovementEvalsStmt = db.prepare<[number], SelfImprovementEvalRow>(
  `SELECT id, created_at, eval_type, title, input_context_json, expected_behavior,
          safety_assertions_json, regression_guard, source_failure_id, status, metadata_json
   FROM self_improvement_evals
   ORDER BY created_at DESC, id DESC
   LIMIT ?`
);
const insertSalesLearningEventStmt = db.prepare(
  `INSERT INTO sales_learning_events (
    event_type,
    job_id,
    channel_id,
    thread_ts,
    source,
    payload
  ) VALUES (?, ?, ?, ?, ?, ?)`
);
const getSalesLearningEventByIdStmt = db.prepare<[number], SalesLearningEventRow>(
  `SELECT id, event_type, job_id, channel_id, thread_ts, source, payload, created_at
   FROM sales_learning_events
   WHERE id = ?`
);
const listRecentSalesLearningEventsStmt = db.prepare<[number], SalesLearningEventRow>(
  `SELECT id, event_type, job_id, channel_id, thread_ts, source, payload, created_at
   FROM sales_learning_events
   ORDER BY created_at DESC, id DESC
   LIMIT ?`
);
const upsertSalesLearningMemoryStmt = db.prepare(
  `INSERT INTO sales_learning_memories (
    type,
    scope,
    subject,
    hypothesis,
    rationale,
    confidence,
    evidence_count,
    status,
    source,
    job_id,
    channel_id,
    thread_ts,
    examples,
    metadata,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(type, scope, subject, hypothesis) DO UPDATE SET
    rationale = excluded.rationale,
    confidence = excluded.confidence,
    evidence_count = sales_learning_memories.evidence_count + excluded.evidence_count,
    status = CASE
      WHEN excluded.status = 'forgotten' THEN 'forgotten'
      WHEN sales_learning_memories.status = 'forgotten' THEN excluded.status
      WHEN sales_learning_memories.evidence_count + excluded.evidence_count >= 2 AND excluded.status = 'tentative' THEN 'active'
      ELSE excluded.status
    END,
    source = excluded.source,
    job_id = COALESCE(excluded.job_id, sales_learning_memories.job_id),
    channel_id = COALESCE(excluded.channel_id, sales_learning_memories.channel_id),
    thread_ts = COALESCE(excluded.thread_ts, sales_learning_memories.thread_ts),
    examples = excluded.examples,
    metadata = excluded.metadata,
    updated_at = datetime('now')`
);
const getSalesLearningMemoryByKeyStmt = db.prepare<[SalesLearningMemoryType, string, string, string], SalesLearningMemoryRow>(
  `SELECT id, type, scope, subject, hypothesis, rationale, confidence, evidence_count, status, source,
          job_id, channel_id, thread_ts, examples, metadata, created_at, updated_at
   FROM sales_learning_memories
   WHERE type = ? AND scope = ? AND subject = ? AND hypothesis = ?
   LIMIT 1`
);
const listSalesLearningMemoriesStmt = db.prepare<[number], SalesLearningMemoryRow>(
  `SELECT id, type, scope, subject, hypothesis, rationale, confidence, evidence_count, status, source,
          job_id, channel_id, thread_ts, examples, metadata, created_at, updated_at
   FROM sales_learning_memories
   WHERE status IN ('tentative', 'active')
   ORDER BY evidence_count DESC, updated_at DESC, id DESC
   LIMIT ?`
);
const listSalesLearningMemoriesByTypeStmt = db.prepare<[SalesLearningMemoryType, number], SalesLearningMemoryRow>(
  `SELECT id, type, scope, subject, hypothesis, rationale, confidence, evidence_count, status, source,
          job_id, channel_id, thread_ts, examples, metadata, created_at, updated_at
   FROM sales_learning_memories
   WHERE type = ? AND status IN ('tentative', 'active')
   ORDER BY evidence_count DESC, updated_at DESC, id DESC
   LIMIT ?`
);
const forgetSalesLearningMemoryByIdStmt = db.prepare<[number]>(
  `UPDATE sales_learning_memories
   SET status = 'forgotten', updated_at = datetime('now')
   WHERE id = ?`
);
const forgetSalesLearningMemoriesMatchingStmt = db.prepare<[string, string, string, string]>(
  `UPDATE sales_learning_memories
   SET status = 'forgotten', updated_at = datetime('now')
   WHERE status IN ('tentative', 'active')
     AND (? = '' OR type = ?)
     AND (LOWER(subject) LIKE LOWER(?) OR LOWER(hypothesis) LIKE LOWER(?))`
);
const insertBrowserActionStmt = db.prepare(
  `INSERT INTO browser_actions (job_id, action_type, status, payload, attempts, last_error, updated_at)
   VALUES (?, ?, 'pending', ?, 0, NULL, datetime('now'))`
);
const listBrowserActionsStmt = db.prepare<[BrowserActionStatus | null, BrowserActionStatus | null, number], BrowserActionRow>(
  `SELECT id, job_id, action_type, status, payload, attempts, last_error, created_at, updated_at
   FROM browser_actions
   WHERE (? IS NULL OR status = ?)
   ORDER BY created_at ASC, id ASC
   LIMIT ?`
);
const getBrowserActionByIdStmt = db.prepare<[number], BrowserActionRow>(
  `SELECT id, job_id, action_type, status, payload, attempts, last_error, created_at, updated_at
   FROM browser_actions
   WHERE id = ?`
);
const activeDuplicateBrowserActionStmt = db.prepare<[string, BrowserActionType], BrowserActionRow>(
  `SELECT id, job_id, action_type, status, payload, attempts, last_error, created_at, updated_at
   FROM browser_actions
   WHERE job_id = ?
     AND action_type = ?
     AND status IN ('pending', 'in_progress', 'paused')
   ORDER BY created_at ASC, id ASC
   LIMIT 1`
);
const updateBrowserActionStatusStmt = db.prepare(
  `UPDATE browser_actions
   SET status = ?, last_error = ?, updated_at = datetime('now')
   WHERE id = ?`
);
const updateBrowserActionPayloadStmt = db.prepare(
  `UPDATE browser_actions
   SET payload = ?, updated_at = datetime('now')
   WHERE id = ?`
);
const incrementBrowserActionAttemptStmt = db.prepare(
  `UPDATE browser_actions
   SET attempts = attempts + 1, last_error = ?, updated_at = datetime('now')
   WHERE id = ?`
);
const upsertHeartbeatStmt = db.prepare(
  `INSERT INTO worker_heartbeats (
    worker,
    status,
    last_run_at,
    last_success_at,
    run_count,
    success_count,
    error_count,
    last_error,
    metadata,
    updated_at
  ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  ON CONFLICT(worker) DO UPDATE SET
    status = excluded.status,
    last_run_at = excluded.last_run_at,
    last_success_at = COALESCE(excluded.last_success_at, worker_heartbeats.last_success_at),
    run_count = worker_heartbeats.run_count + 1,
    success_count = worker_heartbeats.success_count + excluded.success_count,
    error_count = worker_heartbeats.error_count + excluded.error_count,
    last_error = excluded.last_error,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at`
);
const getHeartbeatStmt = db.prepare<[string], HeartbeatRow>(
  `SELECT worker, status, last_run_at, last_success_at, run_count, success_count, error_count,
          last_error, metadata, updated_at
   FROM worker_heartbeats
   WHERE worker = ?`
);
const listHeartbeatsStmt = db.prepare<[], HeartbeatRow>(
  `SELECT worker, status, last_run_at, last_success_at, run_count, success_count, error_count,
          last_error, metadata, updated_at
   FROM worker_heartbeats
   ORDER BY worker ASC`
);
const staleHeartbeatsStmt = db.prepare<[string], HeartbeatRow>(
  `SELECT worker, status, last_run_at, last_success_at, run_count, success_count, error_count,
          last_error, metadata, updated_at
   FROM worker_heartbeats
   WHERE datetime(updated_at) < datetime(?)
   ORDER BY updated_at ASC`
);
const getHealthAlertStmt = db.prepare<[string], { last_sent_at: string }>(
  "SELECT last_sent_at FROM health_alerts WHERE alert_key = ?"
);
const upsertHealthAlertStmt = db.prepare(
  `INSERT INTO health_alerts (alert_key, last_sent_at) VALUES (?, ?)
   ON CONFLICT(alert_key) DO UPDATE SET last_sent_at = excluded.last_sent_at`
);

function formatHeartbeatTimestamp(date: Date): string {
  return date.toISOString();
}

function parseHeartbeatMetadata(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function rowToHeartbeat(row: HeartbeatRow): HeartbeatRecord {
  return {
    worker: row.worker,
    status: row.status,
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    runCount: row.run_count,
    successCount: row.success_count,
    errorCount: row.error_count,
    lastError: row.last_error,
    metadata: parseHeartbeatMetadata(row.metadata),
    updatedAt: row.updated_at,
  };
}

function rowToSlackThreadState(row: SlackThreadStateRow): SlackThreadState {
  return {
    id: row.id,
    channelId: row.channel_id,
    messageTs: row.message_ts,
    threadTs: row.thread_ts,
    upworkUrl: row.upwork_url,
    jobId: row.job_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSlackBehaviorMemory(row: SlackBehaviorMemoryRow): SlackBehaviorMemory {
  return {
    id: row.id,
    type: row.type,
    rule: row.rule,
    scope: row.scope,
    source: row.source,
    threadChannelId: row.thread_channel_id,
    threadTs: row.thread_ts,
    jobId: row.job_id,
    confidence: row.confidence,
    active: row.active === 1,
    metadata: parseJsonObject<Record<string, unknown>>(row.metadata) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSlackFailureReflection(row: SlackFailureReflectionRow): SlackFailureReflection {
  return {
    id: row.id,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    jobId: row.job_id,
    userMessage: row.user_message,
    whatHappened: row.what_happened,
    whyItFailed: row.why_it_failed,
    nextBehavior: row.next_behavior,
    fixType: row.fix_type,
    proposedTask: row.proposed_task,
    createdAt: row.created_at,
  };
}

function rowToSalesLearningEvent(row: SalesLearningEventRow): SalesLearningEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    jobId: row.job_id,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    source: row.source,
    payload: parseJsonObject<Record<string, unknown>>(row.payload) ?? {},
    createdAt: row.created_at,
  };
}

function rowToSalesLearningMemory(row: SalesLearningMemoryRow): SalesLearningMemory {
  return {
    id: row.id,
    type: row.type,
    scope: row.scope,
    subject: row.subject,
    hypothesis: row.hypothesis,
    rationale: row.rationale,
    confidence: row.confidence,
    evidenceCount: row.evidence_count,
    status: row.status,
    source: row.source,
    jobId: row.job_id,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    examples: parseJsonStringArray(row.examples),
    metadata: parseJsonObject<Record<string, unknown>>(row.metadata) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAgentEvent(row: AgentEventRow): AgentEvent {
  return {
    id: row.id,
    createdAt: row.created_at,
    eventType: row.event_type,
    sourceType: row.source_type,
    sourceId: row.source_id,
    jobId: row.job_id,
    applicationId: row.application_id,
    threadTs: row.thread_ts,
    actor: row.actor,
    summary: row.summary,
    payload: parseJsonObject<Record<string, unknown>>(row.payload_json) ?? {},
    importance: row.importance,
    privacyLevel: row.privacy_level,
    embeddingId: row.embedding_id,
  };
}

function parseJsonNumberArray(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
  } catch {
    return [];
  }
}

function rowToAgentMemory(row: AgentMemoryRow): AgentMemory {
  return {
    id: row.id,
    memoryType: row.memory_type,
    scope: row.scope,
    title: row.title,
    summary: row.summary,
    ruleText: row.rule_text,
    hypothesisText: row.hypothesis_text,
    confidence: row.confidence,
    importance: row.importance,
    evidenceCount: row.evidence_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    decayScore: row.decay_score,
    status: row.status,
    version: row.version,
    supersedesMemoryId: row.supersedes_memory_id,
    contradictedByMemoryId: row.contradicted_by_memory_id,
    sourceEventIds: parseJsonNumberArray(row.source_event_ids),
    keywords: parseJsonStringArray(row.keywords),
    embeddingId: row.embedding_id,
  };
}

function rowToMemoryEmbedding(row: MemoryEmbeddingRow): MemoryEmbedding {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    provider: row.provider,
    model: row.model,
    vectorJsonOrBlob: row.vector_json_or_blob,
    createdAt: row.created_at,
  };
}

function rowToMemoryConsolidation(row: MemoryConsolidationRow): MemoryConsolidation {
  return {
    id: row.id,
    createdAt: row.created_at,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    summaryType: row.summary_type,
    summary: row.summary,
    sourceMemoryIds: parseJsonNumberArray(row.source_memory_ids),
    sourceEventIds: parseJsonNumberArray(row.source_event_ids),
    confidence: row.confidence,
    status: row.status,
  };
}

function rowToMemoryLink(row: MemoryLinkRow): MemoryLink {
  return {
    id: row.id,
    sourceMemoryId: row.source_memory_id,
    targetMemoryId: row.target_memory_id,
    relationshipType: row.relationship_type,
    strength: row.strength,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMemoryRelation(row: MemoryRelationRow): MemoryRelation {
  return {
    id: row.id,
    sourceEntity: row.source_entity,
    relation: row.relation,
    targetEntity: row.target_entity,
    confidence: row.confidence,
    sourceMemoryIds: parseJsonNumberArray(row.source_memory_ids),
    evidenceCount: row.evidence_count,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMemoryThreadSummary(row: MemoryThreadSummaryRow): MemoryThreadSummary {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    jobId: row.job_id,
    summary: row.summary,
    recentMessages: parseJsonStringArray(row.recent_messages_json),
    sourceEventIds: parseJsonNumberArray(row.source_event_ids),
    sourceMemoryIds: parseJsonNumberArray(row.source_memory_ids),
    version: row.version,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTaskTelemetry(row: TaskTelemetryRow): TaskTelemetry {
  return {
    id: row.id,
    createdAt: row.created_at,
    taskType: row.task_type,
    sourceType: row.source_type,
    sourceId: row.source_id,
    jobId: row.job_id,
    threadTs: row.thread_ts,
    success: row.success === 1,
    correctionReceived: row.correction_received === 1,
    userFrustrationDetected: row.user_frustration_detected === 1,
    manualInterventionRequired: row.manual_intervention_required === 1,
    browserSecurityBlocker: row.browser_security_blocker === 1,
    retryRequired: row.retry_required === 1,
    latencyMs: row.latency_ms,
    provider: row.provider,
    model: row.model,
    actionStatus: row.action_status,
    outcome: row.outcome,
    confidence: row.confidence,
    failureReason: row.failure_reason,
    metadata: parseJsonObject<Record<string, unknown>>(row.metadata_json) ?? {},
  };
}

function rowToImprovementCandidate(row: ImprovementCandidateRow): ImprovementCandidate {
  return {
    id: row.id,
    createdAt: row.created_at,
    candidateType: row.candidate_type,
    title: row.title,
    summary: row.summary,
    rationale: row.rationale,
    sourceTaskIds: parseJsonNumberArray(row.source_task_ids),
    sourceMemoryIds: parseJsonNumberArray(row.source_memory_ids),
    status: row.status,
    priority: row.priority,
    createdBy: row.created_by,
    shippedAt: row.shipped_at,
    metadata: parseJsonObject<Record<string, unknown>>(row.metadata_json) ?? {},
  };
}

function rowToPromptToolVersion(row: PromptToolVersionRow): PromptToolVersion {
  return {
    id: row.id,
    versionId: row.version_id,
    createdAt: row.created_at,
    kind: row.kind,
    name: row.name,
    changeSummary: row.change_summary,
    reason: row.reason,
    relatedScorecard: parseJsonObject<Record<string, unknown>>(row.related_scorecard_json) ?? {},
    relatedFailureId: row.related_failure_id,
    createdBy: row.created_by,
    active: row.active === 1,
    rollbackTargetVersionId: row.rollback_target_version_id,
    tests: parseJsonStringArray(row.tests_json),
    metadata: parseJsonObject<Record<string, unknown>>(row.metadata_json) ?? {},
  };
}

function rowToSelfImprovementEval(row: SelfImprovementEvalRow): SelfImprovementEval {
  return {
    id: row.id,
    createdAt: row.created_at,
    evalType: row.eval_type,
    title: row.title,
    inputContext: parseJsonObject<Record<string, unknown>>(row.input_context_json) ?? {},
    expectedBehavior: row.expected_behavior,
    safetyAssertions: parseJsonStringArray(row.safety_assertions_json),
    regressionGuard: row.regression_guard,
    sourceFailureId: row.source_failure_id,
    status: row.status,
    metadata: parseJsonObject<Record<string, unknown>>(row.metadata_json) ?? {},
  };
}

const upsertApplicationStmt = db.prepare(
  `INSERT INTO applications (
    job_id,
    status,
    fit_score,
    fit_reasons,
    red_flags,
    suggested_bid,
    suggested_connects,
    suggested_boost_connects,
    connects_warnings,
    selected_portfolio_items,
    proposal_text,
    structured_proposal,
    generated_at,
    job_intelligence,
    connects_strategy,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(job_id) DO UPDATE SET
    status = excluded.status,
    fit_score = excluded.fit_score,
    fit_reasons = excluded.fit_reasons,
    red_flags = excluded.red_flags,
    suggested_bid = excluded.suggested_bid,
    suggested_connects = excluded.suggested_connects,
    suggested_boost_connects = excluded.suggested_boost_connects,
    connects_warnings = excluded.connects_warnings,
    selected_portfolio_items = excluded.selected_portfolio_items,
    proposal_text = excluded.proposal_text,
    structured_proposal = excluded.structured_proposal,
    generated_at = excluded.generated_at,
    job_intelligence = excluded.job_intelligence,
    connects_strategy = excluded.connects_strategy,
    updated_at = datetime('now')`
);
const getApplicationStatusStmt = db.prepare<[string], { status: ApplicationStatus }>(
  "SELECT status FROM applications WHERE job_id = ? LIMIT 1"
);
const getApplicationJobLinkStmt = db.prepare<[string], ApplicationJobLink>(
  `SELECT a.job_id as jobId, s.url, s.title
   FROM applications a
   LEFT JOIN seen_jobs s ON s.id = a.job_id
   WHERE a.job_id = ?
   LIMIT 1`
);
const getApplicationDraftStmt = db.prepare<[string], ApplicationDraftRow>(
  `SELECT job_id, status, fit_score, fit_reasons, red_flags, suggested_bid, suggested_connects,
          suggested_boost_connects, connects_warnings, selected_portfolio_items, proposal_text,
          structured_proposal, generated_at, proposal_version, revision_requests, job_intelligence, connects_strategy
   FROM applications
   WHERE job_id = ?
   LIMIT 1`
);
const updateApplicationRevisionStmt = db.prepare<[string, string]>(
  `UPDATE applications
   SET revision_requests = ?, status = 'draft', updated_at = datetime('now')
   WHERE job_id = ?`
);
const updateApplicationProofPlanOverridesStmt = db.prepare<[string, string]>(
  `UPDATE applications
   SET proof_plan_overrides = ?, updated_at = datetime('now')
   WHERE job_id = ?`
);
const getApplicationProofPlanOverridesStmt = db.prepare<[string], { proof_plan_overrides: string | null }>(
  `SELECT proof_plan_overrides
   FROM applications
   WHERE job_id = ?
   LIMIT 1`
);
const applyApplicationRevisionStmt = db.prepare<[string, string, string, number, string]>(
  `UPDATE applications
   SET proposal_text = ?, revision_requests = ?, generated_at = ?, proposal_version = ?, status = 'draft', updated_at = datetime('now')
   WHERE job_id = ?`
);
const updateApplicationStatusStmt = db.prepare<[ApplicationStatus, string | null, string | null, string]>(
  `UPDATE applications
   SET status = ?, reviewed_at = COALESCE(?, reviewed_at), submitted_at = COALESCE(?, submitted_at), updated_at = datetime('now')
   WHERE job_id = ?`
);
const insertApplicationEventStmt = db.prepare(
  "INSERT INTO application_events (job_id, event_type, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)"
);
const applicationSummaryStmt = db.prepare<[], ApplicationSummaryRow>(
  "SELECT status, COUNT(*) as count FROM applications GROUP BY status ORDER BY count DESC"
);
const applicationListStmt = db.prepare<[number], ApplicationListRow>(
  `SELECT a.job_id, a.status, a.fit_score, s.title, s.url, a.suggested_bid, a.suggested_connects,
          a.actual_total_connects, a.actual_boost_connects, a.boost_rank, a.actual_client_spend,
          a.attachments_used, a.profile_highlights_used, a.updated_at
   FROM applications a
   LEFT JOIN seen_jobs s ON s.id = a.job_id
   ORDER BY a.updated_at DESC
   LIMIT ?`
);
const applicationNotesStmt = db.prepare<[string], ApplicationNoteRow>(
  "SELECT id, job_id, note, created_at FROM application_events WHERE job_id = ? AND event_type = 'note' ORDER BY id DESC"
);
const getLatestProposalVersionNumberStmt = db.prepare<[string], { version_number: number }>(
  `SELECT version_number
   FROM application_proposal_versions
   WHERE job_id = ?
   ORDER BY version_number DESC
   LIMIT 1`
);
const insertProposalVersionStmt = db.prepare(
  `INSERT INTO application_proposal_versions (
    job_id,
    version_number,
    source,
    label,
    proposal_text,
    screening_answers,
    note
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const listProposalVersionsStmt = db.prepare<[string], ApplicationProposalVersionRow>(
  `SELECT id, job_id, version_number, source, label, proposal_text, screening_answers, note, created_at
   FROM application_proposal_versions
   WHERE job_id = ?
   ORDER BY version_number ASC, id ASC`
);
const latestProposalVersionStmt = db.prepare<[string], ApplicationProposalVersionRow>(
  `SELECT id, job_id, version_number, source, label, proposal_text, screening_answers, note, created_at
   FROM application_proposal_versions
   WHERE job_id = ?
   ORDER BY version_number DESC, id DESC
   LIMIT 1`
);
const latestProposalVersionBySourceStmt = db.prepare<[string, ProposalVersionSource], ApplicationProposalVersionRow>(
  `SELECT id, job_id, version_number, source, label, proposal_text, screening_answers, note, created_at
   FROM application_proposal_versions
   WHERE job_id = ? AND source = ?
   ORDER BY version_number DESC, id DESC
   LIMIT 1`
);
const upsertScreeningCoverageStmt = db.prepare(
  `INSERT INTO application_screening_coverage (
    job_id,
    question_index,
    question_text,
    planned_answer,
    filled_answer,
    verified_answer,
    human_edited_answer,
    final_answer,
    status,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(job_id, question_index) DO UPDATE SET
    question_text = COALESCE(excluded.question_text, application_screening_coverage.question_text),
    planned_answer = COALESCE(excluded.planned_answer, application_screening_coverage.planned_answer),
    filled_answer = COALESCE(excluded.filled_answer, application_screening_coverage.filled_answer),
    verified_answer = COALESCE(excluded.verified_answer, application_screening_coverage.verified_answer),
    human_edited_answer = COALESCE(excluded.human_edited_answer, application_screening_coverage.human_edited_answer),
    final_answer = COALESCE(excluded.final_answer, application_screening_coverage.final_answer),
    status = excluded.status,
    updated_at = datetime('now')`
);
const listScreeningCoverageStmt = db.prepare<[string], ApplicationScreeningCoverageRow>(
  `SELECT job_id, question_index, question_text, planned_answer, filled_answer, verified_answer,
          human_edited_answer, final_answer, status, updated_at
   FROM application_screening_coverage
   WHERE job_id = ?
   ORDER BY question_index ASC`
);
const upsertApplicationAssetStmt = db.prepare(
  `INSERT INTO application_assets (
    job_id,
    source,
    source_file_id,
    original_name,
    relative_path,
    mime_type,
    size_bytes,
    proof_type,
    attach_policy
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(job_id, source, source_file_id, original_name) DO UPDATE SET
    relative_path = excluded.relative_path,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    proof_type = excluded.proof_type,
    attach_policy = excluded.attach_policy`
);
const getApplicationAssetByUniqueStmt = db.prepare<[string, ApplicationAssetSource, string | null, string], ApplicationAssetRow>(
  `SELECT id, job_id, source, source_file_id, original_name, relative_path, mime_type, size_bytes, proof_type, attach_policy, created_at
   FROM application_assets
   WHERE job_id = ? AND source = ? AND COALESCE(source_file_id, '') = COALESCE(?, '') AND original_name = ?
   LIMIT 1`
);
const listApplicationAssetsStmt = db.prepare<[string], ApplicationAssetRow>(
  `SELECT id, job_id, source, source_file_id, original_name, relative_path, mime_type, size_bytes, proof_type, attach_policy, created_at
   FROM application_assets
   WHERE job_id = ?
   ORDER BY id ASC`
);
const listAllApplicationAssetsStmt = db.prepare<[], ApplicationAssetRow>(
  `SELECT id, job_id, source, source_file_id, original_name, relative_path, mime_type, size_bytes, proof_type, attach_policy, created_at
   FROM application_assets
   ORDER BY created_at DESC, id DESC`
);
const outcomeLearningRowsStmt = db.prepare<[], OutcomeLearningRow>(
  `SELECT a.status, s.source_query, s.budget, s.client_spend
   FROM applications a
   LEFT JOIN seen_jobs s ON s.id = a.job_id`
);
const slackPreviewJobStmt = db.prepare<[string], SlackPreviewJobRow>(
  `SELECT s.id, s.title, s.url, s.description, s.score, s.match_level, s.budget, s.client_country,
          s.client_rating, s.client_spend, s.client_hire_rate, s.skills, s.experience_level,
          s.connects_cost, s.proposal_count, s.competition_level, s.posted_at, a.status, a.fit_score, a.fit_reasons, a.red_flags,
          a.suggested_bid, a.suggested_connects, a.suggested_boost_connects, a.connects_warnings,
          a.selected_portfolio_items, a.proposal_text, a.structured_proposal, a.generated_at, a.job_intelligence, a.connects_strategy
   FROM seen_jobs s
   LEFT JOIN applications a ON a.job_id = s.id
   WHERE s.id = ?
   LIMIT 1`
);
const recordApplicationSubmissionStmt = db.prepare(
  `UPDATE applications
   SET status = 'applied',
       actual_required_connects = ?,
       actual_boost_connects = ?,
       actual_total_connects = ?,
       boost_rank = ?,
       actual_client_spend = ?,
       actual_rate = ?,
       profile_used = ?,
       attachments_used = ?,
       profile_highlights_used = ?,
       submitted_proposal_text = COALESCE(?, submitted_proposal_text),
       submitted_at = COALESCE(submitted_at, ?),
       updated_at = datetime('now')
   WHERE job_id = ?`
);

export function closeDb(): void {
  db.close();
}

export function isFirstRun(): boolean {
  return (countStmt.get()?.count ?? 0) === 0;
}

export function isJobSeen(id: string): boolean {
  return Boolean(isSeenStmt.get(id));
}

export function isJobFingerprintSeen(job: JobPosting): boolean {
  const fingerprint = buildJobFingerprint(job);
  if (seenFingerprintStmt.get(fingerprint)) {
    return true;
  }

  return recentSeenFingerprintsStmt.all().some((row) => {
    if (!row.fingerprint) return false;
    return areNearDuplicateJobs(rowToJobPosting(row), job);
  });
}

function rowToJobPosting(row: SeenFingerprintRow): JobPosting {
  let skills: string[] = [];
  if (row.skills) {
    try {
      const parsed = JSON.parse(row.skills);
      if (Array.isArray(parsed)) {
        skills = parsed.filter((skill): skill is string => typeof skill === "string");
      }
    } catch {
      skills = [];
    }
  }

  return {
    id: row.id,
    title: row.title,
    url: row.url,
    description: row.description ?? "",
    postedAt: row.posted_at ?? "",
    budget: row.budget ?? "",
    clientCountry: row.client_country ?? "",
    clientRating: row.client_rating ?? 0,
    clientSpend: row.client_spend ?? 0,
    clientHireRate: row.client_hire_rate ?? 0,
    clientTotalHires: 0,
    clientFeedbackCount: 0,
    category: "",
    experienceLevel: row.experience_level ?? "",
    connectsCost: row.connects_cost ?? 0,
    skills,
    sourceQuery: "seen_jobs",
    proposalCount: row.proposal_count ?? null,
    competitionLevel: row.competition_level === "low" || row.competition_level === "medium" || row.competition_level === "high"
      ? row.competition_level
      : "unknown",
  };
}

export function markJobSeen(job: ScoredJob, notified: boolean): void {
  upsertSeenStmt.run(
    job.id,
    job.title,
    job.url,
    job.description,
    job.score,
    job.matchLevel,
    job.budget,
    job.clientCountry,
    job.clientRating,
    job.clientSpend,
    job.clientHireRate,
    JSON.stringify(job.skills),
    job.experienceLevel,
    job.connectsCost,
    job.sourceQuery,
    job.proposalCount ?? null,
    job.competitionLevel ?? "unknown",
    job.postedAt,
    buildJobFingerprint(job),
    notified ? 1 : 0
  );
  if (job.applicationDraft) {
    saveApplicationDraft(job.applicationDraft);
  }
}

export function saveApplicationDraft(draft: ApplicationDraft): void {
  const previousStatus = getApplicationStatus(draft.jobId);
  upsertApplicationStmt.run(
    draft.jobId,
    draft.status,
    draft.fitScore,
    JSON.stringify(draft.fitReasons),
    JSON.stringify(draft.redFlags),
    draft.suggestedBid,
    draft.suggestedConnects,
    draft.suggestedBoostConnects,
    JSON.stringify(draft.connectsWarnings),
    JSON.stringify(draft.selectedPortfolioItems),
    draft.proposalText,
    draft.structuredProposal ? JSON.stringify(draft.structuredProposal) : null,
    draft.generatedAt,
    draft.jobIntelligence ? JSON.stringify(draft.jobIntelligence) : null,
    draft.connectsStrategy ? JSON.stringify(draft.connectsStrategy) : null
  );
  if (!previousStatus) {
    insertApplicationEventStmt.run(draft.jobId, "created", null, draft.status, "Application draft created.");
  }
  ensureInitialProposalVersion(draft);
}

function rowToApplicationDraft(row: ApplicationDraftRow): ApplicationDraft {
  const proposalText = row.proposal_text;
  return {
    jobId: row.job_id,
    status: row.status,
    fitScore: row.fit_score,
    fitReasons: parseJsonStringArray(row.fit_reasons),
    redFlags: parseJsonStringArray(row.red_flags),
    suggestedBid: row.suggested_bid ?? "Not specified",
    suggestedConnects: row.suggested_connects ?? 0,
    suggestedBoostConnects: row.suggested_boost_connects ?? 0,
    connectsWarnings: parseJsonStringArray(row.connects_warnings),
    selectedPortfolioItems: parseJsonArray<PortfolioItem>(row.selected_portfolio_items),
    proposalQuality: {
      score: 0,
      issues: [
        {
          category: "voice",
          severity: "info",
          message: "Proposal quality was not persisted with this stored draft.",
          suggestion: "Regenerate the draft before final approval if quality scoring is required.",
        },
      ],
      positiveSignals: [],
      wordCount: proposalText.trim().split(/\s+/).filter(Boolean).length,
    },
    proposalText,
    structuredProposal: parseJsonObject<StructuredProposalDraft>(row.structured_proposal),
    generatedAt: row.generated_at,
    jobIntelligence: parseJsonObject<JobIntelligence>(row.job_intelligence),
    proposalVersion: row.proposal_version ?? 1,
    revisionRequests: parseJsonStringArray(row.revision_requests),
    connectsStrategy: parseJsonObject<ConnectsStrategySnapshot>(row.connects_strategy),
  };
}

export function getApplicationDraft(jobId: string): ApplicationDraft | null {
  const row = getApplicationDraftStmt.get(jobId);
  return row ? rowToApplicationDraft(row) : null;
}

export function getApplicationProofPlanOverrides(jobId: string): ProofPlanOverrideState | null {
  const row = getApplicationProofPlanOverridesStmt.get(jobId);
  if (!row) return null;
  return parseJsonObject<ProofPlanOverrideState>(row.proof_plan_overrides) ?? {
    includeAssetIds: [],
    excludeAssetIds: [],
    includeProofIds: [],
    excludeProofIds: [],
    includePortfolioItemIds: [],
    excludePortfolioItemIds: [],
    portfolioOnly: false,
    noFiles: false,
    noScreenshots: false,
    attachAllRelevantScreenshots: false,
    instructionHistory: [],
  };
}

export function updateApplicationProofPlanOverrides(jobId: string, overrides: ProofPlanOverrideState, note?: string): boolean {
  const currentStatus = getApplicationStatus(jobId);
  if (!currentStatus) return false;
  const result = updateApplicationProofPlanOverridesStmt.run(JSON.stringify(overrides), jobId);
  if (result.changes > 0) {
    insertApplicationEventStmt.run(jobId, "proof_plan_revised", currentStatus, currentStatus, note ?? "Proof plan revised from Slack.");
  }
  return result.changes > 0;
}

function rowToApplicationAsset(row: ApplicationAssetRow): ApplicationAsset {
  return {
    id: row.id,
    jobId: row.job_id,
    source: row.source,
    sourceFileId: row.source_file_id,
    originalName: row.original_name,
    relativePath: row.relative_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    proofType: row.proof_type,
    attachPolicy: row.attach_policy,
    createdAt: row.created_at,
  };
}

export function registerApplicationAsset(input: RegisterApplicationAssetInput): ApplicationAsset {
  const sourceFileId = input.sourceFileId ?? null;
  upsertApplicationAssetStmt.run(
    input.jobId,
    input.source,
    sourceFileId,
    input.originalName,
    input.relativePath ?? null,
    input.mimeType ?? null,
    input.sizeBytes ?? null,
    input.proofType,
    input.attachPolicy,
  );
  const row = getApplicationAssetByUniqueStmt.get(input.jobId, input.source, sourceFileId, input.originalName);
  if (!row) {
    throw new Error(`Failed to register application asset for job_id=${input.jobId}`);
  }
  insertApplicationEventStmt.run(
    input.jobId,
    "asset_registered",
    null,
    null,
    `${input.source}: ${input.originalName}`,
  );
  return rowToApplicationAsset(row);
}

export function listApplicationAssets(jobId: string): ApplicationAsset[] {
  return listApplicationAssetsStmt.all(jobId).map(rowToApplicationAsset);
}

export function listAllApplicationAssets(): ApplicationAsset[] {
  return listAllApplicationAssetsStmt.all().map(rowToApplicationAsset);
}

export function getApplicationStatus(jobId: string): ApplicationStatus | null {
  return getApplicationStatusStmt.get(jobId)?.status ?? null;
}

export function getApplicationJobLink(jobId: string): ApplicationJobLink | null {
  return getApplicationJobLinkStmt.get(jobId) ?? null;
}

export function recordApplicationRevisionRequest(jobId: string, instruction: string): ApplicationRevisionResult | null {
  const row = getApplicationDraftStmt.get(jobId);
  if (!row) return null;

  const existingRequests = parseJsonStringArray(row.revision_requests);
  const currentVersion = row.proposal_version ?? 1;
  const nextRequests = [...existingRequests, `${new Date().toISOString()} pending v${currentVersion}: ${instruction}`];
  const result = updateApplicationRevisionStmt.run(JSON.stringify(nextRequests), jobId);
  if (result.changes === 0) return null;

  insertApplicationEventStmt.run(
    jobId,
    "revision_requested",
    row.status,
    "draft",
    `pending v${currentVersion}: ${instruction}`
  );

  return {
    jobId,
    proposalVersion: currentVersion,
    proposalText: row.proposal_text,
    revisionRequests: nextRequests,
    applied: false,
  };
}

export function applyApplicationRevision(
  jobId: string,
  instruction: string,
  revisedProposalText: string
): ApplicationRevisionResult | null {
  const row = getApplicationDraftStmt.get(jobId);
  if (!row) return null;

  const latestAuditVersion = getLatestProposalVersionNumberStmt.get(jobId)?.version_number ?? 0;
  const nextVersion = Math.max(row.proposal_version ?? 1, latestAuditVersion) + 1;
  const generatedAt = new Date().toISOString();
  const existingRequests = parseJsonStringArray(row.revision_requests);
  const revisionEntry = `${generatedAt} applied v${nextVersion}: ${instruction}`;
  const nextRequests = [...existingRequests, revisionEntry];
  const result = applyApplicationRevisionStmt.run(
    revisedProposalText,
    JSON.stringify(nextRequests),
    generatedAt,
    nextVersion,
    jobId
  );
  if (result.changes === 0) return null;

  recordProposalVersion({
    jobId,
    source: "slack_revision",
    proposalText: revisedProposalText,
    screeningAnswers: parseJsonObject<StructuredProposalDraft>(row.structured_proposal)?.clientRequestAnswers ?? [],
    label: `slack_revision_v${nextVersion}`,
    versionNumber: nextVersion,
    note: instruction,
  });

  insertApplicationEventStmt.run(
    jobId,
    "revision_applied",
    row.status,
    "draft",
    `v${nextVersion}: ${instruction}`
  );

  return {
    jobId,
    proposalVersion: nextVersion,
    proposalText: revisedProposalText,
    revisionRequests: nextRequests,
    applied: true,
  };
}

export function updateApplicationStatus(
  jobId: string,
  status: ApplicationStatus,
  note?: string
): boolean {
  const previousStatus = getApplicationStatus(jobId);
  if (!previousStatus) {
    return false;
  }
  const now = new Date().toISOString();
  const reviewedAt = ["approved", "rejected", "lost"].includes(status) ? now : null;
  const submittedAt = ["applied", "submitted"].includes(status) ? now : null;
  const result = updateApplicationStatusStmt.run(status, reviewedAt, submittedAt, jobId);
  insertApplicationEventStmt.run(jobId, "status_changed", previousStatus, status, note ?? null);
  return result.changes > 0;
}

export function addApplicationNote(jobId: string, note: string): boolean {
  const currentStatus = getApplicationStatus(jobId);
  if (!currentStatus) {
    return false;
  }
  insertApplicationEventStmt.run(jobId, "note", currentStatus, currentStatus, note);
  return true;
}

export function getApplicationSummary(): ApplicationSummaryRow[] {
  return applicationSummaryStmt.all();
}

export function listRecentApplications(limit = 20): ApplicationListRow[] {
  return applicationListStmt.all(limit);
}

export function getApplicationNotes(jobId: string): ApplicationNoteRow[] {
  return applicationNotesStmt.all(jobId);
}

function proposalVersionLabel(source: ProposalVersionSource, versionNumber: number): string {
  switch (source) {
    case "draft_generated":
      return versionNumber === 1 ? "draft_v1" : `draft_v${versionNumber}`;
    case "slack_preview":
      return `slack_preview_v${versionNumber}`;
    case "slack_revision":
      return `slack_revision_v${versionNumber}`;
    case "upwork_inserted":
      return `upwork_inserted_v${versionNumber}`;
    case "remote_chrome_qa":
      return `remote_chrome_qa_v${versionNumber}`;
    case "human_edit_reread":
      return `human_edit_reread_v${versionNumber}`;
    case "final_submitted":
      return `final_submitted_v${versionNumber}`;
  }
}

function rowToProposalVersion(row: ApplicationProposalVersionRow): ProposalVersionSnapshot {
  return {
    id: row.id,
    jobId: row.job_id,
    versionNumber: row.version_number,
    source: row.source,
    label: row.label,
    proposalText: row.proposal_text,
    screeningAnswers: parseJsonStringArray(row.screening_answers),
    note: row.note,
    createdAt: row.created_at,
  };
}

export function recordProposalVersion(input: RecordProposalVersionInput): ProposalVersionSnapshot {
  const proposalText = input.proposalText;
  const versionNumber = input.versionNumber ?? ((getLatestProposalVersionNumberStmt.get(input.jobId)?.version_number ?? 0) + 1);
  const label = input.label ?? proposalVersionLabel(input.source, versionNumber);
  insertProposalVersionStmt.run(
    input.jobId,
    versionNumber,
    input.source,
    label,
    proposalText,
    JSON.stringify(input.screeningAnswers ?? []),
    input.note ?? null
  );
  const row = latestProposalVersionStmt.get(input.jobId);
  if (!row) {
    throw new Error(`Failed to record proposal version for job_id=${input.jobId}`);
  }
  insertApplicationEventStmt.run(input.jobId, "proposal_version_recorded", null, null, `${label}: ${input.source}`);
  return rowToProposalVersion(row);
}

export function ensureInitialProposalVersion(draft: ApplicationDraft): ProposalVersionSnapshot | null {
  if (!draft.proposalText.trim()) return null;
  if (getLatestProposalVersionNumberStmt.get(draft.jobId)) return null;
  return recordProposalVersion({
    jobId: draft.jobId,
    source: "draft_generated",
    proposalText: draft.proposalText,
    screeningAnswers: draft.structuredProposal?.clientRequestAnswers ?? [],
    label: "draft_v1",
    versionNumber: 1,
    note: "Initial generated application draft.",
  });
}

export function listProposalVersions(jobId: string): ProposalVersionSnapshot[] {
  return listProposalVersionsStmt.all(jobId).map(rowToProposalVersion);
}

export function getLatestProposalVersion(jobId: string, source?: ProposalVersionSource): ProposalVersionSnapshot | null {
  const row = source ? latestProposalVersionBySourceStmt.get(jobId, source) : latestProposalVersionStmt.get(jobId);
  return row ? rowToProposalVersion(row) : null;
}

function rowToScreeningCoverage(row: ApplicationScreeningCoverageRow): ScreeningCoverageItem {
  return {
    jobId: row.job_id,
    questionIndex: row.question_index,
    questionText: row.question_text,
    plannedAnswer: row.planned_answer,
    filledAnswer: row.filled_answer,
    verifiedAnswer: row.verified_answer,
    humanEditedAnswer: row.human_edited_answer,
    finalAnswer: row.final_answer,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export function upsertScreeningCoverageItem(item: Omit<ScreeningCoverageItem, "updatedAt">): ScreeningCoverageItem {
  upsertScreeningCoverageStmt.run(
    item.jobId,
    item.questionIndex,
    item.questionText ?? null,
    item.plannedAnswer ?? null,
    item.filledAnswer ?? null,
    item.verifiedAnswer ?? null,
    item.humanEditedAnswer ?? null,
    item.finalAnswer ?? null,
    item.status
  );
  const row = listScreeningCoverageStmt.all(item.jobId).find((candidate) => candidate.question_index === item.questionIndex);
  if (!row) {
    throw new Error(`Failed to upsert screening coverage for job_id=${item.jobId} index=${item.questionIndex}`);
  }
  return rowToScreeningCoverage(row);
}

export function recordPlannedScreeningCoverage(jobId: string, questions: string[], answers: string[]): ScreeningCoverageItem[] {
  const count = Math.max(questions.length, answers.length);
  const rows: ScreeningCoverageItem[] = [];
  for (let index = 0; index < count; index += 1) {
    rows.push(upsertScreeningCoverageItem({
      jobId,
      questionIndex: index + 1,
      questionText: questions[index] ?? null,
      plannedAnswer: answers[index] ?? null,
      filledAnswer: null,
      verifiedAnswer: null,
      humanEditedAnswer: null,
      finalAnswer: null,
      status: answers[index] ? "planned" : "unknown",
    }));
  }
  return rows;
}

export function listScreeningCoverage(jobId: string): ScreeningCoverageItem[] {
  return listScreeningCoverageStmt.all(jobId).map(rowToScreeningCoverage);
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}

export function getScoredJobForSlackPreview(jobId: string): ScoredJob | null {
  const row = slackPreviewJobStmt.get(jobId);
  if (!row) {
    return null;
  }

  const fitReasons = parseJsonStringArray(row.fit_reasons);
  const redFlags = parseJsonStringArray(row.red_flags);
  const connectsWarnings = parseJsonStringArray(row.connects_warnings);
  const applicationDraft: ApplicationDraft | undefined = row.proposal_text
    ? {
        jobId: row.id,
        status: row.status ?? "draft",
        fitScore: row.fit_score ?? row.score ?? 0,
        fitReasons,
        redFlags,
        suggestedBid: row.suggested_bid ?? "Not specified",
        suggestedConnects: row.suggested_connects ?? row.connects_cost ?? 0,
        suggestedBoostConnects: row.suggested_boost_connects ?? 0,
        connectsWarnings,
        selectedPortfolioItems: parseJsonArray<PortfolioItem>(row.selected_portfolio_items),
        proposalQuality: {
          score: 0,
          issues: [
            {
              category: "voice",
              severity: "info",
              message: "Proposal quality was not persisted with this stored draft.",
              suggestion: "Regenerate the draft before final approval if quality scoring is required.",
            },
          ],
          positiveSignals: [],
          wordCount: row.proposal_text.trim().split(/\s+/).filter(Boolean).length,
        },
        proposalText: row.proposal_text,
        structuredProposal: parseJsonObject<StructuredProposalDraft>(row.structured_proposal),
        generatedAt: row.generated_at ?? new Date().toISOString(),
        jobIntelligence: parseJsonObject<JobIntelligence>(row.job_intelligence),
        connectsStrategy: parseJsonObject<ConnectsStrategySnapshot>(row.connects_strategy),
      }
    : undefined;

  return {
    id: row.id,
    title: row.title,
    url: row.url,
    description: row.description ?? "",
    postedAt: row.posted_at ?? new Date().toISOString(),
    budget: row.budget ?? "",
    clientCountry: row.client_country ?? "",
    clientRating: row.client_rating ?? 0,
    clientSpend: row.client_spend ?? 0,
    clientHireRate: row.client_hire_rate ?? 0,
    clientTotalHires: 0,
    clientFeedbackCount: 0,
    category: "stored",
    experienceLevel: row.experience_level ?? "",
    connectsCost: row.connects_cost ?? 0,
    skills: parseJsonStringArray(row.skills),
    sourceQuery: "stored-preview",
    proposalCount: row.proposal_count ?? null,
    competitionLevel: row.competition_level === "low" || row.competition_level === "medium" || row.competition_level === "high"
      ? row.competition_level
      : "unknown",
    score: row.score ?? row.fit_score ?? 0,
    matchLevel: row.match_level ?? "medium",
    matchedKeywords: [],
    negativeKeywords: [],
    scoreBreakdown: {
      fitScore: { score: row.fit_score ?? row.score ?? 0, reasons: fitReasons, risks: redFlags },
      clientQualityScore: { score: 0, reasons: [], risks: [] },
      opportunityScore: { score: 0, reasons: [], risks: [] },
      redFlagScore: { score: redFlags.length ? 50 : 100, reasons: [], risks: redFlags },
      connectsRiskScore: { score: 0, reasons: [], risks: connectsWarnings },
      finalScore: row.score ?? row.fit_score ?? 0,
      reasons: fitReasons,
      risks: redFlags,
    },
    applicationDraft,
  };
}

function topCounts(values: string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function budgetBand(value: string | null): string {
  const max = Math.max(0, ...(value?.match(/\d+(?:,\d{3})*/g)?.map((item) => Number(item.replace(/,/g, ""))) ?? []));
  if (max >= 3000) return "budget >= $3k";
  if (max >= 1000) return "budget $1k-$3k";
  if (max >= 300) return "budget $300-$999";
  if (max > 0) return "budget < $300";
  return "budget unknown";
}

function clientSpendBand(value: number | null): string {
  const spend = value ?? 0;
  if (spend >= 100000) return "client spend >= $100k";
  if (spend >= 10000) return "client spend $10k-$100k";
  if (spend >= 1000) return "client spend $1k-$10k";
  if (spend > 0) return "client spend <$1k";
  return "client spend unknown";
}

function buildOutcomeSegments(rows: OutcomeLearningRow[], keyForRow: (row: OutcomeLearningRow) => string): OutcomeLearningSegment[] {
  const grouped = new Map<string, OutcomeLearningRow[]>();
  for (const row of rows) {
    const key = keyForRow(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const repliedStatuses: ApplicationStatus[] = ["replied", "interview", "hired"];
  return [...grouped.entries()]
    .map(([name, segmentRows]) => {
      const submitted = segmentRows.filter((row) => ["applied", "submitted", "replied", "interview", "hired", "lost"].includes(row.status)).length;
      const replied = segmentRows.filter((row) => repliedStatuses.includes(row.status)).length;
      const interviews = segmentRows.filter((row) => ["interview", "hired"].includes(row.status)).length;
      const hired = segmentRows.filter((row) => row.status === "hired").length;
      const lost = segmentRows.filter((row) => row.status === "lost").length;
      return {
        name,
        total: segmentRows.length,
        submitted,
        replied,
        interviews,
        hired,
        lost,
        replyRate: submitted ? replied / submitted : 0,
        hireRate: submitted ? hired / submitted : 0,
      };
    })
    .sort((a, b) => b.replyRate - a.replyRate || b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, 10);
}

export function getOutcomeLearningSummary(now = new Date()): OutcomeLearningSummary {
  const rows = outcomeLearningRowsStmt.all();
  return {
    generatedAt: now.toISOString(),
    totalTracked: rows.length,
    bySourceQuery: buildOutcomeSegments(rows, (row) => row.source_query?.trim() || "unknown source"),
    byBudgetBand: buildOutcomeSegments(rows, (row) => budgetBand(row.budget)),
    byClientSpendBand: buildOutcomeSegments(rows, (row) => clientSpendBand(row.client_spend)),
  };
}

export function getApplicationAnalytics(): ApplicationAnalytics {
  const rows = db
    .prepare<[], ApplicationListRow>(
      `SELECT a.job_id, a.status, a.fit_score, s.title, s.url, a.suggested_bid, a.suggested_connects,
              a.actual_total_connects, a.actual_boost_connects, a.boost_rank, a.actual_client_spend,
              a.attachments_used, a.profile_highlights_used, a.updated_at
       FROM applications a
       LEFT JOIN seen_jobs s ON s.id = a.job_id`
    )
    .all();
  const total = rows.length;
  const appliedStatuses: ApplicationStatus[] = ["applied", "submitted", "replied", "interview", "hired", "lost"];
  const appliedRows = rows.filter((row) => appliedStatuses.includes(row.status));
  const repliedRows = rows.filter((row) => ["replied", "interview", "hired"].includes(row.status));
  const interviewRows = rows.filter((row) => ["interview", "hired"].includes(row.status));
  const hiredRows = rows.filter((row) => row.status === "hired");
  const lostRows = rows.filter((row) => row.status === "lost");
  const totalConnectsSpent = appliedRows.reduce((sum, row) => sum + (row.actual_total_connects ?? 0), 0);
  const attachments = appliedRows.flatMap((row) => parseJsonStringArray(row.attachments_used));
  const highlights = appliedRows.flatMap((row) => parseJsonStringArray(row.profile_highlights_used));

  return {
    total,
    applied: appliedRows.length,
    replied: repliedRows.length,
    interviews: interviewRows.length,
    hired: hiredRows.length,
    lost: lostRows.length,
    totalConnectsSpent,
    averageConnectsPerApplied: appliedRows.length ? totalConnectsSpent / appliedRows.length : 0,
    connectsPerReply: repliedRows.length ? totalConnectsSpent / repliedRows.length : null,
    replyRate: appliedRows.length ? repliedRows.length / appliedRows.length : 0,
    interviewRate: appliedRows.length ? interviewRows.length / appliedRows.length : 0,
    hireRate: appliedRows.length ? hiredRows.length / appliedRows.length : 0,
    topAttachments: topCounts(attachments),
    topHighlights: topCounts(highlights),
  };
}

export function recordApplicationSubmission(input: ApplicationSubmissionInput): boolean {
  const previousStatus = getApplicationStatus(input.jobId);
  if (!previousStatus) {
    return false;
  }
  const totalConnects = input.requiredConnects + input.boostConnects;
  const submittedAt = new Date().toISOString();
  const result = recordApplicationSubmissionStmt.run(
    input.requiredConnects,
    input.boostConnects,
    totalConnects,
    input.boostRank,
    input.clientSpend,
    input.rate,
    input.profileUsed,
    JSON.stringify(input.attachmentsUsed),
    JSON.stringify(input.profileHighlightsUsed),
    input.submittedProposalText ?? null,
    submittedAt,
    input.jobId
  );
  insertApplicationEventStmt.run(
    input.jobId,
    "submission_recorded",
    previousStatus,
    "applied",
    input.note ??
      `Applied: required=${input.requiredConnects}, boost=${input.boostConnects}, total=${totalConnects}, rank=${input.boostRank ?? "n/a"}`
  );
  if (input.submittedProposalText?.trim()) {
    recordProposalVersion({
      jobId: input.jobId,
      source: "final_submitted",
      proposalText: input.submittedProposalText,
      note: input.note ?? "Submitted proposal text recorded from application submission.",
    });
  }
  return result.changes > 0;
}

function parseBrowserActionPayload(value: string): BrowserActionPayload {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as BrowserActionPayload)
      : {};
  } catch {
    return {};
  }
}

function rowToBrowserAction(row: BrowserActionRow): BrowserAction {
  return {
    id: row.id,
    jobId: row.job_id,
    actionType: row.action_type,
    status: row.status,
    payload: parseBrowserActionPayload(row.payload),
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function enqueueBrowserAction(input: BrowserActionInput): number {
  const result = insertBrowserActionStmt.run(
    input.jobId,
    input.actionType,
    JSON.stringify(input.payload ?? {})
  );
  return Number(result.lastInsertRowid);
}

export function enqueueBrowserActionDeduped(input: BrowserActionInput): BrowserActionEnqueueResult {
  if (input.actionType === "prepare_application_review" || input.actionType === "capture_job_from_url") {
    const duplicate = activeDuplicateBrowserActionStmt.get(input.jobId, input.actionType);
    if (duplicate) {
      return { id: duplicate.id, duplicate: true, duplicateOf: duplicate.id };
    }
  }

  return { id: enqueueBrowserAction(input), duplicate: false };
}

export function listBrowserActions(status: BrowserActionStatus | null = null, limit = 25): BrowserAction[] {
  return listBrowserActionsStmt.all(status, status, limit).map(rowToBrowserAction);
}

export function getBrowserActionById(id: number): BrowserAction | null {
  const row = getBrowserActionByIdStmt.get(id);
  return row ? rowToBrowserAction(row) : null;
}

export function updateBrowserActionStatus(id: number, status: BrowserActionStatus, lastError?: string): boolean {
  const result = updateBrowserActionStatusStmt.run(status, lastError ?? null, id);
  return result.changes > 0;
}

export function mergeBrowserActionPayload(id: number, patch: BrowserActionPayload): BrowserAction | null {
  const existing = getBrowserActionById(id);
  if (!existing) return null;
  updateBrowserActionPayloadStmt.run(JSON.stringify({ ...existing.payload, ...patch }), id);
  return getBrowserActionById(id);
}

export function incrementBrowserActionAttempts(id: number, lastError?: string): boolean {
  const result = incrementBrowserActionAttemptStmt.run(lastError ?? null, id);
  return result.changes > 0;
}

export function upsertSlackThreadState(input: {
  channelId: string;
  messageTs: string;
  threadTs: string;
  upworkUrl: string;
  jobId?: string | null;
  status: SlackThreadStatus;
}): SlackThreadState {
  insertSlackThreadStateStmt.run(
    input.channelId,
    input.messageTs,
    input.threadTs,
    input.upworkUrl,
    input.jobId ?? null,
    input.status
  );

  const row = getSlackThreadStateByChannelMessageStmt.get(input.channelId, input.messageTs);
  if (!row) {
    throw new Error(`Failed to persist slack thread mapping for ${input.channelId}/${input.messageTs}`);
  }
  return rowToSlackThreadState(row);
}

export function getSlackThreadStateByThreadTs(channelId: string, threadTs: string): SlackThreadState | null {
  const row = getSlackThreadStateByChannelThreadStmt.get(channelId, threadTs);
  return row ? rowToSlackThreadState(row) : null;
}

export function getSlackThreadStateByJobId(jobId: string): SlackThreadState | null {
  const row = getSlackThreadStateByJobIdStmt.get(jobId);
  return row ? rowToSlackThreadState(row) : null;
}

export function updateSlackThreadStateStatus(
  channelId: string,
  threadTs: string,
  status: string,
  options?: { jobId?: string | null; upworkUrl?: string }
): SlackThreadState | null {
  updateSlackThreadStateStatusStmt.run(
    status,
    options?.jobId ?? null,
    options?.upworkUrl ?? null,
    channelId,
    threadTs
  );
  const row = getSlackThreadStateByChannelThreadStmt.get(channelId, threadTs);
  return row ? rowToSlackThreadState(row) : null;
}

export function listSlackThreadStates(channelId: string, limit = 100): SlackThreadState[] {
  return listSlackThreadStatesStmt.all(channelId, limit).map(rowToSlackThreadState);
}

export function upsertSlackBehaviorMemory(input: UpsertSlackBehaviorMemoryInput): SlackBehaviorMemory {
  const rule = input.rule.replace(/\s+/g, " ").trim();
  if (!rule) {
    throw new Error("Slack behavior memory rule cannot be empty.");
  }
  const scope = input.scope?.trim() || "global";
  const confidence = input.confidence ?? "medium";
  upsertSlackBehaviorMemoryStmt.run(
    input.type,
    rule,
    scope,
    input.source?.trim() || "slack_correction",
    input.threadChannelId ?? null,
    input.threadTs ?? null,
    input.jobId ?? null,
    confidence,
    JSON.stringify(input.metadata ?? {})
  );
  const row = getSlackBehaviorMemoryByKeyStmt.get(input.type, rule, scope);
  if (!row) {
    throw new Error(`Failed to persist Slack behavior memory: ${input.type}/${scope}`);
  }
  return rowToSlackBehaviorMemory(row);
}

export function listActiveSlackBehaviorMemories(limit = 25): SlackBehaviorMemory[] {
  return listActiveSlackBehaviorMemoriesStmt.all(Math.max(1, limit)).map(rowToSlackBehaviorMemory);
}

export function recordSlackFailureReflection(input: RecordSlackFailureReflectionInput): SlackFailureReflection {
  const userMessage = input.userMessage.replace(/\s+/g, " ").trim();
  const whatHappened = input.whatHappened.replace(/\s+/g, " ").trim();
  const whyItFailed = input.whyItFailed.replace(/\s+/g, " ").trim();
  const nextBehavior = input.nextBehavior.replace(/\s+/g, " ").trim();
  if (!userMessage || !whatHappened || !whyItFailed || !nextBehavior) {
    throw new Error("Slack failure reflection requires message, happened, why, and next behavior.");
  }
  insertSlackFailureReflectionStmt.run(
    input.channelId ?? null,
    input.threadTs ?? null,
    input.jobId ?? null,
    userMessage,
    whatHappened,
    whyItFailed,
    nextBehavior,
    input.fixType,
    input.proposedTask?.trim() || null
  );
  const row = listRecentSlackFailureReflectionsStmt.get(1);
  if (!row) {
    throw new Error("Failed to persist Slack failure reflection.");
  }
  return rowToSlackFailureReflection(row);
}

export function listRecentSlackFailureReflections(limit = 25): SlackFailureReflection[] {
  return listRecentSlackFailureReflectionsStmt.all(Math.max(1, limit)).map(rowToSlackFailureReflection);
}

function clampMemoryImportance(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 3;
  return Math.max(1, Math.min(10, Math.round(value ?? 3)));
}

function cleanAgentMemoryText(value: string, field: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new Error(`Agent memory ${field} cannot be empty.`);
  return cleaned;
}

function normalizeAgentKeywords(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? [])
    .map((value) => value.toLowerCase().replace(/\s+/g, " ").trim())
    .filter(Boolean)))
    .slice(0, 40);
}

export function recordAgentEvent(input: RecordAgentEventInput): AgentEvent {
  const summary = cleanAgentMemoryText(input.summary, "summary");
  const result = insertAgentEventStmt.run(
    input.eventType,
    input.sourceType?.trim() || "system",
    input.sourceId ?? null,
    input.jobId ?? null,
    input.applicationId ?? input.jobId ?? null,
    input.threadTs ?? null,
    input.actor?.trim() || "agent",
    summary,
    JSON.stringify(input.payload ?? {}),
    clampMemoryImportance(input.importance),
    input.privacyLevel ?? "normal",
    input.embeddingId ?? null
  );
  const row = getAgentEventByIdStmt.get(Number(result.lastInsertRowid));
  if (!row) throw new Error("Failed to persist agent event.");
  return rowToAgentEvent(row);
}

export function listRecentAgentEvents(limit = 25): AgentEvent[] {
  return listRecentAgentEventsStmt.all(Math.max(1, limit)).map(rowToAgentEvent);
}

export function upsertAgentMemory(input: UpsertAgentMemoryInput): AgentMemory {
  const scope = input.scope?.replace(/\s+/g, " ").trim() || "global";
  const title = cleanAgentMemoryText(input.title, "title");
  const summary = cleanAgentMemoryText(input.summary, "summary");
  const confidence = input.confidence ?? "low";
  const evidenceCount = normalizeEvidenceCount(input.evidenceCount);
  const status = input.status ?? (evidenceCount > 1 ? "active" : "tentative");
  const version = Math.max(1, Math.floor(input.version ?? 1));
  const keywords = normalizeAgentKeywords(input.keywords);
  const sourceEventIds = Array.from(new Set((input.sourceEventIds ?? []).filter((id) => Number.isFinite(id)))).slice(0, 50);
  upsertAgentMemoryStmt.run(
    input.memoryType,
    scope,
    title,
    summary,
    input.ruleText?.trim() || null,
    input.hypothesisText?.trim() || null,
    confidence,
    clampMemoryImportance(input.importance),
    evidenceCount,
    status,
    version,
    input.supersedesMemoryId ?? null,
    input.contradictedByMemoryId ?? null,
    JSON.stringify(sourceEventIds),
    JSON.stringify(keywords),
    input.embeddingId ?? null
  );
  const row = getAgentMemoryByKeyStmt.get(input.memoryType, scope, title, summary);
  if (!row) throw new Error(`Failed to persist agent memory: ${input.memoryType}/${scope}/${title}`);
  return rowToAgentMemory(row);
}

export function listAgentMemories(limit = 50): AgentMemory[] {
  return listAgentMemoriesStmt.all(Math.max(1, limit)).map(rowToAgentMemory);
}

export function listAgentMemoriesByType(memoryType: string, limit = 50): AgentMemory[] {
  return listAgentMemoriesByTypeStmt.all(memoryType, Math.max(1, limit)).map(rowToAgentMemory);
}

export function getAgentMemory(id: number): AgentMemory | null {
  const row = getAgentMemoryByIdStmt.get(id);
  return row ? rowToAgentMemory(row) : null;
}

export function touchAgentMemory(id: number): boolean {
  return touchAgentMemoryStmt.run(id).changes > 0;
}

export function updateAgentMemoryState(input: {
  id: number;
  status?: AgentMemoryStatus;
  importance?: number;
  decayScore?: number;
  supersedesMemoryId?: number | null;
  contradictedByMemoryId?: number | null;
}): AgentMemory | null {
  updateAgentMemoryStateStmt.run(
    input.status ?? null,
    input.importance === undefined ? null : clampMemoryImportance(input.importance),
    input.decayScore === undefined ? null : Math.max(0, input.decayScore),
    input.supersedesMemoryId ?? null,
    input.contradictedByMemoryId ?? null,
    input.id
  );
  return getAgentMemory(input.id);
}

export function updateAgentMemoryContent(input: {
  id: number;
  title?: string;
  summary?: string;
  ruleText?: string | null;
  hypothesisText?: string | null;
  confidence?: AgentMemoryConfidence;
  importance?: number;
  evidenceCountIncrement?: number;
  status?: AgentMemoryStatus;
  versionIncrement?: number;
  sourceEventIds?: number[];
  keywords?: string[];
}): AgentMemory | null {
  updateAgentMemoryContentStmt.run(
    input.title === undefined ? null : cleanAgentMemoryText(input.title, "title"),
    input.summary === undefined ? null : cleanAgentMemoryText(input.summary, "summary"),
    input.ruleText === undefined ? null : input.ruleText?.trim() || null,
    input.hypothesisText === undefined ? null : input.hypothesisText?.trim() || null,
    input.confidence ?? null,
    input.confidence ?? null,
    input.confidence ?? null,
    input.importance === undefined ? null : clampMemoryImportance(input.importance),
    input.evidenceCountIncrement === undefined ? null : normalizeEvidenceCount(input.evidenceCountIncrement),
    input.status ?? null,
    input.status ?? null,
    input.status ?? null,
    input.versionIncrement === undefined ? null : Math.max(1, Math.floor(input.versionIncrement)),
    input.sourceEventIds === undefined ? null : JSON.stringify(Array.from(new Set(input.sourceEventIds.filter((id) => Number.isFinite(id)))).slice(0, 50)),
    input.keywords === undefined ? null : JSON.stringify(normalizeAgentKeywords(input.keywords)),
    input.id
  );
  return getAgentMemory(input.id);
}

export function forgetAgentMemory(input: { id?: number; query?: string; memoryType?: string }): number {
  if (typeof input.id === "number") {
    return forgetAgentMemoryByIdStmt.run(input.id).changes;
  }
  const query = input.query?.replace(/\s+/g, " ").trim();
  if (!query) return 0;
  const pattern = `%${query}%`;
  return forgetAgentMemoriesMatchingStmt.run(input.memoryType ?? "", input.memoryType ?? "", pattern, pattern, pattern).changes;
}

export function recordMemoryEmbedding(input: {
  ownerType: string;
  ownerId: number;
  provider: string;
  model: string;
  vectorJsonOrBlob: string;
}): MemoryEmbedding {
  const result = insertMemoryEmbeddingStmt.run(input.ownerType, input.ownerId, input.provider, input.model, input.vectorJsonOrBlob);
  return rowToMemoryEmbedding({
    id: Number(result.lastInsertRowid),
    owner_type: input.ownerType,
    owner_id: input.ownerId,
    provider: input.provider,
    model: input.model,
    vector_json_or_blob: input.vectorJsonOrBlob,
    created_at: new Date().toISOString(),
  });
}

export function getMemoryEmbedding(id: number): MemoryEmbedding | null {
  const row = getMemoryEmbeddingByIdStmt.get(id);
  return row ? rowToMemoryEmbedding(row) : null;
}

export function listMemoryEmbeddingsByOwner(ownerType: string, ownerId: number): MemoryEmbedding[] {
  return listMemoryEmbeddingsByOwnerStmt.all(ownerType, ownerId).map(rowToMemoryEmbedding);
}

export function setAgentMemoryEmbedding(input: { memoryId: number; embeddingId: number }): AgentMemory | null {
  updateAgentMemoryEmbeddingIdStmt.run(input.embeddingId, input.memoryId);
  return getAgentMemory(input.memoryId);
}

export function recordMemoryConsolidation(input: {
  periodStart: string;
  periodEnd: string;
  summaryType: string;
  summary: string;
  sourceMemoryIds?: number[];
  sourceEventIds?: number[];
  confidence?: AgentMemoryConfidence;
  status?: AgentMemoryStatus;
}): MemoryConsolidation {
  const result = insertMemoryConsolidationStmt.run(
    input.periodStart,
    input.periodEnd,
    input.summaryType,
    input.summary,
    JSON.stringify(input.sourceMemoryIds ?? []),
    JSON.stringify(input.sourceEventIds ?? []),
    input.confidence ?? "low",
    input.status ?? "tentative"
  );
  return rowToMemoryConsolidation({
    id: Number(result.lastInsertRowid),
    created_at: new Date().toISOString(),
    period_start: input.periodStart,
    period_end: input.periodEnd,
    summary_type: input.summaryType,
    summary: input.summary,
    source_memory_ids: JSON.stringify(input.sourceMemoryIds ?? []),
    source_event_ids: JSON.stringify(input.sourceEventIds ?? []),
    confidence: input.confidence ?? "low",
    status: input.status ?? "tentative",
  });
}

function clampLinkStrength(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value ?? 0.5));
}

function cleanRelationText(value: string, fallback: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, 160);
}

export function upsertMemoryLink(input: UpsertMemoryLinkInput): MemoryLink {
  const relationshipType = cleanRelationText(input.relationshipType, "related_to").replace(/\s+/g, "_").toLowerCase();
  const reason = cleanAgentMemoryText(input.reason ?? "Related memory evidence.", "reason");
  upsertMemoryLinkStmt.run(
    input.sourceMemoryId,
    input.targetMemoryId,
    relationshipType,
    clampLinkStrength(input.strength),
    reason
  );
  const row = getMemoryLinkStmt.get(input.sourceMemoryId, input.targetMemoryId, relationshipType);
  if (!row) throw new Error(`Failed to persist memory link: ${input.sourceMemoryId}/${input.targetMemoryId}`);
  return rowToMemoryLink(row);
}

export function listMemoryLinksForMemory(memoryId: number, limit = 25): MemoryLink[] {
  return listMemoryLinksForMemoryStmt.all(memoryId, memoryId, Math.max(1, limit)).map(rowToMemoryLink);
}

export function upsertMemoryRelation(input: UpsertMemoryRelationInput): MemoryRelation {
  const sourceEntity = cleanRelationText(input.sourceEntity, "unknown_source").toLowerCase();
  const relation = cleanRelationText(input.relation, "related_to").replace(/\s+/g, "_").toLowerCase();
  const targetEntity = cleanRelationText(input.targetEntity, "unknown_target").toLowerCase();
  const sourceMemoryIds = Array.from(new Set((input.sourceMemoryIds ?? []).filter((id) => Number.isFinite(id)))).slice(0, 50);
  const existing = getMemoryRelationStmt.get(sourceEntity, relation, targetEntity);
  const mergedSourceMemoryIds = existing
    ? Array.from(new Set([...parseJsonNumberArray(existing.source_memory_ids), ...sourceMemoryIds])).slice(0, 50)
    : sourceMemoryIds;
  upsertMemoryRelationStmt.run(
    sourceEntity,
    relation,
    targetEntity,
    input.confidence ?? "low",
    JSON.stringify(mergedSourceMemoryIds),
    normalizeEvidenceCount(input.evidenceCount),
    input.status ?? "tentative"
  );
  const row = getMemoryRelationStmt.get(sourceEntity, relation, targetEntity);
  if (!row) throw new Error(`Failed to persist memory relation: ${sourceEntity}/${relation}/${targetEntity}`);
  return rowToMemoryRelation(row);
}

export function listMemoryRelations(limit = 50): MemoryRelation[] {
  return listMemoryRelationsStmt.all(Math.max(1, limit)).map(rowToMemoryRelation);
}

export function upsertMemoryThreadSummary(input: UpsertMemoryThreadSummaryInput): MemoryThreadSummary {
  const ownerType = cleanRelationText(input.ownerType, "thread").replace(/\s+/g, "_").toLowerCase();
  const ownerId = cleanRelationText(input.ownerId, "unknown");
  const summary = cleanAgentMemoryText(input.summary, "summary");
  const recentMessages = (input.recentMessages ?? []).map((message) => cleanAgentMemoryText(message, "message")).filter(Boolean).slice(-30);
  const sourceEventIds = Array.from(new Set((input.sourceEventIds ?? []).filter((id) => Number.isFinite(id)))).slice(0, 50);
  const sourceMemoryIds = Array.from(new Set((input.sourceMemoryIds ?? []).filter((id) => Number.isFinite(id)))).slice(0, 50);
  upsertMemoryThreadSummaryStmt.run(
    ownerType,
    ownerId,
    input.channelId ?? null,
    input.threadTs ?? null,
    input.jobId ?? null,
    summary,
    JSON.stringify(recentMessages),
    JSON.stringify(sourceEventIds),
    JSON.stringify(sourceMemoryIds),
    input.status ?? "active"
  );
  const row = getMemoryThreadSummaryStmt.get(ownerType, ownerId);
  if (!row) throw new Error(`Failed to persist memory thread summary: ${ownerType}/${ownerId}`);
  return rowToMemoryThreadSummary(row);
}

export function getMemoryThreadSummary(ownerType: string, ownerId: string): MemoryThreadSummary | null {
  const row = getMemoryThreadSummaryStmt.get(
    cleanRelationText(ownerType, "thread").replace(/\s+/g, "_").toLowerCase(),
    cleanRelationText(ownerId, "unknown")
  );
  return row ? rowToMemoryThreadSummary(row) : null;
}

export function listMemoryThreadSummaries(limit = 25): MemoryThreadSummary[] {
  return listMemoryThreadSummariesStmt.all(Math.max(1, limit)).map(rowToMemoryThreadSummary);
}

function boolToInt(value: boolean | undefined): number {
  return value ? 1 : 0;
}

function normalizeTelemetryActionStatus(value: TaskTelemetryActionStatus | undefined, success: boolean): TaskTelemetryActionStatus {
  if (value) return value;
  return success ? "completed" : "failed";
}

function normalizeConfidenceValue(value: AgentMemoryConfidence | undefined): AgentMemoryConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizePriority(value: number | undefined): number {
  return clampMemoryImportance(value);
}

function normalizeNumberArray(values: number[] | undefined): number[] {
  return Array.from(new Set((values ?? []).filter((value) => Number.isFinite(value)).map((value) => Math.floor(value)))).slice(0, 50);
}

export function recordTaskTelemetry(input: RecordTaskTelemetryInput): TaskTelemetry {
  const actionStatus = normalizeTelemetryActionStatus(input.actionStatus, input.success);
  const latencyMs = Number.isFinite(input.latencyMs ?? NaN) ? Math.max(0, Math.round(input.latencyMs ?? 0)) : null;
  const result = insertTaskTelemetryStmt.run(
    input.taskType,
    input.sourceType?.trim() || "system",
    input.sourceId ?? null,
    input.jobId ?? null,
    input.threadTs ?? null,
    boolToInt(input.success),
    boolToInt(input.correctionReceived),
    boolToInt(input.userFrustrationDetected),
    boolToInt(input.manualInterventionRequired),
    boolToInt(input.browserSecurityBlocker),
    boolToInt(input.retryRequired),
    latencyMs,
    input.provider?.trim() || null,
    input.model?.trim() || null,
    actionStatus,
    input.outcome?.trim() || null,
    normalizeConfidenceValue(input.confidence),
    input.failureReason?.trim() || null,
    JSON.stringify(input.metadata ?? {})
  );
  const row = getTaskTelemetryByIdStmt.get(Number(result.lastInsertRowid));
  if (!row) throw new Error("Failed to persist task telemetry.");
  return rowToTaskTelemetry(row);
}

export function listTaskTelemetry(limit = 250): TaskTelemetry[] {
  return listTaskTelemetryStmt.all(Math.max(1, limit)).map(rowToTaskTelemetry);
}

export function createImprovementCandidate(input: CreateImprovementCandidateInput): ImprovementCandidate {
  const title = cleanAgentMemoryText(input.title, "improvement title");
  const summary = cleanAgentMemoryText(input.summary, "improvement summary");
  const result = insertImprovementCandidateStmt.run(
    input.candidateType,
    title,
    summary,
    input.rationale?.replace(/\s+/g, " ").trim() || "",
    JSON.stringify(normalizeNumberArray(input.sourceTaskIds)),
    JSON.stringify(normalizeNumberArray(input.sourceMemoryIds)),
    input.status ?? "proposed",
    normalizePriority(input.priority),
    input.createdBy?.trim() || "agent",
    JSON.stringify(input.metadata ?? {})
  );
  const row = getImprovementCandidateByIdStmt.get(Number(result.lastInsertRowid));
  if (!row) throw new Error("Failed to persist improvement candidate.");
  return rowToImprovementCandidate(row);
}

export function listImprovementCandidates(limit = 50): ImprovementCandidate[] {
  return listImprovementCandidatesStmt.all(Math.max(1, limit)).map(rowToImprovementCandidate);
}

export function createPromptToolVersion(input: CreatePromptToolVersionInput): PromptToolVersion {
  const versionId = cleanAgentMemoryText(input.versionId, "prompt/tool version id");
  const result = insertPromptToolVersionStmt.run(
    versionId,
    input.kind,
    cleanAgentMemoryText(input.name, "prompt/tool version name"),
    cleanAgentMemoryText(input.changeSummary, "prompt/tool version change summary"),
    cleanAgentMemoryText(input.reason, "prompt/tool version reason"),
    JSON.stringify(input.relatedScorecard ?? {}),
    input.relatedFailureId ?? null,
    input.createdBy?.trim() || "agent",
    input.active ? 1 : 0,
    input.rollbackTargetVersionId?.trim() || null,
    JSON.stringify(input.tests ?? []),
    JSON.stringify(input.metadata ?? {})
  );
  const row = getPromptToolVersionByVersionIdStmt.get(versionId);
  if (!row || Number(result.lastInsertRowid) < 1) throw new Error(`Failed to persist prompt/tool version: ${versionId}`);
  return rowToPromptToolVersion(row);
}

export function listPromptToolVersions(limit = 50): PromptToolVersion[] {
  return listPromptToolVersionsStmt.all(Math.max(1, limit)).map(rowToPromptToolVersion);
}

export function deactivatePromptToolVersion(versionId: string): boolean {
  return deactivatePromptToolVersionStmt.run(versionId).changes > 0;
}

export function createSelfImprovementEval(input: CreateSelfImprovementEvalInput): SelfImprovementEval {
  const result = insertSelfImprovementEvalStmt.run(
    input.evalType,
    cleanAgentMemoryText(input.title, "eval title"),
    JSON.stringify(input.inputContext ?? {}),
    cleanAgentMemoryText(input.expectedBehavior, "eval expected behavior"),
    JSON.stringify(input.safetyAssertions ?? []),
    cleanAgentMemoryText(input.regressionGuard, "eval regression guard"),
    input.sourceFailureId ?? null,
    input.status?.trim() || "active",
    JSON.stringify(input.metadata ?? {})
  );
  const row = getSelfImprovementEvalByIdStmt.get(Number(result.lastInsertRowid));
  if (!row) throw new Error("Failed to persist self-improvement eval.");
  return rowToSelfImprovementEval(row);
}

export function listSelfImprovementEvals(limit = 50): SelfImprovementEval[] {
  return listSelfImprovementEvalsStmt.all(Math.max(1, limit)).map(rowToSelfImprovementEval);
}

function cleanSalesLearningText(value: string, field: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    throw new Error(`Sales learning ${field} cannot be empty.`);
  }
  return cleaned;
}

function normalizeEvidenceCount(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? 1));
}

function normalizeSalesExamples(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? [])
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)))
    .slice(0, 8);
}

function summarizeSalesPayload(payload: Record<string, unknown> | undefined, fallback: string): string {
  const summary = typeof payload?.summary === "string" ? payload.summary : "";
  const instruction = typeof payload?.instruction === "string" ? payload.instruction : "";
  const outcome = typeof payload?.outcome === "string" ? payload.outcome : "";
  return [summary, instruction, outcome, fallback].find((value) => value.replace(/\s+/g, " ").trim())?.replace(/\s+/g, " ").trim() ?? fallback;
}

function salesMemoryImportance(confidence: SalesLearningConfidence, evidenceCount: number): number {
  const confidenceScore = confidence === "high" ? 7 : confidence === "medium" ? 5 : 3;
  return Math.max(1, Math.min(10, confidenceScore + Math.min(3, evidenceCount - 1)));
}

function salesMemoryKeywords(input: {
  type: SalesLearningMemoryType;
  scope: string;
  subject: string;
  hypothesis: string;
  examples: string[];
  metadata: Record<string, unknown>;
}): string[] {
  const metadataKeywords = ["vertical", "platform", "source", "jobType", "outcome"]
    .map((key) => input.metadata[key])
    .filter((value): value is string => typeof value === "string");
  return normalizeAgentKeywords([
    input.type,
    input.scope,
    input.subject,
    input.hypothesis,
    ...input.examples,
    ...metadataKeywords,
  ].flatMap((value) => value.split(/[^A-Za-z0-9_-]+/)));
}

export function recordSalesLearningEvent(input: RecordSalesLearningEventInput): SalesLearningEvent {
  const source = input.source?.replace(/\s+/g, " ").trim() || "system";
  const result = insertSalesLearningEventStmt.run(
    input.eventType,
    input.jobId ?? null,
    input.channelId ?? null,
    input.threadTs ?? null,
    source,
    JSON.stringify(input.payload ?? {})
  );
  const row = getSalesLearningEventByIdStmt.get(Number(result.lastInsertRowid));
  if (!row) {
    throw new Error("Failed to persist sales learning event.");
  }
  recordAgentEvent({
    eventType: input.eventType,
    sourceType: "sales_learning",
    sourceId: String(row.id),
    jobId: input.jobId ?? null,
    applicationId: input.jobId ?? null,
    threadTs: input.threadTs ?? null,
    actor: "agent",
    summary: summarizeSalesPayload(input.payload, input.eventType),
    payload: input.payload ?? {},
    importance: input.eventType === "outcome_recorded" || input.eventType === "failure_reflection" ? 7 : 5,
    privacyLevel: "normal",
  });
  return rowToSalesLearningEvent(row);
}

export function listRecentSalesLearningEvents(limit = 25): SalesLearningEvent[] {
  return listRecentSalesLearningEventsStmt.all(Math.max(1, limit)).map(rowToSalesLearningEvent);
}

export function upsertSalesLearningMemory(input: UpsertSalesLearningMemoryInput): SalesLearningMemory {
  const scope = input.scope?.replace(/\s+/g, " ").trim() || "global";
  const subject = cleanSalesLearningText(input.subject, "subject");
  const hypothesis = cleanSalesLearningText(input.hypothesis, "hypothesis");
  const rationale = input.rationale?.replace(/\s+/g, " ").trim() ?? "";
  const confidence = input.confidence ?? "low";
  const evidenceCount = normalizeEvidenceCount(input.evidenceCount);
  const status = input.status ?? (evidenceCount > 1 ? "active" : "tentative");
  const source = input.source?.replace(/\s+/g, " ").trim() || "system";
  const examples = normalizeSalesExamples(input.examples);
  upsertSalesLearningMemoryStmt.run(
    input.type,
    scope,
    subject,
    hypothesis,
    rationale,
    confidence,
    evidenceCount,
    status,
    source,
    input.jobId ?? null,
    input.channelId ?? null,
    input.threadTs ?? null,
    JSON.stringify(examples),
    JSON.stringify(input.metadata ?? {})
  );
  const row = getSalesLearningMemoryByKeyStmt.get(input.type, scope, subject, hypothesis);
  if (!row) {
    throw new Error(`Failed to persist sales learning memory: ${input.type}/${scope}/${subject}`);
  }
  upsertAgentMemory({
    memoryType: input.type,
    scope,
    title: subject,
    summary: hypothesis,
    ruleText: input.type === "operator_preference" ? hypothesis : null,
    hypothesisText: hypothesis,
    confidence,
    importance: salesMemoryImportance(confidence, evidenceCount),
    evidenceCount,
    status,
    sourceEventIds: Array.isArray(input.metadata?.sourceEventIds)
      ? input.metadata.sourceEventIds.filter((item): item is number => typeof item === "number")
      : [],
    keywords: salesMemoryKeywords({ type: input.type, scope, subject, hypothesis, examples, metadata: input.metadata ?? {} }),
    embeddingId: null,
  });
  return rowToSalesLearningMemory(row);
}

export function listSalesLearningMemories(limit = 50): SalesLearningMemory[] {
  return listSalesLearningMemoriesStmt.all(Math.max(1, limit)).map(rowToSalesLearningMemory);
}

export function listSalesLearningMemoriesByType(type: SalesLearningMemoryType, limit = 50): SalesLearningMemory[] {
  return listSalesLearningMemoriesByTypeStmt.all(type, Math.max(1, limit)).map(rowToSalesLearningMemory);
}

export function forgetSalesLearningMemory(input: { id?: number; query?: string; type?: SalesLearningMemoryType }): number {
  let changes = 0;
  if (typeof input.id === "number") {
    changes += forgetSalesLearningMemoryByIdStmt.run(input.id).changes;
    changes += forgetAgentMemory({ id: input.id });
    return changes;
  }
  const query = input.query?.replace(/\s+/g, " ").trim();
  if (!query) return 0;
  const pattern = `%${query}%`;
  changes += forgetSalesLearningMemoriesMatchingStmt.run(input.type ?? "", input.type ?? "", pattern, pattern).changes;
  changes += forgetAgentMemory({ query, memoryType: input.type });
  return changes;
}

export function recordHeartbeat(input: HeartbeatWriteInput): HeartbeatRecord {
  const timestamp = formatHeartbeatTimestamp(input.at ?? new Date());
  const isSuccess = input.status === "success";
  const isError = input.status === "error";
  upsertHeartbeatStmt.run(
    input.worker,
    input.status,
    timestamp,
    isSuccess ? timestamp : null,
    isSuccess ? 1 : 0,
    isError ? 1 : 0,
    input.error ?? null,
    JSON.stringify(input.metadata ?? {}),
    timestamp
  );

  const heartbeat = getHeartbeat(input.worker);
  if (!heartbeat) {
    throw new Error(`Failed to record heartbeat for ${input.worker}`);
  }
  return heartbeat;
}

export function getHeartbeat(worker: string): HeartbeatRecord | null {
  const row = getHeartbeatStmt.get(worker);
  return row ? rowToHeartbeat(row) : null;
}

export function listHeartbeats(): HeartbeatRecord[] {
  return listHeartbeatsStmt.all().map(rowToHeartbeat);
}

export function listStaleHeartbeats(thresholdMs: number, now = new Date()): HeartbeatRecord[] {
  const staleBefore = new Date(now.getTime() - thresholdMs);
  return staleHeartbeatsStmt.all(formatHeartbeatTimestamp(staleBefore)).map((row) => ({
    ...rowToHeartbeat(row),
    status: "stale",
  }));
}

export function getHealthAlertLastSent(alertKey: string): string | null {
  return getHealthAlertStmt.get(alertKey)?.last_sent_at ?? null;
}

export function recordHealthAlertSent(alertKey: string, sentAt = new Date()): void {
  upsertHealthAlertStmt.run(alertKey, formatHeartbeatTimestamp(sentAt));
}

export function cleanupOldSeenJobs(): number {
  const result = cleanupStmt.run();
  return result.changes;
}

export function queueSlackMessage(payload: string): void {
  queueInsertStmt.run(payload);
}

export function getQueuedSlackMessages(): SlackQueueItem[] {
  return queueSelectStmt.all();
}

export function getSlackQueueStats(): SlackQueueStats {
  return queueStatsStmt.get() ?? { count: 0, maxAttempts: 0 };
}

export function markQueuedMessageSent(id: number): void {
  queueDeleteStmt.run(id);
}

export function incrementQueuedMessageAttempts(id: number): void {
  queueAttemptStmt.run(id);
}

export function getDbStats(): SeenStats {
  const total = countStmt.get()?.count ?? 0;
  const matchCounts = db
    .prepare<[], MatchCountRow>(
      `SELECT match_level, COUNT(*) as count
       FROM seen_jobs
       GROUP BY match_level`
    )
    .all();

  const stats: SeenStats = {
    total,
    high: 0,
    medium: 0,
    low: 0,
    skip: 0,
  };

  for (const row of matchCounts) {
    if (row.match_level === "high") {
      stats.high = row.count;
    } else if (row.match_level === "medium") {
      stats.medium = row.count;
    } else if (row.match_level === "low") {
      stats.low = row.count;
    } else if (row.match_level === "skip") {
      stats.skip = row.count;
    }
  }

  return stats;
}

function formatDateKeyInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getDailySummary(referenceDate = new Date()): DailySummary {
  const rows = db
    .prepare<[], DailyRow>(
      "SELECT title, score, match_level, seen_at FROM seen_jobs"
    )
    .all();

  const targetDay = formatDateKeyInTimezone(referenceDate, TIMEZONE);
  let high = 0;
  let medium = 0;
  let low = 0;
  let filteredOut = 0;
  let topJobTitle: string | null = null;
  let topJobScore: number | null = null;

  for (const row of rows) {
    const rowDate = new Date(`${row.seen_at}Z`);
    if (Number.isNaN(rowDate.getTime())) {
      continue;
    }
    const rowDay = formatDateKeyInTimezone(rowDate, TIMEZONE);
    if (rowDay !== targetDay) {
      continue;
    }

    if (row.match_level === "high") {
      high += 1;
    } else if (row.match_level === "medium") {
      medium += 1;
    } else if (row.match_level === "low") {
      low += 1;
    } else {
      filteredOut += 1;
    }

    if (topJobScore === null || row.score > topJobScore) {
      topJobTitle = row.title;
      topJobScore = row.score;
    }
  }

  return {
    high,
    medium,
    low,
    filteredOut,
    topJobTitle,
    topJobScore,
  };
}
