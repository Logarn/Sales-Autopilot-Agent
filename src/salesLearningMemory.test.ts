import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { LlmJsonRequest } from "./llm/provider";

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
  const tempDb = resolve(process.cwd(), "data/.tmp-sales-learning/jobs.db");
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;

  const {
    closeDb,
    forgetSalesLearningMemory,
    listAgentMemories,
    listRecentAgentEvents,
    listSalesLearningMemories,
    listSalesLearningMemoriesByType,
    markJobSeen,
    recordMemoryConsolidation,
    recordMemoryEmbedding,
    upsertAgentMemory,
  } = require("./db") as {
    closeDb: () => void;
    forgetSalesLearningMemory: (input: { id?: number; query?: string; type?: string }) => number;
    listAgentMemories: (limit?: number) => Array<{ id: number; memoryType: string; title: string; summary: string; evidenceCount: number; status: string; version: number; sourceEventIds: number[]; keywords: string[]; lastUsedAt: string | null; supersedesMemoryId: number | null; contradictedByMemoryId: number | null; embeddingId: number | null }>;
    listRecentAgentEvents: (limit?: number) => Array<{ id: number; eventType: string; sourceType: string; jobId: string | null; summary: string; importance: number; privacyLevel: string }>;
    listSalesLearningMemories: (limit?: number) => Array<{ id: number; type: string; hypothesis: string; evidenceCount: number; status: string; confidence: string }>;
    listSalesLearningMemoriesByType: (type: string, limit?: number) => Array<{ id: number; type: string; hypothesis: string; evidenceCount: number; status: string; subject: string }>;
    markJobSeen: (job: any, notified: boolean) => void;
    recordMemoryConsolidation: (input: any) => { id: number; summaryType: string; sourceMemoryIds: number[]; sourceEventIds: number[]; status: string };
    recordMemoryEmbedding: (input: any) => { id: number; ownerType: string; ownerId: number; provider: string; model: string; vectorJsonOrBlob: string };
    upsertAgentMemory: (input: any) => { id: number; version: number; status: string; supersedesMemoryId: number | null; contradictedByMemoryId: number | null; embeddingId: number | null };
  };
  const {
    buildSalesLearningPromptContext,
    recordApplicationOutcomeLearning,
    recordBoostDecisionSignal,
    recordCodeImprovementTask,
    recordProofPreferenceSignal,
    recordProposalStyleSignal,
    reflectOnSalesOutcomeWithLlm,
    rememberSalesLearning,
    retrieveRelevantSalesLearningMemories,
  } = require("./salesLearningMemory") as {
    buildSalesLearningPromptContext: (input: any) => { relevantMemories: any[]; guidance: string[] };
    recordApplicationOutcomeLearning: (input: any) => any[];
    recordBoostDecisionSignal: (input: any) => any;
    recordCodeImprovementTask: (input: any) => any;
    recordProofPreferenceSignal: (input: any) => any;
    recordProposalStyleSignal: (input: any) => any;
    reflectOnSalesOutcomeWithLlm: (input: any, provider?: any) => Promise<{ ok: boolean; memories?: any[] }>;
    rememberSalesLearning: (input: any) => any;
    retrieveRelevantSalesLearningMemories: (input: any) => any[];
  };
  const { buildApplicationDraft } = require("./agent") as {
    buildApplicationDraft: (job: any) => any;
  };
  const { buildJobIntelligenceMessages } = require("./jobIntelligenceParser") as {
    buildJobIntelligenceMessages: (input: any) => Array<{ role: string; content: string }>;
  };
  const { selectPortfolioAssetsForJob } = require("./skills/portfolioSelectionSkill") as {
    selectPortfolioAssetsForJob: (job: any) => { salesLearningGuidance?: string[] };
  };

  const portfolioItem = {
    id: "fly-boutique",
    name: "Fly Boutique",
    description: "Fashion retention proof",
    industries: ["fashion"],
    platforms: ["Klaviyo", "Shopify"],
    bestFitJobTypes: ["retention"],
    result: "Deliverability and retention lift",
    sensitivity: "approved_external",
    allowedUsage: "always_include_when_relevant",
    filePath: "fly-boutique-case-study.pdf",
    neverUseWhen: [],
  };
  const job = {
    id: "sales-learning-fashion-klaviyo",
    title: "Klaviyo retention strategist for fashion boutique",
    url: "https://www.upwork.com/jobs/~saleslearning1",
    description: "Fashion Shopify brand needs Klaviyo lifecycle flows, retention strategy, campaigns, and proof.",
    postedAt: "2026-06-07T08:00:00.000Z",
    budget: "$1,500",
    clientCountry: "US",
    clientRating: 5,
    clientSpend: 25000,
    clientHireRate: 72,
    clientTotalHires: 8,
    clientFeedbackCount: 4,
    category: "Email Marketing",
    experienceLevel: "Expert",
    connectsCost: 12,
    skills: ["Klaviyo", "Shopify", "Retention"],
    sourceQuery: "Saved Search - Klaviyo DTC",
    proposalCount: 6,
    competitionLevel: "medium",
    score: 91,
    matchLevel: "high",
    matchedKeywords: ["klaviyo", "fashion"],
    negativeKeywords: [],
    scoreBreakdown: {
      fitScore: { score: 95, reasons: ["Klaviyo fashion fit"], risks: [] },
      clientQualityScore: { score: 80, reasons: [], risks: [] },
      opportunityScore: { score: 82, reasons: [], risks: [] },
      redFlagScore: { score: 100, reasons: [], risks: [] },
      connectsRiskScore: { score: 80, reasons: [], risks: [] },
      finalScore: 91,
      reasons: ["strong fashion Klaviyo fit"],
      risks: [],
      connectsStrategy: {
        decision: "safe_apply",
        requiredConnects: 12,
        suggestedBoostConnects: 28,
        totalConnects: 40,
        expectedValueScore: 88,
        sourceBackedConnects: {
          requiredConnects: 12,
          boostConnects: 28,
          totalConnects: 40,
          confidence: "high",
          sourceText: "12 Connects required",
          sourceLocation: "apply page",
          extractionMethod: "deterministic_visible_text",
        },
        reasons: ["top 3 visibility likely enough"],
        risks: [],
      },
    },
    applicationDraft: {
      jobId: "sales-learning-fashion-klaviyo",
      status: "draft",
      fitScore: 95,
      fitReasons: ["Klaviyo fashion fit"],
      redFlags: [],
      suggestedBid: "$75/hr",
      suggestedConnects: 12,
      suggestedBoostConnects: 28,
      connectsWarnings: [],
      connectsStrategy: {
        decision: "safe_apply",
        requiredConnects: 12,
        suggestedBoostConnects: 28,
        totalConnects: 40,
        expectedValueScore: 88,
        reasons: ["top 3 visibility likely enough"],
        risks: [],
      },
      selectedPortfolioItems: [portfolioItem],
      proposalQuality: { score: 90, issues: [], positiveSignals: ["specific opener"], wordCount: 65 },
      proposalText: "I’d fix the post-purchase flow first — that is where fashion customers usually leak easy repeat revenue.\n\nFly Boutique is the closest proof here.\n\nSend me the store URL and I’ll point to the first two fixes.",
      structuredProposal: {
        opening: "I’d fix the post-purchase flow first.",
        diagnosis: "Repeat purchase leak.",
        proof: "Fly Boutique.",
        clientRequestAnswers: [],
        rateRetainerAnswer: "$75/hr",
        cta: "Send me the store URL.",
        suggestedAttachments: ["Fly Boutique"],
        suggestedHighlights: ["Deliverability and retention lift"],
        browserFillNotes: {
          approvedText: "I’d fix the post-purchase flow first.",
          profileNotes: [],
          rate: "$75/hr",
          attachments: ["Fly Boutique"],
          highlights: ["Deliverability and retention lift"],
          connectsPlan: "12 required, 28 boost.",
        },
      },
      generatedAt: "2026-06-07T08:15:00.000Z",
      jobIntelligence: {
        schemaVersion: "1.0",
        primaryPlatform: "Klaviyo",
        platformsMentioned: ["Klaviyo", "Shopify"],
        platformCategory: "ESP",
        platformPreferenceTier: "core",
        platformFitReason: "Core Klaviyo retention job.",
        shouldSkipForPlatform: false,
        skipReason: "",
        businessType: "DTC fashion",
        ecommerceVertical: "fashion",
        jobCategory: "Email marketing",
        taskType: "retention",
        requiredSkills: ["Klaviyo"],
        clientGoal: "Improve retention",
        redFlags: [],
        fitScoreReasoning: "Strong fit.",
        proposalAngle: "Lead with post-purchase diagnosis.",
        proofRecommendations: ["Fly Boutique"],
        draftConstraints: [],
        platformMismatchWarnings: [],
        needsManualReview: false,
        confidence: "high",
      },
    },
  };
  markJobSeen(job, true);

  const proposalMemory = recordProposalStyleSignal({
    jobId: job.id,
    instruction: "Make the opener more specific and commercial. Cut the generic experience intro.",
    beforeText: "I have extensive experience with Klaviyo and would love to help.",
    afterText: job.applicationDraft.proposalText,
    source: "test",
  });
  assert(proposalMemory.type === "proposal_style", "proposal edit should create proposal_style memory");
  assert(/specific commercial diagnosis/i.test(proposalMemory.hypothesis), "proposal memory should learn direct commercial diagnosis preference");

  const proofMemory = recordProofPreferenceSignal({
    jobId: job.id,
    instruction: "Use Fly Boutique instead.",
    plannedProofIds: ["fly-boutique"],
    source: "test",
  });
  assert(proofMemory.type === "proof_preference", "proof correction should create proof_preference");
  assert(/Fly Boutique|fly-boutique/i.test(proofMemory.hypothesis), "proof memory should name corrected proof");

  const boostMemory = recordBoostDecisionSignal({
    jobId: job.id,
    requiredConnects: 12,
    boostConnects: 28,
    totalConnects: 40,
    boostRank: 3,
    decision: "safe_apply",
    reasons: ["Top 3 visibility is enough; do not overpay for #1."],
    source: "test",
  });
  assert(boostMemory.type === "boost_strategy", "boost decision should create boost_strategy memory");
  assert(!/always boost 50/i.test(boostMemory.hypothesis), "boost memory should not encode always-boost-max behavior");

  const outcomeMemories = recordApplicationOutcomeLearning({
    jobId: job.id,
    outcome: "replied",
    note: "Client replied after Fly Boutique proof and direct opener.",
    source: "test",
  });
  assert(outcomeMemories.some((memory) => memory.type === "source_quality"), "outcome should create source quality memory");
  assert(outcomeMemories.some((memory) => memory.type === "proposal_style"), "outcome should create proposal style memory");
  assert(outcomeMemories.some((memory) => memory.type === "boost_strategy"), "outcome should create boost strategy memory");
  assert(outcomeMemories.some((memory) => memory.type === "timing_hypothesis"), "outcome should create timing hypothesis");

  const futureJob = {
    ...job,
    id: "future-fashion-klaviyo",
    title: "Fashion brand needs Klaviyo post-purchase flows",
    applicationDraft: undefined,
  };
  const retrieved = retrieveRelevantSalesLearningMemories({
    job: futureJob,
    text: "Need proposal, proof, and boost plan for fashion Klaviyo job.",
    limit: 8,
  });
  assert(retrieved.some((memory) => memory.type === "proof_preference" && /Fly Boutique|fly-boutique/i.test(memory.hypothesis)), "similar future job should retrieve proof memory");
  assert(retrieved.some((memory) => memory.type === "boost_strategy"), "similar future job should retrieve boost memory");
  assert(retrieved.some((memory) => memory.type === "proposal_style"), "similar future job should retrieve draft style memory");

  const draftWithMemory = buildApplicationDraft(futureJob);
  assert(
    draftWithMemory.structuredProposal?.browserFillNotes.profileNotes.some((line: string) => /Sales learning/i.test(line)),
    "draft/proposal guidance should include relevant sales memories"
  );
  assert(
    draftWithMemory.connectsWarnings.some((line: string) => /Sales learning.*boost/i.test(line)),
    "boost/connects guidance should include relevant sales memories"
  );
  const proofSelection = selectPortfolioAssetsForJob(futureJob);
  assert(
    Boolean(proofSelection.salesLearningGuidance?.some((line) => /Fly Boutique|proof_preference/i.test(line))),
    "proof/portfolio selection context should include relevant sales memories"
  );
  const intelligencePrompt = JSON.stringify(buildJobIntelligenceMessages({ job: futureJob }));
  assert(/salesLearning/i.test(intelligencePrompt) && /Fly Boutique|boost_strategy|proposal_style/i.test(intelligencePrompt), "job intelligence/proof prompt should include relevant sales memories");

  const promptContext = buildSalesLearningPromptContext({ job: futureJob, text: "What should we do?", limit: 5 });
  assert(promptContext.guidance.some((line) => /Hard safety/i.test(line)), "memory prompt guidance should preserve hard safety");
  assert(promptContext.guidance.some((line) => /override learned preferences/i.test(line)), "prompt guidance should state current instructions override learned preferences");

  const remember = rememberSalesLearning({ text: "For fashion Klaviyo jobs, check Fly Boutique proof first.", jobId: job.id });
  assert(remember.status === "active", "remember command should create active memory");
  const forgotten = forgetSalesLearningMemory({ id: remember.id });
  assert(forgotten >= 1, "forget command should disable a memory");
  assert(!listSalesLearningMemories(200).some((memory) => memory.id === remember.id), "forgotten memory should not be listed as active/tentative");

  const codeTask = recordCodeImprovementTask({
    task: "Add source-specific cooldown when a saved search repeatedly triggers browser checks.",
    why: "Repeated browser challenge from one source.",
    jobId: job.id,
    source: "test",
  });
  assert(codeTask.type === "code_improvement_task", "repeated failure should create proposed code-improvement task");

  const requests: LlmJsonRequest[] = [];
  const reflection = await reflectOnSalesOutcomeWithLlm({
    jobId: job.id,
    outcome: "interview",
    note: "Interview booked after direct opener and Fly Boutique proof.",
    source: "test",
  }, {
    isAvailable: () => true,
    completeJson: async <T>(request: LlmJsonRequest) => {
      requests.push(request);
      return {
        ok: true,
        data: {
          memories: [
            {
              type: "proposal_style",
              scope: "fashion:klaviyo",
              subject: "fashion:klaviyo:proposal",
              hypothesis: "Direct revenue-leak openers are working for fashion Klaviyo jobs.",
              rationale: "Interview booked after the direct opener.",
              confidence: "low",
              status: "tentative",
            },
          ],
          codeImprovementTask: "Track submitted proposal final text when Steve confirms manual submit.",
        } as T,
      };
    },
  });
  assert(reflection.ok, "LLM reflection should persist hypotheses when provider returns data");
  assert(requests.some((request) => JSON.stringify(request).includes("sales-learning reflection loop")), "reflection prompt should identify the sales learning loop");
  assert(listSalesLearningMemoriesByType("proposal_style", 50).some((memory) => /Direct revenue-leak openers/i.test(memory.hypothesis)), "LLM reflection should create proposal hypothesis");
  assert(listSalesLearningMemoriesByType("code_improvement_task", 50).some((memory) => /submitted proposal final text/i.test(memory.hypothesis)), "LLM reflection should create proposed code task");

  const proofMemories = listSalesLearningMemoriesByType("proof_preference", 50);
  assert(proofMemories.some((memory) => memory.evidenceCount >= 1 && memory.status === "tentative"), "proof memories should keep evidence and freshness state");

  const agentEvents = listRecentAgentEvents(50);
  assert(agentEvents.some((event) => event.eventType === "draft_style_signal" && event.sourceType === "sales_learning"), "application/draft event should be stored in agent_events");
  assert(agentEvents.some((event) => event.eventType === "proof_correction"), "proof event should be stored in agent_events");
  assert(agentEvents.some((event) => event.eventType === "boost_decision"), "boost event should be stored in agent_events");
  assert(agentEvents.some((event) => event.eventType === "outcome_recorded"), "outcome event should be stored in agent_events");

  const agentMemories = listAgentMemories(100);
  assert(agentMemories.some((memory) => memory.memoryType === "proposal_style" && memory.keywords.includes("fashion")), "compact proposal memory should be available in agent_memories with keywords");
  assert(agentMemories.some((memory) => memory.memoryType === "proof_preference" && /Fly Boutique|fly-boutique/i.test(memory.summary)), "compact proof memory should be available in agent_memories");
  assert(agentMemories.some((memory) => memory.memoryType === "boost_strategy"), "compact boost memory should be available in agent_memories");
  assert(agentMemories.some((memory) => memory.memoryType === "timing_hypothesis"), "compact timing memory should be available in agent_memories");

  const baseAgentMemory = upsertAgentMemory({
    memoryType: "proof_preference",
    scope: "fashion:klaviyo",
    title: "fashion:klaviyo:proof override",
    summary: "Fashion Klaviyo proof should prioritize Fly Boutique.",
    hypothesisText: "Fashion Klaviyo proof should prioritize Fly Boutique.",
    confidence: "medium",
    importance: 8,
    evidenceCount: 2,
    status: "active",
    keywords: ["fashion", "klaviyo", "fly boutique"],
  });
  const contradictedMemory = upsertAgentMemory({
    memoryType: "proof_preference",
    scope: "fashion:klaviyo",
    title: "fashion:klaviyo:proof override contradiction",
    summary: "For this narrow segment, Design Case Studies contradicted the Fly Boutique proof rule.",
    hypothesisText: "For this narrow segment, Design Case Studies contradicted the Fly Boutique proof rule.",
    confidence: "low",
    importance: 5,
    evidenceCount: 1,
    status: "tentative",
    contradictedByMemoryId: baseAgentMemory.id,
    keywords: ["fashion", "klaviyo", "design case studies"],
  });
  const supersedingMemory = upsertAgentMemory({
    memoryType: "proof_preference",
    scope: "fashion:klaviyo",
    title: "fashion:klaviyo:proof override v2",
    summary: "Fashion Klaviyo proof should prioritize Fly Boutique unless the job is design-heavy.",
    hypothesisText: "Fashion Klaviyo proof should prioritize Fly Boutique unless the job is design-heavy.",
    confidence: "medium",
    importance: 8,
    evidenceCount: 2,
    status: "active",
    supersedesMemoryId: baseAgentMemory.id,
    keywords: ["fashion", "klaviyo", "fly boutique", "design"],
  });
  assert(contradictedMemory.contradictedByMemoryId === baseAgentMemory.id, "agent memory should support contradiction links");
  assert(supersedingMemory.supersedesMemoryId === baseAgentMemory.id, "agent memory should support supersession links");
  assert(supersedingMemory.version >= 1, "agent memory should expose versioning");

  const embedding = recordMemoryEmbedding({
    ownerType: "agent_memory",
    ownerId: baseAgentMemory.id,
    provider: "stub",
    model: "lexical-placeholder",
    vectorJsonOrBlob: "[]",
  });
  assert(embedding.ownerType === "agent_memory" && embedding.vectorJsonOrBlob === "[]", "embedding table should support optional vector hooks");
  const consolidation = recordMemoryConsolidation({
    periodStart: "2026-06-01T00:00:00.000Z",
    periodEnd: "2026-06-07T23:59:59.000Z",
    summaryType: "weekly_sales_learning_stub",
    summary: "Fashion Klaviyo proof and direct openers are worth continued testing.",
    sourceMemoryIds: [baseAgentMemory.id, supersedingMemory.id],
    sourceEventIds: agentEvents.slice(0, 2).map((event) => event.id),
    confidence: "low",
    status: "tentative",
  });
  assert(consolidation.sourceMemoryIds.length === 2, "memory consolidation should preserve source memory ids");

  const usedBefore = listAgentMemories(100).find((memory) => memory.memoryType === "proof_preference" && /Fly Boutique|fly-boutique/i.test(memory.summary));
  assert(Boolean(usedBefore), "retrieval candidate should exist before prompt context injection");
  buildSalesLearningPromptContext({ job: futureJob, text: "Use proof for fashion Klaviyo", limit: 5 });
  const usedAfter = listAgentMemories(100).find((memory) => memory.id === usedBefore!.id);
  assert(Boolean(usedAfter?.lastUsedAt), "retrieved agent memories should update last_used_at");

  closeDb();
  console.log("sales learning memory tests passed");
}

runTests().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
