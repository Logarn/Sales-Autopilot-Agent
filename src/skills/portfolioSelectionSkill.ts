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

export interface PortfolioSelectionResult {
  matchedThemes: string[];
  selectedProof: ProofRecord[];
  autoAttachAssets: PortfolioAsset[];
  recommendOnlyAssets: PortfolioAsset[];
  mentionOnlyProof: ProofRecord[];
  doNotUseAssets: PortfolioAsset[];
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

function pickFigmaLinks(text: string, figmaLinks: PortfolioLink[]): PortfolioLink[] {
  if (!/(figma|design|email design|template|campaign design|flow design|visual)/.test(text)) {
    return [];
  }
  return figmaLinks.filter((link) => includesAny(text, link.useFor.map((item) => item.toLowerCase())) || /figma|design/.test(link.useFor.join(" ").toLowerCase()));
}

function pickVideoLinks(text: string, videoLinks: PortfolioLink[]): PortfolioLink[] {
  if (!/(video|loom|intro|walkthrough|high-trust|long-term)/.test(text)) {
    return [];
  }
  return videoLinks.filter((link) => link.safeToMention);
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
  }

  if (/(health|wellness|supplement|men'?s health)/.test(text)) {
    addTheme("health_supplements");
    addProofAndAssets(result, findProofById(proofBank, "dr-rachael-institute"), assets, "mention_only");
    addProofAndAssets(result, findProofById(proofBank, "dr-rachael-klaviyo-screenshot"), assets, "recommend_only");
    if (/(subscription|foundation|setup|recharge)/.test(text)) {
      addProofAndAssets(result, findProofById(proofBank, "endurance-wellness"), assets, "auto_attach");
    }
  }

  if (/(high-aov|high aov|furniture|home goods|sofa|mattress|premium lifestyle|considered purchase)/.test(text)) {
    addTheme("high_aov_home");
    addProofAndAssets(result, findProofById(proofBank, "lifely"), assets, "auto_attach");
  }

  if (/(fashion|apparel|boutique|clothing|deliverability|spam|rfm)/.test(text)) {
    addTheme("fashion_deliverability");
    addProofAndAssets(result, findProofById(proofBank, "fly-boutique"), assets, "auto_attach");
  }

  if (/(figma|design|email design|template|visual|campaign design|flow design)/.test(text)) {
    addTheme("design_figma");
    addProofAndAssets(result, findProofById(proofBank, "design-case-studies"), assets, "auto_attach");
    result.selectedFigmaLinks.push(...pickFigmaLinks(text, figmaLinks));
  }

  if (/(pet|dog|cat|chicken|farm|hobby)/.test(text) && /(dtc|shopify|klaviyo|retention|email|sms|recharge)/.test(text)) {
    addTheme("pet_dtc");
    addProofAndAssets(result, findProofById(proofBank, "whisker-seeker"), assets, "mention_only");
    addProofAndAssets(result, findProofById(proofBank, "my-pet-chicken"), assets, "mention_only");
  }

  if (/\b(beverage|drink|lifestyle)\b/.test(text) && /\b(uk|united kingdom|europe|eu|european)\b/.test(text)) {
    addTheme("beverage_lifestyle_uk");
    addProofAndAssets(result, findProofById(proofBank, "hangaritas-screenshot"), assets, "recommend_only");
  }

  if (/\b(art|anime|fandom|jewelry)\b/.test(text)) {
    addTheme("art_fandom");
    addProofAndAssets(result, findProofById(proofBank, "kraymer-art-screenshot"), assets, "recommend_only");
  }

  result.selectedVideoLinks.push(...pickVideoLinks(text, videoLinks));

  result.matchedThemes = uniqueStrings(result.matchedThemes);
  result.selectedProof = uniqueById(result.selectedProof);
  result.autoAttachAssets = uniqueById(result.autoAttachAssets).filter((asset) => !(asset.requiresManualReview || !asset.safeToAttach));
  result.recommendOnlyAssets = uniqueById(result.recommendOnlyAssets).filter((asset) => !result.autoAttachAssets.some((item) => item.id === asset.id));
  result.mentionOnlyProof = uniqueById(result.mentionOnlyProof);
  result.doNotUseAssets = uniqueById(result.doNotUseAssets);
  result.selectedFigmaLinks = uniqueById(result.selectedFigmaLinks);
  result.selectedVideoLinks = uniqueById(result.selectedVideoLinks);

  if (result.autoAttachAssets.some((asset) => asset.requiresManualReview || !asset.safeToAttach)) {
    result.warnings.push("Sensitive assets attempted to auto-attach; selection rules should be reviewed.");
  }
  if (result.recommendOnlyAssets.some((asset) => asset.requiresManualReview)) {
    result.warnings.push("Some selected assets require manual review before mention or attachment.");
  }

  return result;
}
