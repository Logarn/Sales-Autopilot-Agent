import assert from "node:assert/strict";
import { buildApplicationDraft, buildApplicationDraftWithResearch } from "./agent";
import { scoreJob } from "./filter";
import {
  composeProposalCoverLetterWithKimi,
  type ProposalCoverLetterClient,
  type ProposalCoverLetterComposeInput,
} from "./proposalCoverLetterComposer";
import type { JobPosting } from "./types";
import type { LlmJsonRequest, LlmJsonResult } from "./llm/provider";

function job(partial: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "proposal-composer-test",
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
  private index = 0;

  constructor(
    private readonly payload:
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | ((request: LlmJsonRequest, index: number) => Record<string, unknown> | Promise<Record<string, unknown>>),
    private readonly available = true,
  ) {}

  isAvailable(): boolean {
    return this.available;
  }

  async completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>> {
    this.requests.push(request);
    const payload = typeof this.payload === "function"
      ? await this.payload(request, this.index++)
      : Array.isArray(this.payload)
        ? this.payload[Math.min(this.index++, this.payload.length - 1)]
        : this.payload;
    return { ok: true, data: payload as T };
  }
}

const disabledBrandResearchProvider = {
  name: "disabled-brand-research",
  isAvailable: () => false,
  search: async () => {
    throw new Error("brand research should not be called in this test");
  },
};

function buildComposeInput(scoredJob: ReturnType<typeof scoreJob>): ProposalCoverLetterComposeInput {
  const fallbackDraft = buildApplicationDraft(scoredJob);
  return {
    job: scoredJob,
    jobUnderstanding: fallbackDraft.jobUnderstanding!,
    brandResearchStatus: fallbackDraft.brandResearchStatus!,
    copyStrategy: fallbackDraft.copyStrategy!,
    brandFactPack: fallbackDraft.brandFactPack!,
    proofStrategy: fallbackDraft.proofStrategy!,
    selectedPortfolioItems: fallbackDraft.selectedPortfolioItems,
    fallbackProposalText: fallbackDraft.proposalText,
    fallbackScreeningAnswers: fallbackDraft.structuredProposal?.clientRequestAnswers ?? [],
    suggestedBid: fallbackDraft.suggestedBid,
    suggestedConnects: fallbackDraft.suggestedConnects,
  };
}

function firstSentence(text: string): string {
  return text.replace(/\s+/g, " ").trim().match(/^[^.!?]+[.!?]?/)?.[0] ?? "";
}

function proofParagraphCount(text: string): number {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => /\b(?:proof|artifact|case study)\b/i.test(paragraph))
    .length;
}

function assertProblemLedProposal(text: string, expectedSignals: string[]): void {
  const lower = text.toLowerCase();
  const opener = firstSentence(text).toLowerCase();
  const signalMatches = expectedSignals.filter((signal) => lower.includes(signal.toLowerCase()));

  assert(!/^(?:steve here|hey there|hi there|hello there|hope you(?:'re| are) well|how is your day going)/i.test(opener), `Primary LLM proposal should not use a fixed opener pattern:\n${text}`);
  assert(signalMatches.length >= 2, `Proposal should reference concrete job context. Expected at least two signals from ${expectedSignals.join(", ")}:\n${text}`);
  assert(!/\b(?:dear hiring manager|perfect fit|tailored to your needs|proven track record|passionate about)\b/i.test(text), `Proposal should avoid generic Upwork filler:\n${text}`);
  assert(!/\b(?:Relevant proof|Approach|Credentials|Screening answers)\s*:/i.test(text), `Proposal should not leak internal scaffold labels:\n${text}`);
  assert(proofParagraphCount(text) === 1, `Proposal should carry exactly one proof paragraph:\n${text}`);
  assert(/\b(?:3-5 day|3 to 5 day|three to five day|first slice|first milestone|done\s*=)\b/i.test(text), `Proposal should include a clear first milestone:\n${text}`);
  assert(/[?]$/.test(text.trim()) && /\b(?:outline|call|review|audit|walk)\b/i.test(text.trim()), `Proposal should end with a clean CTA:\n${text}`);
}

async function run(): Promise<void> {
  const scored = scoreJob(job());
  const composeInput = buildComposeInput(scored);

  const multiCandidateProvider = new FakeProposalProvider({
    candidates: [
      {
        angleId: "revenue-leak-diagnosis",
        angleLabel: "Revenue leak diagnosis",
        openerShape: "revenue-leak",
        proposalText: [
          "Hey there,",
          "",
          "I am excited to apply for your Klaviyo role.",
          "",
          "I can help with Shopify, retention, and email marketing.",
        ].join("\n"),
      },
      {
        angleId: "customer-moment-breakdown",
        angleLabel: "Customer moment breakdown",
        openerShape: "customer-moment",
        proposalText: [
          "The repeat-purchase leak here is that buyers are probably reaching the welcome, abandoned cart, post-purchase, and win-back sequence before this Shopify skincare brand has earned enough trust to make the second order feel easy. In Klaviyo, those moments are where email revenue either compounds or disappears after the first purchase.",
          "",
          "In a 3-5 day first slice, I would audit those four flows, rank the two biggest leaks, and rewrite the first sequence in founder voice so the customer path feels easier to buy through. Done = one priority flow is rebuilt, the next test is defined, and the revenue hypothesis is clear.",
          "",
          "For proof, I would use the Truly Beauty case study, where zero-party-data segmentation helped lift revenue per subscriber 2.5x within two months.",
          "",
          "I can keep the first pass async-friendly inside the current account so you can judge the logic before expanding scope. Would you rather see the first audit outline here, or do a quick call?",
        ].join("\n"),
      },
      {
        angleId: "segmentation-cadence-miss",
        angleLabel: "Segmentation and cadence miss",
        openerShape: "segmentation-cadence",
        proposalText: [
          "Your campaigns may simply need better segmentation.",
          "",
          "I have a proven track record and can tailor a solution to your needs.",
        ].join("\n"),
      },
    ],
  });

  const composed = await composeProposalCoverLetterWithKimi(composeInput, multiCandidateProvider);
  assert.equal(composed.usedLlm, true, JSON.stringify(composed, null, 2));
  assert.equal(composed.generationTrace.mode, "llm_primary");
  assert.equal(composed.generationTrace.candidateCount, 3);
  assert.equal(composed.generationTrace.selectedAngleId, "customer-moment-breakdown");
  assert.equal(composed.generationTrace.selectedOpenerShape, "customer-moment");
  assertProblemLedProposal(composed.proposalText, ["shopify", "klaviyo", "welcome", "abandoned cart", "post-purchase", "win-back"]);

  const composePrompt = multiCandidateProvider.requests
    .flatMap((request) => request.messages.map((message) => message.content))
    .join("\n");
  assert.match(composePrompt, /Generate one proposal candidate for each supplied angle/i);
  assert.match(composePrompt, /Never start with fixed patterns like `Steve here`/i);
  assert.doesNotMatch(composePrompt, /Default to `Steve here`/i);
  assert.match(composePrompt, /Do not fill a template/i);

  const researchedDraft = await buildApplicationDraftWithResearch(scored, {
    brandResearchProvider: disabledBrandResearchProvider,
    proposalCopyProvider: new FakeProposalProvider({
      candidates: [
      {
        angleId: "customer-moment-breakdown",
        angleLabel: "Customer moment breakdown",
        openerShape: "customer-moment",
        proposalText: [
          "The weakness in this brief is that the buyer may be reaching the welcome, abandoned cart, post-purchase, and win-back path before the brand has made the second order feel certain enough to take. That is a lifecycle problem before it is a tooling problem, even when Shopify and Klaviyo are the stack.",
            "",
            "My first 3-5 day move would be to map those four moments, identify the two biggest retention leaks, and rebuild the highest-leverage sequence first. Done = one sequence is rewritten, the highest-priority test is defined, and the next retention fix is obvious.",
            "",
            "For proof, I would use the Truly Beauty case study, where zero-party-data segmentation helped lift revenue per subscriber 2.5x within two months.",
            "",
            "I can keep the first pass async-friendly and grounded in the current account instead of widening scope too early. Would you rather see the first audit outline here, or do a quick call?",
          ].join("\n"),
        },
      ],
    }),
  });
  assert.equal(researchedDraft.proposalGenerationTrace?.mode, "llm_primary");
  assert.equal(researchedDraft.proposalGenerationTrace?.selectedOpenerShape, "customer-moment");
  assert.equal(researchedDraft.structuredProposal?.browserFillNotes.approvedText, researchedDraft.proposalText);
  assert(researchedDraft.skillUseTrace?.invocationOrder.includes("cover_letter_strategy:job_reader"));
  assert(researchedDraft.skillUseTrace?.invocationOrder.includes("cover_letter_strategy:problem_interpreter"));
  assert(researchedDraft.skillUseTrace?.invocationOrder.some((item: string) => item.startsWith("cover_letter_strategy:angle_generator:")));
  assert(researchedDraft.skillUseTrace?.invocationOrder.includes("cover_letter_drafting:proposal-writer-llm-primary"));
  assert(researchedDraft.skillUseTrace?.invocationOrder.includes("cover_letter_critic:copy-os"));
  assert.equal(researchedDraft.draftQualityGate?.ready, true);
  assertProblemLedProposal(researchedDraft.proposalText, ["shopify", "klaviyo", "welcome", "abandoned cart", "post-purchase", "win-back"]);

  const deterministicFallbackDraft = buildApplicationDraft(scored);
  assert.equal(deterministicFallbackDraft.proposalGenerationTrace?.mode, "deterministic_fallback");
  assert.equal(deterministicFallbackDraft.proposalGenerationTrace?.provider, "fallback");

  const repairProvider = new FakeProposalProvider([
    {
      candidates: [
        {
          angleId: "revenue-leak-diagnosis",
          angleLabel: "Revenue leak diagnosis",
          openerShape: "revenue-leak",
          proposalText: "Hi there, I am excited to apply for your job. I have extensive experience.",
        },
      ],
    },
      {
        proposalText: [
        "The commercial leak in this brief is that repeat purchase is being asked to happen before the welcome, abandoned cart, post-purchase, and win-back path earns enough buyer trust to feel natural. Inside Klaviyo for a Shopify skincare brand, that is usually where email revenue flattens.",
        "",
        "My first 3-5 day move would be to audit those four lifecycle moments, rebuild the highest-leverage sequence, and show where the next retention win should come from. Done = the priority sequence is rewritten, the measurement plan is clear, and the next fix is queued.",
        "",
        "For proof, I would use the Truly Beauty case study, where zero-party-data segmentation helped lift revenue per subscriber 2.5x within two months.",
        "",
        "I can keep the first pass async-friendly and specific to the existing customer path. Would you rather see the first audit outline here, or do a quick call?",
      ].join("\n"),
    },
  ]);
  const repaired = await composeProposalCoverLetterWithKimi(composeInput, repairProvider);
  assert.equal(repaired.usedLlm, true, JSON.stringify(repaired, null, 2));
  assert.equal(repaired.generationTrace.repairAttempted, true);
  assert.equal(repairProvider.requests.length, 2);
  assertProblemLedProposal(repaired.proposalText, ["shopify", "klaviyo", "welcome", "abandoned cart", "post-purchase", "win-back"]);

  const unavailable = await composeProposalCoverLetterWithKimi(composeInput, new FakeProposalProvider({}, false));
  assert.equal(unavailable.usedLlm, false);
  assert.equal(unavailable.generationTrace.mode, "deterministic_fallback");
  assert.match(unavailable.reason ?? "", /unavailable/i);
  assert.equal(unavailable.proposalText, deterministicFallbackDraft.proposalText);

  const hardFail = await composeProposalCoverLetterWithKimi(composeInput, new FakeProposalProvider([
    {
      candidates: [
        {
          angleId: "customer-moment-breakdown",
          angleLabel: "Customer moment breakdown",
          openerShape: "customer-moment",
          proposalText: "Hope you're well. I can help with email marketing.",
        },
      ],
    },
    {
      proposalText: "Dear Hiring Manager, I am the perfect fit for this opportunity.",
    },
  ]));
  assert.equal(hardFail.usedLlm, false);
  assert.equal(hardFail.generationTrace.mode, "deterministic_fallback");
  assert.equal(hardFail.generationTrace.repairAttempted, true);
  assert.match(hardFail.reason ?? "", /repair blocked/i);

  const requiredPrefixJob = scoreJob(job({
    id: "proposal-required-prefix",
    title: "Email design system for a multi-brand agency",
    description: [
      "Need Figma email design support for Shopify campaigns and Klaviyo templates.",
      "The work is high-volume, mobile-first, and needs better hierarchy, CTA clarity, and reusable modules.",
      "To show you've read this post in full, start your response with the phrase \"Design Guru\" followed by three of the largest brands you've designed for.",
    ].join(" "),
    category: "Email Design",
    skills: ["Figma", "Email Design", "Shopify", "Klaviyo"],
  }));
  const requiredPrefixInput = buildComposeInput(requiredPrefixJob);
  const requiredPrefixCompose = await composeProposalCoverLetterWithKimi(requiredPrefixInput, new FakeProposalProvider({
    candidates: [
      {
        angleId: "hierarchy-first-read",
        angleLabel: "Hierarchy-first read",
        openerShape: "hierarchy-first",
        proposalText: [
          "Design Guru - Truly Beauty, The Fly Boutique, Dr Rachael",
          "",
          "The bottleneck in this brief is that a mobile reader has to decide too quickly, and the Figma + Shopify + Klaviyo template stack is not making hierarchy or CTA clarity do enough work across multiple brands. If reusable modules stay muddy, production speed slows down and can reduce conversion.",
          "",
          "My first 3-5 day move would be to audit one live template family, fix the first hierarchy and CTA issues, and define the reusable module decisions the team can scale. Done = one template path is cleaner, the design system rules are clearer, and the next rollout is easier to approve.",
          "",
          "For proof, I would use Design Case Studies, where premium DTC email systems lifted click-through rate 38% by making the offer and CTA easier to read on mobile.",
          "",
          "I can keep the first pass async-friendly and tightly scoped to one template family before widening the system. Would you rather see the first outline here, or do a quick call?",
        ].join("\n"),
      },
    ],
  }));
  assert.equal(requiredPrefixCompose.usedLlm, true);
  assert(requiredPrefixCompose.proposalText.startsWith("Design Guru - Truly Beauty, The Fly Boutique, Dr Rachael"));
  assert(!/^Design Guru[\s\S]*Steve here/i.test(requiredPrefixCompose.proposalText));
  assertProblemLedProposal(requiredPrefixCompose.proposalText, ["figma", "shopify", "klaviyo", "mobile", "hierarchy", "cta"]);

  console.log("proposal cover letter composer tests passed");
}

run().catch((error) => {
  console.error("proposal cover letter composer tests failed:");
  console.error(error);
  process.exit(1);
});
