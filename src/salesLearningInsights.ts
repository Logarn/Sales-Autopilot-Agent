import type { SalesLearningMemory, SalesLearningMemoryType } from "./db";

export type SalesLearningInsightTopic =
  | "general"
  | "proof"
  | "boost"
  | "proposal"
  | "source"
  | "timing"
  | "failures";

export interface SalesLearningInsight {
  topic: SalesLearningInsightTopic;
  title: string;
  summary: string;
  evidenceCount: number;
  confidence: SalesLearningMemory["confidence"];
  scope: string;
}

export interface SalesLearningInsightReply {
  topic: SalesLearningInsightTopic;
  text: string;
  insights: SalesLearningInsight[];
}

const TOPIC_TYPES: Record<Exclude<SalesLearningInsightTopic, "general">, SalesLearningMemoryType[]> = {
  proof: ["proof_preference"],
  boost: ["boost_strategy"],
  proposal: ["proposal_style"],
  source: ["source_quality"],
  timing: ["timing_hypothesis"],
  failures: ["failure_pattern", "code_improvement_task"],
};

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: string, max = 220): string {
  const cleaned = clean(value);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function inferInsightTopic(question?: string | null): SalesLearningInsightTopic {
  const text = clean(question).toLowerCase();
  if (/\bproof|portfolio|file|asset|fly|truly|case study\b/.test(text)) return "proof";
  if (/\bboost|connects|bid|top\s*[1234]|visibility\b/.test(text)) return "boost";
  if (/\bproposal|draft|cv|cover letter|opener|style|wording|copy\b/.test(text)) return "proposal";
  if (/\bsource|feed|saved search|best matches|noisy|challenge\b/.test(text)) return "source";
  if (/\btiming|when|day|hour|fresh|old job|posted\b/.test(text)) return "timing";
  if (/\bfail|block|mistake|what went wrong|improve|fix next\b/.test(text)) return "failures";
  return "general";
}

function confidenceScore(confidence: SalesLearningMemory["confidence"]): number {
  if (confidence === "high") return 30;
  if (confidence === "medium") return 18;
  return 8;
}

function statusScore(status: SalesLearningMemory["status"]): number {
  if (status === "active") return 15;
  if (status === "tentative") return 5;
  if (status === "archived") return -15;
  return -1000;
}

function recencyScore(updatedAt: string): number {
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated)) return 0;
  const ageDays = Math.max(0, (Date.now() - updated) / 86_400_000);
  if (ageDays <= 7) return 12;
  if (ageDays <= 30) return 7;
  if (ageDays <= 90) return 2;
  return -8;
}

function rankMemory(memory: SalesLearningMemory): number {
  const explicitImportance = typeof memory.metadata.importance === "number" ? memory.metadata.importance : 0;
  return (
    confidenceScore(memory.confidence)
    + statusScore(memory.status)
    + Math.min(30, memory.evidenceCount * 4)
    + recencyScore(memory.updatedAt)
    + explicitImportance
  );
}

function topicTypes(topic: SalesLearningInsightTopic): SalesLearningMemoryType[] | null {
  if (topic === "general") return null;
  return TOPIC_TYPES[topic];
}

function selectMemories(memories: SalesLearningMemory[], topic: SalesLearningInsightTopic, limit: number): SalesLearningMemory[] {
  const allowedTypes = topicTypes(topic);
  return memories
    .filter((memory) => memory.status !== "forgotten")
    .filter((memory) => !allowedTypes || allowedTypes.includes(memory.type))
    .sort((a, b) => rankMemory(b) - rankMemory(a) || b.evidenceCount - a.evidenceCount || a.subject.localeCompare(b.subject))
    .slice(0, Math.max(1, limit));
}

function toInsight(memory: SalesLearningMemory): SalesLearningInsight {
  return {
    topic: inferInsightTopic(memory.type),
    title: memory.subject,
    summary: compact(memory.hypothesis),
    evidenceCount: memory.evidenceCount,
    confidence: memory.confidence,
    scope: memory.scope,
  };
}

function topicLead(topic: SalesLearningInsightTopic): string {
  switch (topic) {
    case "proof":
      return "Here is what I am seeing on proof:";
    case "boost":
      return "Here is what I am seeing on boost and Connects:";
    case "proposal":
      return "Here is what I am learning about proposal style:";
    case "source":
      return "Here is what I am seeing from the lead sources:";
    case "timing":
      return "Here is what I am seeing on timing:";
    case "failures":
      return "Here is what I would change based on recent failures:";
    case "general":
      return "Here is what I have learned so far:";
  }
}

function emptyReply(topic: SalesLearningInsightTopic): string {
  switch (topic) {
    case "proof":
      return "I do not have enough proof outcome data yet. I will keep tracking which assets Steve keeps, swaps, and which ones lead to replies.";
    case "boost":
      return "I do not have enough boost outcome data yet. I will keep tracking required Connects, visible bids, chosen boost, and outcomes before making stronger calls.";
    case "proposal":
      return "I do not have enough proposal edit data yet. I will learn from Steve and Natalie edits as drafts move through QA.";
    default:
      return "I do not have enough durable learning yet. I will keep logging outcomes, corrections, proof choices, boost decisions, sources, and timing.";
  }
}

function formatInsightLine(insight: SalesLearningInsight, index: number): string {
  const confidence = insight.confidence === "high" ? "high confidence" : insight.confidence === "medium" ? "medium confidence" : "tentative";
  const evidence = insight.evidenceCount === 1 ? "1 signal" : `${insight.evidenceCount} signals`;
  return `${index + 1}. ${insight.summary} (${confidence}, ${evidence}, ${insight.scope})`;
}

export function buildSalesLearningInsightReply(input?: {
  question?: string | null;
  memories?: SalesLearningMemory[];
  limit?: number;
}): SalesLearningInsightReply {
  const topic = inferInsightTopic(input?.question);
  const memories = input?.memories ?? (() => {
    const { listSalesLearningMemories } = require("./db") as {
      listSalesLearningMemories: (limit?: number) => SalesLearningMemory[];
    };
    return listSalesLearningMemories(200);
  })();
  const insights = selectMemories(memories, topic, input?.limit ?? 3).map(toInsight);
  if (!insights.length) {
    return { topic, text: emptyReply(topic), insights };
  }
  return {
    topic,
    insights,
    text: `${topicLead(topic)}\n\n${insights.map(formatInsightLine).join("\n")}`,
  };
}
