import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

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

async function runTests(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-sales-learning-retrieval/jobs.db");
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;

  const {
    closeDb,
    forgetSalesLearningMemory,
    upsertAgentMemory,
  } = require("./db") as {
    closeDb: () => void;
    forgetSalesLearningMemory: (input: { query?: string; type?: string }) => number;
    upsertAgentMemory: (input: any) => { id: number; memoryType: string; title: string; summary: string; status: string };
  };
  const {
    buildSalesLearningPromptContext,
    retrieveRelevantSalesLearningMemories,
    retrieveRelevantSalesLearningMemoriesWithDebug,
    scoreSalesLearningMemoryForDebug,
  } = require("./salesLearningMemory") as {
    buildSalesLearningPromptContext: (input: any) => { relevantMemories: any[]; guidance: string[] };
    retrieveRelevantSalesLearningMemories: (input: any) => any[];
    retrieveRelevantSalesLearningMemoriesWithDebug: (input: any) => Array<{ memory: any; score: number; components: any; explanation: string[] }>;
    scoreSalesLearningMemoryForDebug: (memory: any, input: any) => { score: number; components: any; explanation: string[] };
  };

  const job = {
    id: "world-class-fashion-klaviyo",
    title: "Fashion brand needs Klaviyo lifecycle and retention flows",
    description: "Boutique Shopify fashion store needs post-purchase Klaviyo flows, campaigns, retention strategy, and portfolio proof.",
    skills: ["Klaviyo", "Shopify", "Email Marketing", "Retention"],
    sourceQuery: "Saved Search - Klaviyo DTC",
    applicationDraft: {
      jobIntelligence: {
        primaryPlatform: "Klaviyo",
        ecommerceVertical: "fashion",
        businessType: "DTC fashion boutique",
        taskType: "retention lifecycle flows",
        jobCategory: "Email marketing",
        clientGoal: "Improve repeat purchase revenue",
        proposalAngle: "Diagnose post-purchase retention leaks.",
        proofRecommendations: ["Fly Boutique"],
      },
    },
  };
  const input = {
    job,
    text: "Need proposal style, screening answers, Fly Boutique proof, boost/connects, and source judgment for a fashion Klaviyo opportunity.",
    limit: 10,
  };

  const proof = upsertAgentMemory({
    memoryType: "proof_preference",
    scope: "fashion:klaviyo",
    title: "fashion:klaviyo:Fly Boutique proof",
    summary: "For fashion Klaviyo retention jobs, prioritize Fly Boutique proof when the job asks for portfolio evidence.",
    hypothesisText: "For fashion Klaviyo retention jobs, prioritize Fly Boutique proof when the job asks for portfolio evidence.",
    confidence: "medium",
    importance: 6,
    evidenceCount: 2,
    status: "active",
    keywords: ["fashion", "klaviyo", "fly", "boutique", "proof", "retention"],
  });
  const style = upsertAgentMemory({
    memoryType: "proposal_style",
    scope: "fashion:klaviyo",
    title: "fashion:klaviyo:direct opener",
    summary: "Fashion Klaviyo proposals should open with a specific commercial diagnosis about repeat-purchase leakage.",
    hypothesisText: "Fashion Klaviyo proposals should open with a specific commercial diagnosis about repeat-purchase leakage.",
    confidence: "medium",
    importance: 6,
    evidenceCount: 2,
    status: "active",
    keywords: ["fashion", "klaviyo", "proposal", "opener", "retention"],
  });
  const screening = upsertAgentMemory({
    memoryType: "screening_answer",
    scope: "fashion:klaviyo",
    title: "fashion:klaviyo:screening approach answers",
    summary: "For approach-plan screening questions, answer with the first Klaviyo audit step and the revenue leak priority.",
    hypothesisText: "For approach-plan screening questions, answer with the first Klaviyo audit step and the revenue leak priority.",
    confidence: "medium",
    importance: 6,
    evidenceCount: 2,
    status: "active",
    keywords: ["fashion", "klaviyo", "screening", "answer", "question", "approach", "audit"],
  });
  const boost = upsertAgentMemory({
    memoryType: "boost_strategy",
    scope: "fashion:klaviyo",
    title: "fashion:klaviyo:connects boost",
    summary: "For fashion Klaviyo jobs, use enough Connects boost for top-three visibility without overpaying for rank one.",
    hypothesisText: "For fashion Klaviyo jobs, use enough Connects boost for top-three visibility without overpaying for rank one.",
    confidence: "medium",
    importance: 6,
    evidenceCount: 2,
    status: "active",
    keywords: ["fashion", "klaviyo", "connects", "boost"],
  });
  const source = upsertAgentMemory({
    memoryType: "source_quality",
    scope: "source:Saved Search - Klaviyo DTC",
    title: "Saved Search - Klaviyo DTC",
    summary: "Saved Search - Klaviyo DTC produced replies on fashion Klaviyo retention work; keep it active for similar jobs.",
    hypothesisText: "Saved Search - Klaviyo DTC produced replies on fashion Klaviyo retention work; keep it active for similar jobs.",
    confidence: "medium",
    importance: 6,
    evidenceCount: 2,
    status: "active",
    keywords: ["saved", "search", "klaviyo", "dtc", "fashion", "replies"],
  });
  const randomKlaviyo = upsertAgentMemory({
    memoryType: "proof_preference",
    scope: "saas:klaviyo",
    title: "saas:klaviyo:implementation proof",
    summary: "Klaviyo proof for B2B SaaS onboarding should use implementation audit examples.",
    hypothesisText: "Klaviyo proof for B2B SaaS onboarding should use implementation audit examples.",
    confidence: "high",
    importance: 10,
    evidenceCount: 5,
    status: "active",
    keywords: ["klaviyo", "proof", "implementation", "saas"],
  });
  const staleBrowserFailure = upsertAgentMemory({
    memoryType: "failure_pattern",
    scope: "fashion:klaviyo",
    title: "fashion:klaviyo:old browser source failure",
    summary: "Old browser capture source_context_unavailable failure on a fashion Klaviyo page; recovery required source inspection.",
    hypothesisText: "Old browser capture source_context_unavailable failure on a fashion Klaviyo page; recovery required source inspection.",
    confidence: "high",
    importance: 10,
    evidenceCount: 5,
    status: "active",
    keywords: ["fashion", "klaviyo", "browser", "capture", "source", "failure"],
  });
  const semantic = upsertAgentMemory({
    memoryType: "proposal_style",
    scope: "fashion:klaviyo",
    title: "fashion:klaviyo:semantic hook candidate",
    summary: "Lifecycle messaging memory with an embedding id and sparse lexical overlap.",
    hypothesisText: "Lifecycle messaging memory with an embedding id and sparse lexical overlap.",
    confidence: "low",
    importance: 3,
    evidenceCount: 1,
    status: "tentative",
    keywords: ["lifecycle"],
    embeddingId: 9001,
  });
  const forgotten = upsertAgentMemory({
    memoryType: "proof_preference",
    scope: "fashion:klaviyo",
    title: "Forgotten Fly Boutique wrong proof",
    summary: "Forgotten Fly Boutique wrong proof memory should not be retrieved.",
    hypothesisText: "Forgotten Fly Boutique wrong proof memory should not be retrieved.",
    confidence: "high",
    importance: 10,
    evidenceCount: 5,
    status: "active",
    keywords: ["forgotten", "fashion", "klaviyo", "fly", "boutique"],
  });
  assert(forgotten.status === "active", "forgotten fixture should start active");
  assert(forgetSalesLearningMemory({ query: "Forgotten Fly Boutique wrong proof" }) >= 1, "forget should mark matching agent memory forgotten");

  const raw = new Database(tempDb);
  raw.prepare("UPDATE agent_memories SET updated_at = '2025-01-01T00:00:00.000Z', decay_score = 8 WHERE id = ?").run(staleBrowserFailure.id);
  raw.close();

  const ranked = retrieveRelevantSalesLearningMemoriesWithDebug(input);
  const ids = ranked.map((item) => item.memory.id);
  const proofIndex = ids.indexOf(proof.id);
  const styleIndex = ids.indexOf(style.id);
  const screeningIndex = ids.indexOf(screening.id);
  const boostIndex = ids.indexOf(boost.id);
  const sourceIndex = ids.indexOf(source.id);
  const randomIndex = ids.indexOf(randomKlaviyo.id);
  const staleIndex = ids.indexOf(staleBrowserFailure.id);
  assert(proofIndex >= 0 && styleIndex >= 0 && screeningIndex >= 0 && boostIndex >= 0 && sourceIndex >= 0, "relevant proof/style/screening/boost/source memories should be retrieved");
  assert(randomIndex >= 0, "random Klaviyo comparison memory should still be eligible");
  assert(staleIndex >= 0, "stale browser comparison memory should still be eligible for ranking");
  assert(proofIndex < randomIndex, "fashion/Klaviyo/Fly Boutique proof should outrank random Klaviyo proof from another vertical");
  assert(styleIndex < randomIndex, "matching proposal style should outrank random Klaviyo keyword match");
  assert(screeningIndex < randomIndex, "matching screening answer memory should outrank random Klaviyo keyword match");
  assert(boostIndex < randomIndex, "matching boost strategy should outrank random Klaviyo keyword match");
  assert(sourceIndex < staleIndex, "matching source memory should outrank stale browser/source failure in ordinary sales context");
  assert(!ids.includes(forgotten.id), "forgotten memories must remain excluded from retrieval");

  const proofDebug = ranked.find((item) => item.memory.id === proof.id);
  const randomDebug = ranked.find((item) => item.memory.id === randomKlaviyo.id);
  assert(Boolean(proofDebug && randomDebug), "debug rows should be available for matching and random memories");
  assert(proofDebug!.components.scopeMatch > randomDebug!.components.scopeMatch, "scope matching should affect score");
  assert(proofDebug!.components.verticalSimilarity > randomDebug!.components.verticalSimilarity, "vertical matching should affect score");
  assert(proofDebug!.components.platformSimilarity >= randomDebug!.components.platformSimilarity, "platform matching should be represented");
  assert(proofDebug!.components.proofSimilarity > 0, "proof similarity should be scored");
  assert(proofDebug!.explanation.includes("proof-match"), "debug explanation should expose compact proof-match reason");

  const nonFailureScore = ranked.find((item) => item.memory.id === staleBrowserFailure.id);
  assert(nonFailureScore!.components.staleBrowserFailurePenalty < 0, "stale browser/failure memories should be penalized outside failure context");
  const failureContextScore = retrieveRelevantSalesLearningMemoriesWithDebug({
    job,
    text: "Browser capture failed with source_context_unavailable for this fashion Klaviyo source.",
    limit: 10,
  }).find((item) => item.memory.id === staleBrowserFailure.id);
  assert(Boolean(failureContextScore), "browser/source failure context should still retrieve matching failure memory");
  assert(failureContextScore!.components.staleBrowserFailurePenalty > nonFailureScore!.components.staleBrowserFailurePenalty, "browser/source failure context should remove stale failure penalty");

  const semanticDebug = retrieveRelevantSalesLearningMemoriesWithDebug({
    ...input,
    semanticScoresByMemoryId: { [semantic.id]: 0.92 },
  }).find((item) => item.memory.id === semantic.id);
  assert(Boolean(semanticDebug), "embedding-backed memory should remain eligible");
  assert(semanticDebug!.components.semantic > 0, "semantic score hook should contribute when embedding metadata and a provided score exist");
  assert(semanticDebug!.explanation.includes("semantic-hook"), "debug explanation should identify semantic hook contribution");

  const retrieved = retrieveRelevantSalesLearningMemories({ ...input, limit: 4 });
  assert(retrieved.some((memory) => memory.id === proof.id), "plain retrieval should include relevant proof memory");
  assert(retrieved.every((memory) => memory.id !== forgotten.id), "plain retrieval should exclude forgotten memory");

  const promptContext = buildSalesLearningPromptContext({ ...input, limit: 4 });
  const promptText = JSON.stringify(promptContext);
  assert(/Fly Boutique/i.test(promptText), "retrieval output should be injectable into prompt context");
  assert(/screening|approach-plan/i.test(promptText), "screening answer memories should be injectable into prompt context");
  assert(/Hard safety/i.test(promptText), "prompt context should preserve hard safety guidance");

  const fabricatedOldFailure = {
    id: 999999,
    type: "failure_pattern",
    scope: "fashion:klaviyo",
    subject: "old browser failure",
    hypothesis: "Old browser capture failed for fashion Klaviyo.",
    rationale: "source_context_unavailable",
    confidence: "high",
    evidenceCount: 4,
    status: "active",
    source: "test",
    jobId: null,
    channelId: null,
    threadTs: null,
    examples: ["browser capture failed"],
    metadata: { importance: 10, decayScore: 8 },
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
  const fabricatedScore = scoreSalesLearningMemoryForDebug(fabricatedOldFailure, input);
  assert(fabricatedScore.components.staleBrowserFailurePenalty < -5, "debug scorer should expose stale browser/failure penalty");

  closeDb();
  console.log("sales learning retrieval tests passed");
}

runTests().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
