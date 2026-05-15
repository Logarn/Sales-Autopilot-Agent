import * as fs from "node:fs";
import * as path from "node:path";
import { loadFreelancerProfile } from "../profile";
import { JobPosting, ScoredJob } from "../types";
import {
  loadFigmaLinks,
  loadProofBank,
  loadVideoLinks,
  PortfolioAsset,
  PortfolioLink,
  ProofRecord,
  selectPortfolioAssetsForJob,
} from "./portfolioSelectionSkill";

export interface ProposalContextPack {
  profileName: string;
  selectedPositioning: string[];
  selectedProofPoints: string[];
  selectedProofLines: string[];
  selectedAttachments: string[];
  selectedScreenshots: string[];
  selectedFigmaLinks: Array<{ name: string; url: string }>;
  selectedVideoLinks: Array<{ name: string; url: string }>;
  voiceRules: string[];
  proposalAngle: string;
  commonAnswers: string[];
  manualReviewWarnings: string[];
}

const PROFILE_DIR = path.resolve(process.cwd(), "profile");

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(PROFILE_DIR, relativePath), "utf8");
}

function compactMarkdownLines(relativePath: string, limit = 12): string[] {
  return readText(relativePath)
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function jobText(job: Pick<JobPosting, "title" | "description" | "skills" | "category" | "budget" | "clientCountry">): string {
  return [job.title, job.description, job.skills.join(" "), job.category, job.budget, job.clientCountry].join(" ").toLowerCase();
}

function buildPositioning(text: string): string[] {
  const positioning = [
    "Senior retention/lifecycle operator for DTC ecommerce brands",
    "Strongest with Shopify-based brands using Klaviyo, Postscript, Attentive, and Omnisend",
    "Focuses on repeat purchase, LTV, segmentation, flow architecture, offer strategy, and customer psychology",
  ];

  if (/(beauty|skincare|cosmetic)/.test(text)) {
    positioning.push("Beauty/skincare fit with strong Klaviyo retention and zero-party-data proof");
  }
  if (/(health|wellness|supplement)/.test(text)) {
    positioning.push("Health/wellness fit with lifecycle, SMS, subscription, and deliverability proof");
  }
  if (/(figma|design|template|visual)/.test(text)) {
    positioning.push("Can support email design systems and Figma-heavy lifecycle work when the role needs design depth");
  }
  return positioning;
}

function buildProposalAngle(text: string): string {
  if (/(beauty|skincare)/.test(text) && /(quiz|zero-party|zpd|subscriber|ltv)/.test(text)) {
    return "Lead with the revenue leak in subscriber quality and repeat purchase behavior, then use Truly Beauty proof around zero-party data, quiz performance, and retention revenue.";
  }
  if (/(health|wellness|supplement)/.test(text)) {
    return "Lead with the lifecycle leak between first purchase, replenishment timing, and subscriber retention. Use Dr. Rachael as mention-only proof and keep sensitive assets out of auto-attach.";
  }
  if (/(figma|design|template|visual)/.test(text)) {
    return "Lead with how design should remove friction and increase certainty, then use design case studies and manual-review Figma links as supporting proof.";
  }
  if (/(deliverability|spam|inbox)/.test(text)) {
    return "Lead with inbox placement and list quality as the expensive bottleneck, then back it with Fly Boutique proof.";
  }
  return "Lead with the real retention leak first, tie it to repeat purchase and LTV, then use one proof point that matches the brand category and stack.";
}

function selectProofLines(records: ProofRecord[]): string[] {
  const lines: string[] = [];
  for (const record of records) {
    lines.push(`${record.name}: ${record.headline}`);
    for (const item of record.supporting.slice(0, 2)) {
      lines.push(`${record.name}: ${item}`);
    }
  }
  return lines.slice(0, 8);
}

function toLinkOutput(links: PortfolioLink[]): Array<{ name: string; url: string }> {
  return links.map((link) => ({ name: link.name, url: link.url }));
}

function assetPathsByKind(assets: PortfolioAsset[], kind: "attachment" | "screenshot"): string[] {
  return assets.filter((asset) => asset.kind === kind).map((asset) => asset.path);
}

function relevantCommonAnswers(text: string): string[] {
  const all = compactMarkdownLines("common-answers.md", 50);
  const picks: string[] = [];
  const addMatching = (needle: RegExp, label: string) => {
    const index = all.findIndex((line) => line.toLowerCase() === label.toLowerCase());
    if (needle.test(text) && index !== -1) {
      const snippet = all.slice(index, index + 2).join(" — ");
      picks.push(snippet);
    }
  };

  addMatching(/availability|start|timeline/, "Availability");
  addMatching(/approach|strategy|plan|audit/, "Approach");
  addMatching(/portfolio|proof|case stud|sample/, "Portfolio / proof request");
  addMatching(/report|attribution|metrics/, "Reporting / attribution");
  addMatching(/subscription|recharge|skio/, "Subscription retention");
  addMatching(/deliverability|spam|inbox/, "Deliverability");
  addMatching(/figma|design|template/, "Design / Figma");

  return picks.slice(0, 4);
}

function manualWarnings(selectionWarnings: string[], proofRecords: ProofRecord[], figmaLinks: PortfolioLink[], videoLinks: PortfolioLink[]): string[] {
  const warnings = [...selectionWarnings];

  for (const record of proofRecords) {
    for (const asset of record.assetRules) {
      if (asset.requiresManualReview) {
        warnings.push(`${record.name}: ${asset.path} requires manual review.`);
      }
      if (asset.safeToAttach === false) {
        warnings.push(`${record.name}: ${asset.path} is mention-only.`);
      }
      if (asset.safeToAttach === "needs_review") {
        warnings.push(`${record.name}: ${asset.path} is recommend-only until manually reviewed.`);
      }
    }
  }

  for (const link of [...figmaLinks, ...videoLinks]) {
    if (link.requiresManualReview) {
      warnings.push(`${link.name}: manual review required before sharing.`);
    }
  }

  return Array.from(new Set(warnings));
}

export function buildProposalContextPack(job: JobPosting | ScoredJob): ProposalContextPack {
  const selection = selectPortfolioAssetsForJob(job);
  const text = jobText(job);
  const profile = loadFreelancerProfile();
  const proofBank = loadProofBank();
  const _allFigmaLinks = loadFigmaLinks();
  const _allVideoLinks = loadVideoLinks();
  const proofMap = new Map(proofBank.map((record) => [record.id, record]));
  const selectedRecords = selection.selectedProof.map((record) => proofMap.get(record.id) ?? record);

  return {
    profileName: profile.name,
    selectedPositioning: buildPositioning(text),
    selectedProofPoints: selectedRecords.map((record) => `${record.name}: ${record.headline}`).slice(0, 4),
    selectedProofLines: selectProofLines(selectedRecords),
    selectedAttachments: assetPathsByKind(selection.autoAttachAssets, "attachment"),
    selectedScreenshots: assetPathsByKind(selection.recommendOnlyAssets, "screenshot"),
    selectedFigmaLinks: toLinkOutput(selection.selectedFigmaLinks),
    selectedVideoLinks: toLinkOutput(selection.selectedVideoLinks),
    voiceRules: compactMarkdownLines("voice-rules.md", 8),
    proposalAngle: buildProposalAngle(text),
    commonAnswers: relevantCommonAnswers(text),
    manualReviewWarnings: manualWarnings(selection.warnings, selectedRecords, selection.selectedFigmaLinks, selection.selectedVideoLinks),
  };
}
