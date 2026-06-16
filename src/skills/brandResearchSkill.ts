import { loadRuntimeSkill, hasUsefulBrandOrCategoryClue, LoadedRuntimeSkill } from "../skillRuntime";
import { BrandResearchRun, isSafeBrandResearchUrl } from "../brandResearchProvider";
import { BrandFactPack, BrandResearchSourceDetail, JobPosting } from "../types";

export type BrandResearchSkillRuntime = LoadedRuntimeSkill & {
  name: "brand-research";
};

export function loadBrandResearchSkill(now = new Date()): BrandResearchSkillRuntime {
  const skill = loadRuntimeSkill("brand-research", now);
  return { ...skill, name: "brand-research" };
}

function sourceText(job: Pick<JobPosting, "title" | "description" | "skills" | "category" | "budget" | "clientCountry">): string {
  return [job.title, job.description, job.skills.join(" "), job.category, job.budget, job.clientCountry].join("\n");
}

function primarySourceText(job: Pick<JobPosting, "title" | "description" | "category">): string {
  return [job.title, job.description, job.category].join("\n");
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = value?.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
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
  if (/^(?:company\.more|client\.more|profile\.more|www\.company\.more)$/i.test(domain)) return false;
  if (/\b(?:fixed-price|intermediate|proposals|connects|tooltip|posted|worldwide|hour|hr)\b/i.test(domain)) return false;
  const parts = domain.split(".");
  const tld = parts[parts.length - 1] ?? "";
  if (!/^[a-z]{2,24}$/i.test(tld)) return false;
  if (/^\d+$/.test(parts[0] ?? "")) return false;
  return true;
}

function visibleBrandName(job: Pick<JobPosting, "title" | "description">): string {
  const text = `${job.title}\n${job.description}`;
  return firstMatch(text, [
    /\b(?:brand|store|company|site)\s+([A-Z][A-Za-z0-9&' -]{2,60}?)(?=\s*(?:\/|,|\.|\band\b|\bneeds\b|\bis\b|\n|$))/,
    /\bfor\s+([A-Z][A-Za-z0-9&' -]{2,50}?)(?=\s+(?:brand|store|shop|site|company)\b)/,
  ]);
}

function visibleUrls(job: Pick<JobPosting, "title" | "description">): string[] {
  const text = `${job.title}\n${job.description}`;
  return unique([...text.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/[^\s),.;]*)?/gi)]
    .map((match) => match[1] ?? match[0])
    .filter(isUsefulBrandDomain)
    .map((url) => `https://${cleanCandidateDomain(url)}`));
}

function categoryFor(job: Pick<JobPosting, "title" | "description" | "skills" | "category" | "budget" | "clientCountry">): string {
  const text = sourceText(job).toLowerCase();
  const primaryText = primarySourceText(job).toLowerCase();
  const lifecycleScope = hasLifecycleEmailPlatformScope(text);
  const strongPrimaryDesignScope = isStrongDesignScope(primaryText);
  if (/garden|plant|lawn|seed|nursery|horticulture/.test(text)) return "gardening";
  if (strongPrimaryDesignScope) return "email design";
  if (/beauty|skincare|cosmetic|skin care|makeup/.test(text)) return "beauty/skincare";
  if (/fashion|apparel|clothing|boutique|jewelry/.test(text)) return "fashion/apparel";
  if (lifecycleScope && !strongPrimaryDesignScope) return "DTC ecommerce";
  if (!lifecycleScope && isStrongDesignScope(text)) return "email design";
  if (/\b(?:pet|dog|cat|farm|hobby)\b/.test(text)) return "pet and hobby DTC";
  if (/supplement|wellness|health/.test(text)) return "health/wellness";
  if (/saas|b2b|software|crm implementation|sales pipeline/.test(text)) return "B2B/SaaS";
  if (/shopify|ecommerce|e-commerce|dtc|d2c|klaviyo|mailchimp|omnisend|email marketing|retention|lifecycle/.test(text)) return "DTC ecommerce";
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

function proofAngleFor(category: string): string {
  if (category === "gardening") {
    return "Use lifecycle proof around seasonal timing, customer education, replenishment, and confidence-building; do not claim brand-specific results unless verified.";
  }
  if (category === "beauty/skincare") {
    return "Use DTC skincare/beauty proof around trust, routine-building, education, replenishment, and repeat purchase; do not claim attached proof until browser verification confirms it.";
  }
  if (category === "email design") {
    return "Use proof around hierarchy, mobile readability, offer clarity, CTA visibility, and conversion logic before design-tool fluency.";
  }
  if (category === "DTC ecommerce") {
    return "Use audit-style Klaviyo/email lifecycle proof when relevant; keep proof focused on flows, campaigns, segmentation, list quality, and revenue/engagement diagnostics instead of forcing unrelated design assets.";
  }
  if (category === "fashion/apparel") {
    return "Use proof around browse intent, fit/occasion confidence, drop timing, and repeat purchase moments; keep any brand-specific style claims source-backed.";
  }
  if (category === "B2B/SaaS") {
    return "Use proof around implementation clarity, workflow adoption, risk reduction, and buyer-stage messaging.";
  }
  return "Use proof that matches the visible job/category logic only; avoid claims about attachments, portfolio selection, or brand research that have not been verified.";
}

function categoryLogic(category: string): Omit<BrandFactPack, "brandName" | "websiteUrls" | "sources" | "sourceDetails" | "confidence" | "researchNeeded" | "researchAttempted" | "webResearchProvider" | "webResearchStatus" | "webResearchQuery" | "researchSummary" | "whatNotToClaim" | "proofAngle" | "assumptions"> {
  if (category === "gardening") {
    return {
      whatTheBrandSells: "gardening products, plants, seeds, tools, or care-related products",
      productCategory: "gardening",
      targetCustomerIcp: "gardeners who need confidence around season, plant type, climate, and care steps",
      customerBuyingMoment: "seasonal planting, care problem, replenishment, or the next plant/product decision",
      repeatPurchaseMoment: "season change, product care stage, replenishment, harvest/planting cycle, or follow-on supplies",
      emotionalPainOrDesire: "avoid wasting time, money, or plants; feel capable and proud of the result",
      likelyLifecycleLeak: "repeat purchase can leak when season, plant type, skill level, geography, and care stage are not mapped clearly",
      likelyConversionLeak: "product pages/emails may not answer what to buy now, why now, and how to succeed with it",
      customerEducationGaps: ["seasonal timing", "care instructions", "plant/product fit", "replenishment timing"],
      objectionsOrTrustGaps: ["will this work in my climate", "am I buying the right thing", "will I mess this up"],
      languageOrHooks: ["right plant, right season, right care step", "help customers feel confident before they buy"],
    };
  }
  if (category === "beauty/skincare") {
    return {
      whatTheBrandSells: "beauty, skincare, cosmetic, or personal-care products",
      productCategory: "beauty/skincare",
      targetCustomerIcp: "buyers who need trust, routine fit, product education, and confidence before repeat purchase",
      customerBuyingMoment: "first-use concern, routine upgrade, replenishment, product pairing, or trust-building before trial",
      repeatPurchaseMoment: "first result, routine formation, replenishment window, and next-best product education",
      emotionalPainOrDesire: "feel confident the product will work for their skin, routine, identity, or desired result",
      likelyLifecycleLeak: "repeat purchase can leak when trust, product education, routine-building, and replenishment timing are not handled clearly",
      likelyConversionLeak: "copy may skip proof, routine context, objections, and product education before asking for action",
      customerEducationGaps: ["how to use it", "who it is for", "when to expect value", "what pairs with it"],
      objectionsOrTrustGaps: ["will this work for me", "is it safe", "is the result believable", "do I need this now"],
      languageOrHooks: ["trust, routine, result, replenishment", "turn product curiosity into a habit"],
    };
  }
  if (category === "email design") {
    return {
      whatTheBrandSells: "products or offers that need clearer email communication",
      productCategory: "email design",
      targetCustomerIcp: "busy email readers deciding in seconds whether the offer is worth attention",
      customerBuyingMoment: "skim-to-click moment where hierarchy, offer clarity, and CTA visibility decide action",
      repeatPurchaseMoment: "campaign or flow moments where a prior buyer needs a clear next reason to click",
      emotionalPainOrDesire: "avoid confusion and quickly see the product, reason, proof, and next step",
      likelyLifecycleLeak: "conversion can leak when visual hierarchy does not make the offer, product path, proof, and CTA obvious fast enough",
      likelyConversionLeak: "weak hierarchy, unclear offer, buried CTA, or design-tool focus before customer clarity",
      customerEducationGaps: ["offer hierarchy", "product value", "proof placement", "single-action CTA"],
      objectionsOrTrustGaps: ["what is this", "why should I care", "what happens if I click"],
      languageOrHooks: ["hierarchy before decoration", "make the offer obvious fast"],
    };
  }
  if (category === "DTC ecommerce") {
    return {
      whatTheBrandSells: "ecommerce products or offers sold through email/lifecycle marketing",
      productCategory: "DTC ecommerce",
      targetCustomerIcp: "ecommerce customers deciding whether the timing, offer, product path, and next step are relevant enough to act on",
      customerBuyingMoment: "welcome intent, campaign interest, abandoned intent, post-purchase education, replenishment, winback, or segmented product discovery",
      repeatPurchaseMoment: "post-purchase education, replenishment timing, next-best product, campaign segmentation, and winback",
      emotionalPainOrDesire: "feel that the message is relevant now and the next action is worth taking",
      likelyLifecycleLeak: "engagement and conversion can leak when flows, campaigns, subscriber list work, and reporting are not tied to clear customer moments",
      likelyConversionLeak: "campaigns may be sent without enough segmentation, offer clarity, lifecycle timing, or performance feedback loops",
      customerEducationGaps: ["why this offer now", "what to click next", "what product path makes sense", "when to return"],
      objectionsOrTrustGaps: ["is this relevant", "why now", "what happens if I click", "is this offer worth attention"],
      languageOrHooks: ["flows, campaigns, list quality, reporting, engagement, conversion", "make each lifecycle moment earn the click"],
    };
  }
  if (category === "fashion/apparel") {
    return {
      whatTheBrandSells: "fashion, apparel, accessories, or style-driven products",
      productCategory: "fashion/apparel",
      targetCustomerIcp: "shoppers buying identity, occasion, fit confidence, and discovery",
      customerBuyingMoment: "drop timing, occasion, abandoned product interest, styling confidence, or seasonal need",
      repeatPurchaseMoment: "new arrivals, replenishment, outfit pairing, VIP/drop access, or abandoned intent",
      emotionalPainOrDesire: "feel seen, styled, timely, and confident about fit or occasion",
      likelyLifecycleLeak: "lifecycle revenue can leak when browsing, fit, style, occasion, and drop timing are not connected",
      likelyConversionLeak: "copy may show products without enough fit, identity, occasion, or urgency logic",
      customerEducationGaps: ["fit", "styling", "occasion", "drop timing"],
      objectionsOrTrustGaps: ["will this fit", "will this suit me", "is this worth buying now"],
      languageOrHooks: ["fit, identity, occasion, timing", "make the next outfit decision easier"],
    };
  }
  if (category === "B2B/SaaS") {
    return {
      whatTheBrandSells: "software, implementation, services, or workflow improvement",
      productCategory: "B2B/SaaS",
      targetCustomerIcp: "buyers trying to reduce risk, wasted time, workflow pain, and decision uncertainty",
      customerBuyingMoment: "workflow pain, implementation friction, risk reduction, or decision confidence",
      repeatPurchaseMoment: "adoption, renewal, expansion, onboarding, and proof of operational value",
      emotionalPainOrDesire: "avoid choosing the wrong system or wasting team time on a messy implementation",
      likelyLifecycleLeak: "pipeline or lifecycle movement can leak when buyer stage, role, risk, and implementation concern are not matched",
      likelyConversionLeak: "messaging may describe features before explaining the business risk removed",
      customerEducationGaps: ["implementation risk", "workflow value", "adoption path", "decision criteria"],
      objectionsOrTrustGaps: ["will this work for my team", "how risky is switching", "what if implementation drags"],
      languageOrHooks: ["less risk, less wasted time, clearer next step", "turn workflow pain into adoption"],
    };
  }
  return {
    whatTheBrandSells: "unknown from visible job text",
    productCategory: category || "unknown",
    targetCustomerIcp: "customers who need a clear reason to trust, buy, return, or take the next step",
    customerBuyingMoment: "the moment the customer needs timing, clarity, belief, and a reason to act",
    repeatPurchaseMoment: "post-purchase education, next-best action, segmentation, and a clear reason to come back",
    emotionalPainOrDesire: "feel confident the brand understands what they need and why now matters",
    likelyLifecycleLeak: "customer moments may not be mapped clearly enough for timing, segmentation, and message fit",
    likelyConversionLeak: "the offer, proof, and next step may not be clear enough before asking for action",
    customerEducationGaps: ["customer moment", "offer clarity", "proof", "next step"],
    objectionsOrTrustGaps: ["why now", "why this", "why trust it"],
    languageOrHooks: ["timing, trust, clarity, next step"],
  };
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeWebSourceDetails(results: BrandResearchSourceDetail[]): BrandResearchSourceDetail[] {
  const seen = new Set<string>();
  const output: BrandResearchSourceDetail[] = [];
  for (const result of results) {
    const key = result.url.toLowerCase();
    if (!isSafeBrandResearchUrl(result.url)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      title: normalizeSnippet(result.title),
      url: result.url,
      snippet: normalizeSnippet(result.snippet),
      provider: result.provider,
    });
  }
  return output.slice(0, 5);
}

function searchLanguageHooks(sourceDetails: BrandResearchSourceDetail[]): string[] {
  return unique(sourceDetails.flatMap((source) => [
    source.title,
    source.snippet.split(/[.!?]/).find((sentence) => /\b(?:customers?|product|routine|trust|season|design|conversion|reviews?|shop|buy|skin|plant|software)\b/i.test(sentence)),
  ])).slice(0, 4);
}

function webEvidenceSummary(sourceDetails: BrandResearchSourceDetail[]): string {
  if (sourceDetails.length === 0) return "";
  return sourceDetails
    .map((source) => {
      const host = sourceHost(source.url) || source.url;
      return `${host}: ${source.title}`;
    })
    .join("; ");
}

export function buildBrandFactPack(input: {
  job: Pick<JobPosting, "id" | "title" | "description" | "skills" | "category" | "budget" | "clientCountry">;
  skill: BrandResearchSkillRuntime;
  webResearch?: BrandResearchRun | null;
}): BrandFactPack {
  const job = input.job;
  const researchNeeded = hasUsefulBrandOrCategoryClue(job);
  const brandName = visibleBrandName(job);
  const urls = visibleUrls(job);
  const category = categoryFor(job);
  const logic = categoryLogic(category);
  const sourceDetails = safeWebSourceDetails(input.webResearch?.results ?? []);
  const webSourceUrls = sourceDetails.map((source) => source.url);
  const webHooks = searchLanguageHooks(sourceDetails);
  const sources = unique([
    "Upwork job title",
    job.description.trim() ? "Upwork job description" : null,
    ...urls,
    ...webSourceUrls,
    category !== "unknown" ? `category clue: ${category}` : null,
  ]);
  const researchAttempted = researchNeeded;
  const hasWebEvidence = sourceDetails.length > 0;
  const confidence = !researchNeeded
    ? "unavailable"
    : hasWebEvidence && (brandName || urls.length > 0)
      ? "high"
      : hasWebEvidence
        ? "medium"
        : brandName || urls.length > 0
      ? "medium"
      : category !== "unknown"
        ? "low"
        : "unavailable";
  const webResearchStatus = input.webResearch?.status ?? (researchNeeded ? "not_configured" : "not_applicable");
  const webResearchProvider = input.webResearch?.provider ?? "disabled";
  const webResearchQuery = input.webResearch?.query ?? "";
  const assumptions = unique([
    hasWebEvidence ? null : "No source-backed web facts were available for this draft.",
    sourceDetails.length > 0 ? null : "Customer psychology and lifecycle leaks are inferred from the job post and category logic.",
    brandName || urls.length > 0 ? null : "Brand name and official website are unknown.",
    input.webResearch?.skippedReason ? `Web research skipped: ${input.webResearch.skippedReason}` : null,
    input.webResearch?.error ? `Web research failed: ${input.webResearch.error}` : null,
  ]);
  const whatNotToClaim = unique([
    hasWebEvidence ? null : "live website research beyond the visible job text",
    hasWebEvidence ? null : "source-backed brand facts",
    brandName ? null : "brand name",
    urls.length > 0 || hasWebEvidence ? null : "brand website content",
    "private metrics",
    "verified customer reviews",
    "attached proof or selected portfolio unless browser verification confirms it",
  ]);
  const researchSummary = !researchNeeded
    ? "No useful brand/category clue was present, so brand research was not selected."
    : hasWebEvidence
      ? `Used ${webResearchProvider} web research outside the production Upwork browser; sources: ${webEvidenceSummary(sourceDetails)}.`
      : urls.length > 0
        ? `Used visible job text and website URL clues only; web research status=${webResearchStatus}; no production Upwork/VNC browser research was used.`
        : `Used visible job text and category-level customer logic for ${category}; web research status=${webResearchStatus}; no fake brand-specific claims.`;

  return {
    brandName: brandName || "unknown",
    websiteUrls: urls,
    ...logic,
    languageOrHooks: unique([...logic.languageOrHooks, ...webHooks]).slice(0, 6),
    whatNotToClaim,
    confidence,
    sources,
    sourceDetails,
    researchNeeded,
    researchAttempted,
    webResearchProvider,
    webResearchStatus,
    webResearchQuery,
    researchSummary,
    proofAngle: proofAngleFor(category),
    assumptions,
  };
}
