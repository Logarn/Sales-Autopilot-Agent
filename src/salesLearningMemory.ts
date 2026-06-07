import {
  forgetSalesLearningMemory,
  listAgentMemories,
  getApplicationDraft,
  getScoredJobForSlackPreview,
  touchAgentMemory,
  recordSalesLearningEvent,
  upsertSalesLearningMemory,
  type AgentMemory,
  type SalesLearningMemory,
  type SalesLearningMemoryType,
} from "./db";
import { JOB_INTELLIGENCE_TEMPERATURE } from "./config";
import { OpenAiCompatibleProvider, getJobIntelligenceProviderConfig, type LlmJsonRequest, type LlmJsonResult } from "./llm/provider";
import { buildSoulPromptContext, buildSoulPromptSection } from "./soul";
import type { ApplicationStatus, BrowserApplyFillPlan, ConnectsStrategySnapshot, ScoredJob } from "./types";

const POSITIVE_OUTCOMES = new Set<ApplicationStatus>(["replied", "interview", "hired"]);
const NEGATIVE_OUTCOMES = new Set<ApplicationStatus>(["lost", "rejected"]);

export interface SalesLearningContextInput {
  jobId?: string | null;
  job?: ScoredJob | null;
  text?: string | null;
  types?: SalesLearningMemoryType[];
  limit?: number;
}

export interface SalesLearningPromptMemory {
  type: SalesLearningMemoryType;
  scope: string;
  subject: string;
  hypothesis: string;
  confidence: SalesLearningMemory["confidence"];
  evidenceCount: number;
  status: SalesLearningMemory["status"];
  updatedAt: string;
}

export interface SalesLearningPromptContext {
  relevantMemories: SalesLearningPromptMemory[];
  guidance: string[];
}

export interface SalesLearningReflectionProvider {
  isAvailable(): boolean;
  completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>>;
}

interface RawSalesLearningReflection {
  memories?: unknown;
  codeImprovementTask?: unknown;
}

interface RawSalesLearningReflectionMemory {
  type?: unknown;
  scope?: unknown;
  subject?: unknown;
  hypothesis?: unknown;
  rationale?: unknown;
  confidence?: unknown;
  status?: unknown;
}

function defaultReflectionProvider(): SalesLearningReflectionProvider {
  return new OpenAiCompatibleProvider(getJobIntelligenceProviderConfig());
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: string | null | undefined, max = 240): string {
  const cleaned = clean(value);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function getJob(jobId?: string | null, job?: ScoredJob | null): ScoredJob | null {
  return job ?? (jobId ? getScoredJobForSlackPreview(jobId) : null);
}

function inferVerticalFromText(value: string): string {
  const text = value.toLowerCase();
  if (/\b(beauty|skincare|cosmetic|makeup|haircare)\b/.test(text)) return "beauty";
  if (/\b(fashion|apparel|clothing|boutique|jewelry)\b/.test(text)) return "fashion";
  if (/\b(supplement|wellness|health|fitness)\b/.test(text)) return "health";
  if (/\b(pet|dog|cat)\b/.test(text)) return "pet";
  if (/\b(saas|software|b2b)\b/.test(text)) return "saas";
  return "unknown";
}

function inferPlatformFromText(value: string): string {
  const text = value.toLowerCase();
  if (/\bklaviyo\b/.test(text)) return "klaviyo";
  if (/\bshopify\b/.test(text)) return "shopify";
  if (/\bmailchimp\b/.test(text)) return "mailchimp";
  if (/\bomnisend\b/.test(text)) return "omnisend";
  if (/\bhubspot\b/.test(text)) return "hubspot";
  return "unknown";
}

function jobSegments(job: ScoredJob | null): {
  vertical: string;
  platform: string;
  source: string;
  jobType: string;
  scope: string;
  text: string;
} {
  const draft = job?.applicationDraft ?? (job?.id ? getApplicationDraft(job.id) ?? undefined : undefined);
  const intelligence = draft?.jobIntelligence;
  const text = [
    job?.title,
    job?.description,
    job?.skills?.join(" "),
    intelligence?.businessType,
    intelligence?.clientGoal,
    intelligence?.taskType,
    intelligence?.proposalAngle,
    intelligence?.proofRecommendations?.join(" "),
  ].map(clean).filter(Boolean).join(" ");
  const vertical = clean(intelligence?.ecommerceVertical) || inferVerticalFromText(text);
  const platform = clean(intelligence?.primaryPlatform).toLowerCase() || inferPlatformFromText(text);
  const source = clean(job?.sourceQuery) || "unknown source";
  const jobType = clean(intelligence?.taskType || intelligence?.jobCategory) || "unknown job type";
  return {
    vertical,
    platform,
    source,
    jobType,
    scope: `${vertical}:${platform}`,
    text,
  };
}

function firstSentence(value: string): string {
  return compact(clean(value).split(/(?<=[.!?])\s+/)[0] ?? "", 180);
}

function lastSentence(value: string): string {
  const sentences = clean(value).split(/(?<=[.!?])\s+/).filter(Boolean);
  return compact(sentences[sentences.length - 1] ?? "", 180);
}

function positiveOutcome(status: ApplicationStatus): boolean {
  return POSITIVE_OUTCOMES.has(status);
}

function negativeOutcome(status: ApplicationStatus): boolean {
  return NEGATIVE_OUTCOMES.has(status);
}

function outcomeLabel(status: ApplicationStatus): string {
  if (status === "interview") return "interview booked";
  if (status === "hired") return "hired";
  if (status === "replied") return "reply received";
  if (status === "lost") return "lost";
  if (status === "rejected") return "skipped/rejected";
  return status;
}

function isSalesMemoryType(value: unknown): value is SalesLearningMemoryType {
  return typeof value === "string" && [
    "proposal_style",
    "proof_preference",
    "boost_strategy",
    "timing_hypothesis",
    "source_quality",
    "operator_preference",
    "failure_pattern",
    "code_improvement_task",
  ].includes(value);
}

function normalizeConfidence(value: unknown): SalesLearningMemory["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizeStatus(value: unknown): SalesLearningMemory["status"] {
  return value === "active" || value === "archived" || value === "forgotten" || value === "tentative"
    ? value
    : "tentative";
}

function normalizeReflectionMemory(raw: RawSalesLearningReflectionMemory, fallbackScope: string): {
  type: SalesLearningMemoryType;
  scope: string;
  subject: string;
  hypothesis: string;
  rationale: string;
  confidence: SalesLearningMemory["confidence"];
  status: SalesLearningMemory["status"];
} | null {
  if (!isSalesMemoryType(raw.type)) return null;
  const subject = clean(typeof raw.subject === "string" ? raw.subject : "");
  const hypothesis = clean(typeof raw.hypothesis === "string" ? raw.hypothesis : "");
  if (!subject || !hypothesis) return null;
  return {
    type: raw.type,
    scope: clean(typeof raw.scope === "string" ? raw.scope : "") || fallbackScope,
    subject,
    hypothesis,
    rationale: clean(typeof raw.rationale === "string" ? raw.rationale : ""),
    confidence: normalizeConfidence(raw.confidence),
    status: normalizeStatus(raw.status),
  };
}

function agentMemoryToSalesLearningMemory(memory: AgentMemory): SalesLearningMemory | null {
  if (!isSalesMemoryType(memory.memoryType)) return null;
  return {
    id: memory.id,
    type: memory.memoryType,
    scope: memory.scope,
    subject: memory.title,
    hypothesis: memory.hypothesisText ?? memory.summary,
    rationale: memory.summary,
    confidence: memory.confidence,
    evidenceCount: memory.evidenceCount,
    status: memory.status,
    source: "agent_memories",
    jobId: null,
    channelId: null,
    threadTs: null,
    examples: memory.keywords.slice(0, 8),
    metadata: {
      sourceEventIds: memory.sourceEventIds,
      importance: memory.importance,
      lastUsedAt: memory.lastUsedAt,
      decayScore: memory.decayScore,
      version: memory.version,
      supersedesMemoryId: memory.supersedesMemoryId,
      contradictedByMemoryId: memory.contradictedByMemoryId,
      embeddingId: memory.embeddingId,
    },
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

export function recordProposalStyleSignal(input: {
  jobId: string;
  instruction: string;
  beforeText?: string | null;
  afterText?: string | null;
  channelId?: string | null;
  threadTs?: string | null;
  source?: string;
}): SalesLearningMemory {
  const job = getJob(input.jobId);
  const segments = jobSegments(job);
  const beforeOpener = firstSentence(input.beforeText ?? "");
  const afterOpener = firstSentence(input.afterText ?? "");
  const beforeCta = lastSentence(input.beforeText ?? "");
  const afterCta = lastSentence(input.afterText ?? "");
  recordSalesLearningEvent({
    eventType: "draft_style_signal",
    jobId: input.jobId,
    channelId: input.channelId,
    threadTs: input.threadTs,
    source: input.source ?? "proposal_revision",
    payload: {
      instruction: input.instruction,
      vertical: segments.vertical,
      platform: segments.platform,
      beforeOpener,
      afterOpener,
      beforeCta,
      afterCta,
    },
  });

  const instruction = input.instruction.toLowerCase();
  const directDiagnosis = /\b(open|opener|intro|first|specific|diagnosis|problem|commercial|revenue|direct)\b/.test(instruction);
  const hypothesis = directDiagnosis
    ? `For ${segments.scope} proposals, Steve prefers a specific commercial diagnosis over generic experience claims.`
    : `For ${segments.scope} proposals, Steve's revision instructions are draft style signals to reuse on similar jobs.`;
  return upsertSalesLearningMemory({
    type: "proposal_style",
    scope: segments.scope,
    subject: `${segments.scope}:proposal`,
    hypothesis,
    rationale: `Revision instruction: ${compact(input.instruction, 220)}`,
    confidence: "low",
    evidenceCount: 1,
    status: "tentative",
    source: input.source ?? "proposal_revision",
    jobId: input.jobId,
    channelId: input.channelId,
    threadTs: input.threadTs,
    examples: unique([beforeOpener ? `before: ${beforeOpener}` : null, afterOpener ? `after: ${afterOpener}` : null]),
    metadata: { vertical: segments.vertical, platform: segments.platform, jobType: segments.jobType },
  });
}

export function recordProofPreferenceSignal(input: {
  jobId: string;
  instruction: string;
  plannedProofIds?: string[];
  verifiedProofLabels?: string[];
  channelId?: string | null;
  threadTs?: string | null;
  source?: string;
}): SalesLearningMemory {
  const job = getJob(input.jobId);
  const segments = jobSegments(job);
  const proofNames = unique([...(input.verifiedProofLabels ?? []), ...(input.plannedProofIds ?? [])]);
  recordSalesLearningEvent({
    eventType: "proof_correction",
    jobId: input.jobId,
    channelId: input.channelId,
    threadTs: input.threadTs,
    source: input.source ?? "proof_correction",
    payload: {
      instruction: input.instruction,
      plannedProofIds: input.plannedProofIds ?? [],
      verifiedProofLabels: input.verifiedProofLabels ?? [],
      vertical: segments.vertical,
      platform: segments.platform,
    },
  });
  const proofText = proofNames.length ? proofNames.join(", ") : "the corrected proof plan";
  return upsertSalesLearningMemory({
    type: "proof_preference",
    scope: segments.scope,
    subject: `${segments.scope}:proof`,
    hypothesis: `For ${segments.scope} opportunities, prioritize ${proofText} when the job context matches this correction.`,
    rationale: `Steve/Natalie proof correction: ${compact(input.instruction, 220)}`,
    confidence: "low",
    evidenceCount: 1,
    status: "tentative",
    source: input.source ?? "proof_correction",
    jobId: input.jobId,
    channelId: input.channelId,
    threadTs: input.threadTs,
    examples: unique([input.instruction, ...proofNames]),
    metadata: { vertical: segments.vertical, platform: segments.platform, jobType: segments.jobType },
  });
}

export function recordBoostDecisionSignal(input: {
  jobId: string;
  requiredConnects: number | null;
  boostConnects: number | null;
  totalConnects: number | null;
  boostRank?: number | null;
  decision?: ConnectsStrategySnapshot["decision"] | null;
  reasons?: string[];
  source?: string;
}): SalesLearningMemory {
  const job = getJob(input.jobId);
  const segments = jobSegments(job);
  recordSalesLearningEvent({
    eventType: "boost_decision",
    jobId: input.jobId,
    source: input.source ?? "connects_strategy",
    payload: {
      requiredConnects: input.requiredConnects,
      boostConnects: input.boostConnects,
      totalConnects: input.totalConnects,
      boostRank: input.boostRank ?? null,
      decision: input.decision ?? null,
      reasons: input.reasons ?? [],
      score: job?.score ?? null,
      matchLevel: job?.matchLevel ?? null,
      vertical: segments.vertical,
      platform: segments.platform,
    },
  });
  return upsertSalesLearningMemory({
    type: "boost_strategy",
    scope: segments.scope,
    subject: `${segments.scope}:boost`,
    hypothesis: `For ${segments.scope} jobs, use the minimum boost that creates meaningful visibility and keep optional boost under the hard 50 cap.`,
    rationale: `Recorded boost decision: required=${input.requiredConnects ?? "unknown"}, boost=${input.boostConnects ?? "unknown"}, total=${input.totalConnects ?? "unknown"}, rank=${input.boostRank ?? "unknown"}.`,
    confidence: "low",
    evidenceCount: 1,
    status: "tentative",
    source: input.source ?? "connects_strategy",
    jobId: input.jobId,
    examples: input.reasons?.slice(0, 4) ?? [],
    metadata: { vertical: segments.vertical, platform: segments.platform, source: segments.source },
  });
}

export function recordApplicationOutcomeLearning(input: {
  jobId: string;
  outcome: ApplicationStatus;
  note?: string | null;
  source?: string;
}): SalesLearningMemory[] {
  const job = getJob(input.jobId);
  const draft = getApplicationDraft(input.jobId);
  const segments = jobSegments(job);
  const outcome = outcomeLabel(input.outcome);
  const positive = positiveOutcome(input.outcome);
  const negative = negativeOutcome(input.outcome);
  const memories: SalesLearningMemory[] = [];

  recordSalesLearningEvent({
    eventType: "outcome_recorded",
    jobId: input.jobId,
    source: input.source ?? "application_outcome",
    payload: {
      outcome: input.outcome,
      note: input.note ?? null,
      vertical: segments.vertical,
      platform: segments.platform,
      sourceQuery: segments.source,
      postedAt: job?.postedAt ?? null,
      generatedAt: draft?.generatedAt ?? null,
      suggestedBoostConnects: draft?.suggestedBoostConnects ?? null,
      suggestedConnects: draft?.suggestedConnects ?? null,
      selectedPortfolioItems: draft?.selectedPortfolioItems.map((item) => item.name) ?? [],
      opener: firstSentence(draft?.proposalText ?? ""),
      cta: lastSentence(draft?.proposalText ?? ""),
    },
  });

  if (positive || negative) {
    memories.push(upsertSalesLearningMemory({
      type: "source_quality",
      scope: `source:${segments.source}`,
      subject: segments.source,
      hypothesis: positive
        ? `${segments.source} produced a ${outcome}; keep watching it for similar high-quality opportunities.`
        : `${segments.source} produced a ${outcome}; review whether this source is noisy for similar jobs before spending more Connects.`,
      rationale: compact(input.note ?? `Outcome recorded as ${outcome}.`, 220),
      confidence: "low",
      evidenceCount: 1,
      status: "tentative",
      source: input.source ?? "application_outcome",
      jobId: input.jobId,
      examples: unique([job?.title, job?.url]),
      metadata: { outcome: input.outcome, vertical: segments.vertical, platform: segments.platform },
    }));
  }

  if (draft?.selectedPortfolioItems.length && positive) {
    memories.push(upsertSalesLearningMemory({
      type: "proof_preference",
      scope: segments.scope,
      subject: `${segments.scope}:proof`,
      hypothesis: `For ${segments.scope} opportunities, proof like ${draft.selectedPortfolioItems.map((item) => item.name).join(", ")} has positive outcome evidence.`,
      rationale: `Outcome ${outcome} after this proof plan.`,
      confidence: "low",
      evidenceCount: 1,
      status: "tentative",
      source: input.source ?? "application_outcome",
      jobId: input.jobId,
      examples: draft.selectedPortfolioItems.map((item) => item.name),
      metadata: { outcome: input.outcome, vertical: segments.vertical, platform: segments.platform },
    }));
  }

  if ((positive || negative) && draft?.connectsStrategy) {
    memories.push(upsertSalesLearningMemory({
      type: "boost_strategy",
      scope: segments.scope,
      subject: `${segments.scope}:boost`,
      hypothesis: positive
        ? `For ${segments.scope} jobs, this Connects/boost range has positive outcome evidence; keep testing minimum useful visibility instead of chasing #1.`
        : `For ${segments.scope} jobs, this Connects/boost choice did not produce a win signal; review whether the boost was worth the spend before repeating it.`,
      rationale: `Outcome ${outcome}; required=${draft.connectsStrategy.requiredConnects ?? "unknown"}, boost=${draft.connectsStrategy.suggestedBoostConnects}, total=${draft.connectsStrategy.totalConnects ?? "unknown"}.`,
      confidence: "low",
      evidenceCount: 1,
      status: "tentative",
      source: input.source ?? "application_outcome",
      jobId: input.jobId,
      examples: draft.connectsStrategy.reasons.slice(0, 4),
      metadata: { outcome: input.outcome, vertical: segments.vertical, platform: segments.platform },
    }));
  }

  const postedAt = Date.parse(job?.postedAt ?? "");
  const preparedAt = Date.parse(draft?.generatedAt ?? "");
  if ((positive || negative) && Number.isFinite(postedAt) && Number.isFinite(preparedAt)) {
    const delayHours = Math.max(0, Math.round((preparedAt - postedAt) / 36_000) / 100);
    memories.push(upsertSalesLearningMemory({
      type: "timing_hypothesis",
      scope: segments.scope,
      subject: `${segments.scope}:timing`,
      hypothesis: positive
        ? `For ${segments.scope} jobs, applying/preparing about ${delayHours}h after posting has positive outcome evidence.`
        : `For ${segments.scope} jobs, applying/preparing about ${delayHours}h after posting did not produce a win signal; keep testing timing instead of assuming stale jobs are worth Connects.`,
      rationale: `Outcome ${outcome}; posted=${job?.postedAt}, prepared=${draft?.generatedAt}.`,
      confidence: "low",
      evidenceCount: 1,
      status: "tentative",
      source: input.source ?? "application_outcome",
      jobId: input.jobId,
      examples: unique([job?.title, `${delayHours}h from posting to prep`]),
      metadata: { outcome: input.outcome, delayHours, vertical: segments.vertical, platform: segments.platform },
    }));
  }

  if (draft?.proposalText.trim() && (positive || negative)) {
    memories.push(upsertSalesLearningMemory({
      type: "proposal_style",
      scope: segments.scope,
      subject: `${segments.scope}:proposal`,
      hypothesis: positive
        ? `For ${segments.scope} proposals, openers like "${firstSentence(draft.proposalText)}" have positive outcome evidence.`
        : `For ${segments.scope} proposals, review whether this opener or proof angle underperformed before reusing it.`,
      rationale: `Outcome ${outcome}; proposal version generated at ${draft.generatedAt}.`,
      confidence: "low",
      evidenceCount: 1,
      status: "tentative",
      source: input.source ?? "application_outcome",
      jobId: input.jobId,
      examples: unique([firstSentence(draft.proposalText), lastSentence(draft.proposalText)]),
      metadata: { outcome: input.outcome, vertical: segments.vertical, platform: segments.platform },
    }));
  }

  return memories;
}

export async function reflectOnSalesOutcomeWithLlm(input: {
  jobId: string;
  outcome: ApplicationStatus;
  note?: string | null;
  source?: string;
}, provider: SalesLearningReflectionProvider = defaultReflectionProvider()): Promise<{ ok: true; memories: SalesLearningMemory[] } | { ok: false; reason: string }> {
  if (!provider.isAvailable()) {
    return { ok: false, reason: "sales learning reflection provider unavailable" };
  }
  const job = getJob(input.jobId);
  const draft = getApplicationDraft(input.jobId);
  const segments = jobSegments(job);
  const existing = buildSalesLearningPromptContext({
    jobId: input.jobId,
    text: [job?.title, job?.description, draft?.proposalText, input.note].map(clean).filter(Boolean).join("\n"),
    limit: 8,
  });
  const response = await provider.completeJson<RawSalesLearningReflection>({
    temperature: Math.min(JOB_INTELLIGENCE_TEMPERATURE, 0.2),
    maxTokens: 1400,
    messages: [
      {
        role: "system",
        content: [
          "You are the Upwork agent's sales-learning reflection loop.",
          "Given one outcome or failure, extract tentative hypotheses that could improve future sales decisions.",
          "Do not create hard rules from one data point. Mark one-off observations tentative and low confidence.",
          "Focus on proposal style, proof fit, boost/connects strategy, timing, source quality, operator preferences, failure patterns, and code-improvement tasks.",
          "Return JSON only: {\"memories\":[{\"type\":\"proposal_style|proof_preference|boost_strategy|timing_hypothesis|source_quality|operator_preference|failure_pattern|code_improvement_task\",\"scope\":\"...\",\"subject\":\"...\",\"hypothesis\":\"...\",\"rationale\":\"...\",\"confidence\":\"low|medium|high\",\"status\":\"tentative|active\"}],\"codeImprovementTask\":\"optional\"}.",
          "Never propose bypassing CAPTCHA/security checks or changing final-submit safety.",
          buildSoulPromptSection("self_improvement_memory"),
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          outcome: input.outcome,
          note: input.note ?? null,
          job: job ? {
            id: job.id,
            title: job.title,
            url: job.url,
            sourceQuery: job.sourceQuery,
            score: job.score,
            matchLevel: job.matchLevel,
            budget: job.budget,
            postedAt: job.postedAt,
            skills: job.skills,
          } : null,
          draft: draft ? {
            proposalText: draft.proposalText,
            selectedPortfolioItems: draft.selectedPortfolioItems.map((item) => item.name),
            suggestedConnects: draft.suggestedConnects,
            suggestedBoostConnects: draft.suggestedBoostConnects,
            connectsStrategy: draft.connectsStrategy,
            jobIntelligence: draft.jobIntelligence,
          } : null,
          existingSalesLearning: existing,
          soul: buildSoulPromptContext("self_improvement_memory"),
        }),
      },
    ],
  });
  if (!response.ok || !response.data) {
    return { ok: false, reason: response.error ?? response.skippedReason ?? "sales learning reflection returned no data" };
  }
  const rawMemories = Array.isArray(response.data.memories) ? response.data.memories : [];
  const memories = rawMemories
    .map((item) => normalizeReflectionMemory(item as RawSalesLearningReflectionMemory, segments.scope))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((memory) => upsertSalesLearningMemory({
      ...memory,
      evidenceCount: 1,
      source: input.source ?? "sales_learning_reflection_llm",
      jobId: input.jobId,
      examples: unique([job?.title, input.note, memory.rationale]),
      metadata: { outcome: input.outcome, vertical: segments.vertical, platform: segments.platform },
    }));
  if (typeof response.data.codeImprovementTask === "string" && response.data.codeImprovementTask.trim()) {
    memories.push(recordCodeImprovementTask({
      task: response.data.codeImprovementTask.trim(),
      why: `Sales-learning reflection for ${input.jobId} after ${input.outcome}.`,
      jobId: input.jobId,
      source: input.source ?? "sales_learning_reflection_llm",
    }));
  }
  return { ok: true, memories };
}

export function recordBrowserApplyPlanLearning(plan: BrowserApplyFillPlan, source = "browser_apply_plan"): SalesLearningMemory[] {
  const memories: SalesLearningMemory[] = [];
  memories.push(recordBoostDecisionSignal({
    jobId: plan.jobId,
    requiredConnects: plan.connects.required,
    boostConnects: plan.connects.boost,
    totalConnects: plan.connects.total,
    decision: plan.connectsStrategy.decision,
    reasons: plan.connectsStrategy.reasons,
    source,
  }));
  memories.push(recordProofPreferenceSignal({
    jobId: plan.jobId,
    instruction: "Proof plan selected during browser application preparation.",
    plannedProofIds: [...plan.attachments.map((attachment) => attachment.name), ...plan.highlights],
    source,
  }));
  return memories;
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []);
}

function scoreMemory(memory: SalesLearningMemory, queryTokens: Set<string>, job: ScoredJob | null): number {
  const haystack = [
    memory.type,
    memory.scope,
    memory.subject,
    memory.hypothesis,
    memory.rationale,
    memory.examples.join(" "),
    JSON.stringify(memory.metadata),
  ].join(" ").toLowerCase();
  const importance = typeof memory.metadata.importance === "number" ? memory.metadata.importance : 3;
  const decayScore = typeof memory.metadata.decayScore === "number" ? memory.metadata.decayScore : 0;
  let score = memory.evidenceCount * 2 + importance + (memory.status === "active" ? 4 : 1) - decayScore;
  if (memory.type === "operator_preference" || memory.scope === "global") score += 2;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 3;
  }
  if (job?.sourceQuery && haystack.includes(job.sourceQuery.toLowerCase())) score += 4;
  return score;
}

export function retrieveRelevantSalesLearningMemories(input: SalesLearningContextInput): SalesLearningMemory[] {
  const job = getJob(input.jobId, input.job);
  const segments = jobSegments(job);
  const queryText = [
    input.text,
    job?.title,
    job?.description,
    job?.skills?.join(" "),
    segments.vertical,
    segments.platform,
    segments.source,
    segments.jobType,
  ].map(clean).filter(Boolean).join(" ");
  const queryTokens = tokenize(queryText);
  const types = new Set(input.types ?? []);
  const ranked = listAgentMemories(300)
    .map(agentMemoryToSalesLearningMemory)
    .filter((memory): memory is SalesLearningMemory => Boolean(memory))
    .filter((memory) => types.size === 0 || types.has(memory.type))
    .map((memory) => ({ memory, score: scoreMemory(memory, queryTokens, job) }))
    .filter(({ score }) => score > 2)
    .sort((a, b) => b.score - a.score || b.memory.evidenceCount - a.memory.evidenceCount || b.memory.updatedAt.localeCompare(a.memory.updatedAt))
    .slice(0, Math.max(1, input.limit ?? 8))
    .map(({ memory }) => memory);
  for (const memory of ranked) {
    touchAgentMemory(memory.id);
  }
  return ranked;
}

export function buildSalesLearningPromptContext(input: SalesLearningContextInput): SalesLearningPromptContext {
  const relevantMemories = retrieveRelevantSalesLearningMemories(input).map((memory) => ({
    type: memory.type,
    scope: memory.scope,
    subject: memory.subject,
    hypothesis: memory.hypothesis,
    confidence: memory.confidence,
    evidenceCount: memory.evidenceCount,
    status: memory.status,
    updatedAt: memory.updatedAt,
  }));
  return {
    relevantMemories,
    guidance: [
      "Use sales memories as hypotheses, not hard rules.",
      "Current user instructions override learned preferences unless a hard safety rule is involved.",
      "Hard safety still wins: never final-submit, never bypass browser/security checks, and never claim unverified proof.",
      "Prefer memories with stronger evidence, recent updates, and matching vertical/platform/source.",
    ],
  };
}

export function formatSalesLearningMemoryReply(input: SalesLearningContextInput = {}): string {
  const memories = retrieveRelevantSalesLearningMemories({ ...input, limit: input.limit ?? 6 });
  if (memories.length === 0) {
    return "I do not have enough sales-learning evidence for this context yet.";
  }
  return [
    "Here is what I have learned so far:",
    ...memories.map((memory) => `• ${memory.hypothesis} (${memory.confidence}, evidence ${memory.evidenceCount})`),
  ].join("\n");
}

export function rememberSalesLearning(input: {
  text: string;
  jobId?: string | null;
  channelId?: string | null;
  threadTs?: string | null;
}): SalesLearningMemory {
  const job = getJob(input.jobId);
  const segments = jobSegments(job);
  recordSalesLearningEvent({
    eventType: "operator_correction",
    jobId: input.jobId ?? null,
    channelId: input.channelId,
    threadTs: input.threadTs,
    source: "slack_remember_command",
    payload: { text: input.text },
  });
  return upsertSalesLearningMemory({
    type: "operator_preference",
    scope: input.jobId ? segments.scope : "global",
    subject: input.jobId ? `${segments.scope}:operator` : "operator preference",
    hypothesis: compact(input.text, 320),
    rationale: "Steve explicitly asked me to remember this.",
    confidence: "medium",
    evidenceCount: 1,
    status: "active",
    source: "slack_remember_command",
    jobId: input.jobId ?? null,
    channelId: input.channelId,
    threadTs: input.threadTs,
    examples: [input.text],
  });
}

export function recordCodeImprovementTask(input: {
  task: string;
  why: string;
  jobId?: string | null;
  channelId?: string | null;
  threadTs?: string | null;
  source?: string;
}): SalesLearningMemory {
  const job = getJob(input.jobId);
  const segments = jobSegments(job);
  recordSalesLearningEvent({
    eventType: "failure_reflection",
    jobId: input.jobId ?? null,
    channelId: input.channelId,
    threadTs: input.threadTs,
    source: input.source ?? "failure_reflection",
    payload: { proposedTask: input.task, why: input.why },
  });
  return upsertSalesLearningMemory({
    type: "code_improvement_task",
    scope: input.jobId ? segments.scope : "global",
    subject: "Mayor/Codex proposed improvement",
    hypothesis: compact(input.task, 360),
    rationale: compact(input.why, 300),
    confidence: "medium",
    evidenceCount: 1,
    status: "tentative",
    source: input.source ?? "failure_reflection",
    jobId: input.jobId ?? null,
    channelId: input.channelId,
    threadTs: input.threadTs,
    examples: [input.task],
  });
}

export function forgetSalesLearning(input: { query?: string; id?: number; type?: SalesLearningMemoryType }): number {
  return forgetSalesLearningMemory(input);
}
