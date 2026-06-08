import {
  getAgentMemory,
  listAgentMemories,
  recordMemoryConsolidation,
  updateAgentMemoryState,
  upsertAgentMemory,
  type AgentMemory,
  type AgentMemoryConfidence,
  type AgentMemoryStatus,
  type MemoryConsolidation,
  type UpsertAgentMemoryInput,
} from "./db";

type VisibleMemoryStatus = Extract<AgentMemoryStatus, "active" | "tentative">;

export interface MemoryConsolidationGroup {
  memoryType: string;
  scope: string;
  keywords: string[];
  sourceMemoryIds: number[];
  evidenceCount: number;
  confidence: AgentMemoryConfidence;
  status: VisibleMemoryStatus;
  summary: string;
}

export interface ConsolidatedMemoryResult {
  group: MemoryConsolidationGroup;
  strategicMemory?: AgentMemory;
  consolidationRecord?: MemoryConsolidation;
}

export interface ConsolidateRelatedMemoriesInput {
  memories?: AgentMemory[];
  memoryTypes?: string[];
  scopes?: string[];
  keywords?: string[];
  limit?: number;
  persist?: boolean;
  periodStart?: string;
  periodEnd?: string;
  summaryType?: string;
}

export interface DecayedMemoryResult {
  before: AgentMemory;
  after: AgentMemory;
}

export interface DecayStaleMemoriesInput {
  memories?: AgentMemory[];
  now?: Date;
  staleAfterDays?: number;
  maxEvidenceCount?: number;
  maxImportance?: number;
  decayBy?: number;
  persist?: boolean;
}

export type MemoryResolutionRelationship = "supersedes" | "contradicts";

export interface RecordScopedMemoryResolutionInput {
  relationship: MemoryResolutionRelationship;
  newMemory: UpsertAgentMemoryInput;
  olderMemoryIds: number[];
  archiveOlder?: boolean;
}

export interface ScopedMemoryResolutionResult {
  relationship: MemoryResolutionRelationship;
  newMemory: AgentMemory;
  olderMemories: AgentMemory[];
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: string, max = 280): string {
  const cleaned = clean(value);
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => clean(value).toLowerCase()).filter(Boolean)));
}

function hasVisibleStatus(memory: AgentMemory): boolean {
  return memory.status === "active" || memory.status === "tentative";
}

function generatedStrategyTitle(memoryType: string, scope: string): string {
  return `${scope}:${memoryType}:strategy`;
}

function isGeneratedStrategicMemory(memory: AgentMemory): boolean {
  return memory.title === generatedStrategyTitle(memory.memoryType, memory.scope);
}

function confidenceRank(confidence: AgentMemoryConfidence): number {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  return 1;
}

function upgradeConfidence(memories: AgentMemory[], evidenceCount: number): AgentMemoryConfidence {
  const highCount = memories.filter((memory) => memory.confidence === "high").length;
  const mediumOrBetterCount = memories.filter((memory) => confidenceRank(memory.confidence) >= 2).length;
  if (evidenceCount >= 6 || highCount >= 2 || (highCount >= 1 && evidenceCount >= 4)) return "high";
  if (evidenceCount >= 3 || memories.length >= 2 || mediumOrBetterCount >= 1) return "medium";
  return "low";
}

function statusForEvidence(evidenceCount: number): VisibleMemoryStatus {
  return evidenceCount >= 2 ? "active" : "tentative";
}

function tokenize(value: string): string[] {
  return clean(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !["for", "the", "and", "with", "that", "this", "should"].includes(token));
}

function memoryText(memory: AgentMemory): string {
  return [
    memory.memoryType,
    memory.scope,
    memory.title,
    memory.summary,
    memory.ruleText,
    memory.hypothesisText,
    memory.keywords.join(" "),
  ].map((value) => clean(value)).filter(Boolean).join(" ");
}

function memoryMatches(input: {
  memory: AgentMemory;
  memoryTypes: Set<string>;
  scopes: Set<string>;
  keywords: Set<string>;
}): boolean {
  if (!hasVisibleStatus(input.memory)) return false;
  if (isGeneratedStrategicMemory(input.memory)) return false;
  if (input.memoryTypes.size > 0 && !input.memoryTypes.has(input.memory.memoryType)) return false;
  if (input.scopes.size > 0 && !input.scopes.has(input.memory.scope)) return false;
  if (input.keywords.size === 0) return true;
  const textTokens = new Set(tokenize(memoryText(input.memory)));
  return Array.from(input.keywords).some((keyword) => textTokens.has(keyword) || memoryText(input.memory).toLowerCase().includes(keyword));
}

function keywordsForGroup(memories: AgentMemory[], requestedKeywords: string[]): string[] {
  const fromMemories = memories.flatMap((memory) => [
    ...memory.keywords,
    ...tokenize(`${memory.title} ${memory.summary} ${memory.hypothesisText ?? ""}`),
  ]);
  const counts = new Map<string, number>();
  for (const keyword of unique([...requestedKeywords, ...fromMemories])) {
    counts.set(keyword, memories.filter((memory) => memoryText(memory).toLowerCase().includes(keyword)).length);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([keyword]) => keyword)
    .slice(0, 12);
}

function buildStrategicSummary(input: {
  memoryType: string;
  scope: string;
  memories: AgentMemory[];
  evidenceCount: number;
  confidence: AgentMemoryConfidence;
}): string {
  const strongest = [...input.memories].sort((a, b) =>
    confidenceRank(b.confidence) - confidenceRank(a.confidence)
    || b.evidenceCount - a.evidenceCount
    || b.importance - a.importance
  )[0];
  const theme = compact(strongest?.hypothesisText || strongest?.summary || strongest?.title || "Use the strongest repeated signal.");
  const sourceCount = input.memories.length === 1 ? "1 related memory" : `${input.memories.length} related memories`;
  const evidence = input.evidenceCount === 1 ? "1 evidence signal" : `${input.evidenceCount} evidence signals`;
  return `For ${input.scope} ${input.memoryType.replace(/_/g, " ")}, treat this as a ${input.confidence}-confidence strategy: ${theme} Backing: ${sourceCount}, ${evidence}.`;
}

function groupRelatedMemories(input: ConsolidateRelatedMemoriesInput): MemoryConsolidationGroup[] {
  const memoryTypes = new Set(unique(input.memoryTypes ?? []));
  const scopes = new Set((input.scopes ?? []).map(clean).filter(Boolean));
  const requestedKeywords = unique(input.keywords ?? []);
  const keywords = new Set(requestedKeywords);
  const memories = (input.memories ?? listAgentMemories(input.limit ?? 200))
    .filter((memory) => memoryMatches({ memory, memoryTypes, scopes, keywords }));
  const groups = new Map<string, AgentMemory[]>();
  for (const memory of memories) {
    const key = `${memory.memoryType}\u0000${memory.scope}`;
    const group = groups.get(key) ?? [];
    group.push(memory);
    groups.set(key, group);
  }
  return Array.from(groups.values())
    .filter((group) => group.length >= 2)
    .map((group) => {
      const evidenceCount = group.reduce((sum, memory) => sum + memory.evidenceCount, 0);
      const confidence = upgradeConfidence(group, evidenceCount);
      const memoryType = group[0].memoryType;
      const scope = group[0].scope;
      return {
        memoryType,
        scope,
        keywords: keywordsForGroup(group, requestedKeywords),
        sourceMemoryIds: group.map((memory) => memory.id),
        evidenceCount,
        confidence,
        status: statusForEvidence(evidenceCount),
        summary: buildStrategicSummary({ memoryType, scope, memories: group, evidenceCount, confidence }),
      };
    })
    .sort((a, b) => b.evidenceCount - a.evidenceCount || a.memoryType.localeCompare(b.memoryType));
}

export function consolidateRelatedMemories(input: ConsolidateRelatedMemoriesInput = {}): ConsolidatedMemoryResult[] {
  const groups = groupRelatedMemories(input);
  if (input.persist === false) {
    return groups.map((group) => ({ group }));
  }
  const now = new Date().toISOString();
  const periodStart = input.periodStart ?? now;
  const periodEnd = input.periodEnd ?? now;
  return groups.map((group) => {
    const strategicTitle = generatedStrategyTitle(group.memoryType, group.scope);
    const existingStrategicMemory = listAgentMemories(input.limit ?? 500)
      .find((memory) =>
        memory.memoryType === group.memoryType &&
        memory.scope === group.scope &&
        memory.title === strategicTitle &&
        memory.summary === group.summary
      );
    const strategicMemory = existingStrategicMemory ?? upsertAgentMemory({
      memoryType: group.memoryType,
      scope: group.scope,
      title: strategicTitle,
      summary: group.summary,
      hypothesisText: group.summary,
      confidence: group.confidence,
      importance: Math.min(10, 4 + Math.ceil(group.evidenceCount / 2)),
      evidenceCount: group.evidenceCount,
      status: group.status,
      sourceEventIds: [],
      keywords: group.keywords,
    });
    const consolidationRecord = recordMemoryConsolidation({
      periodStart,
      periodEnd,
      summaryType: input.summaryType ?? `strategic_${group.memoryType}`,
      summary: group.summary,
      sourceMemoryIds: group.sourceMemoryIds,
      sourceEventIds: [],
      confidence: group.confidence,
      status: group.status,
    });
    return { group, strategicMemory, consolidationRecord };
  });
}

function memoryAgeDays(memory: AgentMemory, now: Date): number {
  const timestamp = Date.parse(memory.lastUsedAt ?? memory.updatedAt ?? memory.createdAt);
  if (!Number.isFinite(timestamp)) return 0;
  return (now.getTime() - timestamp) / (24 * 60 * 60 * 1000);
}

export function decayStaleLowValueMemories(input: DecayStaleMemoriesInput = {}): DecayedMemoryResult[] {
  const now = input.now ?? new Date();
  const staleAfterDays = input.staleAfterDays ?? 45;
  const maxEvidenceCount = input.maxEvidenceCount ?? 1;
  const maxImportance = input.maxImportance ?? 4;
  const decayBy = input.decayBy ?? 2;
  const memories = input.memories ?? listAgentMemories(500);
  const candidates = memories.filter((memory) =>
    hasVisibleStatus(memory)
    && memory.confidence === "low"
    && memory.evidenceCount <= maxEvidenceCount
    && memory.importance <= maxImportance
    && memoryAgeDays(memory, now) >= staleAfterDays
  );
  return candidates.map((memory) => {
    const after = input.persist === false
      ? {
        ...memory,
        status: "archived" as AgentMemoryStatus,
        importance: Math.max(1, memory.importance - decayBy),
        decayScore: memory.decayScore + decayBy,
      }
      : updateAgentMemoryState({
        id: memory.id,
        status: "archived",
        importance: Math.max(1, memory.importance - decayBy),
        decayScore: memory.decayScore + decayBy,
      });
    if (!after) throw new Error(`Failed to decay agent memory ${memory.id}`);
    return { before: memory, after };
  });
}

export function recordScopedMemoryResolution(input: RecordScopedMemoryResolutionInput): ScopedMemoryResolutionResult {
  if (input.olderMemoryIds.length === 0) {
    throw new Error("At least one older memory id is required for scoped memory resolution.");
  }
  const primaryOlderId = input.olderMemoryIds[0];
  const newMemory = upsertAgentMemory({
    ...input.newMemory,
    supersedesMemoryId: input.relationship === "supersedes" ? primaryOlderId : input.newMemory.supersedesMemoryId,
  });
  const shouldArchiveOlder = input.archiveOlder ?? input.relationship === "supersedes";
  const olderMemories = input.olderMemoryIds.map((id) => {
    const updated = updateAgentMemoryState({
      id,
      status: shouldArchiveOlder ? "archived" : undefined,
      contradictedByMemoryId: input.relationship === "contradicts" ? newMemory.id : undefined,
    }) ?? getAgentMemory(id);
    if (!updated) throw new Error(`Older memory ${id} was not found.`);
    return updated;
  });
  return {
    relationship: input.relationship,
    newMemory,
    olderMemories,
  };
}
