import { loadRuntimeSkill } from "../skillRuntime";
import { buildSoulRuntimeGuidance } from "../soul";
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
  retention_lane: string;
  proof_angle: string;
  proof_verification_state: ProofVerificationState;
  requested_tools: string[];
  requested_deliverables: string[];
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

export interface ProposalScorecardDimension {
  dimension: string;
  weight: number;
  score: number;
  passed: boolean;
  hardFail: boolean;
  message: string;
}

export interface ProposalScorecardResult {
  score: number;
  ready: boolean;
  wordCount: number;
  operatingBand: {
    min: number;
    max: number;
    actual: number;
  };
  dimensions: ProposalScorecardDimension[];
  hardFailures: string[];
  feedbackMessages: string[];
  jobSpecificSignalCount: number;
  proofCount: number;
  screeningAnswerCount: number;
  soulLoaded: boolean;
}

export interface DraftQualityGateResult {
  ready: boolean;
  skillLoaded: boolean;
  soulLoaded?: boolean;
  fullJobDescriptionRead: boolean;
  copyStrategyCreated: boolean;
  finalSubmitManual: boolean;
  issues: DraftQualityGateIssue[];
  scorecard?: ProposalScorecardResult;
}

export interface CopywritingDraftInput {
  job: ScoredJob;
  profile: FreelancerProfile;
  intelligence: JobIntelligence;
  brandFactPack: BrandFactPack;
  proofPoints: string[];
  portfolioItems: PortfolioItem[];
  skill: CopywritingSkillRuntime;
  soulGuidance?: string[];
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

function primaryLowerSource(job: JobPosting): string {
  return `${job.title}\n${job.description}\n${job.category}`.toLowerCase();
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

function cleanCandidateDomain(value: string): string {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[),.;:]+$/g, "")
    .trim()
    .toLowerCase();
}

function isUsefulBrandDomain(value: string): boolean {
  const domain = cleanCandidateDomain(value);
  if (!domain || !domain.includes(".")) return false;
  if (/upwork\.com$/i.test(domain)) return false;
  if (/\b(?:fixed-price|intermediate|proposals|connects|tooltip|posted|worldwide|hour|hr)\b/i.test(domain)) return false;
  const parts = domain.split(".");
  const tld = parts[parts.length - 1] ?? "";
  if (!/^[a-z]{2,24}$/i.test(tld)) return false;
  if (/^\d+$/.test(parts[0] ?? "")) return false;
  return true;
}

function visibleBrandName(job: JobPosting): string {
  const text = `${job.title}\n${job.description}`;
  return firstMatch(text, [
    /\b(?:brand|store|company|site)\s+([A-Z][A-Za-z0-9&' -]{2,60}?)(?=\s*(?:\/|,|\.|\band\b|\bneeds\b|\bis\b|\n|$))/,
    /\bfor\s+([A-Z][A-Za-z0-9&' -]{2,50}?)(?=\s+(?:brand|store|shop|site|company)\b)/,
  ]) ?? "";
}

function visibleBrandUrl(job: JobPosting): string {
  for (const match of `${job.title}\n${job.description}`.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/[^\s),.;]*)?/gi)) {
    const candidate = match[1] ?? match[0] ?? "";
    if (isUsefulBrandDomain(candidate)) return cleanCandidateDomain(candidate);
  }
  return "";
}

function categoryFor(job: JobPosting, intelligence: JobIntelligence): string {
  const text = lowerSource(job);
  const primaryText = primaryLowerSource(job);
  const lifecycleScope = hasLifecycleEmailPlatformScope(text);
  const strongPrimaryDesignScope = isStrongDesignScope(primaryText);
  if (/garden|plant|lawn|seed|nursery|horticulture/.test(text)) return "gardening";
  if (/beauty|skincare|cosmetic|skin care|makeup/.test(text)) return "beauty";
  if (/fashion|apparel|clothing|boutique|jewelry/.test(text)) return "fashion";
  if (lifecycleScope && !strongPrimaryDesignScope) return "dtc ecommerce";
  if (strongPrimaryDesignScope || (!lifecycleScope && isStrongDesignScope(text))) return "email_design";
  if (/\b(?:klaviyo|mailchimp|omnisend|ecommerce|e-commerce|customer retention|retention|email campaign|email marketing|flows?)\b/.test(text)) return "dtc ecommerce";
  if (/saas|b2b|software|crm implementation|sales pipeline/.test(text)) return "b2b_saas";
  if (intelligence.ecommerceVertical && intelligence.ecommerceVertical !== "unknown") return intelligence.ecommerceVertical;
  if (/shopify|ecommerce|e-commerce|dtc|d2c/.test(text)) return "dtc ecommerce";
  return job.category || "unknown";
}

function hasLifecycleEmailPlatformScope(text: string): boolean {
  return /\b(?:klaviyo|mailchimp|omnisend)\b/.test(text) &&
    /\b(?:flow|flows|automation|automations|campaign|campaigns|subscriber|subscribers|list|lists|engagement|conversion|performance|insights|ecommerce|e-commerce|retention|lifecycle)\b/.test(text);
}

function isStrongDesignScope(text: string): boolean {
  if (hasLifecycleEmailPlatformScope(text) && !/\b(?:figma|email design|design system|campaign design|flow design|creative direction|visual design|mockup)\b/.test(text)) {
    return false;
  }
  return /\b(?:figma|email design|design system|campaign design|flow design|creative direction|visual design|mockup)\b/.test(text);
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
    case "dtc ecommerce":
      return "ecommerce customers deciding whether the message is relevant, the offer is clear, and the next action is worth taking";
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
    case "dtc ecommerce":
      return "An ecommerce customer is not reading flows because they love automation. They are deciding whether the offer, timing, and next step feel relevant enough to act on.";
    default:
      return "The customer is not just moving through a funnel. They need timing, clarity, belief, and a reason to take the next step.";
  }
}

function commercialPainFor(job: JobPosting, category: string): string {
  const text = lowerSource(job);
  if (isStrongDesignScope(primaryLowerSource(job))) {
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
  if (/klaviyo|mailchimp|omnisend|email marketing|email campaign|customer retention|ecommerce/.test(text)) {
    return "engagement and conversion can leak when campaigns and flows are not tied to clear customer moments, offer clarity, and useful segmentation";
  }
  if (category === "gardening") return "retention depends on timing: seasons, product care, replenishment, and what the customer is trying to grow next";
  if (category === "beauty") return "repeat purchase depends on trust, education, routine, replenishment, and product pairing, not just more reminders";
  if (category === "dtc ecommerce") return "email revenue depends on matching the message, timing, offer, and segment to the customer moment instead of just sending more campaigns";
  return "the business is likely leaving money in unclear timing, weak segmentation, and customer moments that are not being used well enough";
}

function mechanismFor(job: JobPosting, category: string, platform: string): string {
  const text = lowerSource(job);
  const platformLabel = platform && platform !== "unknown" ? platform : "the CRM";
  if (category === "email_design" || isStrongDesignScope(primaryLowerSource(job))) {
    return "build the work around hierarchy first: the reason to care, the offer, the proof, the product path, and one clear action";
  }
  if (category === "gardening") {
    return `build ${platformLabel} around season, plant type, buying stage, care education, replenishment, review/referral, and what the customer probably needs next`;
  }
  if (category === "beauty") {
    return `build ${platformLabel} around trust, first use, first result, routine-building, replenishment, education, and the next best product moment`;
  }
  if (category === "dtc ecommerce") {
    return `audit the current flows/campaigns, find the highest-leverage customer moments, then tighten segmentation, message angle, offer clarity, and measurement across ${platformLabel}`;
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
  const primaryText = primaryLowerSource(job);
  return unique([
    /audit/.test(text) ? "audit" : null,
    /flow|automation|journey/.test(text) ? "flows/automations" : null,
    /campaign|newsletter/.test(text) ? "campaigns/newsletters" : null,
    /segment|list/.test(text) ? "segmentation/list work" : null,
    /design|template|figma/.test(primaryText) ? "email design/templates" : null,
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
    retention_lane: retentionLaneFor(input.job, category),
    proof_angle: proofState === "unavailable"
      ? "proof unavailable; do not claim specific proof"
      : input.brandFactPack.proofAngle || "use proof after the customer and commercial logic is clear",
    proof_verification_state: proofState,
    requested_tools: input.understanding.requestedTools,
    requested_deliverables: input.understanding.requestedDeliverables,
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
    case "dtc ecommerce":
      return "welcome intent, abandoned intent, post-purchase education, replenishment, winback, and campaign segmentation";
    default:
      return "post-purchase education, segmentation, next-best action, and a clear reason to come back";
  }
}

function retentionLaneFor(job: JobPosting, category: string): string {
  const text = lowerSource(job);
  if (/\b(?:shopify email|migration|migrate|move from|switch from)\b/i.test(text)) return "migration_foundation";
  if (/\b(?:revenue share|email revenue|gross revenue|lift|growth|roi|conversion rate|cro|audit)\b/i.test(text)) return "revenue_lift";
  if (/\b(?:founder voice|brand voice|tone of voice|doesn'?t sound like marketing|not sound like marketing)\b/i.test(text)) return "founder_voice";
  if (/\b(?:subscription|recharge|loop|win[-\s]?back|replenishment|repeat purchase|churn)\b/i.test(text)) return "subscription_winback";
  if (/\b(?:api|integration|integrations|deliverability|sender|dns|domain|events?|webhook|html|liquid|qa)\b/i.test(text)) return "technical_retention";
  if (/\b(?:agency|multiple brands|multi[-\s]?brand|accounts|clients)\b/i.test(text)) return "agency_support";
  if (category === "email_design") return "email_template_clarity";
  if (/\b(?:flow|flows|automation|automations|audit|underperforming)\b/i.test(text)) return "flow_audit";
  return "lifecycle_operator";
}

function laneLabel(lane: string): string {
  switch (lane) {
    case "migration_foundation":
      return "Klaviyo migration/foundation";
    case "revenue_lift":
      return "owned-revenue";
    case "founder_voice":
      return "founder-voice retention";
    case "subscription_winback":
      return "subscription and win-back";
    case "technical_retention":
      return "retention systems";
    case "agency_support":
      return "multi-account lifecycle ops";
    case "email_template_clarity":
      return "email clarity";
    case "flow_audit":
      return "flow/audit";
    default:
      return "lifecycle";
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
    if (/portfolio|general/i.test(portfolio)) {
      return "I can use a concise audit-style proof angle if helpful, but I would keep the proposal focused on the work: what is leaking, what to fix first, and how we will measure it.";
    }
    return `I can use ${portfolio} only if it is the most relevant proof for this scope; otherwise I would keep proof light and focus on the audit/fix path.`;
  }
  return "Relevant proof can be selected once the exact scope is clear.";
}

function requestedTools(strategy: CopyStrategy): string[] {
  const toolOrder = ["Klaviyo", "Mailchimp", "Omnisend", "Shopify", "Postscript", "Attentive"];
  return toolOrder.filter((tool) => strategy.requested_tools.some((item) => item.toLowerCase() === tool.toLowerCase()));
}

function requestedToolSentence(strategy: CopyStrategy): string | null {
  const tools = requestedTools(strategy);
  if (tools.length >= 3 && tools.some((tool) => /mailchimp|omnisend/i.test(tool))) {
    return `Because this touches ${tools.slice(0, 3).join(", ")}, I would not treat it like a generic template refresh. I would separate the flows, campaigns, subscriber list work, and reporting so each platform has a clear job tied to engagement and conversion.`;
  }
  if (tools.length >= 2) {
    return `Since the work touches ${tools.join(" and ")}, I would keep the plan tied to the customer moments first, then make the platform execution clean.`;
  }
  return null;
}

function openerSpecifics(strategy: CopyStrategy): [string, string] {
  const tools = requestedTools(strategy);
  const toolSpecific = tools.length >= 2 ? `${tools.slice(0, 3).join(" + ")} execution` : tools[0] ? `${tools[0]} execution` : strategy.category;
  const deliverableSpecific = strategy.requested_deliverables.length
    ? strategy.requested_deliverables.slice(0, 2).join(" + ")
    : laneLabel(strategy.retention_lane);
  return [toolSpecific, deliverableSpecific];
}

function conciseHook(strategy: CopyStrategy): string {
  const tools = requestedTools(strategy);
  const opener = "Steve here - how is your day going?";
  const [specificOne, specificTwo] = openerSpecifics(strategy);
  if (strategy.category === "gardening" && tools.length > 0) {
    return `${opener} Two things stood out: seasonal replenishment and ${specificOne}. I would start with planting timing, care anxiety, and what the customer needs next before building more emails.`;
  }
  if (strategy.category === "email_design") {
    const platformDetail = requestedTools(strategy).length ? ` across ${requestedTools(strategy).slice(0, 2).join(" + ")}` : "";
    return `${opener} Two things stood out: offer hierarchy/mobile CTA clarity and ${specificTwo}${platformDetail}. I would treat this as an offer-clarity problem first, not a prettier-template pass.`;
  }
  return `${opener} Two things stood out: customer lifecycle/commercial pain and ${specificOne} around ${specificTwo}. That makes this a ${laneLabel(strategy.retention_lane)} problem first, because ${strategy.client_commercial_pain}.`;
}

function oneStepSolution(strategy: CopyStrategy): string {
  const tools = requestedTools(strategy);
  if (strategy.category === "email_design") {
    return "I would start by checking offer hierarchy, mobile readability, product path, and CTA visibility on the priority templates.";
  }
  if (tools.length >= 3) {
    return "I would start with active flows, subscriber/list logic, campaign cadence, and reporting, then rank the first fixes by likely lift.";
  }
  return `I would start with a tight diagnostic pass around ${strategy.repeat_purchase_or_conversion_moment}, then turn the clearest leak into the first practical fix.`;
}

function microMilestoneLine(strategy: CopyStrategy): string {
  const tools = requestedTools(strategy);
  if (strategy.category === "email_design") {
    return "First 3-5 day slice: tighten the priority template path. Done = the offer, hierarchy, product path, and CTA are clear on mobile before expanding the set.";
  }
  if (tools.length >= 3) {
    return "First 3-5 day slice: audit the active flows/campaigns and list logic. Done = the top three fixes are ranked by likely engagement/conversion lift with the first fix ready to implement.";
  }
  if (tools.length >= 1) {
    return `First 3-5 day slice: audit the highest-leverage customer moment in ${tools[0]}. Done = one practical fix is mapped with the trigger, segment, message angle, and measurement check.`;
  }
  return "First 3-5 day slice: diagnose the highest-leverage customer moment. Done = one practical fix is mapped with the trigger, message angle, and measurement check.";
}

function singleProofPoint(proofPoints: string[], portfolioItems: PortfolioItem[]): string {
  const selectedProof = proofPoints.find((point) =>
    /^[^:\n]{2,80}:\s+[^:\n]{8,}$/i.test(point) &&
    !/\b(?:Klaviyo Silver Partner|Senior director|Comfortable owning)\b/i.test(point)
  );
  if (selectedProof) {
    const [name, ...headlineParts] = selectedProof.split(":");
    const headline = headlineParts.join(":").trim().replace(/[.!?]+$/g, "");
    return `For proof, I would keep it to one matched artifact: ${name.trim()} - ${headline}.`;
  }
  const proofText = [...proofPoints, ...portfolioItems.map((item) => item.result), ...portfolioItems.map((item) => item.name)].join(" ");
  if (/klaviyo silver partner/i.test(proofText) || /8\+?\s*years/i.test(proofText)) {
    return "For proof, I would keep it to one Klaviyo/lifecycle artifact instead of dumping credentials.";
  }
  const portfolio = firstProofLabel(proofPoints, portfolioItems);
  if (portfolio && !/portfolio|general/i.test(portfolio)) {
    return `For proof, I would use ${portfolio} if it is the cleanest match for this scope.`;
  }
  return "For proof, I would use one artifact only after browser QA confirms it matches this application.";
}

function logisticsLine(strategy: CopyStrategy): string {
  const tools = requestedTools(strategy);
  if (strategy.category === "email_design") {
    return "I can keep this async-friendly and show the before/after logic before expanding the set.";
  }
  if (tools.length >= 3) {
    return "I can keep this async-friendly and show the performance logic before any bigger rebuild.";
  }
  return "I can start small and keep the first scope tied to the highest-leverage fix already implied by the brief.";
}

function ctaLine(strategy: CopyStrategy): string {
  const tools = requestedTools(strategy);
  if (strategy.category === "email_design") {
    return "Would you prefer a quick call, or should I send the first async template outline?";
  }
  if (tools.length >= 3) {
    return "Would you prefer a quick call, or should I send the first async audit outline from the current setup?";
  }
  return "Would you prefer a quick call, or should I send the first async outline from the current setup?";
}

export function draftCoverLetterFromCopyStrategy(input: {
  strategy: CopyStrategy;
  proofPoints: string[];
  portfolioItems: PortfolioItem[];
}): string {
  const strategy = input.strategy;
  return [
    conciseHook(strategy),
    "",
    `${oneStepSolution(strategy)} ${microMilestoneLine(strategy)}`,
    "",
    singleProofPoint(input.proofPoints, input.portfolioItems),
    "",
    `${logisticsLine(strategy)} ${ctaLine(strategy)}`,
  ].filter((line) => line !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
  return /\b(if it makes sense|if useful|happy to|send me|share|we can start|walk me through|take a quick look|choose a 10-minute call|2-slide plan|would you prefer|async (?:audit |template |)?outline|quick call)\b/i.test(text) && /[.!?]$/.test(text.trim());
}

function wordCount(text: string): number {
  return text.trim().match(/\b[\w'-]+\b/g)?.length ?? 0;
}

function paragraphCount(text: string): number {
  return text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).length;
}

function firstTwoSentenceWindow(text: string): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return sentences.slice(0, 2).join(" ").slice(0, 420);
}

function scorecardJobSignals(job: JobPosting, copyStrategy?: CopyStrategy | null): string[] {
  const source = sourceText(job).toLowerCase();
  const toolSignals = [
    "Klaviyo",
    "Mailchimp",
    "Omnisend",
    "Shopify",
    "Figma",
    "HubSpot",
    "Brevo",
    "Postscript",
    "Attentive",
  ].filter((signal) => source.includes(signal.toLowerCase()));
  const scopeSignals = [
    "flow",
    "flows",
    "automation",
    "campaign",
    "campaigns",
    "subscriber",
    "list",
    "engagement",
    "conversion",
    "retention",
    "lifecycle",
    "audit",
    "design",
    "template",
    "deliverability",
    "segmentation",
    "replenishment",
    "post-purchase",
    "welcome",
  ].filter((signal) => source.includes(signal.toLowerCase()));
  const strategySignals = [
    copyStrategy?.category,
    ...(copyStrategy?.requested_tools ?? []),
    ...(copyStrategy?.requested_deliverables ?? []),
  ];
  return unique([...toolSignals, ...scopeSignals, ...strategySignals])
    .filter((signal) => signal.length > 2 && !/unknown/i.test(signal))
    .slice(0, 18);
}

function countJobSpecificSignals(text: string, job: JobPosting, copyStrategy?: CopyStrategy | null): number {
  const lower = text.toLowerCase();
  return scorecardJobSignals(job, copyStrategy).filter((signal) => lower.includes(signal.toLowerCase())).length;
}

function proofMentionCount(text: string): number {
  const proofParagraphs = text.split(/\n{2,}/).filter((paragraph) => /\brelevant proof\b|\bfor proof\b|\bone matched artifact\b|\bcase study\b|\bscreenshot\b|\bloom\b/i.test(paragraph));
  return proofParagraphs.length;
}

function hasMicroMilestone(text: string): boolean {
  return /\bDone\s*=/i.test(text) &&
    /\b(?:3\s*[-–]\s*5|3|4|5|three|four|five)\s*(?:day|days)\b/i.test(text) &&
    /\b(?:first|slice|milestone|sprint|audit|diagnostic|fix)\b/i.test(text);
}

function hasMetricMarker(text: string): boolean {
  return /(?:\b\d+(?:\.\d+)?\s*%|\$\s?\d|\b\d+\s*x\b|\bfrom\s+[^.\n]{1,40}\s+to\s+[^.\n]{1,60})/i.test(text);
}

function hasBinaryOrScopeCta(text: string): boolean {
  const tail = text.trim().slice(-280);
  if (!/[?]$/.test(tail.trim())) return false;
  if (/\b(?:or|option a|option b|prefer|rather)\b/i.test(tail)) return true;
  return /\b(?:what|which|where|when|how)\b/i.test(tail) && /\b(?:scope|priority|setup|template|audit|outline|call|plan|fix)\b/i.test(tail);
}

function screeningQuestionsLikelyRequired(job: JobPosting): boolean {
  const text = sourceText(job);
  return /\b(?:screening questions?|application questions?|answer(?: the)? questions?|when applying|to apply|include in your proposal|please answer)\b/i.test(text);
}

function hasWeakScreeningAnswer(answer: string): boolean {
  return answer.split(/\s+/).filter(Boolean).length < 8 ||
    /\b(?:yes|no|n\/a|sure|happy to help|i can help|great question)\b\.?$/i.test(answer.trim()) ||
    /\b(?:tailored to your needs|leverage|extensive experience|passionate)\b/i.test(answer);
}

function usesGenericAiCliches(text: string): boolean {
  return /\b(?:I am writing to express|tailored to your needs|leverage my expertise|extensive experience|passionate about|proven track record|take your business to the next level)\b/i.test(text);
}

function hasUnsupportedClaim(text: string, proofState?: ProofVerificationState): boolean {
  if (/\bguarantee(?:d)?\b|\bwill definitely\b|\b100%\b/i.test(text)) return true;
  return /\b(?:attached|uploaded|selected portfolio|verified proof|included the file)\b/i.test(text) && proofState !== "verified";
}

function scorecardFeedback(code: string, detail?: string): string {
  switch (code) {
    case "opener_specificity":
      return "Blocked: opening lines are generic. Mention two concrete details from the job post in the first two sentences.";
    case "proof_relevance":
      return detail === "proof_dump"
        ? "Revise: too many proof items. Keep one artifact that best matches the client's problem."
        : "Blocked: no proof artifact or relevant example. Add exactly one matched case, screenshot, Loom, or portfolio item.";
    case "micro_milestone":
      return "Blocked: proposal lacks a clear first slice. Add one 3-5 day micro-milestone with Done = ....";
    case "screening_answers":
      return "Blocked: client questions are incomplete or vague. Answer directly with evidence before revising the body.";
    case "tone_humanity":
      return "Revise: draft sounds templated. Replace generic phrases with concrete specifics, proof, and client-language outcomes.";
    case "cta_quality":
      return "Revise: close is passive. End with one low-friction choice such as quick call or async outline?";
    case "readability":
      return "Revise: proposal is not scannable. Cut resume detail, keep one proof, and shorten to the operating band.";
    case "honesty":
      return "Blocked: this draft claims research or results that are not evidenced. Remove or restate honestly.";
    case "soul_loaded":
      return "Blocked: soul.md was not loaded before copywriting. Regenerate with soul.md invoked.";
    default:
      return "Revise: proposal scorecard found a quality issue.";
  }
}

function scorecardDimension(input: {
  dimension: string;
  weight: number;
  passed: boolean;
  hardFail: boolean;
  message: string;
  partial?: boolean;
}): ProposalScorecardDimension {
  return {
    dimension: input.dimension,
    weight: input.weight,
    score: input.passed ? input.weight : input.partial ? Math.round(input.weight * 0.55) : 0,
    passed: input.passed,
    hardFail: input.hardFail && !input.passed,
    message: input.message,
  };
}

export function evaluateProposalScorecard(input: {
  proposalText: string;
  job: JobPosting;
  copyStrategy?: CopyStrategy | null;
  proofVerificationState?: ProofVerificationState;
  screeningAnswers?: string[];
  soulLoaded?: boolean;
}): ProposalScorecardResult {
  const text = input.proposalText.trim();
  const words = wordCount(text);
  const openingSignalCount = countJobSpecificSignals(firstTwoSentenceWindow(text), input.job, input.copyStrategy);
  const totalSignalCount = countJobSpecificSignals(text, input.job, input.copyStrategy);
  const proofCount = proofMentionCount(text);
  const screeningAnswers = input.screeningAnswers ?? [];
  const screeningRequired = screeningQuestionsLikelyRequired(input.job);
  const screeningPass = screeningRequired
    ? screeningAnswers.length > 0 && !screeningAnswers.some(hasWeakScreeningAnswer)
    : !screeningAnswers.some(hasWeakScreeningAnswer);
  const paragraphs = paragraphCount(text);
  const bullets = (text.match(/^\s*(?:[-*]|\d+\.)\s+/gm) ?? []).length;
  const lengthInBand = words >= 150 && words <= 220;
  const readable = paragraphs >= 2 && paragraphs <= 5 && bullets <= 2 && words >= 60 && words <= 320;
  const customerOrGoal = /\b(?:customer|buyer|reader|shopper|subscriber|client|conversion|engagement|revenue|retention|trust|friction|repeat|replenishment|deliverability)\b/i.test(text);
  const proofPass = proofCount === 1 && input.proofVerificationState !== "unavailable" && input.proofVerificationState !== "do_not_claim";
  const metricPass = hasMetricMarker(text);
  const soulLoaded = input.soulLoaded === true;
  const tonePass = soulLoaded && /^steve here\b/i.test(text) && /\bI would\b/i.test(text) && !usesGenericAiCliches(text);
  const ctaPass = hasBinaryOrScopeCta(text);
  const honestyPass = !hasUnsupportedClaim(text, input.proofVerificationState) && !/\b(?:invented|fake|guaranteed results)\b/i.test(text);

  const dimensions = [
    scorecardDimension({
      dimension: "Opener specificity",
      weight: 15,
      passed: openingSignalCount >= 2,
      hardFail: true,
      partial: openingSignalCount === 1,
      message: `${openingSignalCount} job-specific signal(s) found in the first two sentences.`,
    }),
    scorecardDimension({
      dimension: "Client-goal understanding",
      weight: 15,
      passed: customerOrGoal && totalSignalCount >= 2,
      hardFail: true,
      partial: customerOrGoal || totalSignalCount >= 2,
      message: customerOrGoal ? "Draft names the client/customer outcome or risk." : "Draft does not clearly restate the client goal or risk.",
    }),
    scorecardDimension({
      dimension: "Proof relevance",
      weight: 15,
      passed: proofPass && metricPass,
      hardFail: true,
      partial: proofCount > 0,
      message: `${proofCount} proof block(s) found; expected exactly one relevant proof artifact or example with a metric.`,
    }),
    scorecardDimension({
      dimension: "Micro-milestone clarity",
      weight: 15,
      passed: hasMicroMilestone(text),
      hardFail: true,
      message: "Draft must include one 3-5 day first slice with Done = acceptance criteria.",
    }),
    scorecardDimension({
      dimension: "Screening-answer quality",
      weight: 10,
      passed: screeningPass,
      hardFail: screeningRequired,
      partial: screeningAnswers.length > 0,
      message: screeningRequired ? `${screeningAnswers.length} screening answer(s) for likely required questions.` : "No required screening questions detected, or answers are concrete enough.",
    }),
    scorecardDimension({
      dimension: "Tone / humanity",
      weight: 10,
      passed: tonePass,
      hardFail: true,
      partial: /^steve here\b/i.test(text) || /\bI would\b/i.test(text),
      message: soulLoaded ? "soul.md loaded and draft uses first-person human voice." : "soul.md was not loaded for copywriting.",
    }),
    scorecardDimension({
      dimension: "Logistics",
      weight: 5,
      passed: /\b(?:async-friendly|available|start|today|tomorrow|this week|turnaround|overlap|3-5 day|first scope)\b/i.test(text),
      hardFail: false,
      message: "Draft should remove operational friction with timeline, availability, or async workflow.",
    }),
    scorecardDimension({
      dimension: "CTA quality",
      weight: 5,
      passed: ctaPass,
      hardFail: true,
      message: "Draft must end with a binary or direct scope-tied question.",
    }),
    scorecardDimension({
      dimension: "Readability",
      weight: 5,
      passed: readable && lengthInBand,
      hardFail: !readable,
      partial: readable,
      message: `${words} words across ${paragraphs} paragraph(s); default operating band is 150-220 words.`,
    }),
    scorecardDimension({
      dimension: "Honesty / risk control",
      weight: 5,
      passed: honestyPass,
      hardFail: true,
      message: honestyPass ? "No unsupported proof, research, submit, or guarantee claim detected." : "Draft contains an unsupported or unsafe claim.",
    }),
  ];

  const score = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
  const hardFailures = dimensions.filter((dimension) => dimension.hardFail).map((dimension) => dimension.dimension);
  const feedbackMessages = dimensions
    .filter((dimension) => !dimension.passed)
    .map((dimension) => {
      if (dimension.dimension === "Opener specificity") return scorecardFeedback("opener_specificity");
      if (dimension.dimension === "Proof relevance") return scorecardFeedback("proof_relevance", proofCount > 1 ? "proof_dump" : undefined);
      if (dimension.dimension === "Micro-milestone clarity") return scorecardFeedback("micro_milestone");
      if (dimension.dimension === "Screening-answer quality") return scorecardFeedback("screening_answers");
      if (dimension.dimension === "Tone / humanity") return soulLoaded ? scorecardFeedback("tone_humanity") : scorecardFeedback("soul_loaded");
      if (dimension.dimension === "CTA quality") return scorecardFeedback("cta_quality");
      if (dimension.dimension === "Readability") return scorecardFeedback("readability");
      if (dimension.dimension === "Honesty / risk control") return scorecardFeedback("honesty");
      return scorecardFeedback("default");
    });

  return {
    score,
    ready: score >= 85 && hardFailures.length === 0,
    wordCount: words,
    operatingBand: { min: 150, max: 220, actual: words },
    dimensions,
    hardFailures,
    feedbackMessages: unique(feedbackMessages),
    jobSpecificSignalCount: openingSignalCount,
    proofCount,
    screeningAnswerCount: screeningAnswers.length,
    soulLoaded,
  };
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
  screeningAnswers?: string[];
  soulLoaded?: boolean;
}): DraftQualityGateResult {
  const text = input.proposalText.trim();
  const lower = text.toLowerCase();
  const issues: DraftQualityGateIssue[] = [];
  const scorecard = evaluateProposalScorecard({
    proposalText: text,
    job: input.job,
    copyStrategy: input.copyStrategy,
    proofVerificationState: input.proofVerificationState,
    screeningAnswers: input.screeningAnswers,
    soulLoaded: input.soulLoaded,
  });
  if (!scorecard.soulLoaded) {
    addIssue(issues, { code: "soul_md_not_loaded", severity: "critical", message: "soul.md must be loaded before writing proposal copy." });
  }
  if (scorecard.jobSpecificSignalCount < 2) {
    addIssue(issues, { code: "missing_two_line_specificity", severity: "critical", message: "First two sentences must contain at least two concrete details from the job post." });
  }
  if (scorecard.proofCount !== 1 || input.proofVerificationState === "unavailable" || input.proofVerificationState === "do_not_claim") {
    addIssue(issues, { code: "proof_count_not_one", severity: "critical", message: "Proposal must use exactly one relevant proof artifact or example." });
  }
  if (!hasMetricMarker(text)) {
    addIssue(issues, { code: "proof_metric_missing", severity: "critical", message: "Proposal proof must include a metric or quantified result." });
  }
  if (!hasMicroMilestone(text)) {
    addIssue(issues, { code: "missing_micro_milestone_done_criteria", severity: "critical", message: "Proposal must include one 3-5 day first slice with explicit Done = acceptance criteria." });
  }
  if ((text.match(/[?]/g) ?? []).length > 2) {
    addIssue(issues, { code: "question_overload", severity: "critical", message: "Proposal must not ask more than two questions." });
  }
  if (!hasBinaryOrScopeCta(text)) {
    addIssue(issues, { code: "missing_choice_based_cta", severity: "critical", message: "Proposal must end with a binary or scope-tied CTA question." });
  }
  if (!scorecard.ready) {
    addIssue(issues, {
      code: "proposal_scorecard_not_ready",
      severity: scorecard.hardFailures.length ? "critical" : "warning",
      message: `Proposal scorecard is ${scorecard.score}/100; ready requires 85+ with no hard failures.`,
      evidence: scorecard.feedbackMessages.slice(0, 3).join(" | "),
    });
  }
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
  if (!/^steve here\b/i.test(text) || !/\bhow is your day going\?/i.test(text)) {
    addIssue(issues, { code: "human_opener_missing", severity: "critical", message: "Cover letter is missing the required Steve here / human opener." });
  }
  if (/\b(?:Two customer-lifecycle details stood out|commercially pointed)\b/i.test(text)) {
    addIssue(issues, { code: "sterile_template_voice", severity: "critical", message: "Cover letter still contains the old sterile proposal template voice.", evidence: text.match(/\b(?:Two customer-lifecycle details stood out|commercially pointed)\b/i)?.[0] });
  }
  if (/\bjust adding noise\b/i.test(text)) {
    addIssue(issues, { code: "banned_noise_phrase", severity: "critical", message: "Cover letter contains the banned phrase just adding noise." });
  }
  if (/\bsend me the store url\b/i.test(text)) {
    addIssue(issues, { code: "store_url_punt_cta", severity: "critical", message: "Cover letter punts to a store URL instead of using the available job context first." });
  }
  if (/(?:upwork\.com|10\.00\w*|fixed[-\s]?price\w*|intermediatei)/i.test(text)) {
    addIssue(issues, { code: "parsed_page_noise_as_client", severity: "critical", message: "Cover letter appears to treat Upwork or parsed page/budget noise as the client or brand.", evidence: text.match(/(?:upwork\.com|10\.00\w*|fixed[-\s]?price\w*|intermediatei)/i)?.[0] });
  }
  if (/\b(?:screenshot\s*\d+|general retention portfolio)\b/i.test(text)) {
    addIssue(issues, { code: "weak_or_unverified_proof_reference", severity: "critical", message: "Cover letter references vague or unverified proof instead of a relevant verified proof plan.", evidence: text.match(/\b(?:screenshot\s*\d+|general retention portfolio)\b/i)?.[0] });
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
  if (text.split(/\s+/).filter(Boolean).length > 260) {
    addIssue(issues, { code: "proposal_too_long", severity: "critical", message: "Cover letter should stay tight and near the 200-word winning proposal structure." });
  }
  const customerInsight = input.copyStrategy?.customer_state_of_mind ?? "";
  if (!customerInsight || (!text.toLowerCase().includes(customerInsight.slice(0, 28).toLowerCase()) && !/\b(?:customer|buyer|reader|shopper|subscriber)\b/i.test(text))) {
    addIssue(issues, { code: "missing_customer_insight", severity: "critical", message: "Cover letter does not include a clear customer insight before selling services." });
  }
  const commercialPain = input.copyStrategy?.client_commercial_pain ?? "";
  if (!commercialPain || !/(opportunity|money|revenue|commercial|leak|conversion|retention|repeat|trust|friction|sender reputation|offer clarity|replenishment)/i.test(text)) {
    addIssue(issues, { code: "missing_commercial_pain", severity: "critical", message: "Cover letter does not name a business opportunity or commercial pain." });
  }
  const jobText = sourceText(input.job).toLowerCase();
  const requiredPlatforms = ["klaviyo", "mailchimp", "omnisend"].filter((platform) => jobText.includes(platform));
  const missingPlatforms = requiredPlatforms.filter((platform) => !lower.includes(platform));
  if (missingPlatforms.length > 0) {
    addIssue(issues, {
      code: "missing_requested_platform_specificity",
      severity: "critical",
      message: `Cover letter omits requested platform(s): ${missingPlatforms.join(", ")}.`,
      evidence: missingPlatforms.join(", "),
    });
  }
  if (/\bengagement\b/.test(jobText) && !/\bengagement\b/.test(lower)) {
    addIssue(issues, { code: "missing_requested_engagement_goal", severity: "critical", message: "Cover letter omits the job's engagement goal." });
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
    soulLoaded: scorecard.soulLoaded,
    fullJobDescriptionRead: input.fullJobDescriptionRead,
    copyStrategyCreated: input.copyStrategyCreated,
    finalSubmitManual: input.finalSubmitManual !== false,
    issues,
    scorecard,
  };
}

export function buildCopywritingDraft(input: CopywritingDraftInput): CopywritingDraftResult {
  if (!input.job.description.trim()) {
    throw new Error("Full job description is required before proposal-copywriting skill can run.");
  }
  if (input.skill.name !== "proposal-copywriting" || !input.skill.markdown.includes("# Proposal Copywriting Skill")) {
    throw new Error("proposal-copywriting skill must be loaded before draft generation.");
  }
  const soulGuidance = input.soulGuidance?.length ? input.soulGuidance : buildSoulRuntimeGuidance("proposal_copywriting_skill");
  if (soulGuidance.length === 0) {
    throw new Error("soul.md must be loaded before proposal copywriting.");
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
    screeningAnswers,
    soulLoaded: soulGuidance.length > 0,
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
