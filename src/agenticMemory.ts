import {
  getAgentMemory,
  getMemoryEmbedding,
  listAllVisibleAgentMemories,
  listMemoryEmbeddingsByOwner,
  listMemoryLinksForMemory,
  recordMemoryEmbedding,
  setAgentMemoryEmbedding,
  updateAgentMemoryContent,
  updateAgentMemoryState,
  upsertAgentMemory,
  upsertMemoryLink,
  upsertMemoryRelation,
  upsertMemoryThreadSummary,
  type AgentMemory,
  type AgentMemoryConfidence,
  type AgentMemoryStatus,
  type MemoryLink,
  type MemoryRelation,
  type MemoryThreadSummary,
  type UpsertAgentMemoryInput,
} from "./db";
import type { LlmJsonRequest, LlmJsonResult } from "./llm/provider";

export type AgenticMemoryUpdateOperation = "ADD" | "UPDATE" | "DELETE" | "NOOP";
export type MemoryLinkRelationship =
  | "related_to"
  | "supports"
  | "refines"
  | "contradicts"
  | "supersedes"
  | "caused_by"
  | "evidence_for";

export interface AgenticMemoryLlmProvider {
  isAvailable(): boolean;
  completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>>;
}

export interface AgenticMemoryEmbeddingProvider {
  isAvailable(): boolean;
  embed(input: { text: string }): Promise<{ provider: string; model: string; vector: number[] }>;
}

export interface AgenticMemoryNoteInput {
  rawContent: string;
  eventSummary?: string;
  memoryType: string;
  scope?: string;
  sourceType?: string;
  sourceId?: string | null;
  jobId?: string | null;
  applicationId?: string | null;
  threadTs?: string | null;
  actor?: string;
  confidence?: AgentMemoryConfidence;
  importance?: number;
  evidenceCount?: number;
  sourceEventIds?: number[];
  context?: string;
  keywords?: string[];
  tags?: string[];
  createdAt?: string;
}

export interface AgenticMemoryNote {
  rawContent: string;
  eventSummary: string;
  context: string;
  keywords: string[];
  tags: string[];
  memoryType: string;
  scope: string;
  sourceType: string;
  sourceId: string | null;
  jobId: string | null;
  applicationId: string | null;
  threadTs: string | null;
  actor: string;
  confidence: AgentMemoryConfidence;
  importance: number;
  evidenceCount: number;
  sourceEventIds: number[];
  createdAt: string;
}

export interface AgenticMemoryUpdateDecision {
  operation: AgenticMemoryUpdateOperation;
  reason: string;
  targetMemoryId?: number;
  updatedSummary?: string;
  updatedKeywords?: string[];
  archiveStatus?: AgentMemoryStatus;
}

export interface PersistedAgenticMemoryResult {
  operation: AgenticMemoryUpdateOperation;
  memory: AgentMemory | null;
  targetMemory: AgentMemory | null;
  reason: string;
  embeddingId: number | null;
}

export interface AgenticMemoryRetrievalInput {
  query: string;
  memoryTypes?: string[];
  scope?: string;
  vertical?: string;
  platform?: string;
  source?: string;
  proof?: string;
  outcome?: string;
  limit?: number;
  embeddingProvider?: AgenticMemoryEmbeddingProvider;
}

export interface AgenticMemoryRetrievalResult {
  memory: AgentMemory;
  score: number;
  components: {
    vector: number;
    keyword: number;
    recency: number;
    importance: number;
    confidence: number;
    scope: number;
    segment: number;
    outcome: number;
  };
  linkedMemoryIds: number[];
}

export interface AgenticMemoryLinkSuggestion {
  targetMemoryId: number;
  relationshipType: MemoryLinkRelationship;
  strength: number;
  reason: string;
}

export interface AgenticMemoryRelationInput {
  sourceEntity: string;
  relation: string;
  targetEntity: string;
  confidence?: AgentMemoryConfidence;
  sourceMemoryIds?: number[];
  evidenceCount?: number;
  status?: AgentMemoryStatus;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "with",
]);

const SECURITY_BYPASS_VERBS = "(?:bypass|override|ignore|disable|solve|circumvent|evade|get\\s+around|work\\s+around|skip|avoid|pass\\s+through|defeat|clear\\s+automatically)";
const SECURITY_BYPASS_TARGETS = "(?:captcha|cloudflare|security|2fa|two[-\\s]*factor|passkey|login|screen|challenge)";
const VERIFICATION_CLAIM_VERBS = "(?:mark|treat|claim|set|record|label)";
const VERIFICATION_CLAIM_TARGETS = "(?:proof|asset|attachment|portfolio|file|field|fields|screening\\s+answer|cover\\s+letter)";
const UNVERIFIED_CLAIM_QUALIFIERS = "(?:unverified|unchecked|unreviewed|unread|unconfirmed|not\\s+verified|not\\s+checked|not\\s+visible)";
const VERIFIED_CLAIM_STATES = "(?:verified|attached|selected|filled|complete|ready|approved)";
const VERIFICATION_REQUIRED_ACTIONS = "(?:verification|verified|checking|checked|readback|review|confirming|confirmed|visible|inspection)";

const SAFETY_BANNED_PATTERNS = [
  /\b(final\s*submit|submit\s+proposal|send\s+proposal|send\s+for\s+\d+\s+connects)\b/i,
  /\b(click|press|tap)\b.{0,40}\b(submit|send)\b/i,
  /\bsubmit\b.{0,40}\bautomatically\b/i,
  /\bsend\b.{0,40}\b(automatically|after\b.{0,20}\bfields?|button)\b/i,
  new RegExp(`\\b${SECURITY_BYPASS_VERBS}\\b.{0,80}\\b${SECURITY_BYPASS_TARGETS}\\b`, "i"),
  new RegExp(`\\b${SECURITY_BYPASS_TARGETS}\\b.{0,80}\\b${SECURITY_BYPASS_VERBS}\\b`, "i"),
  new RegExp(`\\b${VERIFICATION_CLAIM_VERBS}\\b.{0,60}\\b${UNVERIFIED_CLAIM_QUALIFIERS}\\b.{0,60}\\b${VERIFICATION_CLAIM_TARGETS}\\b.{0,60}\\b${VERIFIED_CLAIM_STATES}\\b`, "i"),
  new RegExp(`\\b${VERIFICATION_CLAIM_VERBS}\\b.{0,60}\\b${VERIFICATION_CLAIM_TARGETS}\\b.{0,60}\\b${VERIFIED_CLAIM_STATES}\\b.{0,60}\\b(?:without|before)\\b.{0,60}\\b${VERIFICATION_REQUIRED_ACTIONS}\\b`, "i"),
  new RegExp(`\\b${VERIFIED_CLAIM_STATES}\\b.{0,60}\\b${VERIFICATION_CLAIM_TARGETS}\\b.{0,60}\\b(?:without|before)\\b.{0,60}\\b${VERIFICATION_REQUIRED_ACTIONS}\\b`, "i"),
  /\bclaim\s+.*\b(verified|attached|selected|filled)\b.*\bwithout\b/i,
  /\b(arbitrary|run)\s+shell\b/i,
];

function isSafeCopywritingSecurityMention(text: string): boolean {
  return /\b(?:avoid|skip|remove|omit)\b.{0,40}\b(?:mentioning|saying|referencing|talking about)\b.{0,80}\b(?:captcha|cloudflare|security|2fa|two[-\s]*factor|passkey|login)\b.{0,80}\b(?:proposal|draft|copy|cover letter)\b/i.test(text)
    || /\b(?:proposal|draft|copy|cover letter)\b.{0,80}\b(?:avoid|skip|remove|omit)\b.{0,40}\b(?:mentioning|saying|referencing|talking about)\b.{0,80}\b(?:captcha|cloudflare|security|2fa|two[-\s]*factor|passkey|login)\b/i.test(text);
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: string | null | undefined, max = 320): string {
  const cleaned = clean(value);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeConfidence(value: unknown): AgentMemoryConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function confidenceScore(value: AgentMemoryConfidence): number {
  if (value === "high") return 1;
  if (value === "medium") return 0.66;
  return 0.33;
}

function confidenceRank(value: AgentMemoryConfidence): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function strongerConfidence(left: AgentMemoryConfidence, right: AgentMemoryConfidence): AgentMemoryConfidence {
  return confidenceRank(left) >= confidenceRank(right) ? left : right;
}

function tokenize(value: string): string[] {
  return clean(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function unique(values: string[], limit = 40): string[] {
  return Array.from(new Set(values.map(clean).filter(Boolean))).slice(0, limit);
}

function inferKeywords(value: string, extra: string[] = []): string[] {
  const counts = new Map<string, number>();
  for (const token of [...tokenize(value), ...extra.flatMap(tokenize)]) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([token]) => token)
    .slice(0, 24);
}

function inferTags(input: AgenticMemoryNoteInput, text: string): string[] {
  const lower = text.toLowerCase();
  const tags = [input.memoryType, input.scope ?? "global"];
  if (/\bklaviyo\b/.test(lower)) tags.push("klaviyo");
  if (/\bfashion|apparel|boutique\b/.test(lower)) tags.push("fashion");
  if (/\bbeauty|skincare|makeup\b/.test(lower)) tags.push("beauty");
  if (/\bfly boutique\b/.test(lower)) tags.push("fly_boutique");
  if (/\btruly beauty\b/.test(lower)) tags.push("truly_beauty");
  if (/\bboost|connects|top\s*3|top\s*4\b/.test(lower)) tags.push("boost");
  if (/\bproposal|draft|opener|cta\b/.test(lower)) tags.push("proposal");
  if (/\bbrowser|captcha|security|connects not visible|field_preparation_incomplete\b/.test(lower)) tags.push("failure");
  return unique(tags, 18);
}

function defaultContext(input: AgenticMemoryNoteInput): string {
  const raw = clean(input.rawContent);
  const summary = clean(input.eventSummary);
  if (summary && raw && !summary.includes(raw)) return `${summary} ${raw}`;
  return summary || raw;
}

interface RawNoteEnhancement {
  context?: unknown;
  keywords?: unknown;
  tags?: unknown;
  confidence?: unknown;
  importance?: unknown;
}

export async function constructMemoryNote(
  input: AgenticMemoryNoteInput,
  provider?: AgenticMemoryLlmProvider
): Promise<AgenticMemoryNote> {
  const rawContent = compact(input.rawContent, 1600);
  const eventSummary = compact(input.eventSummary ?? rawContent, 600);
  let context = compact(input.context ?? defaultContext(input), 900);
  let keywords = unique([...(input.keywords ?? []), ...inferKeywords(`${eventSummary} ${rawContent}`)]);
  let tags = unique([...(input.tags ?? []), ...inferTags(input, `${eventSummary} ${rawContent}`)]);
  let confidence = input.confidence ?? "low";
  let importance = clamp(input.importance ?? 3, 1, 5);

  if (provider?.isAvailable()) {
    const result = await provider.completeJson<RawNoteEnhancement>({
      temperature: 0.2,
      maxTokens: 700,
      messages: [
        {
          role: "system",
          content:
            "Create an enriched atomic memory note for a sales agent. Return JSON with context, keywords, tags, confidence, and importance. Do not create safety-breaking instructions.",
        },
        {
          role: "user",
          content: JSON.stringify({
            rawContent,
            eventSummary,
            memoryType: input.memoryType,
            scope: input.scope ?? "global",
            existingContext: context,
          }),
        },
      ],
    });
    if (result.ok && result.data) {
      context = compact(typeof result.data.context === "string" ? result.data.context : context, 900);
      if (Array.isArray(result.data.keywords)) {
        keywords = unique([...keywords, ...result.data.keywords.filter((item): item is string => typeof item === "string")]);
      }
      if (Array.isArray(result.data.tags)) {
        tags = unique([...tags, ...result.data.tags.filter((item): item is string => typeof item === "string")]);
      }
      confidence = normalizeConfidence(result.data.confidence ?? confidence);
      if (typeof result.data.importance === "number") importance = clamp(result.data.importance, 1, 5);
    }
  }

  return {
    rawContent,
    eventSummary,
    context,
    keywords,
    tags,
    memoryType: clean(input.memoryType) || "agentic_memory",
    scope: clean(input.scope) || "global",
    sourceType: clean(input.sourceType) || "system",
    sourceId: input.sourceId ?? null,
    jobId: input.jobId ?? null,
    applicationId: input.applicationId ?? input.jobId ?? null,
    threadTs: input.threadTs ?? null,
    actor: clean(input.actor) || "agent",
    confidence,
    importance,
    evidenceCount: Math.max(1, Math.floor(input.evidenceCount ?? 1)),
    sourceEventIds: Array.from(new Set(input.sourceEventIds ?? [])).filter((id) => Number.isFinite(id)).slice(0, 50),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function memoryNoteToUpsertInput(note: AgenticMemoryNote): UpsertAgentMemoryInput {
  return {
    memoryType: note.memoryType,
    scope: note.scope,
    title: compact(note.eventSummary, 120),
    summary: compact(note.context, 700),
    ruleText: note.memoryType === "operator_preference" ? note.context : null,
    hypothesisText: note.memoryType === "operator_preference" ? null : note.context,
    confidence: note.confidence,
    importance: note.importance,
    evidenceCount: note.evidenceCount,
    status: note.evidenceCount > 1 || note.confidence === "high" ? "active" : "tentative",
    sourceEventIds: note.sourceEventIds,
    keywords: unique([...note.keywords, ...note.tags]),
  };
}

export function deterministicEmbedding(text: string, dimensions = 64): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    let hash = 2166136261;
    for (const char of token) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    const index = Math.abs(hash) % dimensions;
    vector[index] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || !right.length || left.length !== right.length) return 0;
  const length = left.length;
  let dot = 0;
  let leftMag = 0;
  let rightMag = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftMag += left[index] * left[index];
    rightMag += right[index] * right[index];
  }
  if (!leftMag || !rightMag) return 0;
  return dot / (Math.sqrt(leftMag) * Math.sqrt(rightMag));
}

function parseVector(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
  } catch {
    return [];
  }
}

async function embedText(text: string, provider?: AgenticMemoryEmbeddingProvider): Promise<{
  provider: string;
  model: string;
  vector: number[];
}> {
  if (provider?.isAvailable()) {
    const embedded = await provider.embed({ text });
    if (embedded.vector.length) return embedded;
  }
  return {
    provider: "deterministic",
    model: "hash-bow-64",
    vector: deterministicEmbedding(text),
  };
}

export async function persistMemoryEmbedding(
  memory: AgentMemory,
  provider?: AgenticMemoryEmbeddingProvider
): Promise<{ memory: AgentMemory; embeddingId: number }> {
  const text = `${memory.title}\n${memory.summary}\n${memory.keywords.join(" ")}`;
  const embedded = await embedText(text, provider);
  const row = recordMemoryEmbedding({
    ownerType: "agent_memory",
    ownerId: memory.id,
    provider: embedded.provider,
    model: embedded.model,
    vectorJsonOrBlob: JSON.stringify(embedded.vector),
  });
  const updated = setAgentMemoryEmbedding({ memoryId: memory.id, embeddingId: row.id }) ?? memory;
  return { memory: updated, embeddingId: row.id };
}

function similarityByKeywords(queryTokens: string[], memory: AgentMemory): number {
  const memoryTokens = new Set([...memory.keywords, ...tokenize(`${memory.title} ${memory.summary}`)]);
  if (!queryTokens.length || !memoryTokens.size) return 0;
  const overlap = queryTokens.filter((token) => memoryTokens.has(token)).length;
  return overlap / Math.max(1, Math.min(queryTokens.length, memoryTokens.size));
}

function daysSince(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 30;
  return Math.max(0, (Date.now() - timestamp) / 86_400_000);
}

function memoryVector(memory: AgentMemory): number[] {
  const explicit = memory.embeddingId ? parseVector(getMemoryEmbedding(memory.embeddingId)?.vectorJsonOrBlob) : [];
  if (explicit.length) return explicit;
  const ownerEmbedding = listMemoryEmbeddingsByOwner("agent_memory", memory.id)[0];
  return parseVector(ownerEmbedding?.vectorJsonOrBlob);
}

function segmentScore(memory: AgentMemory, input: AgenticMemoryRetrievalInput): number {
  const haystack = `${memory.scope} ${memory.title} ${memory.summary} ${memory.keywords.join(" ")}`.toLowerCase();
  const segments = [input.vertical, input.platform, input.source, input.proof].map((value) => clean(value).toLowerCase()).filter(Boolean);
  if (!segments.length) return 0;
  return segments.filter((segment) => haystack.includes(segment)).length / segments.length;
}

function normalizedScope(value: string | null | undefined): string {
  return clean(value).toLowerCase();
}

function hasParentChildScope(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left.startsWith(`${right}:`) || right.startsWith(`${left}:`);
}

function scopesCompatible(memoryScopeValue: string, queryScopeValue: string | null | undefined): boolean {
  const memoryScope = normalizedScope(memoryScopeValue);
  const queryScope = normalizedScope(queryScopeValue);
  if (!queryScope) return true;
  if (memoryScope === queryScope || memoryScope === "global" || queryScope === "global") return true;
  return hasParentChildScope(memoryScope, queryScope);
}

function scopesMutationCompatible(memoryScopeValue: string, candidateScopeValue: string | null | undefined): boolean {
  const memoryScope = normalizedScope(memoryScopeValue);
  const candidateScope = normalizedScope(candidateScopeValue);
  if (!candidateScope || candidateScope === "global") return memoryScope === "global";
  if (memoryScope === candidateScope || memoryScope === "global") return true;
  return candidateScope.startsWith(`${memoryScope}:`);
}

function scopeRelevance(memoryScopeValue: string, queryScopeValue: string | null | undefined): number {
  const memoryScope = normalizedScope(memoryScopeValue);
  const queryScope = normalizedScope(queryScopeValue);
  if (!queryScope) return 0;
  if (memoryScope === queryScope) return 1;
  if (memoryScope === "global") return 0.5;
  if (queryScope === "global") return 0.35;
  if (hasParentChildScope(memoryScope, queryScope)) return 0.75;
  return 0;
}

function hasMutableMemoryStatus(memory: AgentMemory): boolean {
  return (memory.status === "active" || memory.status === "tentative") && memory.contradictedByMemoryId === null;
}

export async function retrieveAgenticMemories(input: AgenticMemoryRetrievalInput): Promise<AgenticMemoryRetrievalResult[]> {
  const limit = Math.max(1, input.limit ?? 8);
  const query = clean(input.query);
  const queryTokens = tokenize([
    query,
    input.scope,
    input.vertical,
    input.platform,
    input.source,
    input.proof,
    input.outcome,
  ].filter(Boolean).join(" "));
  const queryEmbedding = (await embedText(query, input.embeddingProvider)).vector;
  const allowedTypes = new Set(input.memoryTypes ?? []);
  const memories = listAllVisibleAgentMemories()
    .filter((memory) => !allowedTypes.size || allowedTypes.has(memory.memoryType))
    .filter((memory) => scopesCompatible(memory.scope, input.scope));

  return memories
    .map((memory): AgenticMemoryRetrievalResult => {
      const vector = memoryVector(memory);
      const vectorScore = vector.length ? Math.max(0, cosineSimilarity(queryEmbedding, vector)) : 0;
      const keyword = similarityByKeywords(queryTokens, memory);
      const recency = 1 / (1 + daysSince(memory.updatedAt) / 30);
      const importance = memory.importance / 5;
      const confidence = confidenceScore(memory.confidence);
      const scope = scopeRelevance(memory.scope, input.scope);
      const segment = segmentScore(memory, input);
      const outcome = input.outcome && `${memory.title} ${memory.summary}`.toLowerCase().includes(input.outcome.toLowerCase()) ? 1 : 0;
      const linkedMemoryIds = listMemoryLinksForMemory(memory.id, 8)
        .map((link) => link.sourceMemoryId === memory.id ? link.targetMemoryId : link.sourceMemoryId);
      const score =
        vectorScore * 0.32 +
        keyword * 0.24 +
        recency * 0.09 +
        importance * 0.1 +
        confidence * 0.08 +
        scope * 0.07 +
        segment * 0.08 +
        outcome * 0.02;
      return {
        memory,
        score,
        components: { vector: vectorScore, keyword, recency, importance, confidence, scope, segment, outcome },
        linkedMemoryIds,
      };
    })
    .filter((result) => result.score > 0.05)
    .sort((left, right) => right.score - left.score || right.memory.importance - left.memory.importance)
    .slice(0, limit);
}

function normalizedMemoryText(value: string): string {
  return tokenize(value).sort().join(" ");
}

function hasContradictionLanguage(value: string): boolean {
  return /\b(no longer|not true|wrong|contradicts|replace|stop using|do not use|don't use)\b/i.test(value);
}

function hasArchiveReplacementLanguage(value: string): boolean {
  return /\b(no longer|not true|wrong|contradicts|replace|stop using|do not use|don't use)\b/i.test(value);
}

function keywordOverlap(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  if (!left.length || !rightSet.size) return 0;
  return left.filter((item) => rightSet.has(item)).length / Math.max(1, Math.min(left.length, rightSet.size));
}

interface RawUpdateDecision {
  operation?: unknown;
  reason?: unknown;
  targetMemoryId?: unknown;
  updatedSummary?: unknown;
  updatedKeywords?: unknown;
  archiveStatus?: unknown;
}

export async function decideMemoryUpdate(
  candidate: AgenticMemoryNote,
  similarMemories: AgentMemory[],
  provider?: AgenticMemoryLlmProvider
): Promise<AgenticMemoryUpdateDecision> {
  const compatibleMemories = similarMemories.filter((memory) => (
    memory.memoryType === candidate.memoryType &&
    scopesMutationCompatible(memory.scope, candidate.scope) &&
    hasMutableMemoryStatus(memory)
  ));
  const candidateMemoryIds = new Set(compatibleMemories.map((memory) => memory.id));
  if (provider?.isAvailable()) {
    const result = await provider.completeJson<RawUpdateDecision>({
      temperature: 0.1,
      maxTokens: 700,
      messages: [
        {
          role: "system",
          content:
            "Choose a Mem0-style memory operation for a new memory candidate. Valid operations: ADD, UPDATE, DELETE, NOOP. Return JSON only. Do not create safety-breaking instructions.",
        },
        {
          role: "user",
          content: JSON.stringify({
            candidate,
            similarMemories: compatibleMemories.map((memory) => ({
              id: memory.id,
              type: memory.memoryType,
              scope: memory.scope,
              title: memory.title,
              summary: memory.summary,
              confidence: memory.confidence,
              evidenceCount: memory.evidenceCount,
            })),
          }),
        },
      ],
    });
    if (result.ok && result.data) {
      const rawOperation = typeof result.data.operation === "string" ? result.data.operation.toUpperCase() : "";
      const operation: AgenticMemoryUpdateOperation = rawOperation === "UPDATE" || rawOperation === "DELETE" || rawOperation === "NOOP" ? rawOperation : "ADD";
      const rawTargetMemoryId = typeof result.data.targetMemoryId === "number" ? result.data.targetMemoryId : undefined;
      const targetMemoryId = rawTargetMemoryId !== undefined && candidateMemoryIds.has(rawTargetMemoryId) ? rawTargetMemoryId : undefined;
      if ((operation === "UPDATE" || operation === "DELETE" || operation === "NOOP") && rawTargetMemoryId !== undefined && targetMemoryId === undefined) {
        return {
          operation: "ADD",
          reason: "LLM targetMemoryId was outside retrieved candidates; preserving isolation by adding a new memory.",
        };
      }
      if ((operation === "UPDATE" || operation === "DELETE") && targetMemoryId === undefined) {
        return {
          operation: "ADD",
          reason: "LLM selected a target-dependent operation without a retrieved target; adding a new memory instead.",
        };
      }
      return {
        operation,
        reason: typeof result.data.reason === "string" ? result.data.reason : "LLM selected memory update operation.",
        targetMemoryId,
        updatedSummary: typeof result.data.updatedSummary === "string" ? result.data.updatedSummary : undefined,
        updatedKeywords: Array.isArray(result.data.updatedKeywords)
          ? result.data.updatedKeywords.filter((item): item is string => typeof item === "string")
          : undefined,
        archiveStatus: result.data.archiveStatus === "forgotten" || result.data.archiveStatus === "archived" ? result.data.archiveStatus : undefined,
      };
    }
  }

  const candidateText = `${candidate.eventSummary} ${candidate.context}`;
  const exact = compatibleMemories.find((memory) => normalizedMemoryText(`${memory.title} ${memory.summary}`) === normalizedMemoryText(candidateText));
  if (exact) {
    return { operation: "NOOP", targetMemoryId: exact.id, reason: "Candidate duplicates an existing memory." };
  }

  const best = similarMemories
    .filter((memory) => candidateMemoryIds.has(memory.id))
    .map((memory) => ({
      memory,
      overlap: keywordOverlap(candidate.keywords, memory.keywords),
    }))
    .sort((left, right) => right.overlap - left.overlap)[0];

  if (best && best.overlap >= 0.45 && hasArchiveReplacementLanguage(candidateText)) {
    return {
      operation: "DELETE",
      targetMemoryId: best.memory.id,
      reason: "Candidate contradicts or replaces an existing memory.",
      archiveStatus: "archived",
    };
  }

  if (best && best.overlap >= 0.45) {
    return {
      operation: "UPDATE",
      targetMemoryId: best.memory.id,
      reason: "Candidate enriches a related memory with new evidence.",
      updatedSummary: compact(`${best.memory.summary} ${candidate.context}`, 900),
      updatedKeywords: unique([...best.memory.keywords, ...candidate.keywords, ...candidate.tags]),
    };
  }

  return { operation: "ADD", reason: "Candidate is a new useful memory." };
}

export async function applyMemoryUpdateDecision(
  candidate: AgenticMemoryNote,
  decision: AgenticMemoryUpdateDecision,
  embeddingProvider?: AgenticMemoryEmbeddingProvider
): Promise<PersistedAgenticMemoryResult> {
  const targetMemory = decision.targetMemoryId ? getAgentMemory(decision.targetMemoryId) : null;
  const decisionSafetyText = [
    decision.reason,
    decision.updatedSummary,
    ...(decision.updatedKeywords ?? []),
  ].map(clean).filter(Boolean).join(" ");
  if (decisionSafetyText && !isHardSafetyMemoryAllowed(decisionSafetyText)) {
    return {
      operation: "NOOP",
      memory: targetMemory,
      targetMemory,
      reason: "Rejected unsafe LLM update fields before persistence.",
      embeddingId: targetMemory?.embeddingId ?? null,
    };
  }
  if (decision.operation === "NOOP") {
    return { operation: "NOOP", memory: targetMemory, targetMemory, reason: decision.reason, embeddingId: targetMemory?.embeddingId ?? null };
  }

  if ((decision.operation === "UPDATE" || decision.operation === "DELETE") && targetMemory && !hasMutableMemoryStatus(targetMemory)) {
    const memory = upsertAgentMemory(memoryNoteToUpsertInput(candidate));
    const embedded = await persistMemoryEmbedding(memory, embeddingProvider);
    return { operation: "ADD", memory: embedded.memory, targetMemory, reason: "Target memory is inactive; added a new memory instead of reviving it.", embeddingId: embedded.embeddingId };
  }

  if (decision.operation === "DELETE") {
    const newMemory = upsertAgentMemory({
      ...memoryNoteToUpsertInput(candidate),
      status: "active",
      supersedesMemoryId: targetMemory?.id ?? undefined,
    });
    const embedded = await persistMemoryEmbedding(newMemory, embeddingProvider);
    const updatedTarget = targetMemory
      ? updateAgentMemoryState({ id: targetMemory.id, status: decision.archiveStatus ?? "archived", contradictedByMemoryId: embedded.memory.id })
      : null;
    if (updatedTarget) {
      upsertMemoryLink({
        sourceMemoryId: embedded.memory.id,
        targetMemoryId: updatedTarget.id,
        relationshipType: "contradicts",
        strength: 0.95,
        reason: decision.reason,
      });
    }
    return { operation: "DELETE", memory: embedded.memory, targetMemory: updatedTarget, reason: decision.reason, embeddingId: embedded.embeddingId };
  }

  if (decision.operation === "UPDATE" && targetMemory) {
    const nextEvidenceCount = targetMemory.evidenceCount + candidate.evidenceCount;
    const updated = updateAgentMemoryContent({
      id: targetMemory.id,
      summary: decision.updatedSummary ?? compact(`${targetMemory.summary} ${candidate.context}`, 900),
      hypothesisText: decision.updatedSummary ?? compact(`${targetMemory.hypothesisText ?? targetMemory.summary} ${candidate.context}`, 900),
      confidence: strongerConfidence(targetMemory.confidence, candidate.confidence),
      importance: Math.max(targetMemory.importance, candidate.importance),
      evidenceCountIncrement: candidate.evidenceCount,
      status: targetMemory.status === "active" || nextEvidenceCount >= 2 || candidate.confidence === "high" ? "active" : "tentative",
      sourceEventIds: uniqueNumberIds([...targetMemory.sourceEventIds, ...candidate.sourceEventIds]),
      keywords: unique([...(decision.updatedKeywords ?? []), ...targetMemory.keywords, ...candidate.keywords, ...candidate.tags]),
    }) ?? targetMemory;
    const embedded = await persistMemoryEmbedding(updated, embeddingProvider);
    return { operation: "UPDATE", memory: embedded.memory, targetMemory, reason: decision.reason, embeddingId: embedded.embeddingId };
  }

  const memory = upsertAgentMemory(memoryNoteToUpsertInput(candidate));
  const embedded = await persistMemoryEmbedding(memory, embeddingProvider);
  return { operation: "ADD", memory: embedded.memory, targetMemory: null, reason: decision.reason, embeddingId: embedded.embeddingId };
}

function uniqueNumberIds(values: number[]): number[] {
  return Array.from(new Set(values.filter((id) => Number.isFinite(id)))).slice(0, 50);
}

export async function createOrUpdateAgenticMemory(input: {
  note: AgenticMemoryNoteInput;
  llmProvider?: AgenticMemoryLlmProvider;
  embeddingProvider?: AgenticMemoryEmbeddingProvider;
  similarLimit?: number;
}): Promise<PersistedAgenticMemoryResult> {
  const rawSafetyText = [
    input.note.rawContent,
    input.note.eventSummary,
    input.note.context,
    ...(input.note.keywords ?? []),
    ...(input.note.tags ?? []),
  ].map(clean).filter(Boolean).join(" ");
  if (!isHardSafetyMemoryAllowed(rawSafetyText)) {
    return {
      operation: "NOOP",
      memory: null,
      targetMemory: null,
      reason: "Rejected unsafe memory before persistence.",
      embeddingId: null,
    };
  }
  const note = await constructMemoryNote(input.note, input.llmProvider);
  const constructedSafetyText = [
    note.rawContent,
    note.eventSummary,
    note.context,
    ...note.keywords,
    ...note.tags,
  ].map(clean).filter(Boolean).join(" ");
  if (!isHardSafetyMemoryAllowed(constructedSafetyText)) {
    return {
      operation: "NOOP",
      memory: null,
      targetMemory: null,
      reason: "Rejected unsafe memory before persistence.",
      embeddingId: null,
    };
  }
  const similar = (await retrieveAgenticMemories({
    query: `${note.eventSummary} ${note.context} ${note.keywords.join(" ")}`,
    memoryTypes: [note.memoryType],
    scope: note.scope,
    limit: input.similarLimit ?? 5,
    embeddingProvider: input.embeddingProvider,
  })).map((result) => result.memory);
  const decision = await decideMemoryUpdate(note, similar, input.llmProvider);
  const result = await applyMemoryUpdateDecision(note, decision, input.embeddingProvider);
  if (result.memory && result.operation !== "NOOP") {
    const relatedCandidates = similar.filter((memory) =>
      memory.id !== result.memory?.id &&
      memory.id !== result.targetMemory?.id &&
      hasMutableMemoryStatus(memory)
    );
    await generateMemoryLinks(result.memory, relatedCandidates, input.llmProvider);
    evolveLinkedMemories(result.memory, relatedCandidates);
    upsertMemoryRelationsFromMemory(result.memory);
  }
  return result;
}

interface RawLinkSuggestion {
  targetMemoryId?: unknown;
  relationshipType?: unknown;
  strength?: unknown;
  reason?: unknown;
}

function normalizeRelationshipType(value: unknown): MemoryLinkRelationship {
  const raw = typeof value === "string" ? value.replace(/\s+/g, "_").toLowerCase() : "";
  if (raw === "supports" || raw === "refines" || raw === "contradicts" || raw === "supersedes" || raw === "caused_by" || raw === "evidence_for") return raw;
  return "related_to";
}

export async function generateMemoryLinks(
  memory: AgentMemory,
  relatedMemories: AgentMemory[],
  provider?: AgenticMemoryLlmProvider
): Promise<MemoryLink[]> {
  const linkCandidates = relatedMemories.filter((item) => item.id !== memory.id && hasMutableMemoryStatus(item));
  if (!linkCandidates.length) return [];
  const suggestions: AgenticMemoryLinkSuggestion[] = [];
  if (provider?.isAvailable()) {
    const result = await provider.completeJson<{ links?: RawLinkSuggestion[] }>({
      temperature: 0.1,
      maxTokens: 600,
      messages: [
        {
          role: "system",
          content:
            "Suggest meaningful links between a new memory and related memories. Return JSON with links: targetMemoryId, relationshipType, strength, reason.",
        },
        {
          role: "user",
          content: JSON.stringify({
            memory: { id: memory.id, type: memory.memoryType, title: memory.title, summary: memory.summary },
            relatedMemories: linkCandidates.map((item) => ({ id: item.id, type: item.memoryType, title: item.title, summary: item.summary })),
          }),
        },
      ],
    });
    if (result.ok && Array.isArray(result.data?.links)) {
      const allowedTargets = new Set(linkCandidates.map((item) => item.id));
      for (const link of result.data.links) {
        if (typeof link.targetMemoryId !== "number") continue;
        if (!allowedTargets.has(link.targetMemoryId)) continue;
        suggestions.push({
          targetMemoryId: link.targetMemoryId,
          relationshipType: normalizeRelationshipType(link.relationshipType),
          strength: typeof link.strength === "number" ? clamp(link.strength, 0, 1) : 0.6,
          reason: typeof link.reason === "string" ? link.reason : "LLM linked related memories.",
        });
      }
    }
  }

  if (!suggestions.length) {
    for (const related of linkCandidates.slice(0, 5)) {
      const overlap = keywordOverlap(memory.keywords, related.keywords);
      if (overlap < 0.2) continue;
      suggestions.push({
        targetMemoryId: related.id,
        relationshipType: hasContradictionLanguage(memory.summary) ? "contradicts" : overlap > 0.55 ? "supports" : "related_to",
        strength: clamp(0.35 + overlap, 0.35, 0.9),
        reason: "Shared keywords and scope connect these memories.",
      });
    }
  }

  return suggestions.map((suggestion) => upsertMemoryLink({
    sourceMemoryId: memory.id,
    targetMemoryId: suggestion.targetMemoryId,
    relationshipType: suggestion.relationshipType,
    strength: suggestion.strength,
    reason: suggestion.reason,
  }));
}

export function evolveLinkedMemories(newMemory: AgentMemory, relatedMemories: AgentMemory[]): AgentMemory[] {
  const evolved: AgentMemory[] = [];
  for (const related of relatedMemories.slice(0, 5)) {
    if (related.id === newMemory.id) continue;
    const current = getAgentMemory(related.id);
    if (!current || !hasMutableMemoryStatus(current)) continue;
    const overlap = keywordOverlap(newMemory.keywords, related.keywords);
    if (overlap < 0.35) continue;
    const updated = updateAgentMemoryContent({
      id: current.id,
      confidence: strongerConfidence(current.confidence, newMemory.confidence),
      importance: Math.max(current.importance, newMemory.importance),
      evidenceCountIncrement: 1,
      status: current.status === "active" || current.evidenceCount >= 1 ? "active" : "tentative",
      keywords: unique([...current.keywords, ...newMemory.keywords]),
    });
    if (updated) evolved.push(updated);
  }
  return evolved;
}

export function upsertThreadSummaryMemory(input: {
  ownerType: string;
  ownerId: string;
  channelId?: string | null;
  threadTs?: string | null;
  jobId?: string | null;
  summary: string;
  recentMessages?: string[];
  sourceEventIds?: number[];
  sourceMemoryIds?: number[];
}): MemoryThreadSummary {
  return upsertMemoryThreadSummary({
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    channelId: input.channelId,
    threadTs: input.threadTs,
    jobId: input.jobId,
    summary: input.summary,
    recentMessages: input.recentMessages,
    sourceEventIds: input.sourceEventIds,
    sourceMemoryIds: input.sourceMemoryIds,
    status: "active",
  });
}

export function upsertMemoryRelationsFromMemory(memory: AgentMemory): MemoryRelation[] {
  const text = `${memory.scope} ${memory.title} ${memory.summary} ${memory.keywords.join(" ")}`.toLowerCase();
  const relations: AgenticMemoryRelationInput[] = [];
  if (text.includes("steve") && /direct|diagnosis|opener/.test(text)) {
    relations.push({
      sourceEntity: "Steve",
      relation: "prefers",
      targetEntity: "direct_diagnosis_openers",
      confidence: memory.confidence,
      sourceMemoryIds: [memory.id],
      evidenceCount: Math.max(1, memory.evidenceCount),
      status: memory.status,
    });
  }
  if (text.includes("fly boutique") && /fashion|klaviyo|apparel/.test(text)) {
    relations.push({
      sourceEntity: "Fly Boutique",
      relation: "supports",
      targetEntity: "fashion_klaviyo",
      confidence: memory.confidence,
      sourceMemoryIds: [memory.id],
      evidenceCount: Math.max(1, memory.evidenceCount),
      status: memory.status,
    });
  }
  if (text.includes("truly beauty") && /beauty|klaviyo|skincare/.test(text)) {
    relations.push({
      sourceEntity: "Truly Beauty",
      relation: "supports",
      targetEntity: "beauty_klaviyo",
      confidence: memory.confidence,
      sourceMemoryIds: [memory.id],
      evidenceCount: Math.max(1, memory.evidenceCount),
      status: memory.status,
    });
  }
  if (/top\s*3|top-3|top\s*three/.test(text) && /boost|connects/.test(text)) {
    relations.push({
      sourceEntity: "top_3_boost",
      relation: "often_sufficient_for",
      targetEntity: memory.scope.includes("klaviyo") ? "high_fit_klaviyo" : "similar_high_fit_jobs",
      confidence: memory.confidence,
      sourceMemoryIds: [memory.id],
      evidenceCount: Math.max(1, memory.evidenceCount),
      status: memory.status,
    });
  }
  if (/saved search|source/.test(text) && /browser check|captcha|challenge|noisy/.test(text)) {
    relations.push({
      sourceEntity: memory.scope || "source",
      relation: "causes",
      targetEntity: "browser_checks",
      confidence: memory.confidence,
      sourceMemoryIds: [memory.id],
      evidenceCount: Math.max(1, memory.evidenceCount),
      status: memory.status,
    });
  }
  return relations.map((relation) => upsertMemoryRelation(relation));
}

export function isHardSafetyMemoryAllowed(text: string): boolean {
  return !SAFETY_BANNED_PATTERNS.some((pattern) => pattern.test(text) && !isSafeCopywritingSecurityMention(text));
}

export async function answerMemoryEvalQuestion(question: string): Promise<{
  answer: string;
  evidenceLevel: "strong" | "tentative" | "not_enough_data";
  memories: AgentMemory[];
}> {
  const retrieved = await retrieveAgenticMemories({ query: question, limit: 5 });
  const strategyStopWords = new Set(["what", "proof", "working", "strategy", "should", "similar", "jobs", "used", "use", "for", "with"]);
  const domainTokens = tokenize(question).filter((token) => !strategyStopWords.has(token));
  const relevant = retrieved.filter((result) => {
    const haystack = `${result.memory.scope} ${result.memory.title} ${result.memory.summary} ${result.memory.keywords.join(" ")}`.toLowerCase();
    const domainMatch = !domainTokens.length || domainTokens.some((token) => haystack.includes(token));
    return domainMatch && result.score >= 0.16;
  });
  const memories = relevant.map((result) => result.memory);
  if (!memories.length) {
    return {
      answer: "I do not have enough memory evidence yet.",
      evidenceLevel: "not_enough_data",
      memories,
    };
  }
  const totalEvidence = memories.reduce((sum, memory) => sum + memory.evidenceCount, 0);
  const hasHighConfidence = memories.some((memory) => memory.confidence === "high" || memory.status === "active");
  const evidenceLevel = totalEvidence >= 4 || (totalEvidence >= 2 && hasHighConfidence) ? "strong" : "tentative";
  const answer = memories
    .slice(0, 3)
    .map((memory) => memory.summary)
    .join(" ");
  return {
    answer: compact(answer, 700),
    evidenceLevel,
    memories,
  };
}
