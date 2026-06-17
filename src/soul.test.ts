import assert from "node:assert/strict";
import { buildApplicationDraft } from "./agent";
import { scoreJob } from "./filter";
import { buildJobIntelligenceMessages } from "./jobIntelligenceParser";
import { buildSoulPromptSection, buildSoulRuntimeGuidance, loadSoulConstitution } from "./soul";
import { selectPortfolioAssetsForJob } from "./skills/portfolioSelectionSkill";

const soul = loadSoulConstitution();
assert(soul.includes("You are Fucking Lead Closer."), "soul.md should load the core identity.");
assert(soul.includes("Never click final submit."), "soul.md should preserve hard submit safety.");

const section = buildSoulPromptSection("test_surface");
assert(section.includes("Operating constitution from soul.md"), "Soul prompt section should identify the source file.");
assert(section.includes("test_surface"), "Soul prompt section should include the target surface.");
assert(section.includes("Hard safety overrides soul.md"), "Soul prompt section should repeat safety override precedence.");

const job = scoreJob({
  id: "soul-test-job",
  title: "Klaviyo lifecycle strategist for Shopify beauty brand",
  url: "https://www.upwork.com/jobs/~soultestjob",
  description: "Shopify beauty brand needs Klaviyo flows, campaign segmentation, lifecycle strategy, and proof of email revenue work.",
  postedAt: new Date().toISOString(),
  budget: "$60-$90/hr",
  clientCountry: "United States",
  clientRating: 4.9,
  clientSpend: 100000,
  clientHireRate: 80,
  clientTotalHires: 20,
  clientFeedbackCount: 12,
  category: "Digital Marketing",
  experienceLevel: "Expert",
  connectsCost: 8,
  skills: ["Klaviyo", "Shopify", "Retention Marketing"],
  sourceQuery: "soul-test",
});

const draft = buildApplicationDraft(job);
assert(draft.proposalText.includes("Steve here"), "Proposal draft generation should use the required soul opener.");
assert(draft.proposalText.toLowerCase().includes("how is your day going?"), "Proposal draft generation should keep the human opener.");
assert(!/commercially pointed|Two customer-lifecycle details stood out/i.test(draft.proposalText), "Proposal draft must not use the old sterile template voice.");
assert(!/\bquick read\b/i.test(draft.proposalText), "Proposal draft should avoid canned quick-read phrasing.");
assert(!/\bThe useful first move is\b/i.test(draft.proposalText), "Proposal draft should avoid canned first-move phrasing.");
assert(!/flows\/automations \+ campaigns\/newsletters/i.test(draft.proposalText), "Proposal draft should avoid raw slash-plus scope bundles.");
assert(draft.structuredProposal?.browserFillNotes.profileNotes.some((note) => note.includes("soul.md loaded for proposal_draft_generation")), "Proposal browser fill notes should carry soul draft guidance.");
assert(draft.proposalText.includes("I would"), "Proposal draft should keep first-person sales voice.");

const proofSelection = selectPortfolioAssetsForJob(job);
assert(proofSelection.soulGuidance?.some((note) => note.includes("soul.md loaded for proof_portfolio_selection")), "Proof selection should carry soul guidance.");
assert(proofSelection.soulGuidance?.some((note) => note.includes("strongest relevant proof")), "Proof selection guidance should reflect the proof philosophy.");

const intelligenceMessages = buildJobIntelligenceMessages({ job, draftText: draft.proposalText });
const intelligencePrompt = JSON.stringify(intelligenceMessages);
assert(intelligencePrompt.includes("Operating constitution from soul.md"), "Job intelligence prompt should include soul.md.");
assert(intelligencePrompt.includes("proof reasoning"), "Job intelligence prompt should identify proof reasoning surface.");
assert(intelligencePrompt.includes("never final-submit"), "Job intelligence prompt should include safety override context.");

const runtimeGuidance = buildSoulRuntimeGuidance("self_improvement_memory");
assert(runtimeGuidance.some((note) => note.includes("CV as cover letter")), "Runtime guidance should include CV learned behavior.");
assert(runtimeGuidance.some((note) => note.includes("Final submit remains manual")), "Runtime guidance should include final-submit safety.");

console.log("soul prompt wiring tests passed");
