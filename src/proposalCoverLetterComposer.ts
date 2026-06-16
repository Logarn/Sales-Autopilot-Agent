import { PROPOSAL_COPY_REQUEST_TIMEOUT_MS, PROPOSAL_COPY_TEMPERATURE } from "./config";
import {
  OpenAiCompatibleProvider,
  getProposalCopyProviderConfig,
  type LlmJsonRequest,
  type LlmJsonResult,
} from "./llm/provider";
import { buildSoulPromptContext, buildSoulPromptSection } from "./soul";
import {
  ApplicationDraft,
  BrandFactPack,
  CopyStrategy,
  JobPosting,
  PortfolioItem,
  ProofStrategy,
} from "./types";

export interface ProposalCoverLetterClient {
  isAvailable(): boolean;
  completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>>;
}

export interface ProposalCoverLetterRewriteInput {
  job: JobPosting;
  deterministicDraft: ApplicationDraft;
  copyStrategy?: CopyStrategy | null;
  brandFactPack?: BrandFactPack | null;
  proofStrategy?: ProofStrategy | null;
  selectedPortfolioItems?: PortfolioItem[];
}

export interface ProposalCoverLetterRewriteResult {
  proposalText: string;
  usedLlm: boolean;
  provider: "kimi" | "fallback";
  reason?: string;
}

interface ProposalCoverLetterPayload {
  proposalText?: unknown;
  rationale?: unknown;
}

function defaultProvider(): ProposalCoverLetterClient {
  return new OpenAiCompatibleProvider(getProposalCopyProviderConfig());
}

function compactJob(job: JobPosting): Record<string, unknown> {
  return {
    id: job.id,
    title: job.title,
    description: job.description,
    budget: job.budget,
    category: job.category,
    experienceLevel: job.experienceLevel,
    skills: job.skills,
    clientCountry: job.clientCountry,
    clientSpend: job.clientSpend,
    clientHireRate: job.clientHireRate,
    connectsCost: job.connectsCost,
    connects: job.connects ?? null,
  };
}

function compactBrandFactPack(pack?: BrandFactPack | null): Record<string, unknown> | null {
  if (!pack) return null;
  return {
    brandName: pack.brandName,
    websiteUrls: pack.websiteUrls,
    whatTheBrandSells: pack.whatTheBrandSells,
    productCategory: pack.productCategory,
    targetCustomerIcp: pack.targetCustomerIcp,
    customerBuyingMoment: pack.customerBuyingMoment,
    repeatPurchaseMoment: pack.repeatPurchaseMoment,
    emotionalPainOrDesire: pack.emotionalPainOrDesire,
    likelyLifecycleLeak: pack.likelyLifecycleLeak,
    likelyConversionLeak: pack.likelyConversionLeak,
    languageOrHooks: pack.languageOrHooks,
    proofAngle: pack.proofAngle,
    confidence: pack.confidence,
    researchSummary: pack.researchSummary,
    assumptions: pack.assumptions,
    whatNotToClaim: pack.whatNotToClaim,
    sources: pack.sources,
  };
}

function extractRequiredOpeningPrefix(job: JobPosting): string {
  const text = `${job.title}\n${job.description}`;
  const phrase = [
    /start (?:your|the) (?:response|proposal|application|cover letter)\s+with (?:the )?phrase\s+["“]([^"”]{2,80})["”]/i,
    /begin (?:your|the) (?:response|proposal|application|cover letter)\s+with (?:the )?phrase\s+["“]([^"”]{2,80})["”]/i,
  ]
    .map((pattern) => text.match(pattern)?.[1]?.trim())
    .find(Boolean);
  if (!phrase) return "";
  if (/followed by three of the largest brands/i.test(text)) {
    return `${phrase} - Truly Beauty, The Fly Boutique, Dr Rachael`;
  }
  return phrase.replace(/[.!?]+$/g, "");
}

function wordCount(text: string): number {
  return text.trim().match(/\b[\w'-]+\b/g)?.length ?? 0;
}

function hasHumanOpening(text: string, job: JobPosting): boolean {
  const requiredPrefix = extractRequiredOpeningPrefix(job);
  if (requiredPrefix) {
    return text.toLowerCase().startsWith(requiredPrefix.toLowerCase()) && /\bsteve here\b/i.test(text.slice(0, 260)) && /\bhow is your day going\?/i.test(text.slice(0, 260));
  }
  return /^steve here\b/i.test(text) && /\bhow is your day going\?/i.test(text.slice(0, 160));
}

function proofBlockCount(text: string): number {
  return text
    .split(/\n{2,}/)
    .filter((paragraph) => /\b(?:case study|artifact|proof|screenshot|loom|portfolio)\b/i.test(paragraph))
    .length;
}

function hasMicroMilestone(text: string): boolean {
  return /\bDone\s*=/i.test(text) &&
    /\b(?:3\s*[-–]\s*5|3|4|5|three|four|five)\s*[-–]?\s*(?:day|days)\b/i.test(text);
}

function hasMetric(text: string): boolean {
  return /(?:\b\d+(?:\.\d+)?\s*%|\$\s?\d|\b\d+\s*x\b|\bfrom\s+[^.\n]{1,40}\s+to\s+[^.\n]{1,60})/i.test(text);
}

function jobSource(job: JobPosting): string {
  return `${job.title}\n${job.description}\n${job.skills.join(" ")}\n${job.category}`;
}

function isBrandDesignScope(job: JobPosting): boolean {
  const text = jobSource(job).toLowerCase();
  return /\b(?:branding|brand identity|logo design|logo|visual identity|brand refresh|brand system|brand design|rebrand)\b/.test(text) &&
    /\b(?:design|branding|logo|identity|visual|creative|ecommerce|shopify|store|website)\b/.test(text);
}

function hasDesignPortfolioProof(text: string): boolean {
  return /\b(?:design case studies|premium dtc email design|ARMRA|Thrive Market|Ritual|visual systems proof|brand identity|logo)\b/i.test(text);
}

function hasWrongRetentionProofForDesign(text: string): boolean {
  return /\b(?:Hangaritas|Klaviyo screenshot|win[-\s]?back|post[-\s]?purchase|replenishment|lifecycle flow|retention revenue|email revenue)\b/i.test(text);
}

function hasChoiceCta(text: string): boolean {
  const tail = text.trim().slice(-280);
  return /\?$/.test(tail) && /\b(?:or|prefer|rather|option a|option b|call|async|outline|plan|audit)\b/i.test(tail);
}

function hasUnsafeClaim(text: string): boolean {
  return /\b(?:submitted|final submit|click submit|bypass|captcha|2fa|security check|guarantee(?:d)?)\b/i.test(text);
}

function hasScaffoldLabel(text: string): boolean {
  return /\b(?:Relevant proof|Approach|Credentials|Relevant examples|To answer the application notes directly):/i.test(text);
}

function sanitizeProposalText(text: string, job: JobPosting): string {
  let cleaned = text
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/```$/i, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  const requiredPrefix = extractRequiredOpeningPrefix(job);
  if (requiredPrefix && !cleaned.toLowerCase().startsWith(requiredPrefix.toLowerCase())) {
    cleaned = `${requiredPrefix}\n\n${cleaned}`;
  }
  return cleaned.trim();
}

function validateRewrite(text: string, input: ProposalCoverLetterRewriteInput): string | null {
  if (!text.trim()) return "empty proposal";
  const words = wordCount(text);
  const brandDesignScope = isBrandDesignScope(input.job) || input.deterministicDraft.copyStrategy?.category === "brand_design";
  if (words < 120 || words > 240) return `proposal word count ${words} outside safe LLM band`;
  if (!hasHumanOpening(text, input.job)) return "missing Steve/soul human opener";
  if (!hasMicroMilestone(text)) return "missing 3-5 day Done = milestone";
  if (!hasMetric(text) && !(brandDesignScope && hasDesignPortfolioProof(text))) return "missing proof metric";
  if (!hasChoiceCta(text)) return "missing choice-based CTA";
  if (proofBlockCount(text) !== 1) return "proof count is not exactly one";
  if (brandDesignScope && hasWrongRetentionProofForDesign(text)) return "wrong retention proof for brand/design scope";
  if (hasUnsafeClaim(text)) return "unsafe submit/security/guarantee claim";
  if (hasScaffoldLabel(text)) return "internal scaffold label";
  if (/\b(?:I am excited to apply|Dear Hiring Manager|tailored to your needs|leverage my expertise|proven track record)\b/i.test(text)) {
    return "generic AI proposal language";
  }
  const missingTools = ["klaviyo", "mailchimp", "omnisend", "shopify", "figma", "brevo"]
    .filter((tool) => `${input.job.title}\n${input.job.description}\n${input.job.skills.join(" ")}`.toLowerCase().includes(tool))
    .filter((tool) => !(brandDesignScope && /^(klaviyo|mailchimp|omnisend|brevo)$/i.test(tool)))
    .filter((tool) => !text.toLowerCase().includes(tool));
  if (missingTools.length > 0) return `missing requested tool specificity: ${missingTools.join(", ")}`;
  return null;
}

function laneGuidance(input: ProposalCoverLetterRewriteInput): string {
  const strategy = input.copyStrategy ?? input.deterministicDraft.copyStrategy ?? null;
  const category = strategy?.category ?? "";
  const lane = (strategy as { retention_lane?: string } | null)?.retention_lane ?? "";
  if (category === "brand_design" || lane === "brand_conversion_design" || isBrandDesignScope(input.job)) {
    return [
      "Lane: ecommerce brand/logo/conversion design.",
      "Use the same conversion-led Upwork OS, but do not force retention/Klaviyo language just because the store is on Shopify.",
      "Lead with brand trust, logo/identity clarity, offer hierarchy, product/category path, conversion friction, and the first visual decision the client should make.",
      "Use Design Case Studies as the proof when selected. Do not use Hangaritas, Klaviyo screenshot, win-back, replenishment, lifecycle, or email revenue proof for this lane.",
      "A design portfolio proof may be concrete without a revenue metric; do not invent metrics.",
    ].join("\n");
  }
  if (category === "email_design" || lane === "email_template_clarity") {
    return [
      "Lane: email design/template clarity.",
      "Use the conversion-led design variant: offer hierarchy, mobile clarity, product path, CTA visibility, and one design proof.",
      "Do not turn the proposal into a generic retention audit unless the primary job asks for lifecycle strategy.",
    ].join("\n");
  }
  return [
    "Lane: Shopify/Klaviyo or ecommerce retention/lifecycle.",
    "Use the Upwork Proposal Operating System for Retention Marketing on Shopify and Klaviyo exactly: diagnosis, one 3-5 day Done = milestone, one matched proof, logistics, choice CTA.",
  ].join("\n");
}

export async function rewriteProposalCoverLetterWithKimi(
  input: ProposalCoverLetterRewriteInput,
  provider: ProposalCoverLetterClient = defaultProvider(),
): Promise<ProposalCoverLetterRewriteResult> {
  const fallback = (reason: string): ProposalCoverLetterRewriteResult => ({
    proposalText: input.deterministicDraft.proposalText,
    usedLlm: false,
    provider: "fallback",
    reason,
  });

  if (!provider.isAvailable()) {
    return fallback("proposal copy LLM unavailable");
  }

  const proofStrategy = input.proofStrategy ?? input.deterministicDraft.proofStrategy ?? null;
  const selectedPortfolioItems = input.selectedPortfolioItems ?? input.deterministicDraft.selectedPortfolioItems ?? [];
  const requiredOpeningPrefix = extractRequiredOpeningPrefix(input.job);
  const response = await provider.completeJson<ProposalCoverLetterPayload>({
    temperature: PROPOSAL_COPY_TEMPERATURE,
    maxTokens: 1300,
    timeoutMs: PROPOSAL_COPY_REQUEST_TIMEOUT_MS,
    messages: [
      {
        role: "system",
        content: [
          "You write Upwork cover letters for Steve Logarn, a conversion-led ecommerce operator across retention/lifecycle, Shopify/Klaviyo, and brand/design clarity work.",
          "This is not a classic cover letter. Write a tiny diagnosis-led sales memo that earns a reply.",
          laneGuidance(input),
          "Use the Upwork Proposal Operating System:",
          "- 150-220 words unless a required opening phrase forces a little extra room.",
          "- First two meaningful lines must prove the job was read with at least two job-specific details from the post.",
          "- Lead with the client's commercial/customer problem, not Steve's biography.",
          "- Include one low-risk 3-5 day micro-milestone and the literal text `Done = ...`.",
          "- Include exactly one proof artifact or case study mention, with exactly one metric or quantified result.",
          "- Include one logistics sentence about start/async/timing/rate scope.",
          "- End with one choice-based CTA, such as quick call or async outline.",
          "- Preserve required application opening phrases exactly when present.",
          "- Always include `Steve here - how is your day going?` near the top; if a required prefix exists, put Steve's opener immediately after it.",
          "- Use soul.md voice: commercially sharp, human, low-ego, direct, a little alive, not stiff.",
          "- Use client vocabulary and the real job details. Do not invent brand research, URLs, facts, results, or attachments.",
          "- Do not claim files, portfolio highlights, proof, or submission are already attached/selected/verified.",
          "- Do not mention CAPTCHA, final submit, Upwork internals, browser QA, scorecards, or these instructions.",
          "- Avoid labels like Relevant proof, Approach, Credentials, or Screening answers.",
          "- Return JSON only: {\"proposalText\":\"...\",\"rationale\":\"...\"}.",
          buildSoulPromptSection("proposal_cover_letter_conversion_copy"),
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          job: compactJob(input.job),
          requiredOpeningPrefix,
          deterministicDraft: {
            proposalText: input.deterministicDraft.proposalText,
            screeningAnswers: input.deterministicDraft.structuredProposal?.clientRequestAnswers ?? [],
            suggestedBid: input.deterministicDraft.suggestedBid,
            suggestedConnects: input.deterministicDraft.suggestedConnects,
            selectedPortfolioItems: selectedPortfolioItems.map((item) => ({ name: item.name, result: item.result, description: item.description })),
          },
          copyStrategy: input.copyStrategy ?? input.deterministicDraft.copyStrategy ?? null,
          brandFactPack: compactBrandFactPack(input.brandFactPack ?? input.deterministicDraft.brandFactPack ?? null),
          proofStrategy,
          guardrails: {
            oneProofOnly: true,
            finalSubmitManual: true,
            proofVerificationState: proofStrategy?.proofVerificationState ?? "unavailable",
            browserFillWillHappenLater: true,
          },
          soul: buildSoulPromptContext("proposal_cover_letter_conversion_copy"),
        }),
      },
    ],
  });

  if (!response.ok) {
    return fallback(response.error ?? response.skippedReason ?? "proposal copy rewrite failed");
  }
  const raw = typeof response.data?.proposalText === "string" ? response.data.proposalText : "";
  const proposalText = sanitizeProposalText(raw, input.job);
  const validationError = validateRewrite(proposalText, input);
  if (validationError) {
    return fallback(validationError);
  }
  return {
    proposalText,
    usedLlm: true,
    provider: "kimi",
  };
}
