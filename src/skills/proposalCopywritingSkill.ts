import { loadRuntimeSkill } from "../skillRuntime";
import {
  BrandFactPack,
  FreelancerProfile,
  JobIntelligence,
  JobPosting,
  PortfolioItem,
  ScoredJob,
} from "../types";

export type ProofVerificationState = "verified" | "planned" | "unavailable" | "do_not_claim";
export type CopyTone = "casual" | "direct" | "sharp" | "warm" | "witty";
export type BrandResearchStatusValue = "not_applicable" | "category_only" | "unavailable";

export interface CopywritingSkillRuntime {
  name: "proposal-copywriting";
  path: string;
  title: string;
  version: "v4";
  markdown: string;
  loadedAt: string;
}

export interface JobUnderstanding {
  jobTitle: string;
  fullJobDescription: string;
  actualJobRequest: string;
  clientBusiness: string;
  customerType: string;
  commercialPain: string;
  emotionalPain: string;
  likelyLifecycleOrConversionLeak: string;
  desiredOutcome: string;
  requestedTools: string[];
  requestedDeliverables: string[];
  unknowns: string[];
}

export interface BrandResearchStatus {
  attempted: boolean;
  status: BrandResearchStatusValue;
  evidence: string[];
  claims: string[];
  unknowns: string[];
}

export interface CopyStrategy {
  job_title: string;
  client_business: string;
  brand_name: string;
  brand_url: string;
  category: string;
  target_customer: string;
  customer_state_of_mind: string;
  customer_pain_or_desire: string;
  client_commercial_pain: string;
  cost_of_inaction: string;
  money_leak: string;
  buying_moment: string;
  repeat_purchase_or_conversion_moment: string;
  likely_lifecycle_gap: string;
  offer_or_project_mechanism: string;
  proof_angle: string;
  proof_verification_state: ProofVerificationState;
  tone: CopyTone;
  opening_angle: string;
  one_sentence_sales_argument: string;
  cta: string;
  unknowns: string[];
  do_not_claim: string[];
}

export type DraftQualityGateSeverity = "info" | "warning" | "critical";

export interface DraftQualityGateIssue {
  code: string;
  severity: DraftQualityGateSeverity;
  message: string;
  evidence?: string;
}

export interface DraftQualityGateResult {
  ready: boolean;
  skillLoaded: boolean;
  fullJobDescriptionRead: boolean;
  copyStrategyCreated: boolean;
  finalSubmitManual: boolean;
  issues: DraftQualityGateIssue[];
}

export interface CopywritingDraftInput {
  job: ScoredJob;
  profile: FreelancerProfile;
  intelligence: JobIntelligence;
  brandFactPack: BrandFactPack;
  proofPoints: string[];
  portfolioItems: PortfolioItem[];
  skill: CopywritingSkillRuntime;
}

export interface CopywritingDraftResult {
  jobUnderstanding: JobUnderstanding;
  brandResearchStatus: BrandResearchStatus;
  brandFactPack: BrandFactPack;
  copyStrategy: CopyStrategy;
  proposalText: string;
  screeningAnswers: string[];
  draftQualityGate: DraftQualityGateResult;
}

export function loadProposalCopywritingSkill(now = new Date()): CopywritingSkillRuntime {
  const skill = loadRuntimeSkill("proposal-copywriting", now);
  return {
    name: "proposal-copywriting",
    path: skill.path,
    title: "Proposal Copywriting Skill",
    version: "v4",
    markdown: skill.content,
    loadedAt: skill.loadedAt,
  };
}

function sourceText(job: JobPosting): string {
  return `${job.title}\n${job.description}\n${job.skills.join(" ")}\n${job.category}`;
}

function lowerSource(job: JobPosting): string {
  return sourceText(job).toLowerCase();
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function visibleBrandName(job: JobPosting): string {
  const text = `${job.title}\n${job.description}`;
  return firstMatch(text, [
    /\b(?:brand|store|company|site)\s+([A-Z][A-Za-z0-9&' -]{2,60}?)(?=\s*(?:\/|,|\.|\band\b|\bneeds\b|\bis\b|\n|$))/,
    /\bfor\s+([A-Z][A-Za-z0-9&' -]{2,50}?)(?=\s+(?:brand|store|shop|site|company)\b)/,
  ]) ?? "";
}

function visibleBrandUrl(job: JobPosting): string {
  const match = `${job.title}\n${job.description}`.match(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/[^\s),.;]*)?/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function categoryFor(job: JobPosting, intelligence: JobIntelligence): string {
  const text = lowerSource(job);
  if (/garden|plant|lawn|seed|nursery|horticulture/.test(text)) return "gardening";
  if (/beauty|skincare|cosmetic|skin care|makeup/.test(text)) return "beauty";
  if (/fashion|apparel|clothing|boutique|jewelry/.test(text)) return "fashion";
  if (/email design|template|figma|design|creative|visual/.test(text)) return "email_design";
  if (/saas|b2b|software|crm implementation|sales pipeline/.test(text)) return "b2b_saas";
  if (intelligence.ecommerceVertical && intelligence.ecommerceVertical !== "unknown") return intelligence.ecommerceVertical;
  if (/shopify|ecommerce|e-commerce|dtc|d2c/.test(text)) return "dtc ecommerce";
  return job.category || "unknown";
}

function targetCustomerFor(category: string): string {
  switch (category) {
    case "gardening":
      return "gardeners trying to buy at the right season, avoid care mistakes, and feel confident about what to plant or replenish next";
    case "beauty":
      return "beauty or skincare buyers looking for trust, routine, product education, and a reason to replenish or try the next product";
    case "fashion":
      return "shoppers looking for fit, identity, occasion, styling confidence, and timely product discovery";
    case "email_design":
      return "email readers skimming quickly and deciding whether the offer is clear enough to click";
    case "b2b_saas":
      return "business buyers trying to reduce workflow pain, risk, implementation friction, and decision uncertainty";
    default:
      return "customers who need a clear reason to trust, buy, return, or take the next step";
  }
}

function customerInsightFor(category: string): string {
  switch (category) {
    case "gardening":
      return "A gardening customer is not just buying a product. They have a season, a plant type, a climate, a skill level, and probably a problem they are trying not to mess up.";
    case "beauty":
      return "A beauty customer is not just buying a product. They are buying trust, routine, confidence, and the hope that this will work well enough to become part of their life.";
    case "fashion":
      return "A fashion customer is not just buying an item. They are buying fit, identity, occasion, and the feeling that this belongs in the version of themselves they want to show.";
    case "email_design":
      return "An email reader does not care what tool the template was built in. They care whether the email makes the offer obvious quickly enough to act on it.";
    case "b2b_saas":
      return "A B2B buyer is not just buying implementation. They are trying to reduce risk, wasted time, decision friction, and the anxiety of choosing the wrong fix.";
    default:
      return "The customer is not just moving through a funnel. They need timing, clarity, belief, and a reason to take the next step.";
  }
}

function commercialPainFor(job: JobPosting, category: string): string {
  const text = lowerSource(job);
  if (/design|template|figma|creative/.test(text)) {
    return "emails may look busy or finished without making the offer, CTA, and product path obvious fast enough";
  }
  if (/crm|customer data|segment|segmentation|list/.test(text)) {
    return "customer data and segments may exist, but they are not yet translating into timely, commercially useful customer moments";
  }
  if (/deliverability|sender|warm/.test(text)) {
    return "the account can look set up while sender reputation, list quality, and targeting quietly limit how much revenue the email program can safely produce";
  }
  if (/flow|automation|journey|lifecycle/.test(text)) {
    return "the flows can exist without giving customers the right reason to trust, return, replenish, or take the next step";
  }
  if (category === "gardening") return "retention depends on timing: seasons, product care, replenishment, and what the customer is trying to grow next";
  if (category === "beauty") return "repeat purchase depends on trust, education, routine, replenishment, and product pairing, not just more reminders";
  return "the business is likely leaving money in unclear timing, weak segmentation, and customer moments that are not being used well enough";
}

function mechanismFor(job: JobPosting, category: string, platform: string): string {
  const text = lowerSource(job);
  const platformLabel = platform && platform !== "unknown" ? platform : "the CRM";
  if (category === "email_design" || /design|template|figma|creative/.test(text)) {
    return "build the work around hierarchy first: the reason to care, the offer, the proof, the product path, and one clear action";
  }
  if (category === "gardening") {
    return `build ${platformLabel} around season, plant type, buying stage, care education, replenishment, review/referral, and what the customer probably needs next`;
  }
  if (category === "beauty") {
    return `build ${platformLabel} around trust, first use, first result, routine-building, replenishment, education, and the next best product moment`;
  }
  if (/account setup|configuration|configure|implementation|sender|warm|import|cleanup/i.test(text)) {
    const transactional = /transactional|api/.test(text) ? ", and separation of transactional API email from lifecycle flows/newsletters" : "";
    const importCleanup = /contact import|import|cleanup|clean up|clean-up|list hygiene/.test(text) ? "contact import/cleanup, " : "";
    return `make ${platformLabel} account setup technically clean first: ${importCleanup}list quality, sender reputation, segmentation, automation logic${transactional}, and QA before volume ramps`;
  }
  return `map the customer moments first, then use ${platformLabel} to make the timing, segmentation, copy, and measurement practical`;
}

function deliverables(job: JobPosting): string[] {
  const text = lowerSource(job);
  return unique([
    /audit/.test(text) ? "audit" : null,
    /flow|automation|journey/.test(text) ? "flows/automations" : null,
    /campaign|newsletter/.test(text) ? "campaigns/newsletters" : null,
    /segment|list/.test(text) ? "segmentation/list work" : null,
    /design|template|figma/.test(text) ? "email design/templates" : null,
    /setup|configuration|configure|implementation/.test(text) ? "setup/configuration" : null,
    /deliverability|sender|warm/.test(text) ? "deliverability/sender reputation" : null,
  ]);
}

export function buildJobUnderstanding(job: ScoredJob, intelligence: JobIntelligence): JobUnderstanding {
  const category = categoryFor(job, intelligence);
  const requestedDeliverables = deliverables(job);
  const requestedTools = unique([...intelligence.platformsMentioned, ...job.skills.filter((skill) => /klaviyo|brevo|crm|shopify|figma|mailchimp|omnisend|hubspot/i.test(skill))]);
  const unknowns = unique([
    visibleBrandName(job) ? null : "brand_name",
    visibleBrandUrl(job) ? null : "brand_url",
    requestedDeliverables.length ? null : "exact_deliverables",
  ]);
  return {
    jobTitle: job.title,
    fullJobDescription: job.description,
    actualJobRequest: intelligence.taskType || requestedDeliverables.join(", ") || job.title,
    clientBusiness: visibleBrandName(job) || category || intelligence.businessType || "unknown",
    customerType: targetCustomerFor(category),
    commercialPain: commercialPainFor(job, category),
    emotionalPain: "the client wants confidence that the work will create a useful business outcome, not just a completed checklist",
    likelyLifecycleOrConversionLeak: mechanismFor(job, category, intelligence.primaryPlatform),
    desiredOutcome: intelligence.clientGoal || "turn customer attention into clearer action, conversion, repeat purchase, or retention",
    requestedTools,
    requestedDeliverables,
    unknowns,
  };
}

export function buildBrandResearchStatus(job: ScoredJob, category: string): BrandResearchStatus {
  const brand = visibleBrandName(job);
  const url = visibleBrandUrl(job);
  if (!brand && !url && category === "unknown") {
    return { attempted: false, status: "not_applicable", evidence: [], claims: [], unknowns: ["brand", "category"] };
  }
  const evidence = unique([brand ? `brand from job: ${brand}` : null, url ? `url from job: ${url}` : null, category !== "unknown" ? `category from job text: ${category}` : null]);
  return {
    attempted: Boolean(brand || url || category !== "unknown"),
    status: category !== "unknown" ? "category_only" : "unavailable",
    evidence,
    claims: category !== "unknown" ? [`Used category-level customer logic for ${category}; no unverified brand-specific claims.`] : [],
    unknowns: unique([brand ? null : "brand_name", url ? null : "brand_url", "live_brand_research"]),
  };
}

function proofVerificationState(proofPoints: string[], portfolioItems: PortfolioItem[]): ProofVerificationState {
  if (portfolioItems.length > 0 || proofPoints.length > 0) return "planned";
  return "unavailable";
}

export function buildCopyStrategy(input: {
  job: ScoredJob;
  intelligence: JobIntelligence;
  understanding: JobUnderstanding;
  brandResearchStatus: BrandResearchStatus;
  brandFactPack: BrandFactPack;
  proofPoints: string[];
  portfolioItems: PortfolioItem[];
}): CopyStrategy {
  const category = categoryFor(input.job, input.intelligence);
  const brandName = input.brandFactPack.brandName !== "unknown" ? input.brandFactPack.brandName : visibleBrandName(input.job);
  const brandUrl = input.brandFactPack.websiteUrls[0] ?? visibleBrandUrl(input.job);
  const mechanism = mechanismFor(input.job, category, input.intelligence.primaryPlatform);
  const proofState = proofVerificationState(input.proofPoints, input.portfolioItems);
  const customerInsight = input.brandFactPack.confidence !== "unavailable" && input.brandFactPack.targetCustomerIcp
    ? `The customer here is not just moving through a funnel. They are ${input.brandFactPack.targetCustomerIcp}, and the buying moment is ${input.brandFactPack.customerBuyingMoment}.`
    : customerInsightFor(category);
  const normalizedBrandUrl = brandUrl.replace(/^https?:\/\//i, "");
  const ctaTarget = brandName && normalizedBrandUrl
    ? `${brandName} / ${normalizedBrandUrl}`
    : brandName || normalizedBrandUrl || "the business";
  return {
    job_title: input.job.title,
    client_business: input.understanding.clientBusiness,
    brand_name: brandName || "unknown",
    brand_url: brandUrl || "unknown",
    category,
    target_customer: input.brandFactPack.targetCustomerIcp || input.understanding.customerType,
    customer_state_of_mind: customerInsight,
    customer_pain_or_desire: input.brandFactPack.emotionalPainOrDesire || input.understanding.emotionalPain,
    client_commercial_pain: input.brandFactPack.likelyLifecycleLeak || input.understanding.commercialPain,
    cost_of_inaction: "the client keeps paying for attention without converting enough of it into trust, action, repeat purchase, or cleaner customer movement",
    money_leak: input.brandFactPack.likelyConversionLeak || input.understanding.commercialPain,
    buying_moment: input.brandFactPack.customerBuyingMoment || buyingMomentFor(category),
    repeat_purchase_or_conversion_moment: input.brandFactPack.repeatPurchaseMoment || repeatMomentFor(category),
    likely_lifecycle_gap: input.brandFactPack.likelyLifecycleLeak || input.understanding.likelyLifecycleOrConversionLeak,
    offer_or_project_mechanism: mechanism,
    proof_angle: proofState === "unavailable"
      ? "proof unavailable; do not claim specific proof"
      : input.brandFactPack.proofAngle || "use proof after the customer and commercial logic is clear",
    proof_verification_state: proofState,
    tone: category === "beauty" ? "warm" : category === "email_design" ? "direct" : "sharp",
    opening_angle: `The opportunity${ctaTarget !== "the business" ? ` for ${ctaTarget}` : ""} here is ${input.brandFactPack.likelyLifecycleLeak || input.understanding.commercialPain}.`,
    one_sentence_sales_argument: `${customerInsight} That is why I would ${mechanism}.`,
    cta: `If it makes sense, we can start with ${ctaTarget} and the first few customer moments you want the work to improve.`,
    unknowns: unique([...input.understanding.unknowns, ...input.brandResearchStatus.unknowns, ...input.brandFactPack.assumptions, ...input.brandFactPack.whatNotToClaim]),
    do_not_claim: unique(["attached proof", "selected portfolio proof", "verified browser state", "brand research beyond job/category evidence", ...input.brandResearchStatus.unknowns.map((item) => `unverified ${item}`), ...input.brandFactPack.whatNotToClaim]),
  };
}

function buyingMomentFor(category: string): string {
  switch (category) {
    case "gardening":
      return "seasonal planning, care anxiety, replenishment, and the next planting decision";
    case "beauty":
      return "trust-building, first use, routine formation, replenishment, and product pairing";
    case "email_design":
      return "the first few seconds when the reader decides whether the offer is clear enough to keep reading";
    case "fashion":
      return "occasion, identity, fit confidence, drop timing, and abandoned product intent";
    case "b2b_saas":
      return "the point where a buyer wants less risk, clearer workflow, and confidence in the next step";
    default:
      return "the moment the customer needs a clearer reason to trust, click, buy, return, or continue";
  }
}

function repeatMomentFor(category: string): string {
  switch (category) {
    case "gardening":
      return "what they bought, what season they are in, what they are trying to grow, and what they need next";
    case "beauty":
      return "first result, habit formation, replenishment timing, education, and next-best product";
    case "email_design":
      return "offer clarity, product path, proof, mobile hierarchy, and one obvious CTA";
    default:
      return "post-purchase education, segmentation, next-best action, and a clear reason to come back";
  }
}

function proofDisplayLabel(value: string): string {
  const cleaned = value
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.(pdf|png|jpe?g|webp)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s*[-–]\s*case study$/i, " case study")
    .replace(/\bcase study case study\b/i, "case study")
    .trim() ?? "";
  if (!cleaned) return "";
  if (/^portfolio$/i.test(cleaned)) return "general retention portfolio";
  return cleaned;
}

function firstProofLabel(proofPoints: string[], portfolioItems: PortfolioItem[]): string {
  const portfolio = proofDisplayLabel(portfolioItems[0]?.name ?? "");
  if (portfolio) return portfolio;
  return proofDisplayLabel(proofPoints[0] ?? "");
}

function proofSentence(strategy: CopyStrategy, proofPoints: string[], portfolioItems: PortfolioItem[]): string {
  if (strategy.proof_verification_state === "unavailable") {
    return "I would keep proof light until the exact examples are relevant to the job instead of forcing a random case study into the proposal.";
  }
  const portfolio = firstProofLabel(proofPoints, portfolioItems);
  if (portfolio) {
    return `I can share relevant work like ${portfolio} if you want to see how I think about the revenue and customer side together.`;
  }
  return "Relevant proof can be selected once the exact scope is clear.";
}

export function draftCoverLetterFromCopyStrategy(input: {
  strategy: CopyStrategy;
  proofPoints: string[];
  portfolioItems: PortfolioItem[];
}): string {
  const strategy = input.strategy;
  return [
    "Steve here,",
    "How is your day going?",
    "",
    strategy.opening_angle,
    "",
    strategy.customer_state_of_mind,
    "",
    `That means I would not start by listing tools or flows. I would keep the work practical and commercially pointed: understand the customer moments, then ${strategy.offer_or_project_mechanism}.`,
    "",
    proofSentence(strategy, input.proofPoints, input.portfolioItems),
    "",
    strategy.cta,
  ].join("\n").trim();
}

export function draftScreeningAnswersFromCopyStrategy(input: {
  strategy: CopyStrategy;
  suggestedBid: string;
  proofPoints: string[];
  portfolioItems: PortfolioItem[];
  jobText: string;
}): string[] {
  const answers: string[] = [];
  const source = input.jobText;
  if (/rate|hourly|budget|price|retainer/i.test(source)) {
    answers.push(`Rate: ${input.suggestedBid.replace(/[.!?]+$/g, "")}. I would keep the first scope tied to the clearest customer moments and revenue leaks before expanding.`);
  }
  if (/portfolio|example|case stud|sample|previous work|proof/i.test(source)) {
    const proof = firstProofLabel(input.proofPoints, input.portfolioItems);
    answers.push(proof
      ? `Yes. I can use ${proof} as the relevant proof angle, but I would only attach or claim it once it is actually selected/verified for this application.`
      : "I can keep proof honest and only include examples that match this exact job instead of forcing a generic case study.");
  }
  if (/approach|plan|how would you|strategy|what would you/i.test(source)) {
    answers.push(`I would start with the customer logic: ${input.strategy.repeat_purchase_or_conversion_moment}. Then I would build the CRM/design work around that mechanism.`);
  }
  if (/availability|start|timeline|when can you/i.test(source)) {
    answers.push("I can start with a short diagnostic pass, then prioritize the highest-impact customer moments before implementation.");
  }
  return answers.map((answer) => answer.split(/\s+/).slice(0, 70).join(" ")).slice(0, 4);
}

function indexOfAny(lower: string, needles: string[]): number {
  const indexes = needles.map((needle) => lower.indexOf(needle)).filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function addIssue(issues: DraftQualityGateIssue[], issue: DraftQualityGateIssue): void {
  issues.push(issue);
}

function hasCompleteCta(text: string): boolean {
  return /\b(if it makes sense|happy to|send me|share|we can start|walk me through|take a quick look)\b/i.test(text) && /[.!?]$/.test(text.trim());
}

function endsMidThought(text: string): boolean {
  const trimmed = text.trim();
  if (/[.?!]$/.test(trimmed)) return false;
  if (/(\.\.\.|…)$/.test(trimmed)) return true;
  return /(?:and|or|but|because|with|to|for|the|a|an)$/i.test(trimmed) || trimmed.length > 0;
}

export function evaluateDraftQualityGate(input: {
  proposalText: string;
  job: JobPosting;
  copyStrategy?: CopyStrategy | null;
  brandFactPack?: BrandFactPack | null;
  skillLoaded: boolean;
  fullJobDescriptionRead: boolean;
  copyStrategyCreated: boolean;
  finalSubmitManual?: boolean;
  proofVerificationState?: ProofVerificationState;
}): DraftQualityGateResult {
  const text = input.proposalText.trim();
  const lower = text.toLowerCase();
  const issues: DraftQualityGateIssue[] = [];
  if (!input.job.description.trim()) {
    addIssue(issues, { code: "missing_job_description", severity: "critical", message: "Full job description is required before drafting or browser fill." });
  }
  if (/\b(?:cookie|feedback helps us improve search|browser extension|job details? close|html|css selector|undefined|null|lorem ipsum)\b/i.test(input.job.description)) {
    addIssue(issues, { code: "low_confidence_or_noisy_job_description", severity: "critical", message: "Job description appears noisy or low-confidence." });
  }
  const genericExpertStart = /^(?:steve here,\s*)?(?:how is your day going\?\s*)?(?:hi[,\s-]*)?(?:i am|i'm)\s+(?:a\s+)?(?:klaviyo|email|crm|marketing|design)[^.\n]{0,80}(?:expert|specialist|professional|consultant|with)/i;
  if (genericExpertStart.test(text) || /^i (?:am|'m) (?:a )?klaviyo expert/i.test(text)) {
    addIssue(issues, { code: "generic_expert_opener", severity: "critical", message: "Cover letter starts with generic expert/credential copy.", evidence: text.slice(0, 120) });
  }
  if (/\bjust adding noise\b/i.test(text)) {
    addIssue(issues, { code: "banned_noise_phrase", severity: "critical", message: "Cover letter contains the banned phrase just adding noise." });
  }
  if (/\b(?:Relevant background|To answer the application notes directly|Relevant examples|Additional relevant example|Relevant proof|Approach|Credentials):/i.test(text)) {
    addIssue(issues, {
      code: "internal_scaffold_labels",
      severity: "critical",
      message: "Cover letter contains internal proof/answer scaffolding instead of final human proposal voice.",
      evidence: text.match(/\b(?:Relevant background|To answer the application notes directly|Relevant examples|Additional relevant example|Relevant proof|Approach|Credentials):[^.\n]*(?:[.\n]|$)/i)?.[0]?.trim(),
    });
  }
  if (/\b(?:placeholder|lorem ipsum|debug|test data|undefined|null|nan|object object|the client will not be notified|feedback helps us improve search|cookie|browser extension|html|css selector)\b/i.test(text)) {
    addIssue(issues, { code: "scraped_or_debug_noise", severity: "critical", message: "Cover letter contains placeholder, debug, test, or scraped UI noise." });
  }
  if (/(\.\.\.|…)\s*$/.test(text) || endsMidThought(text)) {
    addIssue(issues, { code: "truncated_or_incomplete", severity: "critical", message: "Cover letter appears truncated or ends mid-thought.", evidence: text.slice(-120) });
  }
  const customerInsight = input.copyStrategy?.customer_state_of_mind ?? "";
  if (!customerInsight || !text.toLowerCase().includes(customerInsight.slice(0, 28).toLowerCase())) {
    addIssue(issues, { code: "missing_customer_insight", severity: "critical", message: "Cover letter does not include a clear customer insight before selling services." });
  }
  const commercialPain = input.copyStrategy?.client_commercial_pain ?? "";
  if (!commercialPain || !/(opportunity|money|revenue|commercial|leak|conversion|retention|repeat|trust|friction|sender reputation|offer clarity|replenishment)/i.test(text)) {
    addIssue(issues, { code: "missing_commercial_pain", severity: "critical", message: "Cover letter does not name a business opportunity or commercial pain." });
  }
  const toolIndex = indexOfAny(lower, ["klaviyo", "brevo", "figma", "flow", "flows", "automation", "automations", "crm", "template"]);
  const customerIndex = indexOfAny(lower, ["customer", "reader", "buyer", "shopper", "gardener", "skincare", "beauty", "offer", "trust", "season", "routine", "hierarchy"]);
  if (toolIndex >= 0 && (customerIndex < 0 || toolIndex < customerIndex)) {
    addIssue(issues, { code: "tools_before_customer_logic", severity: "critical", message: "Cover letter lists tools or flows before explaining customer logic." });
  }
  if (/\b(attached|attachment|selected portfolio|portfolio is selected|uploaded|verified proof|included the file)\b/i.test(text) && input.proofVerificationState !== "verified") {
    addIssue(issues, { code: "unverified_proof_claim", severity: "critical", message: "Cover letter claims proof, portfolio, or attachments without verified browser/app state." });
  }
  if (!hasCompleteCta(text)) {
    addIssue(issues, { code: "missing_complete_cta", severity: "critical", message: "Cover letter does not end with a complete human CTA." });
  }
  if (/\b(?:submit|send for connects|bypass|captcha|2fa|two-factor|passkey|security check)\b/i.test(text)) {
    addIssue(issues, { code: "unsafe_submit_or_security_language", severity: "critical", message: "Cover letter includes submit/security language that does not belong in the proposal." });
  }
  if (!input.skillLoaded) {
    addIssue(issues, { code: "copywriting_skill_not_loaded", severity: "critical", message: "Copywriting skill was not loaded before draft generation." });
  }
  if (!input.fullJobDescriptionRead) {
    addIssue(issues, { code: "full_job_description_not_read", severity: "critical", message: "Full job description was not available before drafting." });
  }
  if (!input.copyStrategyCreated) {
    addIssue(issues, { code: "copy_strategy_missing", severity: "critical", message: "copy_strategy was not created before drafting." });
  }
  if (
    input.brandFactPack?.researchNeeded &&
    input.brandFactPack.webResearchStatus !== "succeeded" &&
    !input.brandFactPack.researchSummary.trim() &&
    input.brandFactPack.assumptions.length === 0
  ) {
    addIssue(issues, { code: "brand_research_skipped_without_explanation", severity: "critical", message: "Brand/category research was needed but skipped without an internal explanation." });
  }
  if (input.finalSubmitManual === false) {
    addIssue(issues, { code: "final_submit_not_manual", severity: "critical", message: "Final submit boundary is not manual." });
  }
  return {
    ready: !issues.some((issue) => issue.severity === "critical"),
    skillLoaded: input.skillLoaded,
    fullJobDescriptionRead: input.fullJobDescriptionRead,
    copyStrategyCreated: input.copyStrategyCreated,
    finalSubmitManual: input.finalSubmitManual !== false,
    issues,
  };
}

export function buildCopywritingDraft(input: CopywritingDraftInput): CopywritingDraftResult {
  if (!input.job.description.trim()) {
    throw new Error("Full job description is required before proposal-copywriting skill can run.");
  }
  if (input.skill.name !== "proposal-copywriting" || !input.skill.markdown.includes("# Proposal Copywriting Skill")) {
    throw new Error("proposal-copywriting skill must be loaded before draft generation.");
  }
  const understanding = buildJobUnderstanding(input.job, input.intelligence);
  const category = categoryFor(input.job, input.intelligence);
  const brandResearchStatus = buildBrandResearchStatus(input.job, category);
  const copyStrategy = buildCopyStrategy({
    job: input.job,
    intelligence: input.intelligence,
    understanding,
    brandResearchStatus,
    brandFactPack: input.brandFactPack,
    proofPoints: input.proofPoints,
    portfolioItems: input.portfolioItems,
  });
  const proposalText = draftCoverLetterFromCopyStrategy({
    strategy: copyStrategy,
    proofPoints: input.proofPoints,
    portfolioItems: input.portfolioItems,
  });
  const screeningAnswers = draftScreeningAnswersFromCopyStrategy({
    strategy: copyStrategy,
    suggestedBid: input.profile.hourlyRate > 0 ? `$${input.profile.hourlyRate}/hr` : "Use the posted budget unless the scope is larger than described",
    proofPoints: input.proofPoints,
    portfolioItems: input.portfolioItems,
    jobText: sourceText(input.job),
  });
  const draftQualityGate = evaluateDraftQualityGate({
    proposalText,
    job: input.job,
    copyStrategy,
    brandFactPack: input.brandFactPack,
    skillLoaded: Boolean(input.skill.markdown.includes("# Proposal Copywriting Skill")),
    fullJobDescriptionRead: input.job.description.trim().length > 0 && understanding.fullJobDescription === input.job.description,
    copyStrategyCreated: Boolean(copyStrategy.one_sentence_sales_argument),
    finalSubmitManual: true,
    proofVerificationState: copyStrategy.proof_verification_state,
  });
  return {
    jobUnderstanding: understanding,
    brandResearchStatus,
    brandFactPack: input.brandFactPack,
    copyStrategy,
    proposalText,
    screeningAnswers,
    draftQualityGate,
  };
}
