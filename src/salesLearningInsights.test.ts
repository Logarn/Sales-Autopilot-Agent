import { buildSalesLearningInsightReply } from "./salesLearningInsights";
import type { SalesLearningMemory } from "./db";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const now = new Date().toISOString();

function memory(input: Partial<SalesLearningMemory> & Pick<SalesLearningMemory, "id" | "type" | "subject" | "hypothesis">): SalesLearningMemory {
  return {
    scope: "global",
    rationale: "",
    confidence: "low",
    evidenceCount: 1,
    status: "tentative",
    source: "test",
    jobId: null,
    channelId: null,
    threadTs: null,
    examples: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

const memories: SalesLearningMemory[] = [
  memory({
    id: 1,
    type: "proposal_style",
    scope: "lifecycle:retention",
    subject: "direct commercial diagnosis",
    hypothesis: "For lifecycle/retention proposals, Steve prefers direct commercial diagnosis in the opener over generic experience claims.",
    confidence: "high",
    evidenceCount: 8,
    status: "active",
  }),
  memory({
    id: 2,
    type: "proof_preference",
    scope: "fashion:klaviyo",
    subject: "Fly Boutique proof",
    hypothesis: "Fashion/Klaviyo jobs should prioritize Fly Boutique proof when retention or lifecycle work is the core ask.",
    confidence: "high",
    evidenceCount: 5,
    status: "active",
  }),
  memory({
    id: 3,
    type: "boost_strategy",
    scope: "klaviyo:high_fit",
    subject: "top-3 boost visibility",
    hypothesis: "For similar high-fit Klaviyo jobs, top-3 visibility appears strong enough; avoid overspending just to be #1 unless the lead is exceptional.",
    confidence: "medium",
    evidenceCount: 4,
    status: "active",
    metadata: { outcome: "replied", requiredConnects: 12, boostConnects: 28, totalConnects: 40 },
  }),
  memory({
    id: 6,
    type: "boost_strategy",
    scope: "klaviyo:low_fit",
    subject: "low-fit boost waste",
    hypothesis: "Low-fit jobs with paid boosts should be treated as waste candidates until they show reply evidence.",
    confidence: "low",
    evidenceCount: 2,
    status: "tentative",
    metadata: { outcome: "lost", requiredConnects: 12, boostConnects: 22, totalConnects: 34 },
  }),
  memory({
    id: 4,
    type: "source_quality",
    scope: "Saved Search - Klaviyo DTC",
    subject: "noisy saved search",
    hypothesis: "Saved Search - Klaviyo DTC produced many noisy leads and repeated browser checks, so Best Matches deserves more priority.",
    confidence: "medium",
    evidenceCount: 3,
    status: "active",
  }),
  memory({
    id: 5,
    type: "proof_preference",
    scope: "beauty:klaviyo",
    subject: "forgotten proof",
    hypothesis: "This should not be visible.",
    confidence: "high",
    evidenceCount: 20,
    status: "forgotten",
  }),
];

const general = buildSalesLearningInsightReply({ memories, question: "what did you learn?", limit: 3 });
assert(general.text.includes("what I have learned") || general.text.includes("learned so far"), "General learning question should produce a human summary.");
assert(general.insights.length === 3, "General learning reply should limit insights.");
assert(general.insights[0]?.summary.includes("direct commercial diagnosis"), "Highest-evidence high-confidence proposal memory should lead general summary.");
assert(!general.text.includes("This should not be visible"), "Forgotten memories must not be shown.");

const proof = buildSalesLearningInsightReply({ memories, question: "what proof is working?", limit: 3 });
assert(proof.topic === "proof", "Proof question should choose proof topic.");
assert(proof.text.includes("Fly Boutique"), "Proof answer should include active Fly Boutique proof memory.");
assert(!proof.text.includes("top-3"), "Proof answer should not include boost memories.");

const boost = buildSalesLearningInsightReply({ memories, question: "what boost strategy is working?", limit: 3 });
assert(boost.topic === "boost", "Boost question should choose boost topic.");
assert(boost.text.includes("top-3 visibility"), "Boost answer should include boost strategy memory.");
assert(!boost.text.includes("Fly Boutique"), "Boost answer should not include proof memories.");

const waste = buildSalesLearningInsightReply({ memories, question: "how many Connects are we wasting?", limit: 3 });
assert(waste.topic === "boost", "Connects waste question should choose boost topic.");
assert(waste.text.includes("68 total Connects"), "Connects waste answer should total known negative Connects with evidence count.");
assert(waste.text.includes("44 boost Connects"), "Connects waste answer should total known negative boost Connects with evidence count.");
assert(waste.text.includes("waste candidates"), "Connects waste answer should avoid fake certainty.");

const empty = buildSalesLearningInsightReply({ memories: [], question: "what source is working?" });
assert(empty.text.includes("not have enough"), "Empty memory state should answer plainly without dumping internals.");

console.log("sales learning insights tests passed");
