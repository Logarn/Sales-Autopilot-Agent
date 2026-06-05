import * as fs from "node:fs";
import * as path from "node:path";
import { PROOF_ASSET_ROOT } from "./config";
import { listAllApplicationAssets } from "./db";
import {
  loadPortfolioAssets,
  loadProofBank,
  type PortfolioAsset,
  type ProofRecord,
} from "./skills/portfolioSelectionSkill";

export type ProofAssetType = "file" | "upwork_portfolio" | "certificate" | "mention_only";

export interface ProofAssetResolverOptions {
  cwd?: string;
  assetRoot?: string;
}

export interface CanonicalProofAssetEntry {
  id: string;
  name: string;
  proofType: ProofAssetType;
  platform: string[];
  vertical: string[];
  attachPolicy: "auto_attach" | "manual_review" | "mention_only" | "do_not_attach";
  safeUsageNotes: string;
  relativePath?: string;
  resolvedPath?: string;
  existsLocally: boolean;
  safeToAttach: boolean;
  safeToAutoInclude: boolean;
  requiresManualReview: boolean;
}

export interface ProofAssetAuditReport {
  assetRoot: string;
  availableLocalFiles: CanonicalProofAssetEntry[];
  missingLocalFiles: CanonicalProofAssetEntry[];
  slackIngestedFiles: CanonicalProofAssetEntry[];
  mentionOnlyProof: CanonicalProofAssetEntry[];
  portfolioSetupRequired: CanonicalProofAssetEntry[];
  filesNotToAttach: CanonicalProofAssetEntry[];
  entries: CanonicalProofAssetEntry[];
}

function proofAssetBaseDir(options: ProofAssetResolverOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const configuredRoot = options.assetRoot ?? PROOF_ASSET_ROOT;
  return path.resolve(cwd, configuredRoot || ".");
}

export function resolveProofAssetPath(relativePath: string, options: ProofAssetResolverOptions = {}): string {
  if (path.isAbsolute(relativePath)) return relativePath;
  return path.resolve(proofAssetBaseDir(options), relativePath);
}

export function proofAssetExists(relativePath: string, options: ProofAssetResolverOptions = {}): boolean {
  return fs.existsSync(resolveProofAssetPath(relativePath, options));
}

function recordsUsingAsset(proofBank: ProofRecord[], relativePath: string): ProofRecord[] {
  return proofBank.filter((record) => record.assetRules.some((rule) => rule.path === relativePath));
}

function inferAttachPolicy(asset: PortfolioAsset): CanonicalProofAssetEntry["attachPolicy"] {
  if (!asset.safeToMention) return "do_not_attach";
  if (!asset.safeToAttach) return "do_not_attach";
  if (asset.requiresManualReview) return "manual_review";
  if (asset.safeToAutoInclude) return "auto_attach";
  return "auto_attach";
}

function inferProofType(asset: PortfolioAsset): ProofAssetType {
  return asset.kind === "attachment" || asset.kind === "screenshot" ? "file" : "mention_only";
}

function entryForAsset(
  asset: PortfolioAsset,
  proofBank: ProofRecord[],
  options: ProofAssetResolverOptions,
): CanonicalProofAssetEntry {
  const linkedProof = recordsUsingAsset(proofBank, asset.path);
  const vertical = Array.from(new Set(linkedProof.flatMap((record) => record.industry ?? asset.categories)));
  const platform = Array.from(new Set(linkedProof.flatMap((record) => record.tools ?? [])));
  const existsLocally = proofAssetExists(asset.path, options);
  const attachPolicy = inferAttachPolicy(asset);
  return {
    id: asset.id,
    name: asset.name,
    proofType: inferProofType(asset),
    platform,
    vertical: vertical.length > 0 ? vertical : asset.categories,
    attachPolicy,
    safeUsageNotes: asset.recommendedUsage,
    relativePath: asset.path,
    resolvedPath: resolveProofAssetPath(asset.path, options),
    existsLocally,
    safeToAttach: asset.safeToAttach,
    safeToAutoInclude: asset.safeToAutoInclude,
    requiresManualReview: asset.requiresManualReview,
  };
}

function mentionOnlyEntry(record: ProofRecord): CanonicalProofAssetEntry {
  return {
    id: record.id,
    name: record.name,
    proofType: "mention_only",
    platform: record.tools ?? [],
    vertical: record.industry ?? [],
    attachPolicy: "mention_only",
    safeUsageNotes: record.headline,
    existsLocally: false,
    safeToAttach: false,
    safeToAutoInclude: false,
    requiresManualReview: true,
  };
}

function slackAssetEntries(options: ProofAssetResolverOptions): CanonicalProofAssetEntry[] {
  return listAllApplicationAssets()
    .filter((asset) => asset.source === "slack" && asset.relativePath)
    .map((asset): CanonicalProofAssetEntry => ({
      id: `slack:${asset.id}`,
      name: asset.originalName,
      proofType: "file",
      platform: [],
      vertical: [],
      attachPolicy: asset.attachPolicy,
      safeUsageNotes: `Slack-ingested file for ${asset.jobId}`,
      relativePath: asset.relativePath ?? undefined,
      resolvedPath: asset.relativePath ? resolveProofAssetPath(asset.relativePath, options) : undefined,
      existsLocally: asset.relativePath ? proofAssetExists(asset.relativePath, options) : false,
      safeToAttach: asset.attachPolicy === "auto_attach",
      safeToAutoInclude: asset.attachPolicy === "auto_attach",
      requiresManualReview: asset.attachPolicy !== "auto_attach",
    }));
}

function upworkSetupEntries(): CanonicalProofAssetEntry[] {
  return [
    {
      id: "upwork-profile-highlights",
      name: "Upwork portfolio/profile highlights",
      proofType: "upwork_portfolio",
      platform: ["Upwork"],
      vertical: [],
      attachPolicy: "auto_attach",
      safeUsageNotes: "Click Add portfolio project, select an existing published portfolio item if visible, and verify the selected label on the apply page.",
      existsLocally: false,
      safeToAttach: false,
      safeToAutoInclude: true,
      requiresManualReview: false,
    },
    {
      id: "upwork-certificates",
      name: "Upwork certificates",
      proofType: "certificate",
      platform: ["Upwork"],
      vertical: [],
      attachPolicy: "auto_attach",
      safeUsageNotes: "Click Add certificate, select an existing relevant certificate if visible, and verify the selected label on the apply page.",
      existsLocally: false,
      safeToAttach: false,
      safeToAutoInclude: true,
      requiresManualReview: false,
    },
  ];
}

export function auditProofAssets(options: ProofAssetResolverOptions = {}): ProofAssetAuditReport {
  const proofBank = loadProofBank();
  const assetEntries = loadPortfolioAssets().map((asset) => entryForAsset(asset, proofBank, options));
  const slackIngestedFiles = slackAssetEntries(options);
  const upworkSetup = upworkSetupEntries();
  const mentionOnlyProof = proofBank
    .filter((record) => record.assetRules.length === 0 || record.assetRules.every((rule) => rule.usage === "mention_only" || rule.safeToAttach === false))
    .map(mentionOnlyEntry);
  const entries = [...assetEntries, ...slackIngestedFiles, ...upworkSetup, ...mentionOnlyProof];

  return {
    assetRoot: proofAssetBaseDir(options),
    availableLocalFiles: assetEntries.filter((entry) => entry.proofType === "file" && entry.existsLocally),
    missingLocalFiles: assetEntries.filter((entry) => entry.proofType === "file" && !entry.existsLocally),
    slackIngestedFiles,
    mentionOnlyProof,
    portfolioSetupRequired: upworkSetup.filter((entry) => entry.requiresManualReview),
    filesNotToAttach: assetEntries.filter((entry) => !entry.safeToAttach || entry.requiresManualReview || entry.attachPolicy === "do_not_attach"),
    entries,
  };
}

function formatEntry(entry: CanonicalProofAssetEntry, includePath: boolean): string {
  const pathPart = includePath && entry.relativePath ? ` (${entry.resolvedPath ?? entry.relativePath})` : "";
  return `${entry.name}${pathPart} - ${entry.attachPolicy}; ${entry.safeUsageNotes}`;
}

export function formatProofAssetAudit(report: ProofAssetAuditReport, options: { includePaths?: boolean } = {}): string {
  const includePath = Boolean(options.includePaths);
  const section = (title: string, entries: CanonicalProofAssetEntry[], empty: string) => [
    `${title}:`,
    ...(entries.length > 0 ? entries.map((entry) => `- ${formatEntry(entry, includePath)}`) : [`- ${empty}`]),
  ].join("\n");

  return [
    `Proof asset root: ${report.assetRoot}`,
    section("Available local files", report.availableLocalFiles, "none"),
    section("Missing local files", report.missingLocalFiles, "none"),
    section("Slack-ingested files", report.slackIngestedFiles, "none"),
    section("Mention-only proof", report.mentionOnlyProof, "none"),
    section("Portfolio/certificate setup required", report.portfolioSetupRequired, "none"),
    section("Files that should not be attached automatically", report.filesNotToAttach, "none"),
  ].join("\n\n");
}

function runCli(): void {
  const args = new Set(process.argv.slice(2));
  const report = auditProofAssets();
  const hasMissingLocalFiles = report.missingLocalFiles.length > 0;
  if (args.has("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (hasMissingLocalFiles) {
      process.exitCode = 1;
    }
    return;
  }
  process.stdout.write(`${formatProofAssetAudit(report, { includePaths: args.has("--paths") })}\n`);
  if (hasMissingLocalFiles) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}
