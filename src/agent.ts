import { critiqueProposal } from "./critic";
import { evaluateConnectsStrategy, formatConnectsStrategy } from "./connectsStrategy";
import { buildDeterministicJobIntelligence } from "./jobIntelligenceParser";
import { loadConnectsRules, loadFreelancerProfile, loadPortfolioLibrary } from "./profile";
import { loadProfileKnowledge } from "./profileKnowledge";
import { buildSoulRuntimeGuidance } from "./soul";
import {
  ApplicationDraft,
  FreelancerProfile,
  JobPosting,
  KnowledgeArtifact,
  PortfolioItem,
  ScoredJob,
  StructuredProposalDraft,
} from "./types";
import { truncateText } from "./utils";

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
    add(`Rate: ${trimTerminalPunctuation(suggestedBid)}. If this becomes a retainer, I would scope the first month around audit, priority fixes, and reporting before expanding.`);
  }
  if (/portfolio|example|case stud|sample|previous work|proof/i.test(source)) {
    const namedExamples = portfolioItems.map((item) => `${item.name}${item.result ? ` (${item.result})` : ""}`);
    const fallbackExamples = proofPoints.filter((point) => /beauty|dtc|klaviyo|retention|lifecycle|shopify|revenue/i.test(point)).slice(0, 2);
    const examples = [...namedExamples, ...fallbackExamples].slice(0, 2);
    add(examples.length ? `Relevant examples: ${examples.join("; ")}.` : "Relevant proof: DTC lifecycle, Klaviyo, segmentation, and retention work tied to repeat purchase and revenue.");
  }
  if (/availability|start|timeline|when can you/i.test(source)) {
    add("Availability: I can start with a short diagnostic pass, then prioritize the highest-impact lifecycle fixes first.");
  }
  if (/approach|plan|how would you|strategy|what would you/i.test(source)) {
    add("Approach: I would audit the account, find the revenue leaks, fix the highest-impact flows/segments/campaign process, then measure repeat-purchase impact.");
  }
  if (/certif|klaviyo partner|partner/i.test(source)) {
    add("Credentials: Klaviyo Silver Partner with DTC lifecycle and retention experience.");
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

function suggestBid(job: ScoredJob, profile: FreelancerProfile): string {
  if (job.budget.toLowerCase().includes("hourly") && profile.hourlyRate > 0) {
    return `$${profile.hourlyRate}/hr`;
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

export function buildApplicationDraft(job: ScoredJob): ApplicationDraft {
  const profile = loadFreelancerProfile();
  const text = jobText(job);
  const redFlags = [...new Set([...job.scoreBreakdown.risks, ...job.negativeKeywords, ...containsAny(text, RED_FLAG_TERMS)])];
  const knowledge = loadProfileKnowledge();
  const voiceKnowledge = selectVoiceKnowledge(knowledge.byType.voice);
  const proofKnowledge = selectRelevantKnowledge(knowledge.byType.proof, job, 2);
  const portfolioKnowledge = selectRelevantKnowledge(knowledge.byType.portfolio, job, 2);
  const bidRuleKnowledge = selectRelevantKnowledge(knowledge.byType.bid_rules, job, 2);
  const soulGuidance = buildSoulRuntimeGuidance("proposal_draft_generation");
  const proofPoints = selectProofPoints(profile, job, proofKnowledge);
  const portfolioItems = selectPortfolioItems(job);
  const fitReasons = [
    ...job.scoreBreakdown.reasons.slice(0, 6),
    ...job.matchedKeywords.slice(0, 4).map((keyword) => `Matches ${keyword}`),
    ...(job.clientSpend > 0 ? [`Client has ${job.clientSpend.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} Upwork spend`] : []),
    ...(job.clientHireRate > 0 ? [`Client hire rate is ${job.clientHireRate}%`] : []),
  ].slice(0, 8);

  const opening = inferPainLine(job);
  const diagnosis = soulGuidance.length > 0
    ? "First thing I would look at: where first-time buyers are dropping off, which lifecycle moments are leaking money, and whether the current messaging is driving repeat purchase or just adding noise."
    : "What I would look at first: where first-time buyers are dropping off, which flows are missing or stale, whether segmentation is doing any real work, and whether campaigns are driving repeat purchase or just adding noise.";
  const proofSentence = proofPoints.length
    ? `Relevant background: ${proofPoints.slice(0, job.matchLevel === "high" ? 3 : 2).join("; ")}.`
    : `My background is closest to ${profile.niche || "retention and lifecycle marketing"}.`;
  const rateRetainerAnswer = suggestBid(job, profile);
  const clientRequestAnswers = extractClientRequestAnswers(job, profile, rateRetainerAnswer, portfolioItems, proofPoints);
  const clientAnswersSentence = clientRequestAnswers.length ? `To answer the application notes directly: ${clientRequestAnswers.join(" ")}` : "";
  const portfolioSentence = portfolioItems.length
    ? `The most relevant proof to include would be: ${portfolioItems.map((item) => item.name).join(", ")}.`
    : "I would keep attachments light unless you want a specific example.";
  const portfolioKnowledgeSentence = portfolioKnowledge.length
    ? `Additional relevant example: ${portfolioKnowledge.map((artifact) => artifact.summary).join(" ")}`
    : "";
  const workPlan = soulGuidance.length > 0
    ? "For this kind of project, I would keep the work practical and commercially pointed: find the leaks, fix the highest-impact lifecycle moments first, tighten the messaging, and tie the work back to repeat purchase."
    : "For this kind of project, I would keep the work practical: find the leaks, rebuild the highest-impact lifecycle moments, tighten the messaging, and make retention a growth lever instead of another channel on the checklist.";
  const closingLine = voiceClosingLine(voiceKnowledge) ?? "If useful, send me the store URL and a quick sense of what is working/not working in Klaviyo now. I can tell you where I would start.";

  const proposal = cleanProposal(
    [
      opening,
      `${diagnosis} ${proofSentence}`,
      [clientAnswersSentence, workPlan, portfolioSentence, portfolioKnowledgeSentence].filter(Boolean).join(" "),
      closingLine,
    ].filter(Boolean).join("\n\n"),
    [...(profile.voice?.bannedPhrases ?? []), ...voiceBannedPhrases(voiceKnowledge)]
  );

  const truncatedProposal = truncateText(proposal, 1800);
  const proposalQuality = critiqueProposal(truncatedProposal, job, profile);
  const jobIntelligence = buildDeterministicJobIntelligence(job, truncatedProposal);
  const connects = evaluateConnects(job);
  if (bidRuleKnowledge.length) {
    connects.warnings.push(...bidRuleKnowledge.map((artifact) => `Profile bid rule: ${artifact.summary}`));
  }

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
    proposalText: truncatedProposal,
    jobIntelligence,
    structuredProposal: buildStructuredProposalDraft({
      job,
      profile,
      opening,
      diagnosis,
      proof: proofSentence,
      clientRequestAnswers,
      rateRetainerAnswer,
      cta: closingLine,
      portfolioItems,
      proposalText: truncatedProposal,
      suggestedConnects: job.connects?.requiredConnects ?? job.connectsCost,
      suggestedBoostConnects: connects.suggestedBoostConnects,
      soulGuidance,
    }),
    generatedAt: new Date().toISOString(),
  };
}
