import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
  const tempDb = resolve(process.cwd(), "data/.tmp-memory-consolidation/jobs.db");
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;

  const {
    closeDb,
    getAgentMemory,
    listAgentMemories,
    upsertAgentMemory,
  } = require("./db") as {
    closeDb: () => void;
    getAgentMemory: (id: number) => any | null;
    listAgentMemories: (limit?: number) => any[];
    upsertAgentMemory: (input: any) => any;
  };
  const {
    consolidateRelatedMemories,
    decayStaleLowValueMemories,
    recordScopedMemoryResolution,
  } = require("./memoryConsolidation") as {
    consolidateRelatedMemories: (input?: any) => any[];
    decayStaleLowValueMemories: (input?: any) => Array<{ before: any; after: any }>;
    recordScopedMemoryResolution: (input: any) => { relationship: string; newMemory: any; olderMemories: any[] };
  };

  const proposalA = upsertAgentMemory({
    memoryType: "proposal_style",
    scope: "fashion:klaviyo",
    title: "fashion direct diagnosis opener",
    summary: "Open with direct commercial diagnosis instead of generic Klaviyo credentials.",
    hypothesisText: "Direct commercial diagnosis openers work better than generic intros for fashion Klaviyo proposals.",
    confidence: "low",
    importance: 5,
    evidenceCount: 1,
    status: "tentative",
    keywords: ["fashion", "klaviyo", "commercial", "diagnosis"],
  });
  const proposalB = upsertAgentMemory({
    memoryType: "proposal_style",
    scope: "fashion:klaviyo",
    title: "fashion revenue leak opener",
    summary: "Start with the revenue leak diagnosis before listing proof.",
    hypothesisText: "Lead with a revenue leak diagnosis, then attach proof after the client problem is named.",
    confidence: "low",
    importance: 5,
    evidenceCount: 2,
    status: "active",
    keywords: ["fashion", "klaviyo", "revenue", "diagnosis"],
  });
  const proposalC = upsertAgentMemory({
    memoryType: "proposal_style",
    scope: "fashion:klaviyo",
    title: "fashion diagnosis CTA",
    summary: "Keep the CTA tied to a fast diagnosis of the retention gap.",
    hypothesisText: "The close should offer a fast diagnosis of the retention gap instead of a broad sales call.",
    confidence: "low",
    importance: 5,
    evidenceCount: 2,
    status: "active",
    keywords: ["fashion", "klaviyo", "diagnosis", "retention"],
  });

  const consolidated = consolidateRelatedMemories({
    memoryTypes: ["proposal_style"],
    scopes: ["fashion:klaviyo"],
    keywords: ["diagnosis"],
    periodStart: "2026-06-01T00:00:00.000Z",
    periodEnd: "2026-06-07T23:59:59.000Z",
  });
  assert(consolidated.length === 1, "related proposal memories should consolidate into one strategy");
  const strategy = consolidated[0];
  assert(strategy.group.evidenceCount === 5, "consolidation should aggregate evidence counts");
  assert(strategy.group.confidence === "medium", "repeated low-confidence evidence should upgrade to medium confidence");
  assert(strategy.strategicMemory?.summary.includes("medium-confidence strategy"), "strategic memory should be a cleaner strategy summary");
  assert(strategy.consolidationRecord?.sourceMemoryIds.includes(proposalA.id), "consolidation should preserve source memory ids");
  assert(strategy.consolidationRecord?.sourceMemoryIds.includes(proposalB.id), "consolidation should include all related source ids");
  assert(strategy.consolidationRecord?.sourceMemoryIds.includes(proposalC.id), "consolidation should include the third related source id");

  const normalProposal = upsertAgentMemory({
    memoryType: "proposal_style",
    scope: "normal_budget:klaviyo",
    title: "short normal proposal",
    summary: "For normal-budget Klaviyo jobs, keep proposals short and direct.",
    hypothesisText: "Normal-budget proposals should be short, direct, and proof-light.",
    confidence: "medium",
    importance: 7,
    evidenceCount: 3,
    status: "active",
    keywords: ["klaviyo", "normal budget", "short proposal"],
  });
  const contradiction = recordScopedMemoryResolution({
    relationship: "contradicts",
    archiveOlder: false,
    olderMemoryIds: [normalProposal.id],
    newMemory: {
      memoryType: "proposal_style",
      scope: "high_budget:klaviyo",
      title: "longer high-budget strategy",
      summary: "For high-budget Klaviyo strategy jobs, use a longer proposal with diagnosis, plan, proof, and risk control.",
      hypothesisText: "High-budget strategy opportunities need a longer proposal than normal-budget jobs because they must show diagnosis, operating plan, proof, and risk control.",
      confidence: "high",
      importance: 9,
      evidenceCount: 5,
      status: "active",
      keywords: ["klaviyo", "high budget", "long proposal", "strategy"],
    },
  });
  assert(contradiction.relationship === "contradicts", "scoped contradiction should return the relationship");
  assert(contradiction.newMemory.scope === "high_budget:klaviyo", "new scoped memory should keep its narrower scope");
  assert(contradiction.olderMemories[0].status === "active", "scoped contradiction should not erase the normal-budget rule by default");
  assert(contradiction.olderMemories[0].contradictedByMemoryId === contradiction.newMemory.id, "older memory should link to the scoped contradiction");

  const stale = upsertAgentMemory({
    memoryType: "source_quality",
    scope: "old saved search",
    title: "stale low-value source",
    summary: "This weak source produced one noisy lead and no useful follow-up.",
    hypothesisText: "Old saved search may be noisy.",
    confidence: "low",
    importance: 3,
    evidenceCount: 1,
    status: "tentative",
    keywords: ["old", "source", "noisy"],
  });
  const decayed = decayStaleLowValueMemories({
    memories: [stale],
    now: new Date("2099-01-01T00:00:00.000Z"),
    staleAfterDays: 30,
  });
  assert(decayed.length === 1, "stale low-confidence memory should be decayed");
  assert(decayed[0].after.status === "archived", "decay should lower retrieval status without deleting");
  assert(decayed[0].after.importance < decayed[0].before.importance, "decay should lower retrieval priority");
  assert(getAgentMemory(stale.id)?.status === "archived", "decayed memory should remain stored");
  assert(!listAgentMemories(200).some((memory) => memory.id === stale.id), "archived memory should be excluded from default retrieval");

  const forgotten = upsertAgentMemory({
    memoryType: "proof_preference",
    scope: "beauty:klaviyo",
    title: "forgotten invisible proof",
    summary: "This invisible proof rule must not be consolidated.",
    hypothesisText: "Invisible proof rule.",
    confidence: "high",
    importance: 10,
    evidenceCount: 99,
    status: "forgotten",
    keywords: ["beauty", "klaviyo", "invisible"],
  });
  const activeProofA = upsertAgentMemory({
    memoryType: "proof_preference",
    scope: "beauty:klaviyo",
    title: "beauty proof A",
    summary: "Beauty Klaviyo jobs should prefer skincare retention proof.",
    hypothesisText: "Use skincare retention proof for beauty Klaviyo jobs.",
    confidence: "low",
    importance: 5,
    evidenceCount: 1,
    status: "tentative",
    keywords: ["beauty", "klaviyo", "proof"],
  });
  const activeProofB = upsertAgentMemory({
    memoryType: "proof_preference",
    scope: "beauty:klaviyo",
    title: "beauty proof B",
    summary: "Beauty lifecycle jobs respond to retention proof before design proof.",
    hypothesisText: "Retention proof should lead for beauty lifecycle jobs.",
    confidence: "low",
    importance: 5,
    evidenceCount: 1,
    status: "tentative",
    keywords: ["beauty", "klaviyo", "proof"],
  });
  const proofGroups = consolidateRelatedMemories({
    persist: false,
    memories: [forgotten, activeProofA, activeProofB],
    memoryTypes: ["proof_preference"],
    scopes: ["beauty:klaviyo"],
  });
  assert(proofGroups.length === 1, "active proof memories should still consolidate");
  assert(!proofGroups[0].group.sourceMemoryIds.includes(forgotten.id), "forgotten memories should be excluded from consolidation");
  assert(proofGroups[0].group.sourceMemoryIds.includes(activeProofA.id) && proofGroups[0].group.sourceMemoryIds.includes(activeProofB.id), "active source memories should remain eligible");
  assert(!proofGroups[0].group.summary.includes("invisible"), "forgotten memory text should not leak into the summary");

  closeDb();
  console.log("memory consolidation tests passed");
}

runTests().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
