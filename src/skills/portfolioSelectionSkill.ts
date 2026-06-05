import * as fs from "node:fs";
import * as path from "node:path";
import { JobPosting, ScoredJob } from "../types";

export type AssetSafety = boolean | "needs_review";

export interface ProofAssetRule {
  path: string;
  assetType: "attachment" | "screenshot";
  safeToAttach: AssetSafety;
  safeToMention: boolean;
  requiresManualReview: boolean;
  usage: "auto_attach" | "mention_only" | "recommend_only";
}

export interface ProofRecord {
  id: string;
  name: string;
  industry?: string[];
  tools?: string[];
  skills?: string[];
  brands?: string[];
  headline: string;
  supporting: string[];
  useFor: string[];
  assetRules: ProofAssetRule[];
}

export interface PortfolioAsset {
  id: string;
  name: string;
  path: string;
  kind: "attachment" | "screenshot";
  categories: string[];
  safeToMention: boolean;
  safeToAttach: boolean;
  safeToAutoInclude: boolean;
  requiresManualReview: boolean;
  recommendedUsage: string;
}

export interface PortfolioLink {
  id: string;
  name: string;
  url: string;
  useFor: string[];
  safeToMention: boolean;
  safeToAutoInclude: boolean;
  requiresManualReview: boolean;
}

export interface UpworkPortfolioItem {
  id: string;
  name: string;
  proofIds: string[];
  aliases: string[];
}

export interface PortfolioSelectionResult {
  matchedThemes: string[];
  selectedProof: ProofRecord[];
  autoAttachAssets: PortfolioAsset[];
  recommendOnlyAssets: PortfolioAsset[];
  mentionOnlyProof: ProofRecord[];
  doNotUseAssets: PortfolioAsset[];
  selectedUpworkPortfolioItems: UpworkPortfolioItem[];
  selectedFigmaLinks: PortfolioLink[];
  selectedVideoLinks: PortfolioLink[];
  warnings: string[];
}

interface ProofBankFile {
  version: number;
  owner: string;
  records: ProofRecord[];
}

interface PortfolioAssetsFile {
  version: number;
  assets: PortfolioAsset[];
}

interface PortfolioLinksFile {
  version: number;
  links: PortfolioLink[];
}

const PROFILE_DIR = path.resolve(process.cwd(), "profile");
const PROOF_BANK_PATH = path.join(PROFILE_DIR, "proof-bank.json");
const PORTFOLIO_ASSETS_PATH = path.join(PROFILE_DIR, "portfolio-assets.json");
const FIGMA_LINKS_PATH = path.join(PROFILE_DIR, "figma-links.json");
const VIDEO_LINKS_PATH = path.join(PROFILE_DIR, "video-links.json");

export const UPWORK_PORTFOLIO_ITEMS: UpworkPortfolioItem[] = [
  {
    id: "design-case-studies-upwork",
    name: "Steve's Design Case Studies",
    proofIds: ["design-case-studies"],
    aliases: ["design case studies", "steve's design case studies"],
  },
  {
    id: "fly-boutique-upwork",
    name: "The Fly Boutique (Retain Like Crazy)",
    proofIds: ["fly-boutique"],
    aliases: ["fly boutique", "retain like crazy"],
  },
  {
    id: "lifely-upwork",
    name: "How Lifely Transformed Their Retention Marketing",
    proofIds: ["lifely"],
    aliases: ["lifely"],
  },
  {
    id: "truly-beauty-upwork",
    name: "From $250k to $1.2 Million In 12 Months / Truly Beauty",
    proofIds: ["truly-beauty"],
    aliases: ["truly beauty", "$1.2 million", "250k"],
  },
];

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function loadProofBank(): ProofRecord[] {
  return readJson<ProofBankFile>(PROOF_BANK_PATH).records;
}

export function loadPortfolioAssets(): PortfolioAsset[] {
  return readJson<PortfolioAssetsFile>(PORTFOLIO_ASSETS_PATH).assets;
}

export function loadFigmaLinks(): PortfolioLink[] {
  return readJson<PortfolioLinksFile>(FIGMA_LINKS_PATH).links;
}

export function loadVideoLinks(): PortfolioLink[] {
  return readJson<PortfolioLinksFile>(VIDEO_LINKS_PATH).links;
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function getJobText(job: Pick<JobPosting, "title" | "description" | "skills" | "category" | "budget" | "clientCountry">): string {
  return [job.title, job.description, job.skills.join(" "), job.category, job.budget, job.clientCountry].join(" ").toLowerCase();
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function findProofById(records: ProofRecord[], id: string): ProofRecord {
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error(`Missing proof record: ${id}`);
  return record;
}

function findAssetByPath(assets: PortfolioAsset[], filePath: string): PortfolioAsset | null {
  return assets.find((asset) => asset.path === filePath) ?? null;
}

function addProofAndAssets(
  result: PortfolioSelectionResult,
  proof: ProofRecord,
  assets: PortfolioAsset[],
  selectionMode: "auto_attach" | "mention_only" | "recommend_only",
): void {
  result.selectedProof.push(proof);
  for (const rule of proof.assetRules) {
    const asset = findAssetByPath(assets, rule.path);
    if (!asset) {
      result.warnings.push(`Missing asset metadata for ${rule.path}`);
      continue;
    }

    if (rule.requiresManualReview || rule.safeToAttach === false || rule.safeToAttach === "needs_review" || selectionMode !== "auto_attach") {
      if (rule.safeToMention) {
        result.recommendOnlyAssets.push(asset);
      } else {
        result.doNotUseAssets.push(asset);
      }
      continue;
    }

    if (asset.safeToAutoInclude && asset.safeToAttach) {
      result.autoAttachAssets.push(asset);
    } else {
      result.recommendOnlyAssets.push(asset);
    }
  }

  if (selectionMode === "mention_only") {
    result.mentionOnlyProof.push(proof);
  }
}

function addUpworkPortfolioForProof(result: PortfolioSelectionResult, proofId: string): void {
  const matches = UPWORK_PORTFOLIO_ITEMS.filter((item) => item.proofIds.includes(proofId));
  result.selectedUpworkPortfolioItems.push(...matches);
}

function isDesignRelevant(text: string): boolean {
  return /(figma|design|email design|template|campaign design|flow design|creative|visual|mockup)/.test(text);
}

function pickFigmaLinks(text: string, figmaLinks: PortfolioLink[]): PortfolioLink[] {
  if (!isDesignRelevant(text)) {
    return [];
  }
  return figmaLinks.filter((link) => includesAny(text, link.useFor.map((item) => item.toLowerCase())) || /figma|design/.test(link.useFor.join(" ").toLowerCase())).slice(0, 2);
}

function pickVideoLinks(text: string, videoLinks: PortfolioLink[]): PortfolioLink[] {
  if (!/(video|loom|intro|walkthrough)/.test(text)) {
    return [];
  }
  return videoLinks.filter((link) => link.safeToMention).slice(0, 1);
}

function rankAutoAttachAssets(text: string, assets: PortfolioAsset[]): PortfolioAsset[] {
  const score = (asset: PortfolioAsset): number => {
    let value = 0;
    const haystack = `${asset.name} ${asset.categories.join(" ")} ${asset.recommendedUsage}`.toLowerCase();
    if (/(beauty|skincare|cosmetic)/.test(text) && /beauty|skincare/.test(haystack)) value += 5;
    if (/(health|wellness|supplement)/.test(text) && /health|wellness|supplement/.test(haystack)) value += 4;
    if (/(subscription|lifecycle foundation|foundation|recharge)/.test(text) && /subscription|foundation|recharge/.test(haystack)) value += 4;
    if (isDesignRelevant(text) && /design|figma|creative/.test(haystack)) value += 5;
    if (/(mailchimp|automation|strategy|retention|klaviyo|shopify|sms|lifecycle)/.test(text) && /case study|retention|automation|lifecycle/.test(haystack)) value += 3;
    if (/(portfolio|proof|case stud|sample|previous work)/.test(text) && /portfolio|proof|case study/.test(haystack)) value += 3;
    if (/(intro|introduction|deck|about steve|meet steve)/.test(text) && /intro|meet steve/.test(haystack)) value += 5;
    if (asset.kind === "screenshot" && /(screenshot|performance|numbers|proof|metric|revenue|klaviyo)/.test(text)) value += 2;
    if (asset.kind === "screenshot" && !/(screenshot|performance|numbers|proof|metric|revenue|klaviyo)/.test(text)) value -= 2;
    if (/endurance wellness/i.test(asset.name) && !/(subscription|lifecycle foundation|foundation|health|wellness)/.test(text)) value -= 10;
    if (/design case studies/i.test(asset.name) && !isDesignRelevant(text)) value -= 10;
    return value;
  };
  return [...assets].sort((left, right) => score(right) - score(left)).slice(0, 3);
}

export function selectPortfolioAssetsForJob(job: JobPosting | ScoredJob): PortfolioSelectionResult {
  const text = getJobText(job);
  const proofBank = loadProofBank();
  const assets = loadPortfolioAssets();
  const figmaLinks = loadFigmaLinks();
  const videoLinks = loadVideoLinks();

  const result: PortfolioSelectionResult = {
    matchedThemes: [],
    selectedProof: [],
    autoAttachAssets: [],
    recommendOnlyAssets: [],
    mentionOnlyProof: [],
    doNotUseAssets: [],
    selectedUpworkPortfolioItems: [],
    selectedFigmaLinks: [],
    selectedVideoLinks: [],
    warnings: [],
  };

  const addTheme = (theme: string) => {
    result.matchedThemes.push(theme);
  };

  if (/(beauty|skincare|cosmetic)/.test(text) && /(klaviyo|shopify|email|sms|retention|lifecycle)/.test(text)) {
    addTheme("beauty_klaviyo");
    addProofAndAssets(result, findProofById(proofBank, "truly-beauty"), assets, "auto_attach");
    addUpworkPortfolioForProof(result, "truly-beauty");
  }

  if (/(health|wellness|supplement|men'?s health)/.test(text)) {
    addTheme("health_supplements");
    addProofAndAssets(result, findProofById(proofBank, "dr-rachael-institute"), assets, "auto_attach");
    addProofAndAssets(result, findProofById(proofBank, "dr-rachael-klaviyo-screenshot"), assets, "auto_attach");
    if (/(subscription|foundation|setup|recharge)/.test(text)) {
      addProofAndAssets(result, findProofById(proofBank, "endurance-wellness"), assets, "auto_attach");
    }
  }

  if (/(high-aov|high aov|furniture|home goods|sofa|mattress|premium lifestyle|considered purchase)/.test(text)) {
    addTheme("high_aov_home");
    addProofAndAssets(result, findProofById(proofBank, "lifely"), assets, "auto_attach");
    addUpworkPortfolioForProof(result, "lifely");
  }

  if (/(fashion|apparel|boutique|clothing|deliverability|spam|rfm)/.test(text)) {
    addTheme("fashion_deliverability");
    addProofAndAssets(result, findProofById(proofBank, "fly-boutique"), assets, "auto_attach");
    addUpworkPortfolioForProof(result, "fly-boutique");
  }

  if (/(figma|design|email design|template|visual|campaign design|flow design)/.test(text)) {
    addTheme("design_figma");
    addProofAndAssets(result, findProofById(proofBank, "design-case-studies"), assets, "auto_attach");
    addUpworkPortfolioForProof(result, "design-case-studies");
    result.selectedFigmaLinks.push(...pickFigmaLinks(text, figmaLinks));
  }

  if (/(pet|dog|cat|chicken|farm|hobby)/.test(text) && /(dtc|shopify|klaviyo|retention|email|sms|recharge)/.test(text)) {
    addTheme("pet_dtc");
    addProofAndAssets(result, findProofById(proofBank, "whisker-seeker"), assets, "auto_attach");
    addProofAndAssets(result, findProofById(proofBank, "my-pet-chicken"), assets, "auto_attach");
  }

  if (/\b(beverage|drink|lifestyle)\b/.test(text) && /\b(uk|united kingdom|europe|eu|european)\b/.test(text)) {
    addTheme("beverage_lifestyle_uk");
    addProofAndAssets(result, findProofById(proofBank, "hangaritas-screenshot"), assets, "auto_attach");
  }

  if (/\b(art|anime|fandom|jewelry)\b/.test(text)) {
    addTheme("art_fandom");
    addProofAndAssets(result, findProofById(proofBank, "kraymer-art-screenshot"), assets, "auto_attach");
  }

  if (/(portfolio|proof|case stud|sample|previous work)/.test(text) && result.autoAttachAssets.length === 0) {
    const general = findAssetByPath(assets, "profile/attachments/portfolio.pdf");
    if (general) {
      result.autoAttachAssets.push(general);
    }
  }

  result.selectedVideoLinks.push(...pickVideoLinks(text, videoLinks));

  result.matchedThemes = uniqueStrings(result.matchedThemes);
  result.selectedProof = uniqueById(result.selectedProof).slice(0, 3);
  result.autoAttachAssets = rankAutoAttachAssets(text, uniqueById(result.autoAttachAssets).filter((asset) => !(asset.requiresManualReview || !asset.safeToAttach)));
  result.recommendOnlyAssets = uniqueById(result.recommendOnlyAssets)
    .filter((asset) => !result.autoAttachAssets.some((item) => item.id === asset.id))
    .filter((asset) => !(/design case studies/i.test(asset.name) && !isDesignRelevant(text)))
    .filter((asset) => !(/endurance wellness/i.test(asset.name) && !/(subscription|lifecycle foundation|foundation|health|wellness)/.test(text)))
    .slice(0, 3);
  result.mentionOnlyProof = uniqueById(result.mentionOnlyProof).slice(0, 2);
  result.doNotUseAssets = uniqueById(result.doNotUseAssets);
  result.selectedUpworkPortfolioItems = uniqueById(result.selectedUpworkPortfolioItems).slice(0, 2);
  result.selectedFigmaLinks = uniqueById(result.selectedFigmaLinks).slice(0, 2);
  result.selectedVideoLinks = uniqueById(result.selectedVideoLinks).slice(0, 1);

  if (result.autoAttachAssets.some((asset) => asset.requiresManualReview || !asset.safeToAttach)) {
    result.warnings.push("Sensitive assets attempted to auto-attach; selection rules should be reviewed.");
  }
  if (result.recommendOnlyAssets.some((asset) => asset.requiresManualReview)) {
    result.warnings.push("Some selected assets require manual review before mention or attachment.");
  }

  return result;
}
