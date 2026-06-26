import { PROPOSAL_COPY_REQUEST_TIMEOUT_MS, PROPOSAL_COPY_TEMPERATURE } from "./config";
import {
  OpenAiCompatibleProvider,
  getProposalCopyProviderConfig,
  type LlmJsonRequest,
  type LlmJsonResult,
} from "./llm/provider";
import { buildSoulPromptContext, buildSoulPromptSection } from "./soul";
import type { ProposalMemoryCalibrationContext } from "./proposalMemoryCalibration";
import {
  BrandFactPack,
  BrandResearchStatus,
  CopyStrategy,
  JobPosting,
  JobUnderstanding,
  PortfolioItem,
  ProofStrategy,
  ProposalCandidateTrace,
  ProposalGenerationTrace,
} from "./types";
import { evaluateDraftQualityGate } from "./skills/proposalCopywritingSkill";

export interface ProposalCoverLetterClient {
  isAvailable(): boolean;
  completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>>;
}

export interface ProposalCoverLetterComposeInput {
  job: JobPosting;
  jobUnderstanding: JobUnderstanding;
  brandResearchStatus: BrandResearchStatus;
  copyStrategy: CopyStrategy;
  brandFactPack?: BrandFactPack | null;
  proofStrategy?: ProofStrategy | null;
  selectedPortfolioItems?: PortfolioItem[];
  fallbackProposalText: string | (() => string);
  fallbackScreeningAnswers?: string[];
  suggestedBid?: string;
  suggestedConnects?: number;
  proposalMemoryCalibration?: ProposalMemoryCalibrationContext;
}

export interface ProposalCoverLetterComposeResult {
  proposalText: string;
  usedLlm: boolean;
  provider: "kimi" | "fallback";
  reason?: string;
  generationTrace: ProposalGenerationTrace;
}

interface ProposalAnglePlan {
  id: string;
  label: string;
  openerShape: string;
  commercialFocus: string;
  firstDiagnosticStep: string;
  proofFit: string;
  instructions: string;
}

interface ProposalComposePayload {
  candidates?: unknown;
  selectedAngleId?: unknown;
  selected_angle_id?: unknown;
  proposalText?: unknown;
  proposal_text?: unknown;
  proposal?: unknown;
  content?: unknown;
  body?: unknown;
  text?: unknown;
}

interface ProposalCandidatePayload {
  angleId?: unknown;
  angle_id?: unknown;
  angleLabel?: unknown;
  angle_label?: unknown;
  openerShape?: unknown;
  opener_shape?: unknown;
  proposalText?: unknown;
  proposal_text?: unknown;
  proposal?: unknown;
  coverLetter?: unknown;
  cover_letter?: unknown;
  text?: unknown;
  body?: unknown;
  content?: unknown;
  rationale?: unknown;
  reason?: unknown;
}

interface ParsedCandidate {
  angleId: string;
  angleLabel: string;
  openerShape: string;
  proposalText: string;
  rationale: string;
}

interface EvaluatedCandidate {
  plan: ProposalAnglePlan;
  proposalText: string;
  rationale: string;
  score: number;
  valid: boolean;
  issues: string[];
}

function defaultProvider(): ProposalCoverLetterClient {
  return new OpenAiCompatibleProvider(getProposalCopyProviderConfig());
}

function wordCount(text: string): number {
  return text.trim().match(/\b[\w'-]+\b/g)?.length ?? 0;
}

function sourceText(job: JobPosting): string {
  return `${job.title}\n${job.description}\n${job.skills.join(" ")}\n${job.category}`;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value?.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function firstString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstParagraph(text: string): string {
  return text.split(/\n{2,}/).map((part) => part.trim()).find(Boolean) ?? "";
}

function firstSentence(text: string): string {
  const sentence = text.replace(/\s+/g, " ").trim().match(/^[^.!?]+[.!?]?/);
  return sentence?.[0]?.trim() ?? "";
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
    clientTotalHires: job.clientTotalHires,
    clientFeedbackCount: job.clientFeedbackCount,
    connectsCost: job.connectsCost,
    connects: job.connects ?? null,
  };
}

function compactJobUnderstanding(jobUnderstanding: JobUnderstanding): Record<string, unknown> {
  return {
    actualJobRequest: jobUnderstanding.actualJobRequest,
    clientBusiness: jobUnderstanding.clientBusiness,
    customerType: jobUnderstanding.customerType,
    commercialPain: jobUnderstanding.commercialPain,
    emotionalPain: jobUnderstanding.emotionalPain,
    likelyLifecycleOrConversionLeak: jobUnderstanding.likelyLifecycleOrConversionLeak,
    desiredOutcome: jobUnderstanding.desiredOutcome,
    requestedTools: jobUnderstanding.requestedTools,
    requestedDeliverables: jobUnderstanding.requestedDeliverables,
    unknowns: jobUnderstanding.unknowns,
  };
}

function compactBrandResearchStatus(status: BrandResearchStatus): Record<string, unknown> {
  return {
    attempted: status.attempted,
    status: status.status,
    evidence: status.evidence,
    claims: status.claims,
    unknowns: status.unknowns,
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
    customerEducationGaps: pack.customerEducationGaps,
    objectionsOrTrustGaps: pack.objectionsOrTrustGaps,
    languageOrHooks: pack.languageOrHooks,
    proofAngle: pack.proofAngle,
    confidence: pack.confidence,
    researchSummary: pack.researchSummary,
    assumptions: pack.assumptions,
    whatNotToClaim: pack.whatNotToClaim,
    sources: pack.sources,
  };
}

function compactProofStrategy(strategy?: ProofStrategy | null): Record<string, unknown> | null {
  if (!strategy) return null;
  return {
    selectedProofNames: strategy.selectedProofNames,
    selectedAttachmentPaths: strategy.selectedAttachmentPaths,
    selectedPortfolioHighlights: strategy.selectedPortfolioHighlights,
    proofVerificationState: strategy.proofVerificationState,
    summary: strategy.summary,
    warnings: strategy.warnings,
  };
}

function extractRequiredOpeningPrefix(job: JobPosting): string {
  const text = `${job.title}\n${job.description}`;
  const match = [
    /start (?:your|the) (?:response|proposal|application|cover letter)\s+with (?:the )?phrase\s+["“]([^"”]{2,80})["”]/i,
    /begin (?:your|the) (?:response|proposal|application|cover letter)\s+with (?:the )?phrase\s+["“]([^"”]{2,80})["”]/i,
  ]
    .map((pattern) => text.match(pattern)?.[1]?.trim())
    .find(Boolean);
  return match?.replace(/[.!?]+$/g, "") ?? "";
}

function isBrandDesignScope(job: JobPosting, copyStrategy?: CopyStrategy | null): boolean {
  const category = copyStrategy?.category ?? "";
  const lane = copyStrategy?.retention_lane ?? "";
  const text = sourceText(job).toLowerCase();
  if (category === "brand_design" || lane === "brand_conversion_design") return true;
  return /\b(?:branding|brand identity|logo design|logo|visual identity|brand refresh|brand system|rebrand)\b/i.test(text);
}

function isEmailDesignScope(job: JobPosting, copyStrategy?: CopyStrategy | null): boolean {
  const category = copyStrategy?.category ?? "";
  const lane = copyStrategy?.retention_lane ?? "";
  if (category === "email_design" || lane === "email_template_clarity") return true;
  const text = sourceText(job).toLowerCase();
  return /\b(?:email design|template design|email template|figma|design system)\b/i.test(text);
}

function requestedToolTerms(job: JobPosting, copyStrategy: CopyStrategy): string[] {
  const text = sourceText(job).toLowerCase();
  const requested = new Set((copyStrategy.requested_tools ?? []).map((tool) => tool.toLowerCase()));
  return [
    "klaviyo",
    "mailchimp",
    "omnisend",
    "brevo",
    "shopify",
    "figma",
    "attentive",
    "postscript",
    "deliverability",
    "segmentation",
  ].filter((term) => text.includes(term) || requested.has(term));
}

function laneGuidance(input: ProposalCoverLetterComposeInput): string {
  if (isBrandDesignScope(input.job, input.copyStrategy)) {
    return [
      "Lane: ecommerce brand/logo/conversion design.",
      "Lead with trust, identity clarity, offer hierarchy, buying-path friction, and what makes the store easier to buy from.",
      "Do not force Klaviyo or lifecycle language into a primary branding/logo/design brief unless the job actually asks for it.",
      "Proof should stay in the design/conversion lane when that is the real scope.",
    ].join("\n");
  }
  if (isEmailDesignScope(input.job, input.copyStrategy)) {
    return [
      "Lane: email design/template clarity.",
      "Lead with hierarchy, mobile readability, offer clarity, CTA visibility, and the conversion cost of muddy layouts.",
      "Do not drift into generic lifecycle audit copy unless the brief is explicitly strategic.",
    ].join("\n");
  }
  return [
    "Lane: retention/lifecycle/CRM strategy.",
    "Lead with the commercial leak in the current lifecycle, customer moment, segmentation, cadence, or deliverability setup.",
    "Use Klaviyo/Shopify/tool language only after the buyer problem is clear.",
  ].join("\n");
}

function proofArtifactHint(input: ProposalCoverLetterComposeInput): string {
  const fromProofStrategy = input.proofStrategy?.selectedPortfolioHighlights?.[0]
    ?? input.proofStrategy?.selectedProofNames?.[0]
    ?? "";
  if (fromProofStrategy) return fromProofStrategy;
  return input.selectedPortfolioItems?.[0]?.name ?? input.copyStrategy.proof_angle ?? "the closest matched proof artifact";
}

function addAngle(target: ProposalAnglePlan[], angle: ProposalAnglePlan): void {
  if (target.some((item) => item.id === angle.id || item.openerShape === angle.openerShape)) return;
  target.push(angle);
}

function buildAnglePlans(input: ProposalCoverLetterComposeInput): ProposalAnglePlan[] {
  const plans: ProposalAnglePlan[] = [];
  const proofHint = proofArtifactHint(input);
  const lifecycleGap = input.copyStrategy.likely_lifecycle_gap || input.jobUnderstanding.likelyLifecycleOrConversionLeak;
  const commercialPain = input.copyStrategy.client_commercial_pain || input.jobUnderstanding.commercialPain;
  const desiredOutcome = input.jobUnderstanding.desiredOutcome || input.copyStrategy.money_leak;
  const customerMoment = input.copyStrategy.repeat_purchase_or_conversion_moment || input.copyStrategy.buying_moment;
  const deliverables = sourceText(input.job).toLowerCase();

  if (isBrandDesignScope(input.job, input.copyStrategy)) {
    addAngle(plans, {
      id: "trust-gap-diagnosis",
      label: "Trust gap diagnosis",
      openerShape: "trust-gap",
      commercialFocus: "the store or identity is asking buyers to trust too much before the design earns it",
      firstDiagnosticStep: "map the trust breaks across the first buying path and rank which visual decisions are costing conversion first",
      proofFit: proofHint,
      instructions: "Open from trust erosion, not design résumé language.",
    });
    addAngle(plans, {
      id: "buying-path-friction",
      label: "Buying path friction",
      openerShape: "buying-path",
      commercialFocus: "buyers may be getting lost between landing, product evaluation, and action",
      firstDiagnosticStep: "review homepage to PDP/cart friction and show the first layout or hierarchy fixes that reduce hesitation",
      proofFit: proofHint,
      instructions: "Open from buying-path friction and what it does to conversion.",
    });
    addAngle(plans, {
      id: "offer-hierarchy-breakdown",
      label: "Offer hierarchy breakdown",
      openerShape: "offer-hierarchy",
      commercialFocus: "the offer and product story may not be landing fast enough for cold traffic",
      firstDiagnosticStep: "audit the current offer hierarchy and define the first visual/message stack that should become easier to scan",
      proofFit: proofHint,
      instructions: "Open from offer clarity and what the buyer cannot understand quickly enough.",
    });
    addAngle(plans, {
      id: "identity-decision-bottleneck",
      label: "Identity decision bottleneck",
      openerShape: "identity-bottleneck",
      commercialFocus: "the client may need sharper identity decisions before execution volume matters",
      firstDiagnosticStep: "pin down the identity decisions blocking consistent execution before expanding scope",
      proofFit: proofHint,
      instructions: "Open from the cost of unclear identity decisions.",
    });
    return plans.slice(0, 4);
  }

  if (isEmailDesignScope(input.job, input.copyStrategy)) {
    addAngle(plans, {
      id: "hierarchy-first-read",
      label: "Hierarchy-first read",
      openerShape: "hierarchy-first",
      commercialFocus: "the template may be burying the offer, CTA, or product path before the reader decides to click",
      firstDiagnosticStep: "review the current template hierarchy and fix the first mobile-read problem before building wider sets",
      proofFit: proofHint,
      instructions: "Open from the reading path and why the current design could be leaking clicks.",
    });
    addAngle(plans, {
      id: "mobile-reader-dropoff",
      label: "Mobile reader dropoff",
      openerShape: "mobile-dropoff",
      commercialFocus: "mobile readers may be losing the offer before the CTA becomes obvious",
      firstDiagnosticStep: "audit the mobile reading path and show the first CTA/hierarchy changes worth testing",
      proofFit: proofHint,
      instructions: "Open from mobile reading friction, not from generic design taste.",
    });
    addAngle(plans, {
      id: "template-system-bottleneck",
      label: "Template system bottleneck",
      openerShape: "system-bottleneck",
      commercialFocus: "the team may not have a reusable system that keeps offers clear without slowing production",
      firstDiagnosticStep: "define the first reusable template decisions that improve speed without flattening conversion logic",
      proofFit: proofHint,
      instructions: "Open from design-system drag on output and performance.",
    });
    addAngle(plans, {
      id: "offer-clarity-path",
      label: "Offer clarity path",
      openerShape: "offer-clarity",
      commercialFocus: "the design may not be helping the reader understand the offer quickly enough",
      firstDiagnosticStep: "identify the first offer-clarity fix that changes what the reader sees and clicks first",
      proofFit: proofHint,
      instructions: "Open from offer clarity and buying momentum.",
    });
    return plans.slice(0, 4);
  }

  addAngle(plans, {
    id: "revenue-leak-diagnosis",
    label: "Revenue leak diagnosis",
    openerShape: "revenue-leak",
    commercialFocus: commercialPain || "revenue is likely leaking between first purchase and repeat purchase",
    firstDiagnosticStep: `diagnose the first leak inside ${lifecycleGap || "the lifecycle"} and show what gets fixed first`,
    proofFit: proofHint,
    instructions: "Open from the revenue leak, not from credentials.",
  });

  addAngle(plans, {
    id: "customer-moment-breakdown",
    label: "Customer moment breakdown",
    openerShape: "customer-moment",
    commercialFocus: customerMoment || "the buyer moment is probably underbuilt or mistimed",
    firstDiagnosticStep: `map the customer moment around ${customerMoment || desiredOutcome || "repeat purchase"} and identify the first message/flow change that builds confidence`,
    proofFit: proofHint,
    instructions: "Open from the buyer moment and why it breaks revenue or trust.",
  });

  if (/\bsegmentation|segment|list|subscriber|campaign|calendar|newsletter\b/i.test(deliverables)) {
    addAngle(plans, {
      id: "segmentation-cadence-miss",
      label: "Segmentation and cadence miss",
      openerShape: "segmentation-cadence",
      commercialFocus: "campaigns or list strategy may be sending too broadly or at the wrong rhythm",
      firstDiagnosticStep: "review the current segments and cadence and identify the first send logic that is creating noise instead of response",
      proofFit: proofHint,
      instructions: "Open from targeting or cadence inefficiency.",
    });
  }

  if (/\bdeliverability|sender|spam|inbox|reputation|hygiene\b/i.test(deliverables)) {
    addAngle(plans, {
      id: "deliverability-risk",
      label: "Deliverability risk",
      openerShape: "deliverability-risk",
      commercialFocus: "sender health may be undermining performance before the copy or flow logic can do its job",
      firstDiagnosticStep: "check sender health, segment quality, and the first deliverability fixes before expanding sends",
      proofFit: proofHint,
      instructions: "Open from risk to inbox placement and what that means for revenue.",
    });
  }

  if (/\bshopify|post-purchase|win-?back|welcome|replenishment|repeat purchase|ltv\b/i.test(deliverables)) {
    addAngle(plans, {
      id: "ltv-journey-gap",
      label: "LTV journey gap",
      openerShape: "ltv-journey",
      commercialFocus: "the Shopify journey may not be carrying buyers cleanly into the next purchase window",
      firstDiagnosticStep: "trace the first-purchase to repeat-purchase path and pick the first underbuilt lifecycle slice worth repairing",
      proofFit: proofHint,
      instructions: "Open from LTV and post-purchase path leakage.",
    });
  }

  return plans.slice(0, 5);
}

function proposalTextKeys(): string[] {
  return [
    "proposalText",
    "proposal_text",
    "proposal",
    "proposalDraft",
    "proposal_draft",
    "proposalBody",
    "proposal_body",
    "coverLetter",
    "cover_letter",
    "coverLetterText",
    "cover_letter_text",
    "letter",
    "content",
    "text",
    "body",
    "message",
    "output",
  ];
}

function extractNestedProposalText(value: unknown, depth = 0): string {
  if (typeof value === "string") return value;
  if (!value || depth > 4) return "";
  if (Array.isArray(value)) {
    const nested = value
      .map((item) => extractNestedProposalText(item, depth + 1))
      .filter(Boolean);
    return nested.find((item) => wordCount(item) >= 60) ?? nested[0] ?? "";
  }
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of proposalTextKeys()) {
    const nested = extractNestedProposalText(record[key], depth + 1);
    if (nested) return nested;
  }
  for (const nestedValue of Object.values(record)) {
    const nested = extractNestedProposalText(nestedValue, depth + 1);
    if (wordCount(nested) >= 60) return nested;
  }
  return "";
}

function extractProposalText(payload: ProposalCandidatePayload | ProposalComposePayload | undefined): string {
  if (!payload) return "";
  for (const key of proposalTextKeys()) {
    const nested = extractNestedProposalText((payload as Record<string, unknown>)[key]);
    if (nested) return nested;
  }
  return extractNestedProposalText(payload);
}

function sanitizeProposalText(text: string): string {
  return text
    .replace(/^```(?:json|text|markdown)?\s*/i, "")
    .replace(/```$/i, "")
    .split(/\n\s*(?:Rationale|Why this works|Explanation|Notes|Critique)\s*:/i)[0]
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findAnglePlan(angles: ProposalAnglePlan[], candidate: ParsedCandidate): ProposalAnglePlan {
  return angles.find((angle) => angle.id === candidate.angleId)
    ?? angles.find((angle) => angle.label.toLowerCase() === candidate.angleLabel.toLowerCase())
    ?? angles.find((angle) => angle.openerShape.toLowerCase() === candidate.openerShape.toLowerCase())
    ?? angles[0]!;
}

function extractCandidates(payload: ProposalComposePayload | undefined, angles: ProposalAnglePlan[]): ParsedCandidate[] {
  const rawArray = Array.isArray(payload?.candidates) ? payload?.candidates : null;
  if (rawArray && rawArray.length > 0) {
    return rawArray
      .map((item, index) => {
        const record = (item ?? {}) as ProposalCandidatePayload;
        const fallbackPlan = angles[index] ?? angles[0]!;
        const proposalText = sanitizeProposalText(extractProposalText(record));
        if (!proposalText) return null;
        return {
          angleId: firstString(record.angleId) || firstString(record.angle_id) || fallbackPlan.id,
          angleLabel: firstString(record.angleLabel) || firstString(record.angle_label) || fallbackPlan.label,
          openerShape: firstString(record.openerShape) || firstString(record.opener_shape) || fallbackPlan.openerShape,
          proposalText,
          rationale: firstString(record.rationale) || firstString(record.reason),
        };
      })
      .filter((item): item is ParsedCandidate => Boolean(item));
  }

  const singleProposal = sanitizeProposalText(extractProposalText(payload));
  if (!singleProposal) return [];
  const fallbackPlan = angles[0]!;
  return [{
    angleId: firstString(payload?.selectedAngleId) || firstString(payload?.selected_angle_id) || fallbackPlan.id,
    angleLabel: fallbackPlan.label,
    openerShape: fallbackPlan.openerShape,
    proposalText: singleProposal,
    rationale: "",
  }];
}

function hasFixedSurfaceOpener(text: string, requiredPrefix: string): boolean {
  if (requiredPrefix) return false;
  return /^(?:steve here|hey there|hi there|hello there|hope you(?:'re| are) well|hope your week is going well|how is your day going)/i.test(text.trim());
}

function evaluateCandidate(
  candidate: ParsedCandidate,
  plan: ProposalAnglePlan,
  input: ProposalCoverLetterComposeInput,
  requestedTools: string[],
  requiredPrefix: string,
): EvaluatedCandidate {
  const text = sanitizeProposalText(candidate.proposalText);
  const customIssues: string[] = [];
  if (requiredPrefix && !text.toLowerCase().startsWith(requiredPrefix.toLowerCase())) {
    customIssues.push("required opening prefix missing");
  }
  if (hasFixedSurfaceOpener(text, requiredPrefix)) {
    customIssues.push("fixed opener pattern");
  }
  if (/\b(?:hey there|how is your day going|hope you(?:'re| are) well)\b/i.test(text)) {
    customIssues.push("faux casual opener");
  }
  if (/\b(?:dear hiring manager|i am excited to apply|perfect fit|proven track record|tailored to your needs)\b/i.test(text)) {
    customIssues.push("generic upwork filler");
  }
  const concreteToolTerms = requestedTools.filter((tool) =>
    /^(?:klaviyo|mailchimp|omnisend|brevo|shopify|figma|attentive|postscript)$/i.test(tool),
  );
  if (concreteToolTerms.some((tool) => !text.toLowerCase().includes(tool.toLowerCase()))) {
    customIssues.push(`missing requested tool specificity: ${concreteToolTerms.filter((tool) => !text.toLowerCase().includes(tool.toLowerCase())).join(", ")}`);
  }

  const gate = evaluateDraftQualityGate({
    proposalText: text,
    job: input.job,
    copyStrategy: input.copyStrategy,
    brandFactPack: input.brandFactPack,
    skillLoaded: true,
    fullJobDescriptionRead: input.job.description.trim().length > 0 &&
      input.jobUnderstanding.fullJobDescription === input.job.description,
    copyStrategyCreated: Boolean(input.copyStrategy.one_sentence_sales_argument),
    finalSubmitManual: true,
    proofVerificationState: input.proofStrategy?.proofVerificationState ?? input.copyStrategy.proof_verification_state,
    screeningAnswers: input.fallbackScreeningAnswers,
    soulLoaded: true,
  });

  const issues = [
    ...customIssues,
    ...gate.issues.map((issue) => issue.code),
  ];
  const criticalCount = gate.issues.filter((issue) => issue.severity === "critical").length;
  const score = Math.max(0, (gate.scorecard?.score ?? 0) - customIssues.length * 12 - criticalCount * 4);

  return {
    plan,
    proposalText: text,
    rationale: candidate.rationale,
    score,
    valid: customIssues.length === 0 && gate.ready,
    issues: unique(issues),
  };
}

function toTrace(candidates: EvaluatedCandidate[], selectedAngleId?: string): ProposalCandidateTrace[] {
  return candidates.map((candidate) => ({
    angleId: candidate.plan.id,
    angleLabel: candidate.plan.label,
    openerShape: candidate.plan.openerShape,
    score: candidate.score,
    valid: candidate.valid,
    issues: candidate.issues,
    selected: candidate.plan.id === selectedAngleId,
  }));
}

function resolveFallbackProposalText(value: string | (() => string)): string {
  return typeof value === "function" ? value() : value;
}

function fallbackResult(
  input: ProposalCoverLetterComposeInput,
  reason: string,
  candidates: ProposalCandidateTrace[] = [],
  repairAttempted = false,
): ProposalCoverLetterComposeResult {
  return {
    proposalText: resolveFallbackProposalText(input.fallbackProposalText),
    usedLlm: false,
    provider: "fallback",
    reason,
    generationTrace: {
      mode: "deterministic_fallback",
      provider: "fallback",
      candidateCount: candidates.length,
      repairAttempted,
      fallbackReason: reason,
      candidates,
    },
  };
}

function buildComposeRequest(input: ProposalCoverLetterComposeInput, angles: ProposalAnglePlan[], requestedTools: string[], requiredPrefix: string): LlmJsonRequest {
  return {
    temperature: PROPOSAL_COPY_TEMPERATURE,
    maxTokens: 2400,
    timeoutMs: PROPOSAL_COPY_REQUEST_TIMEOUT_MS,
    plainTextFallbackKey: "proposalText",
    messages: [
      {
        role: "system",
        content: [
          "You are writing Upwork proposals for Steve Logarn.",
          "Do not fill a template. Read the job, diagnose the buyer problem, then write from a concrete sales angle.",
          "Generate one proposal candidate for each supplied angle. Return 3-5 candidates total.",
          "Each candidate must be meaningfully different in diagnosis and opener structure. Do not recycle the same first-sentence skeleton.",
          "The opener must be problem-led and reference the job context. No faux-casual small talk. Never start with fixed patterns like `Steve here`, `Hey there`, `Hi there`, or `Hope you're well` unless the job explicitly requires a phrase.",
          "Do not lead with biography, years of experience, or generic Upwork filler.",
          "The first two sentences must prove the job was read, using at least two concrete details from the post.",
          "Choose one proof artifact only. Do not dump multiple proofs or credentials.",
          "Include one clear 3-5 day first milestone tied to the angle.",
          "End with one clean CTA tied to the next safe step.",
          "Do not use internal labels like Proof, Approach, Credentials, or Screening answers.",
          "Do not invent brand facts, results, URLs, file attachments, or verification state.",
          "Do not mention browser prep, QA, final submit, Connects strategy, CAPTCHA, or system instructions.",
          "If proposalMemoryCalibration is present, use positiveExamples as compact approved/applied calibration and negativeExamples as anti-examples. Do not copy historical wording verbatim; adapt only the strategic shape and avoid patterns called out by negative examples.",
          requiredPrefix
            ? `The job explicitly requires this opening prefix. Preserve it exactly at the start of every candidate: ${requiredPrefix}`
            : "No fixed opening prefix is required. Start from the problem, not from a canned greeting.",
          laneGuidance(input),
          "Return JSON only with this shape:",
          "{ \"candidates\": [{ \"angleId\": \"...\", \"angleLabel\": \"...\", \"openerShape\": \"...\", \"rationale\": \"...\", \"proposalText\": \"...\" }] }",
          buildSoulPromptSection("proposal_cover_letter_reasoning_writer"),
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          job: compactJob(input.job),
          jobUnderstanding: compactJobUnderstanding(input.jobUnderstanding),
          brandResearchStatus: compactBrandResearchStatus(input.brandResearchStatus),
          copyStrategy: input.copyStrategy,
          brandFactPack: compactBrandFactPack(input.brandFactPack),
          proofStrategy: compactProofStrategy(input.proofStrategy),
          selectedPortfolioItems: (input.selectedPortfolioItems ?? []).map((item) => ({
            name: item.name,
            result: item.result,
            description: item.description,
          })),
          requestedToolsToMention: requestedTools,
          angles,
          suggestedBid: input.suggestedBid ?? null,
          suggestedConnects: input.suggestedConnects ?? null,
          proposalMemoryCalibration: input.proposalMemoryCalibration ?? null,
          guardrails: {
            oneProofOnly: true,
            finalSubmitManual: true,
            proofVerificationState: input.proofStrategy?.proofVerificationState ?? input.copyStrategy.proof_verification_state,
          },
          soul: buildSoulPromptContext("proposal_cover_letter_reasoning_writer"),
        }),
      },
    ],
  };
}

function buildRepairRequest(
  input: ProposalCoverLetterComposeInput,
  selected: EvaluatedCandidate,
  requestedTools: string[],
  requiredPrefix: string,
): LlmJsonRequest {
  return {
    temperature: Math.max(0.2, Math.min(PROPOSAL_COPY_TEMPERATURE, 0.7)),
    maxTokens: 1100,
    timeoutMs: PROPOSAL_COPY_REQUEST_TIMEOUT_MS,
    plainTextFallbackKey: "proposalText",
    messages: [
      {
        role: "system",
        content: [
          "Rewrite one Upwork proposal candidate so it passes quality review.",
          "Keep the same underlying angle, but fix the blocked issues.",
          "The opener must stay problem-led and specific to the job. No faux-casual small talk and no fixed canned opener patterns.",
          "Keep exactly one proof artifact, one 3-5 day milestone, and one clean CTA.",
          "Do not add internal labels or generic Upwork filler.",
          requiredPrefix
            ? `Preserve this required opening prefix exactly: ${requiredPrefix}`
            : "No fixed opening prefix is required.",
          "Return JSON only with { \"proposalText\": \"...\" }.",
          buildSoulPromptSection("proposal_cover_letter_rewriter"),
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          job: compactJob(input.job),
          jobUnderstanding: compactJobUnderstanding(input.jobUnderstanding),
          copyStrategy: input.copyStrategy,
          angle: selected.plan,
          selectedProposal: selected.proposalText,
          blockedIssues: selected.issues,
          requestedToolsToMention: requestedTools,
          proofStrategy: compactProofStrategy(input.proofStrategy),
          brandFactPack: compactBrandFactPack(input.brandFactPack),
          proposalMemoryCalibration: input.proposalMemoryCalibration ?? null,
          soul: buildSoulPromptContext("proposal_cover_letter_rewriter"),
        }),
      },
    ],
  };
}

function chooseBestCandidate(candidates: EvaluatedCandidate[]): EvaluatedCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    if (left.valid !== right.valid) return left.valid ? -1 : 1;
    if (left.score !== right.score) return right.score - left.score;
    return right.proposalText.length - left.proposalText.length;
  })[0] ?? null;
}

export async function composeProposalCoverLetterWithKimi(
  input: ProposalCoverLetterComposeInput,
  provider: ProposalCoverLetterClient = defaultProvider(),
): Promise<ProposalCoverLetterComposeResult> {
  const angles = buildAnglePlans(input);
  const requestedTools = requestedToolTerms(input.job, input.copyStrategy);
  const requiredPrefix = extractRequiredOpeningPrefix(input.job);

  if (!provider.isAvailable()) {
    return fallbackResult(input, "proposal copy LLM unavailable");
  }

  const response = await provider.completeJson<ProposalComposePayload>(
    buildComposeRequest(input, angles, requestedTools, requiredPrefix),
  );
  if (!response.ok) {
    return fallbackResult(input, response.error ?? response.skippedReason ?? "proposal composition failed");
  }

  const parsedCandidates = extractCandidates(response.data, angles);
  if (parsedCandidates.length === 0) {
    return fallbackResult(input, "proposal composition returned no usable candidates");
  }

  const evaluated = parsedCandidates.map((candidate) => {
    const plan = findAnglePlan(angles, candidate);
    return evaluateCandidate(candidate, plan, input, requestedTools, requiredPrefix);
  });
  const bestInitial = chooseBestCandidate(evaluated);
  if (!bestInitial) {
    return fallbackResult(input, "proposal composition produced no scored candidates");
  }

  if (bestInitial.valid) {
    const traces = toTrace(evaluated, bestInitial.plan.id);
    return {
      proposalText: bestInitial.proposalText,
      usedLlm: true,
      provider: "kimi",
      generationTrace: {
        mode: "llm_primary",
        provider: "kimi",
        candidateCount: evaluated.length,
        selectedAngleId: bestInitial.plan.id,
        selectedAngleLabel: bestInitial.plan.label,
        selectedOpenerShape: bestInitial.plan.openerShape,
        repairAttempted: false,
        candidates: traces,
      },
    };
  }

  const repair = await provider.completeJson<ProposalCandidatePayload>(
    buildRepairRequest(input, bestInitial, requestedTools, requiredPrefix),
  );
  if (!repair.ok) {
    return fallbackResult(
      input,
      `${repair.error ?? repair.skippedReason ?? "proposal repair failed"} after ${bestInitial.issues.join(", ")}`,
      toTrace(evaluated),
      true,
    );
  }

  const repairedCandidate: ParsedCandidate = {
    angleId: bestInitial.plan.id,
    angleLabel: bestInitial.plan.label,
    openerShape: bestInitial.plan.openerShape,
    proposalText: sanitizeProposalText(extractProposalText(repair.data)),
    rationale: firstString(repair.data?.rationale) || firstString(repair.data?.reason),
  };
  const repairedEvaluation = evaluateCandidate(repairedCandidate, bestInitial.plan, input, requestedTools, requiredPrefix);
  const finalCandidates = evaluated.map((candidate) => candidate.plan.id === bestInitial.plan.id ? repairedEvaluation : candidate);
  if (!repairedEvaluation.valid) {
    return fallbackResult(
      input,
      `proposal repair blocked by ${repairedEvaluation.issues.join(", ")}`,
      toTrace(finalCandidates),
      true,
    );
  }

  return {
    proposalText: repairedEvaluation.proposalText,
    usedLlm: true,
    provider: "kimi",
    generationTrace: {
      mode: "llm_primary",
      provider: "kimi",
      candidateCount: finalCandidates.length,
      selectedAngleId: repairedEvaluation.plan.id,
      selectedAngleLabel: repairedEvaluation.plan.label,
      selectedOpenerShape: repairedEvaluation.plan.openerShape,
      repairAttempted: true,
      candidates: toTrace(finalCandidates, repairedEvaluation.plan.id),
    },
  };
}

export const rewriteProposalCoverLetterWithKimi = composeProposalCoverLetterWithKimi;
