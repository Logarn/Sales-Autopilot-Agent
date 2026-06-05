import { proofAssetExists, type ProofAssetResolverOptions } from "./proofAssets";
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

function autoAttachItem(asset: PortfolioAsset, options: ProofAssetResolverOptions): ProofAvailabilityItem {
  const exists = proofAssetExists(asset.path, options);
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

function recommendOnlyItem(asset: PortfolioAsset, options: ProofAssetResolverOptions): ProofAvailabilityItem {
  const exists = proofAssetExists(asset.path, options);
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
  options: ProofAssetResolverOptions = {},
): ProofAvailabilityItem[] {
  const items = [
    ...selection.autoAttachAssets.map((asset) => autoAttachItem(asset, options)),
    ...selection.recommendOnlyAssets.map((asset) => recommendOnlyItem(asset, options)),
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
