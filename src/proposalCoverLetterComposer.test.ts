import assert from "node:assert/strict";
import { buildApplicationDraft, buildApplicationDraftWithResearch } from "./agent";
import { scoreJob } from "./filter";
import {
  rewriteProposalCoverLetterWithKimi,
  type ProposalCoverLetterClient,
} from "./proposalCoverLetterComposer";
import type { JobPosting } from "./types";
import type { LlmJsonRequest, LlmJsonResult } from "./llm/provider";

function job(partial: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "proposal-kimi-cover-letter",
    title: "Shopify Klaviyo retention flow audit for skincare brand",
    url: "https://www.upwork.com/jobs/~123456789012345678",
    description: [
      "We run a Shopify skincare brand and need a Klaviyo retention expert to audit weak welcome, abandoned cart, post-purchase, and win-back flows.",
      "The goal is to improve repeat purchase, increase email revenue, and make the messaging feel more like a helpful founder than a generic marketing department.",
      "Please include relevant proof and explain your first step.",
    ].join(" "),
    postedAt: new Date().toISOString(),
    budget: "$500 fixed",
    clientCountry: "United States",
    clientRating: 5,
    clientSpend: 18000,
    clientHireRate: 90,
    clientTotalHires: 8,
    clientFeedbackCount: 6,
    category: "Email Marketing",
    experienceLevel: "Expert",
    connectsCost: 9,
    skills: ["Shopify", "Klaviyo", "Email Marketing", "Retention Marketing"],
    sourceQuery: "test",
    proposalCount: 8,
    competitionLevel: "low",
    ...partial,
  };
}

class FakeProposalProvider implements ProposalCoverLetterClient {
  requests: LlmJsonRequest[] = [];

  constructor(private readonly payload: Record<string, unknown>, private readonly available = true) {}

  isAvailable(): boolean {
    return this.available;
  }

  async completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>> {
    this.requests.push(request);
    return { ok: true, data: this.payload as T };
  }
}

const scored = scoreJob(job());
const deterministicDraft = buildApplicationDraft(scored);
const conversionProposal = [
  "Steve here - how is your day going?",
  "",
  "Your buyers need the skincare routine to feel easy after the first order, and the Shopify/Klaviyo flows you named are where that trust either compounds or leaks. I would start with a 3-5 day flow audit focused on welcome, abandoned cart, post-purchase, and win-back logic.",
  "",
  "Done = the two biggest repeat-purchase leaks are ranked, one high-leverage sequence is rewritten in founder voice, and the test plan is tied to email revenue instead of vanity opens.",
  "",
  "For one proof point, I would use the Truly Beauty case study: a zero-party data engine helped lift revenue per subscriber 2.5x within two months.",
  "",
  "I can keep the first scope async-friendly and start with the flow logic before touching a wider calendar. Would you prefer a quick call or an async first-pass audit outline?",
].join("\n");

async function run(): Promise<void> {
  const provider = new FakeProposalProvider({ proposalText: conversionProposal, rationale: "uses retention OS" });
  const rewrite = await rewriteProposalCoverLetterWithKimi({
    job: scored,
    deterministicDraft,
    copyStrategy: deterministicDraft.copyStrategy,
    brandFactPack: deterministicDraft.brandFactPack,
    proofStrategy: deterministicDraft.proofStrategy,
    selectedPortfolioItems: deterministicDraft.selectedPortfolioItems,
  }, provider);

  assert.equal(rewrite.usedLlm, true, JSON.stringify(rewrite, null, 2));
  assert.match(rewrite.proposalText, /^Steve here - how is your day going\?/);
  assert.match(rewrite.proposalText, /\bDone\s*=/);
  assert.match(rewrite.proposalText, /2\.5x within two months/);
  assert.match(rewrite.proposalText, /quick call or an async first-pass audit outline\?$/);
  assert.equal(provider.requests.length, 1);
  assert((provider.requests[0]?.timeoutMs ?? 0) >= 75_000, "Proposal copy Kimi request should use the longer proposal-copy timeout.");
  assert.equal(provider.requests[0]?.plainTextFallbackKey, "proposalText", "Proposal copy should accept long non-JSON Kimi text as proposalText.");
  const prompt = provider.requests.flatMap((request) => request.messages.map((message) => message.content)).join("\n");
  assert.match(prompt, /Operating constitution from soul\.md/i, "Proposal copy prompt should include soul.md.");
  assert.match(prompt, /Upwork Proposal Operating System for Retention Marketing/i, "Prompt should include the retention copy OS.");
  assert.match(prompt, /exactly one proof artifact/i, "Prompt should enforce one proof artifact.");
  assert.match(prompt, /Steve here - how is your day going\?/i, "Prompt should preserve Steve's voice opener.");
  assert.doesNotMatch(prompt, /"proposalText"\s*:\s*"\.\.\."/i, "Prompt should not teach Kimi to return a placeholder proposalText.");
  assert.match(prompt, /full finished cover letter/i, "Prompt should ask for the full finished cover letter.");

  const researchedDraft = await buildApplicationDraftWithResearch(scored, { proposalCopyProvider: new FakeProposalProvider({ proposalText: conversionProposal }) });
  assert.equal(researchedDraft.proposalText, conversionProposal);
  assert.equal(researchedDraft.structuredProposal?.browserFillNotes.approvedText, conversionProposal);
  assert(researchedDraft.skillUseTrace?.invocationOrder.some((item: string) => item === "cover_letter_drafting:proposal-copy-kimi-conversion-os"), "Async draft should record the Kimi conversion cover-letter pass.");
  assert.equal(researchedDraft.draftQualityGate?.ready, true);

  const brandDesignJob = scoreJob(job({
    id: "proposal-kimi-brand-design",
    title: "Established Shopify Store Seeking Ecommerce Partner - Branding & Logo Design",
    description: [
      "Need branding, logo design, website modernization, conversion optimization, and a sharper Shopify store experience.",
      "The store is already doing meaningful revenue, but the brand identity and buying path need to feel more credible.",
      "Please include relevant proof and the first thing you would improve.",
    ].join(" "),
    category: "Ecommerce Design",
    skills: ["Shopify", "Brand Design", "Conversion Optimization"],
  }));
  const brandDesignDraft = buildApplicationDraft(brandDesignJob);
  const brandDesignProposal = [
    "Steve here - how is your day going?",
    "",
    "Your Shopify store already has traction, but the branding/logo brief says the first leak is trust and product-path clarity, not another generic ecommerce checklist. I would start with a 3-5 day brand/conversion diagnostic across the homepage, PDP path, logo/identity fit, and offer hierarchy.",
    "",
    "Done = the identity risks, buying-path friction, and first design direction are mapped clearly enough to approve before a full redesign expands.",
    "",
    "For proof, I would use one matched artifact: Design Case Studies - premium DTC email design and campaign/flow visual systems proof.",
    "",
    "I can keep the first pass async-friendly and decision-focused before bigger design execution. Would you prefer a quick call or an async brand/conversion outline?",
  ].join("\n");
  const brandProvider = new FakeProposalProvider({ proposalText: brandDesignProposal, rationale: "uses brand design lane" });
  const brandRewrite = await rewriteProposalCoverLetterWithKimi({
    job: brandDesignJob,
    deterministicDraft: brandDesignDraft,
    copyStrategy: brandDesignDraft.copyStrategy,
    brandFactPack: brandDesignDraft.brandFactPack,
    proofStrategy: brandDesignDraft.proofStrategy,
    selectedPortfolioItems: brandDesignDraft.selectedPortfolioItems,
  }, brandProvider);
  assert.equal(brandRewrite.usedLlm, true, JSON.stringify(brandRewrite, null, 2));
  assert.match(brandRewrite.proposalText, /Design Case Studies/);
  assert.doesNotMatch(brandRewrite.proposalText, /Hangaritas|win[-\s]?back|replenishment|email revenue/i);
  const brandPrompt = brandProvider.requests.flatMap((request) => request.messages.map((message) => message.content)).join("\n");
  assert.match(brandPrompt, /Lane: ecommerce brand\/logo\/conversion design/i, "Brand design prompt should include lane-specific guidance.");
  assert.match(brandPrompt, /Do not use Hangaritas/i, "Brand design prompt should explicitly block retention proof drift.");

  const aliasRewrite = await rewriteProposalCoverLetterWithKimi({
    job: brandDesignJob,
    deterministicDraft: brandDesignDraft,
    copyStrategy: brandDesignDraft.copyStrategy,
    brandFactPack: brandDesignDraft.brandFactPack,
    proofStrategy: brandDesignDraft.proofStrategy,
  }, new FakeProposalProvider({ proposal_text: brandDesignProposal, rationale: "kimi used snake_case" }));
  assert.equal(aliasRewrite.usedLlm, true, "Proposal composer should accept Kimi proposal_text JSON alias.");
  assert.equal(aliasRewrite.proposalText, brandDesignProposal);

  const proposalAliasRewrite = await rewriteProposalCoverLetterWithKimi({
    job: brandDesignJob,
    deterministicDraft: brandDesignDraft,
    copyStrategy: brandDesignDraft.copyStrategy,
    brandFactPack: brandDesignDraft.brandFactPack,
    proofStrategy: brandDesignDraft.proofStrategy,
  }, new FakeProposalProvider({ proposal: brandDesignProposal, rationale: "kimi used generic proposal key" }));
  assert.equal(proposalAliasRewrite.usedLlm, true, "Proposal composer should accept Kimi proposal JSON alias.");
  assert.equal(proposalAliasRewrite.proposalText, brandDesignProposal);

  const nestedAliasRewrite = await rewriteProposalCoverLetterWithKimi({
    job: brandDesignJob,
    deterministicDraft: brandDesignDraft,
    copyStrategy: brandDesignDraft.copyStrategy,
    brandFactPack: brandDesignDraft.brandFactPack,
    proofStrategy: brandDesignDraft.proofStrategy,
  }, new FakeProposalProvider({
    result: {
      content: {
        cover_letter_text: brandDesignProposal,
      },
    },
    rationale: "kimi nested the cover letter under result.content",
  }));
  assert.equal(nestedAliasRewrite.usedLlm, true, "Proposal composer should accept nested Kimi cover-letter content.");
  assert.equal(nestedAliasRewrite.proposalText, brandDesignProposal);

  const verboseKimiRewrite = await rewriteProposalCoverLetterWithKimi({
    job: brandDesignJob,
    deterministicDraft: brandDesignDraft,
    copyStrategy: brandDesignDraft.copyStrategy,
    brandFactPack: brandDesignDraft.brandFactPack,
    proofStrategy: brandDesignDraft.proofStrategy,
  }, new FakeProposalProvider({
    proposalText: [
      "The user wants me to write an Upwork cover letter. I need to follow the operating system and avoid generic copy.",
      "",
      brandDesignProposal,
      "",
      "Rationale: this uses the brand design lane.",
    ].join("\n"),
  }));
  assert.equal(verboseKimiRewrite.usedLlm, true, "Proposal composer should strip Kimi preamble/rationale from a usable cover letter.");
  assert.equal(verboseKimiRewrite.proposalText, brandDesignProposal);

  const wrongDesignProof = await rewriteProposalCoverLetterWithKimi({
    job: brandDesignJob,
    deterministicDraft: brandDesignDraft,
    copyStrategy: brandDesignDraft.copyStrategy,
    brandFactPack: brandDesignDraft.brandFactPack,
    proofStrategy: brandDesignDraft.proofStrategy,
  }, new FakeProposalProvider({
    proposalText: brandDesignProposal.replace(
      "Design Case Studies - premium DTC email design and campaign/flow visual systems proof",
      "Hangaritas screenshot - £21,681.29 attributed email revenue, up 173% vs previous period",
    ),
  }));
  assert.equal(wrongDesignProof.usedLlm, false, "Brand design rewrite should reject Hangaritas/Klaviyo proof drift.");
  assert.match(wrongDesignProof.reason ?? "", /wrong retention proof/i);

  const badProvider = new FakeProposalProvider({ proposalText: "Hi, I am excited to apply. I can help." });
  const fallback = await rewriteProposalCoverLetterWithKimi({
    job: scored,
    deterministicDraft,
    copyStrategy: deterministicDraft.copyStrategy,
    brandFactPack: deterministicDraft.brandFactPack,
    proofStrategy: deterministicDraft.proofStrategy,
  }, badProvider);
  assert.equal(fallback.usedLlm, false);
  assert.equal(fallback.proposalText, deterministicDraft.proposalText);
  assert.match(fallback.reason ?? "", /word count|missing|generic|proof/i);

  const unavailable = await rewriteProposalCoverLetterWithKimi({
    job: scored,
    deterministicDraft,
    copyStrategy: deterministicDraft.copyStrategy,
    brandFactPack: deterministicDraft.brandFactPack,
    proofStrategy: deterministicDraft.proofStrategy,
  }, new FakeProposalProvider({}, false));
  assert.equal(unavailable.usedLlm, false);
  assert.match(unavailable.reason ?? "", /unavailable/);

  console.log("proposal cover letter composer tests passed");
}

run().catch((error) => {
  console.error("proposal cover letter composer tests failed:");
  console.error(error);
  process.exit(1);
});
