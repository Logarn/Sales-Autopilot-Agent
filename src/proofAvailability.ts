import * as fs from "node:fs";
import * as path from "node:path";
import type { PortfolioAsset, PortfolioSelectionResult } from "./skills/portfolioSelectionSkill";

export type ProofAvailabilityStatus =
  | "available_uploadable"
  | "available_manual_review"
  | "missing_manual_upload"
  | "mention_only";

export interface ProofAvailabilityItem {
  name: string;
  kind: PortfolioAsset["kind"] | "proof";
  status: ProofAvailabilityStatus;
  statusText: string;
  canAutoAttach: boolean;
  requiresManualUpload: boolean;
  requiresManualReview: boolean;
  relativePath?: string;
}

export interface ProofAvailabilityFormatOptions {
  includePath?: boolean;
  limit?: number;
}

function existsRelativeToCwd(relativePath: string, cwd: string): boolean {
  return fs.existsSync(path.resolve(cwd, relativePath));
}

function autoAttachItem(asset: PortfolioAsset, cwd: string): ProofAvailabilityItem {
  const exists = existsRelativeToCwd(asset.path, cwd);
  if (!exists) {
    return {
      name: asset.name,
      kind: asset.kind,
      status: "missing_manual_upload",
      statusText: "File missing locally - manual upload needed",
      canAutoAttach: false,
      requiresManualUpload: true,
      requiresManualReview: false,
      relativePath: asset.path,
    };
  }

  return {
    name: asset.name,
    kind: asset.kind,
    status: "available_uploadable",
    statusText: "File available - eligible for attachment",
    canAutoAttach: true,
    requiresManualUpload: false,
    requiresManualReview: false,
    relativePath: asset.path,
  };
}

function recommendOnlyItem(asset: PortfolioAsset, cwd: string): ProofAvailabilityItem {
  const exists = existsRelativeToCwd(asset.path, cwd);
  return {
    name: asset.name,
    kind: asset.kind,
    status: exists ? "available_manual_review" : "missing_manual_upload",
    statusText: exists
      ? "File available - manual review needed before upload"
      : "File missing locally - manual upload needed",
    canAutoAttach: false,
    requiresManualUpload: !exists,
    requiresManualReview: true,
    relativePath: asset.path,
  };
}

export function buildProofAvailabilityReport(
  selection: PortfolioSelectionResult,
  options: { cwd?: string } = {},
): ProofAvailabilityItem[] {
  const cwd = options.cwd ?? process.cwd();
  const items = [
    ...selection.autoAttachAssets.map((asset) => autoAttachItem(asset, cwd)),
    ...selection.recommendOnlyAssets.map((asset) => recommendOnlyItem(asset, cwd)),
    ...selection.mentionOnlyProof.map((proof): ProofAvailabilityItem => ({
      name: proof.name,
      kind: "proof",
      status: "mention_only",
      statusText: "Mention-only proof - do not attach",
      canAutoAttach: false,
      requiresManualUpload: false,
      requiresManualReview: true,
    })),
  ];

  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.name}|${item.relativePath ?? ""}|${item.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatProofAvailabilityLines(
  items: ProofAvailabilityItem[],
  options: ProofAvailabilityFormatOptions = {},
): string[] {
  const limit = Math.max(0, Math.floor(options.limit ?? items.length));
  return items.slice(0, limit).map((item) => {
    const pathSuffix = options.includePath && item.relativePath ? `; File: ${item.relativePath}` : "";
    return `Suggested proof: ${item.name}; Status: ${item.statusText}${pathSuffix}`;
  });
}
