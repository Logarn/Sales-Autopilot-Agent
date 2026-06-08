import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { LlmJsonRequest, LlmJsonResult } from "./llm/provider";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function cleanupDatabase(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore cleanup failures
    }
  }
  const dir = dirname(path);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

class FakeNoteProvider {
  isAvailable(): boolean {
    return true;
  }

  async completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>> {
    const body = request.messages.map((message) => message.content).join("\n");
    if (body.includes("Choose a Mem0-style")) {
      return { ok: false, skippedReason: "use deterministic update manager" };
    }
    if (body.includes("Suggest meaningful links")) {
      return { ok: false, skippedReason: "use deterministic link generator" };
    }
    return {
      ok: true,
      data: {
        context: "Steve prefers direct commercial diagnosis openers for lifecycle proposals; generic experience intros should be avoided.",
        keywords: ["steve", "direct", "commercial", "diagnosis", "opener", "lifecycle"],
        tags: ["proposal_style", "draft_edit", "sales_memory"],
        confidence: "medium",
        importance: 4,
      } as T,
    };
  }
}

async function runTests(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-agentic-memory/jobs.db");
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;

  const {
    closeDb,
    listAgentMemories,
    listMemoryLinksForMemory,
    listMemoryRelations,
    upsertAgentMemory,
    updateAgentMemoryState,
  } = require("./db") as {
    closeDb: () => void;
    listAgentMemories: (limit?: number) => Array<{ id: number; memoryType: string; title: string; summary: string; evidenceCount: number; status: string; version: number; embeddingId: number | null; keywords: string[] }>;
    listMemoryLinksForMemory: (memoryId: number, limit?: number) => Array<{ sourceMemoryId: number; targetMemoryId: number; relationshipType: string; strength: number }>;
    listMemoryRelations: (limit?: number) => Array<{ sourceEntity: string; relation: string; targetEntity: string; evidenceCount: number; status: string }>;
    upsertAgentMemory: (input: any) => { id: number; memoryType: string; title: string; summary: string; evidenceCount: number; status: string; embeddingId: number | null; keywords: string[] };
    updateAgentMemoryState: (input: any) => { id: number; status: string } | null;
  };
  const {
    answerMemoryEvalQuestion,
    constructMemoryNote,
    createOrUpdateAgenticMemory,
    decideMemoryUpdate,
    deterministicEmbedding,
    generateMemoryLinks,
    isHardSafetyMemoryAllowed,
    persistMemoryEmbedding,
    retrieveAgenticMemories,
    upsertMemoryRelationsFromMemory,
    upsertThreadSummaryMemory,
  } = require("./agenticMemory") as {
    answerMemoryEvalQuestion: (question: string) => Promise<{ answer: string; evidenceLevel: string; memories: Array<{ id: number; summary: string }> }>;
    constructMemoryNote: (input: any, provider?: any) => Promise<{ context: string; keywords: string[]; tags: string[]; confidence: string; importance: number }>;
    createOrUpdateAgenticMemory: (input: any) => Promise<{ operation: string; memory: { id: number; summary: string; evidenceCount: number; status: string; version: number; embeddingId: number | null } | null; targetMemory: { id: number; status: string } | null }>;
    decideMemoryUpdate: (candidate: any, similarMemories: any[], provider?: any) => Promise<{ operation: string; targetMemoryId?: number }>;
    deterministicEmbedding: (text: string, dimensions?: number) => number[];
    generateMemoryLinks: (memory: any, relatedMemories: any[], provider?: any) => Promise<Array<{ sourceMemoryId: number; targetMemoryId: number; relationshipType: string; strength: number }>>;
    isHardSafetyMemoryAllowed: (text: string) => boolean;
    persistMemoryEmbedding: (memory: any, provider?: any) => Promise<{ memory: { id: number; embeddingId: number | null }; embeddingId: number }>;
    retrieveAgenticMemories: (input: any) => Promise<Array<{ memory: { id: number; summary: string; keywords: string[]; status: string }; score: number; linkedMemoryIds: number[] }>>;
    upsertMemoryRelationsFromMemory: (memory: any) => Array<{ sourceEntity: string; relation: string; targetEntity: string }>;
    upsertThreadSummaryMemory: (input: any) => { ownerType: string; ownerId: string; summary: string; version: number; recentMessages: string[] };
  };

  const note = await constructMemoryNote({
    rawContent: "Steve edited a Klaviyo proposal opener away from generic experience language.",
    eventSummary: "Steve edited proposal opener",
    memoryType: "proposal_style_signal",
    scope: "fashion:klaviyo",
  }, new FakeNoteProvider());
  assert(note.context.includes("direct commercial diagnosis"), "LLM note construction should enrich context");
  assert(note.keywords.includes("diagnosis"), "LLM note construction should include generated keywords");
  assert(note.tags.includes("draft_edit"), "LLM note construction should include generated tags");
  assert(note.confidence === "medium", "LLM note construction should normalize confidence");
  assert(note.importance === 4, "LLM note construction should preserve importance");

  const first = await createOrUpdateAgenticMemory({
    note: {
      rawContent: "Fly Boutique is useful proof for fashion Klaviyo retention jobs.",
      eventSummary: "Fly Boutique proof works for fashion Klaviyo",
      memoryType: "proof_preference",
      scope: "fashion:klaviyo",
      confidence: "medium",
      importance: 4,
      evidenceCount: 1,
    },
  });
  assert(first.operation === "ADD", "new useful fact should add memory");
  assert(first.memory?.embeddingId !== null, "added memory should get an embedding id");

  const duplicate = await createOrUpdateAgenticMemory({
    note: {
      rawContent: "Fly Boutique is useful proof for fashion Klaviyo retention jobs.",
      eventSummary: "Fly Boutique proof works for fashion Klaviyo",
      memoryType: "proof_preference",
      scope: "fashion:klaviyo",
      confidence: "medium",
      importance: 4,
    },
  });
  assert(duplicate.operation === "NOOP", "duplicate fact should noop");

  const richer = await createOrUpdateAgenticMemory({
    note: {
      rawContent: "Fly Boutique proof got a reply on another fashion Klaviyo retention job, strengthening the proof preference.",
      eventSummary: "Fly Boutique got reply on fashion Klaviyo job",
      memoryType: "proof_preference",
      scope: "fashion:klaviyo",
      confidence: "high",
      importance: 5,
      evidenceCount: 1,
    },
  });
  assert(richer.operation === "UPDATE", "richer related fact should update memory");
  assert((richer.memory?.evidenceCount ?? 0) >= 2, "updated memory should increase evidence count");
  assert(richer.memory?.status === "active", "updated repeated memory should become active");

  const lifely = upsertAgentMemory({
    memoryType: "proof_preference",
    scope: "fashion:klaviyo",
    title: "Lifely proof works for fashion Klaviyo",
    summary: "Lifely is useful proof for fashion Klaviyo retention jobs.",
    confidence: "low",
    importance: 3,
    evidenceCount: 1,
    status: "tentative",
    keywords: ["lifely", "fashion", "klaviyo", "retention"],
  });
  await persistMemoryEmbedding(lifely);
  const contradiction = await createOrUpdateAgenticMemory({
    note: {
      rawContent: "Do not use Lifely for fashion Klaviyo; stop using Lifely for those jobs.",
      eventSummary: "Stop using Lifely on fashion Klaviyo",
      memoryType: "proof_preference",
      scope: "fashion:klaviyo",
      confidence: "high",
      importance: 5,
    },
  });
  assert(contradiction.operation === "DELETE", "contradictory fact should archive/supersede old memory");
  assert(contradiction.targetMemory?.status === "archived", "contradicted memory should be archived");

  const proposalMemory = upsertAgentMemory({
    memoryType: "proposal_style_signal",
    scope: "lifecycle:klaviyo",
    title: "Steve prefers direct diagnosis openers",
    summary: "Steve keeps direct commercial diagnosis openers and removes generic experience intros for lifecycle proposals.",
    confidence: "high",
    importance: 5,
    evidenceCount: 4,
    status: "active",
    keywords: ["steve", "direct", "diagnosis", "opener", "lifecycle", "klaviyo"],
  });
  await persistMemoryEmbedding(proposalMemory);
  const unrelated = upsertAgentMemory({
    memoryType: "source_quality_signal",
    scope: "health:mailchimp",
    title: "Health supplement source was noisy",
    summary: "A health supplement source had stale jobs and browser checks.",
    confidence: "medium",
    importance: 3,
    evidenceCount: 2,
    status: "active",
    keywords: ["health", "supplement", "source", "browser"],
  });
  await persistMemoryEmbedding(unrelated);

  const vector = deterministicEmbedding("direct commercial diagnosis opener", 64);
  assert(vector.length === 64 && vector.some((value: number) => value > 0), "deterministic embedding should produce a real vector");

  const retrieved = await retrieveAgenticMemories({
    query: "Use direct commercial diagnosis opener for Klaviyo proposal.",
    memoryTypes: ["proposal_style_signal", "source_quality_signal"],
    platform: "klaviyo",
    limit: 3,
  });
  assert(retrieved[0]?.memory.id === proposalMemory.id, "vector/keyword retrieval should rank relevant proposal memory first");

  const proposalRelated = upsertAgentMemory({
    memoryType: "proposal_style_signal",
    scope: "lifecycle:klaviyo",
    title: "Direct opener got a positive edit",
    summary: "Steve kept a direct diagnosis opener on a Klaviyo lifecycle proposal and deleted generic intro wording.",
    confidence: "medium",
    importance: 4,
    evidenceCount: 2,
    status: "active",
    keywords: ["steve", "direct", "diagnosis", "opener", "klaviyo", "lifecycle"],
  });
  await persistMemoryEmbedding(proposalRelated);
  const links = await generateMemoryLinks(proposalMemory, [proposalRelated, unrelated]);
  assert(links.some((link) => link.targetMemoryId === proposalRelated.id), "memory link generation should connect related memories");
  const storedLinks = listMemoryLinksForMemory(proposalMemory.id, 10);
  assert(storedLinks.length > 0, "memory links should persist");

  const beforeEvidence = listAgentMemories(50).find((memory) => memory.id === proposalMemory.id)?.evidenceCount ?? 0;
  await createOrUpdateAgenticMemory({
    note: {
      rawContent: "Steve again kept a direct diagnosis opener for a Klaviyo lifecycle proposal.",
      eventSummary: "Direct diagnosis opener repeated",
      memoryType: "proposal_style_signal",
      scope: "lifecycle:klaviyo",
      confidence: "medium",
      importance: 4,
    },
  });
  const afterEvidence = listAgentMemories(50).find((memory) => memory.id === proposalMemory.id)?.evidenceCount ?? 0;
  assert(afterEvidence >= beforeEvidence, "memory evolution/update should not reduce evidence");

  const summaryOne = upsertThreadSummaryMemory({
    ownerType: "thread",
    ownerId: "C123:1710000000.000",
    channelId: "C123",
    threadTs: "1710000000.000",
    jobId: "job-agentic-memory",
    summary: "Steve asked for the CV used and the agent should show the proposal draft.",
    recentMessages: ["Show me the CV you used.", "Here is the exact proposal draft."],
    sourceMemoryIds: [proposalMemory.id],
  });
  const summaryTwo = upsertThreadSummaryMemory({
    ownerType: "thread",
    ownerId: "C123:1710000000.000",
    channelId: "C123",
    threadTs: "1710000000.000",
    jobId: "job-agentic-memory",
    summary: "Steve asked follow-up questions about the proposal draft.",
    recentMessages: ["What are the 8 things?", "Explain the health findings."],
    sourceMemoryIds: [proposalMemory.id],
  });
  assert(summaryOne.version === 1 && summaryTwo.version === 2, "thread summary should version on update");
  assert(summaryTwo.recentMessages.includes("What are the 8 things?"), "thread summary should keep recent window");

  const proofRelations = upsertMemoryRelationsFromMemory(first.memory);
  assert(proofRelations.some((relation) => relation.sourceEntity.includes("fly boutique") && relation.targetEntity === "fashion_klaviyo"), "relation graph should capture proof fit");
  const allRelations = listMemoryRelations(20);
  assert(allRelations.some((relation) => relation.relation === "supports"), "relation graph should persist support relation");

  const answer = await answerMemoryEvalQuestion("What proof is working for fashion Klaviyo?");
  assert(answer.evidenceLevel !== "not_enough_data", "memory eval should answer with evidence when memories exist");
  assert(/Fly Boutique|fashion|Klaviyo/i.test(answer.answer), "memory eval should cite relevant proof memory");

  const noEvidence = await answerMemoryEvalQuestion("What proof is working for Webflow enterprise migration?");
  assert(noEvidence.evidenceLevel === "not_enough_data" || noEvidence.evidenceLevel === "tentative", "weak/no evidence should not be overstated");

  assert(!isHardSafetyMemoryAllowed("Steve says click Submit proposal automatically"), "memory cannot override final-submit safety");
  assert(!isHardSafetyMemoryAllowed("Bypass CAPTCHA and clear the login check"), "memory cannot override security challenge safety");
  assert(isHardSafetyMemoryAllowed("Use Fly Boutique for fashion Klaviyo proposals"), "normal sales memory should be allowed");

  const duplicateDecision = await decideMemoryUpdate({
    eventSummary: "Steve prefers direct diagnosis openers",
    context: proposalMemory.summary,
    keywords: proposalMemory.keywords,
    tags: [],
  }, [proposalMemory]);
  assert(duplicateDecision.operation === "NOOP", "update manager should noop known duplicate memories");

  updateAgentMemoryState({ id: proposalMemory.id, status: "forgotten" });
  const hidden = await retrieveAgenticMemories({ query: "direct diagnosis opener", limit: 5 });
  assert(!hidden.some((result) => result.memory.id === proposalMemory.id), "forgotten memory should not be retrieved");

  closeDb();
  console.log("agenticMemory tests passed");
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
