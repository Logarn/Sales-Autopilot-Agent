import { critiqueProposal } from "./critic";
import {
  BrandResearchRun,
  BrandResearchToolProvider,
  researchBrandForJob,
} from "./brandResearchProvider";
import { evaluateConnectsStrategy, formatConnectsStrategy } from "./connectsStrategy";
import { buildDeterministicJobIntelligence } from "./jobIntelligenceParser";
import { loadConnectsRules, loadFreelancerProfile, loadPortfolioLibrary } from "./profile";
import { loadProfileKnowledge } from "./profileKnowledge";
import { buildSalesLearningPromptContext } from "./salesLearningMemory";
import {
  buildInitialSkillUseTrace,
  finalizeSkillUseTrace,
  selectApplicationPrepSkills,
} from "./skillRuntime";
import { buildSoulRuntimeGuidance } from "./soul";
import { buildBrandFactPack, loadBrandResearchSkill } from "./skills/brandResearchSkill";
import { buildCopywritingDraft, evaluateDraftQualityGate, loadProposalCopywritingSkill } from "./skills/proposalCopywritingSkill";
import { selectPortfolioAssetsForJob } from "./skills/portfolioSelectionSkill";
import {
  ApplicationDraft,
  FreelancerProfile,
  JobPosting,
  KnowledgeArtifact,
  PortfolioItem,
  ProofStrategy,
  ScoredJob,
  StructuredProposalDraft,
} from "./types";

const RED_FLAG_TERMS = [
  "full-time",
  "onsite",
  "on-site",
  "w2",
  "rockstar",
  "guru",
  "cheap",
  "lowest bid",
  "asap",
  "24/7",
  "virtual assistant",
  "data entry",
  "go high level",
  "gohighlevel",
  "ghl",
];

const AI_SLUDGE_PATTERNS = [
  /i am excited to apply/gi,
  /i'd love the opportunity/gi,
  /i believe (that )?i('m| am) (the )?perfect fit/gi,
  /dear hiring manager/gi,
  /passionate about/gi,
  /with over \d+ years of experience/gi,
];

export interface BuildApplicationDraftOptions {
  brandResearchRun?: BrandResearchRun | null;
}

export interface BuildApplicationDraftWithResearchOptions {
  brandResearchProvider?: BrandResearchToolProvider;
}

function jobText(job: JobPosting): string {
  return [job.title, job.description, job.skills.join(" "), job.category].join(" ").toLowerCase();
}

function containsAny(text: string, terms: string[]): string[] {
  return terms.filter((term) => text.includes(term.toLowerCase()));
}

function isBeautyDtcKlaviyoJob(job: JobPosting): boolean {
  const text = jobText(job);
  return /beauty|skincare|cosmetic|dtc|d2c|shopify|ecommerce|klaviyo/.test(text);
}

function isKnownDifferentPlatformClaim(text: string, primaryPlatform: string): boolean {
  const normalizedPrimary = primaryPlatform.toLowerCase();
  if (!normalizedPrimary || normalizedPrimary === "unknown") return false;
  const platformTerms = [
    "klaviyo",
    "brevo",
    "hubspot",
    "customer.io",
    "omnisend",
    "mailerlite",
    "mailchimp",
    "attentive",
    "postscript",
    "sendgrid",
    "activecampaign",
    "braze",
    "iterable",
    "salesforce marketing cloud",
  ];
  const lower = text.toLowerCase();
  return platformTerms.some((platform) => platform !== normalizedPrimary && lower.includes(platform));
}

function platformLabel(intelligence: { primaryPlatform: string }): string | null {
  return intelligence.primaryPlatform && intelligence.primaryPlatform !== "unknown" ? intelligence.primaryPlatform : null;
}

function inferPainLine(job: JobPosting): string {
  const text = jobText(job);
  if (text.includes("audit")) {
    return "If the account needs an audit, the win is not a giant checklist. It is finding the few leaks that are actually costing revenue and fixing those first.";
  }
  if (text.includes("flow") || text.includes("automation")) {
    return "The hard part with Klaviyo flows is not getting them live. It is making sure they remove friction, build certainty, and give customers a reason to buy again before they drift away.";
  }
  if (text.includes("campaign")) {
    return "For DTC email, more campaigns usually is not the answer by itself. The leverage is a cleaner calendar, sharper angles, better segmentation, and reporting that shows what actually moved revenue.";
  }
  if (text.includes("sms")) {
    return "SMS can print money or irritate customers quickly. The difference is restraint, segmentation, timing, and making each send earn its place.";
  }
  return "If you are hiring for retention, the issue usually is not traffic. It is that customers buy once, then disappear 30, 60, or 90 days later.";
}

function selectRelevantKnowledge(artifacts: KnowledgeArtifact[], job: JobPosting, limit: number): KnowledgeArtifact[] {
  const text = jobText(job);
  return artifacts
    .map((artifact) => {
      const haystack = [artifact.title, artifact.tags.join(" "), artifact.summary].join(" ").toLowerCase();
      const tagMatches = artifact.tags.filter((tag) => text.includes(tag.toLowerCase())).length;
      const skillMatches = job.skills.filter((skill) => haystack.includes(skill.toLowerCase())).length;
      const titleMatch = artifact.title
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 3 && text.includes(word)).length;
      return { artifact, score: tagMatches * 4 + skillMatches * 3 + titleMatch };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.artifact.sourcePath.localeCompare(b.artifact.sourcePath))
    .slice(0, limit)
    .map(({ artifact }) => artifact);
}

function platformSafeKnowledge(artifacts: KnowledgeArtifact[], primaryPlatform: string): KnowledgeArtifact[] {
  return artifacts.filter((artifact) => {
    const text = [artifact.title, artifact.tags.join(" "), artifact.summary].join(" ");
    return !isKnownDifferentPlatformClaim(text, primaryPlatform);
  });
}

function selectProofPoints(profile: FreelancerProfile, job: JobPosting, knowledgeProof: KnowledgeArtifact[] = []): string[] {
  const text = jobText(job);
  const directSkillMatches = (profile.skills ?? []).filter((skill) => text.includes(skill.toLowerCase())).slice(0, 4);
  const allProof = profile.proofPoints ?? [];
  const priorityProof = allProof.filter((point) => {
    const lower = point.toLowerCase();
    return isBeautyDtcKlaviyoJob(job) && /(truly beauty|beauty|dtc|klaviyo|retention|lifecycle|shopify)/.test(lower);
  });
  const proof = [...priorityProof, ...allProof].slice(0, 3);
  const knowledge = knowledgeProof.map((artifact) => artifact.summary).slice(0, 2);
  return [...new Set([...knowledge, ...proof, ...directSkillMatches])].slice(0, 5);
}

function trimTerminalPunctuation(value: string): string {
  return value.trim().replace(/[.!?]+$/g, "");
}

function displayPortfolioExample(item: PortfolioItem): string {
  const withoutExtension = item.name
    .replace(/\.(pdf|png|jpe?g)$/i, "")
    .replace(/\s*[-–]\s*case study$/i, " case study")
    .trim();
  if (/^portfolio$/i.test(withoutExtension)) return "general retention portfolio";
  if (/^lifely$/i.test(withoutExtension)) return "Lifely case study";
  if (/^truly beauty$/i.test(withoutExtension)) return "Truly Beauty case study";
  return withoutExtension;
}

function extractClientRequestAnswers(
  job: ScoredJob,
  profile: FreelancerProfile,
  suggestedBid: string,
  portfolioItems: PortfolioItem[],
  proofPoints: string[]
): string[] {
  const source = `${job.title}\n${job.description}`;
  const answers: string[] = [];
  const add = (answer: string) => {
    if (!answers.includes(answer)) answers.push(answer);
  };

  if (/rate|hourly|budget|price|retainer/i.test(source)) {
    add(`For rate, I would use ${trimTerminalPunctuation(suggestedBid)}. If this becomes a retainer, I would scope the first month around audit, priority fixes, and reporting before expanding.`);
  }
  if (/portfolio|example|case stud|sample|previous work|proof/i.test(source)) {
    const namedExamples = portfolioItems.map((item) => `${displayPortfolioExample(item)}${item.result ? ` (${item.result})` : ""}`);
    const fallbackExamples = proofPoints.filter((point) => /beauty|dtc|klaviyo|retention|lifecycle|shopify|revenue/i.test(point)).slice(0, 2);
    const examples = [...namedExamples, ...fallbackExamples].slice(0, 2);
    add(examples.length ? `The closest examples I would use are ${examples.join("; ")}.` : "I would keep the proof tied to DTC lifecycle, Klaviyo, segmentation, and retention work that connects to repeat purchase and revenue.");
  }
  if (/availability|start|timeline|when can you/i.test(source)) {
    add("I can start with a short diagnostic pass, then prioritize the highest-impact lifecycle fixes first.");
  }
  if (/approach|plan|how would you|strategy|what would you/i.test(source)) {
    add("I would audit the account, find the revenue leaks, fix the highest-impact flows, segments, or campaign process, then measure repeat-purchase impact.");
  }
  if (/certif|klaviyo partner|partner/i.test(source)) {
    add("I bring Klaviyo partner experience plus DTC lifecycle and retention work.");
  }

  return answers.slice(0, 4);
}

function buildStructuredProposalDraft(args: {
  job: ScoredJob;
  profile: FreelancerProfile;
  opening: string;
  diagnosis: string;
  proof: string;
  clientRequestAnswers: string[];
  rateRetainerAnswer: string;
  cta: string;
  portfolioItems: PortfolioItem[];
  proposalText: string;
  suggestedConnects: number;
  suggestedBoostConnects: number;
  soulGuidance: string[];
}): StructuredProposalDraft {
  const attachments = args.portfolioItems.map((item) => item.name);
  const highlights = args.portfolioItems.map((item) => item.result).filter(Boolean).slice(0, 3);
  const connectsPlan = args.suggestedBoostConnects > 0
    ? `Use ${args.suggestedConnects} required Connects; consider ${args.suggestedBoostConnects} boost Connects only if the bid stays near the target rank.`
    : `Use ${args.suggestedConnects} required Connects; no boost by default.`;

  return {
    opening: args.opening,
    diagnosis: args.diagnosis,
    proof: args.proof,
    clientRequestAnswers: args.clientRequestAnswers,
    rateRetainerAnswer: args.rateRetainerAnswer,
    cta: args.cta,
    suggestedAttachments: attachments,
    suggestedHighlights: highlights,
    browserFillNotes: {
      approvedText: args.proposalText,
      profileNotes: [args.profile.title, args.profile.location, ...args.soulGuidance].filter(Boolean),
      rate: args.rateRetainerAnswer,
      attachments,
      highlights,
      connectsPlan,
    },
  };
}

function selectVoiceKnowledge(artifacts: KnowledgeArtifact[], limit = 4): KnowledgeArtifact[] {
  return [...artifacts]
    .sort((a, b) => (b.createdAt ?? b.sourcePath).localeCompare(a.createdAt ?? a.sourcePath))
    .slice(0, limit);
}

function voiceClosingLine(artifacts: KnowledgeArtifact[]): string | null {
  const combined = artifacts.map((artifact) => artifact.summary).join(" ");
  const preferredTag = artifacts
    .flatMap((artifact) => artifact.tags.filter((tag) => tag.startsWith("prefer:")))
    .map((tag) => tag.slice(7).trim())
    .find(Boolean);
  if (preferredTag) {
    return preferredTag;
  }
  if (/short(er)?\s+cta|concise\s+cta|confident.*next step|specific next step/i.test(combined)) {
    return "Send me the store URL and I can point to the first retention fixes I would make.";
  }
  if (/audit|diagnos/i.test(combined)) {
    return "Send me the store URL and I can give you a practical read on where I would start.";
  }
  return null;
}

function voiceBannedPhrases(artifacts: KnowledgeArtifact[]): string[] {
  const tagged = artifacts.flatMap((artifact) => artifact.tags.filter((tag) => tag.startsWith("ban:")).map((tag) => tag.slice(4)));
  const fromText = artifacts.flatMap((artifact) => {
    const matches = [...artifact.summary.matchAll(/avoid (?:the )?(?:phrase|wording)?\s*["“]([^"”]+)["”]/gi)];
    return matches.map((match) => match[1]).filter(Boolean);
  });
  return [...tagged, ...fromText];
}

export function selectPortfolioItems(job: JobPosting): PortfolioItem[] {
  const library = loadPortfolioLibrary();
  const text = jobText(job);
  const scored = library.items
    .map((item) => {
      const never = item.neverUseWhen.some((term) => text.includes(term.toLowerCase()));
      if (never || item.sensitivity === "private") {
        return { item, score: -999 };
      }
      let score = 0;
      for (const industry of item.industries) {
        if (text.includes(industry.toLowerCase())) score += 4;
      }
      for (const platform of item.platforms) {
        if (text.includes(platform.toLowerCase())) score += 3;
      }
      for (const jobType of item.bestFitJobTypes) {
        if (text.includes(jobType.toLowerCase())) score += 2;
      }
      if (item.allowedUsage === "always_include_when_relevant" && score > 0) score += 1;
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ item }) => item);

  return scored;
}

function buildProofStrategy(input: {
  proofSelection: ReturnType<typeof selectPortfolioAssetsForJob>;
  portfolioItems: PortfolioItem[];
  proofPoints: string[];
}): ProofStrategy {
  const selectedProofNames = input.proofSelection.selectedProof.map((proof) => proof.name);
  const selectedAttachmentPaths = input.proofSelection.autoAttachAssets.map((asset) => asset.path);
  const selectedPortfolioHighlights = input.proofSelection.selectedUpworkPortfolioItems.map((item) => item.name);
  const proofVerificationState = selectedProofNames.length || selectedAttachmentPaths.length || selectedPortfolioHighlights.length || input.proofPoints.length
    ? "planned"
    : "unavailable";
  const summary = proofVerificationState === "unavailable"
    ? "No verified/relevant proof selected; proposal must avoid proof claims."
    : [
        selectedProofNames.length ? `proof: ${selectedProofNames.slice(0, 3).join(", ")}` : null,
        selectedPortfolioHighlights.length ? `portfolio highlights: ${selectedPortfolioHighlights.slice(0, 4).join(", ")}` : null,
        selectedAttachmentPaths.length ? `candidate files: ${selectedAttachmentPaths.slice(0, 3).join(", ")}` : null,
        input.proofPoints.length ? `profile proof context: ${input.proofPoints.slice(0, 2).join("; ")}` : null,
      ].filter(Boolean).join("; ");
  return {
    selectedProofNames,
    selectedAttachmentPaths,
    selectedPortfolioHighlights,
    proofVerificationState,
    summary,
    warnings: input.proofSelection.warnings,
  };
}

function shortenProposalSafely(text: string, maxLength: number): string {
  const cleaned = text.trim();
  if (cleaned.length <= maxLength) return cleaned;
  const paragraphs = cleaned.split(/\n{2,}/);
  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    const candidate = [...kept, paragraph].join("\n\n");
    if (candidate.length > maxLength) break;
    kept.push(paragraph);
  }
  const fallback = kept.join("\n\n").trim() || cleaned.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
  if (/[.!?]$/.test(fallback)) return fallback;
  const sentenceEnd = Math.max(fallback.lastIndexOf("."), fallback.lastIndexOf("!"), fallback.lastIndexOf("?"));
  return sentenceEnd > 80 ? fallback.slice(0, sentenceEnd + 1).trim() : `${fallback}.`;
}

function cleanProposal(text: string, bannedPhrases: string[]): string {
  let cleaned = text.trim();
  for (const pattern of AI_SLUDGE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }
  for (const phrase of bannedPhrases ?? []) {
    cleaned = cleaned.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "");
  }
  return cleaned.replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();
}

function parseBudgetNumbers(value: string): number[] {
  return (value.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [])
    .map((item) => Number(item.replace(/,/g, "")))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function isHourlyBudget(value: string): boolean {
  return /\/\s*hr|hourly|per\s+hour/i.test(value);
}

function formatHourlyRate(value: number): string {
  const rounded = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/0+$/g, "").replace(/\.$/, "");
  return `$${rounded}/hr`;
}

function suggestBid(job: ScoredJob, profile: FreelancerProfile): string {
  if (isHourlyBudget(job.budget) && profile.hourlyRate > 0) {
    const budgetNumbers = parseBudgetNumbers(job.budget);
    if (budgetNumbers.length > 0) {
      const low = Math.min(...budgetNumbers);
      const high = Math.max(...budgetNumbers);
      const minimumAcceptableRate = 10;
      const plannedRate = profile.hourlyRate > high
        ? Math.min(profile.hourlyRate, Math.max(minimumAcceptableRate, high + 5))
        : profile.hourlyRate < low
          ? Math.max(minimumAcceptableRate, low)
          : Math.max(minimumAcceptableRate, profile.hourlyRate);
      return formatHourlyRate(plannedRate);
    }
    return formatHourlyRate(profile.hourlyRate);
  }
  return "Use the posted budget unless the scope is larger than described; do not race to the bottom.";
}

function evaluateConnects(job: ScoredJob): {
  suggestedBoostConnects: number;
  warnings: string[];
  strategy: NonNullable<ScoredJob["scoreBreakdown"]["connectsStrategy"]>;
} {
  const rules = loadConnectsRules();
  const warnings: string[] = [];
  const requiredConnects = job.connects
    ? job.connects.requiredConnects
    : job.connectsCost > 0
      ? job.connectsCost
      : null;
  const baseBoost = job.scoreBreakdown.connectsStrategy?.suggestedBoostConnects ?? (job.matchLevel === "high" ? rules.idealBoostMin : 0);
  const strategy = job.scoreBreakdown.connectsStrategy ?? evaluateConnectsStrategy({
    job,
    score: job.score,
    scoreBreakdown: job.scoreBreakdown,
    suggestedBoostConnects: baseBoost,
  });

  if (requiredConnects === null) {
    warnings.push("Required Connects are unknown from visible Upwork source text. Inspect the apply page before preparing or submitting.");
  } else if (requiredConnects > rules.maxRequiredPerJob) {
    warnings.push(
      `Required Connects (${requiredConnects}) exceed hard cap (${rules.maxRequiredPerJob}). Skip or require explicit approval.`
    );
  } else if (requiredConnects > rules.requireApprovalAbove) {
    warnings.push(
      `Required Connects (${requiredConnects}) exceed approval threshold (${rules.requireApprovalAbove}). Require approval.`
    );
  }

  const suggestedBoostConnects = strategy.decision === "safe_apply" ? strategy.suggestedBoostConnects : 0;
  warnings.push(formatConnectsStrategy(strategy));
  if (strategy.decision === "skip") {
    warnings.push("Do not spend Connects on this job unless Steve explicitly overrides after review.");
  } else if (strategy.decision === "manual_review") {
    warnings.push("Manual review required before spending Connects or boosting.");
  }
  if (suggestedBoostConnects > 0) {
    warnings.push(
      `Boost only if ${suggestedBoostConnects}-${rules.idealBoostMax} Connects keeps the proposal near top ${rules.targetBoostRank}. Do not chase bids above ${rules.skipIfTopBidAbove}.`
    );
  }

  if (rules.neverBidMax) {
    warnings.push("Never bid max automatically. Human approval required for expensive boost races.");
  }

  const resolvedRequiredConnects = strategy.sourceBackedConnects?.requiredConnects ?? strategy.requiredConnects;
  return {
    suggestedBoostConnects,
    warnings,
    strategy: {
      ...strategy,
      suggestedBoostConnects,
      requiredConnects: resolvedRequiredConnects,
      totalConnects: resolvedRequiredConnects === null ? null : resolvedRequiredConnects + suggestedBoostConnects,
    },
  };
}

export function buildApplicationDraft(job: ScoredJob, options: BuildApplicationDraftOptions = {}): ApplicationDraft {
  if (!job.description.trim()) {
    throw new Error("Full job description is required before application draft generation.");
  }
  const profile = loadFreelancerProfile();
  const text = jobText(job);
  const redFlags = [...new Set([...job.scoreBreakdown.risks, ...job.negativeKeywords, ...containsAny(text, RED_FLAG_TERMS)])];
  const preliminaryJobIntelligence = buildDeterministicJobIntelligence(job);
  const primaryPlatform = platformLabel(preliminaryJobIntelligence) ?? "unknown";
  const knowledge = loadProfileKnowledge();
  const voiceKnowledge = selectVoiceKnowledge(knowledge.byType.voice);
  const proofKnowledge = platformSafeKnowledge(selectRelevantKnowledge(knowledge.byType.proof, job, 2), primaryPlatform);
  const bidRuleKnowledge = selectRelevantKnowledge(knowledge.byType.bid_rules, job, 2);
  const soulGuidance = buildSoulRuntimeGuidance("proposal_draft_generation");
  const selectedSkills = selectApplicationPrepSkills(job);
  const initialSkillTrace = buildInitialSkillUseTrace(job, selectedSkills);
  const brandResearchSkill = loadBrandResearchSkill();
  const brandFactPack = buildBrandFactPack({ job, skill: brandResearchSkill, webResearch: options.brandResearchRun ?? null });
  const proposalCopywritingSkill = loadProposalCopywritingSkill();
  const salesLearning = buildSalesLearningPromptContext({
    job,
    text: [job.title, job.description].join("\n"),
    types: ["proposal_style", "screening_answer", "proof_preference", "boost_strategy", "source_quality", "timing_hypothesis"],
    limit: 6,
  });
  const salesLearningGuidance = salesLearning.relevantMemories
    .map((memory) => `Sales learning (${memory.type}, ${memory.confidence}, evidence ${memory.evidenceCount}): ${memory.hypothesis}`)
    .slice(0, 6);
  const proofPoints = selectProofPoints(profile, job, proofKnowledge);
  const portfolioItems = selectPortfolioItems(job);
  const proofSelection = selectPortfolioAssetsForJob(job);
  const proofStrategy = buildProofStrategy({ proofSelection, portfolioItems, proofPoints });
  const fitReasons = [
    ...job.scoreBreakdown.reasons.slice(0, 6),
    ...job.matchedKeywords.slice(0, 4).map((keyword) => `Matches ${keyword}`),
    ...(job.clientSpend > 0 ? [`Client has ${job.clientSpend.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} Upwork spend`] : []),
    ...(job.clientHireRate > 0 ? [`Client hire rate is ${job.clientHireRate}%`] : []),
  ].slice(0, 8);

  const rateRetainerAnswer = suggestBid(job, profile);
  const copywritingDraft = buildCopywritingDraft({
    job,
    profile,
    intelligence: preliminaryJobIntelligence,
    brandFactPack,
    proofPoints,
    portfolioItems,
    skill: proposalCopywritingSkill,
  });
  const proposal = cleanProposal(
    copywritingDraft.proposalText,
    [...(profile.voice?.bannedPhrases ?? []), ...voiceBannedPhrases(voiceKnowledge)]
  );
  const finalProposal = shortenProposalSafely(proposal, 1800);
  const draftQualityGate = evaluateDraftQualityGate({
    proposalText: finalProposal,
    job,
    copyStrategy: copywritingDraft.copyStrategy,
    brandFactPack,
    skillLoaded: Boolean(proposalCopywritingSkill.markdown.includes("# Proposal Copywriting Skill")),
    fullJobDescriptionRead: job.description.trim().length > 0 && copywritingDraft.jobUnderstanding.fullJobDescription === job.description,
    copyStrategyCreated: Boolean(copywritingDraft.copyStrategy.one_sentence_sales_argument),
    finalSubmitManual: true,
    proofVerificationState: copywritingDraft.copyStrategy.proof_verification_state,
  });
  const proposalQuality = critiqueProposal(finalProposal, job, profile);
  const jobIntelligence = buildDeterministicJobIntelligence(job, finalProposal);
  const connects = evaluateConnects(job);
  if (bidRuleKnowledge.length) {
    connects.warnings.push(...bidRuleKnowledge.map((artifact) => `Profile bid rule: ${artifact.summary}`));
  }
  if (salesLearningGuidance.length) {
    connects.warnings.push(...salesLearningGuidance.filter((line) => /boost|connects|source|timing/i.test(line)));
  }
  const skillUseTrace = finalizeSkillUseTrace({
    trace: initialSkillTrace,
    brandFactPack,
    copyStrategy: copywritingDraft.copyStrategy,
    proofStrategy,
    qualityGateReady: draftQualityGate.ready,
  });
  const proposalStyleMemoryIds = salesLearning.relevantMemories
    .map((memory) => `${memory.type}:${memory.scope}:${memory.subject}`)
    .slice(0, 8);

  return {
    jobId: job.id,
    status: "draft",
    fitScore: Math.min(100, Math.max(0, job.scoreBreakdown.fitScore.score)),
    fitReasons,
    redFlags,
    suggestedBid: rateRetainerAnswer,
    suggestedConnects: job.connects?.requiredConnects ?? job.connectsCost,
    suggestedBoostConnects: connects.suggestedBoostConnects,
    connectsWarnings: connects.warnings,
    connectsStrategy: connects.strategy,
    selectedPortfolioItems: portfolioItems,
    proposalQuality,
    proposalText: finalProposal,
    jobIntelligence,
    structuredProposal: buildStructuredProposalDraft({
      job,
      profile,
      opening: copywritingDraft.copyStrategy.opening_angle,
      diagnosis: copywritingDraft.copyStrategy.one_sentence_sales_argument,
      proof: proofStrategy.summary,
      clientRequestAnswers: copywritingDraft.screeningAnswers,
      rateRetainerAnswer,
      cta: copywritingDraft.copyStrategy.cta,
      portfolioItems,
      proposalText: finalProposal,
      suggestedConnects: job.connects?.requiredConnects ?? job.connectsCost,
      suggestedBoostConnects: connects.suggestedBoostConnects,
      soulGuidance: [...soulGuidance, ...salesLearningGuidance],
    }),
    jobUnderstanding: copywritingDraft.jobUnderstanding,
    brandFactPack,
    copyStrategy: copywritingDraft.copyStrategy,
    proofStrategy,
    draftQualityGate,
    skillUseTrace,
    proposalStyleMemoryIds,
    brandResearchStatus: copywritingDraft.brandResearchStatus,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildApplicationDraftWithResearch(
  job: ScoredJob,
  options: BuildApplicationDraftWithResearchOptions = {},
): Promise<ApplicationDraft> {
  if (!job.description.trim()) {
    throw new Error("Full job description is required before application draft generation.");
  }
  const brandResearchRun = await researchBrandForJob({
    job,
    provider: options.brandResearchProvider,
  });
  return buildApplicationDraft(job, { brandResearchRun });
}
