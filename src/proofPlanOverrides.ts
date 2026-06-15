import {
  loadProofBank,
  loadPortfolioAssets,
  MAX_UPWORK_PORTFOLIO_SELECTIONS,
  UPWORK_PORTFOLIO_ITEMS,
  type PortfolioAsset,
  type PortfolioSelectionResult,
} from "./skills/portfolioSelectionSkill";
import type { ProofPlanOverrideState } from "./types";

export const EMPTY_PROOF_PLAN_OVERRIDES: ProofPlanOverrideState = {
  includeAssetIds: [],
  excludeAssetIds: [],
  includeProofIds: [],
  excludeProofIds: [],
  includePortfolioItemIds: [],
  excludePortfolioItemIds: [],
  portfolioOnly: false,
  noFiles: false,
  noScreenshots: false,
  attachAllRelevantScreenshots: false,
  instructionHistory: [],
};

export interface ProofAliasMatch {
  label: string;
  proofIds: string[];
  assetIds: string[];
  portfolioItemIds: string[];
  screenshotAssetIds?: string[];
}

export interface ProofPlanRevisionSummary {
  changed: boolean;
  includedLabels: string[];
  excludedLabels: string[];
  flags: string[];
  reply: string;
}

const PROOF_ALIASES: ProofAliasMatch[] = [
  {
    label: "Truly Beauty",
    proofIds: ["truly-beauty"],
    assetIds: ["truly-beauty-case-study"],
    portfolioItemIds: ["truly-beauty-upwork"],
  },
  {
    label: "Fly Boutique",
    proofIds: ["fly-boutique"],
    assetIds: ["fly-boutique-case-study"],
    portfolioItemIds: ["fly-boutique-upwork"],
  },
  {
    label: "Lifely",
    proofIds: ["lifely"],
    assetIds: ["lifely-case-study"],
    portfolioItemIds: ["lifely-upwork"],
  },
  {
    label: "Design Case Studies",
    proofIds: ["design-case-studies"],
    assetIds: ["design-case-studies"],
    portfolioItemIds: ["design-case-studies-upwork"],
  },
  {
    label: "Endurance Wellness",
    proofIds: ["endurance-wellness"],
    assetIds: ["endurance-wellness-strategy"],
    portfolioItemIds: [],
  },
  {
    label: "Dr. Rachael",
    proofIds: ["dr-rachael-institute", "dr-rachael-klaviyo-screenshot"],
    assetIds: ["dr-rachael-report", "dr-rachael-screenshot"],
    portfolioItemIds: [],
    screenshotAssetIds: ["dr-rachael-screenshot"],
  },
  {
    label: "DTC performance figures",
    proofIds: ["whisker-seeker", "my-pet-chicken"],
    assetIds: ["dtc-performance-figures"],
    portfolioItemIds: [],
  },
  {
    label: "Kraymer",
    proofIds: ["kraymer-art-screenshot"],
    assetIds: ["kraymer-retention-audit", "kraymer-screenshot"],
    portfolioItemIds: [],
    screenshotAssetIds: ["kraymer-screenshot"],
  },
  {
    label: "Hangaritas",
    proofIds: ["hangaritas-screenshot"],
    assetIds: ["hangaritas-screenshot"],
    portfolioItemIds: [],
    screenshotAssetIds: ["hangaritas-screenshot"],
  },
  {
    label: "Portfolio PDF",
    proofIds: [],
    assetIds: ["portfolio-general"],
    portfolioItemIds: [],
  },
  {
    label: "intro PDF",
    proofIds: [],
    assetIds: ["steve-intro-pdf"],
    portfolioItemIds: [],
  },
  {
    label: "Meet Steve PDF",
    proofIds: [],
    assetIds: ["meet-steve-logarn-pdf"],
    portfolioItemIds: [],
  },
];

const ALIAS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\btruly(?:\s+beauty)?\b/i, label: "Truly Beauty" },
  { pattern: /\bfly(?:\s+boutique)?\b|\bretain\s+like\s+crazy\b/i, label: "Fly Boutique" },
  { pattern: /\blifely\b/i, label: "Lifely" },
  { pattern: /\bdesign\s+case\s+stud(?:y|ies)\b|\bsteve'?s\s+design\s+case\s+stud(?:y|ies)\b/i, label: "Design Case Studies" },
  { pattern: /\bendurance(?:\s+wellness)?\b/i, label: "Endurance Wellness" },
  { pattern: /\bdr\.?\s*rachael\b/i, label: "Dr. Rachael" },
  { pattern: /\bdtc\s+brand\s+performance\b|\bperformance\s+figures\b|\bwhisker\s+seeker\b|\bmy\s+pet\s+chicken\b/i, label: "DTC performance figures" },
  { pattern: /\bkraymer\b/i, label: "Kraymer" },
  { pattern: /\bhangaritas\b/i, label: "Hangaritas" },
  { pattern: /\bportfolio(?:\s+pdf)?\b/i, label: "Portfolio PDF" },
  { pattern: /\bintro\s+pdf\b|\bsteve\s+intro\b|\bintro\s+deck\b/i, label: "intro PDF" },
  { pattern: /\bmeet\s+steve\b|\bmeet\s+steve\s+logarn\b/i, label: "Meet Steve PDF" },
];

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function addUnique(target: string[], values: string[]): string[] {
  return unique([...target, ...values]);
}

function removeValues(target: string[], values: string[]): string[] {
  const remove = new Set(values);
  return target.filter((value) => !remove.has(value));
}

function matchesInText(value: string): ProofAliasMatch[] {
  const labels = ALIAS_PATTERNS
    .filter((entry) => entry.pattern.test(value))
    .map((entry) => entry.label);
  return PROOF_ALIASES.filter((entry) => labels.includes(entry.label));
}

function applyInclude(overrides: ProofPlanOverrideState, matches: ProofAliasMatch[]): ProofPlanOverrideState {
  const proofIds = matches.flatMap((match) => match.proofIds);
  const assetIds = matches.flatMap((match) => match.assetIds);
  const portfolioItemIds = matches.flatMap((match) => match.portfolioItemIds);
  return {
    ...overrides,
    includeProofIds: addUnique(removeValues(overrides.includeProofIds, []), proofIds),
    includeAssetIds: addUnique(removeValues(overrides.includeAssetIds, []), assetIds),
    includePortfolioItemIds: addUnique(removeValues(overrides.includePortfolioItemIds, []), portfolioItemIds),
    excludeProofIds: removeValues(overrides.excludeProofIds, proofIds),
    excludeAssetIds: removeValues(overrides.excludeAssetIds, assetIds),
    excludePortfolioItemIds: removeValues(overrides.excludePortfolioItemIds, portfolioItemIds),
  };
}

function applyExclude(overrides: ProofPlanOverrideState, matches: ProofAliasMatch[]): ProofPlanOverrideState {
  const proofIds = matches.flatMap((match) => match.proofIds);
  const assetIds = matches.flatMap((match) => match.assetIds);
  const portfolioItemIds = matches.flatMap((match) => match.portfolioItemIds);
  return {
    ...overrides,
    excludeProofIds: addUnique(overrides.excludeProofIds, proofIds),
    excludeAssetIds: addUnique(overrides.excludeAssetIds, assetIds),
    excludePortfolioItemIds: addUnique(overrides.excludePortfolioItemIds, portfolioItemIds),
    includeProofIds: removeValues(overrides.includeProofIds, proofIds),
    includeAssetIds: removeValues(overrides.includeAssetIds, assetIds),
    includePortfolioItemIds: removeValues(overrides.includePortfolioItemIds, portfolioItemIds),
  };
}

function labels(matches: ProofAliasMatch[]): string[] {
  return unique(matches.map((match) => match.label));
}

function aliasesExcept(matches: ProofAliasMatch[]): ProofAliasMatch[] {
  const keep = new Set(labels(matches));
  return PROOF_ALIASES.filter((entry) => !keep.has(entry.label));
}

function conciseList(values: string[], fallback: string): string {
  if (values.length === 0) return fallback;
  if (values.length === 1) return values[0]!;
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

export function parseProofPlanOverrides(value: unknown): ProofPlanOverrideState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_PROOF_PLAN_OVERRIDES };
  const input = value as Partial<ProofPlanOverrideState>;
  return {
    includeAssetIds: unique(input.includeAssetIds ?? []),
    excludeAssetIds: unique(input.excludeAssetIds ?? []),
    includeProofIds: unique(input.includeProofIds ?? []),
    excludeProofIds: unique(input.excludeProofIds ?? []),
    includePortfolioItemIds: unique(input.includePortfolioItemIds ?? []),
    excludePortfolioItemIds: unique(input.excludePortfolioItemIds ?? []),
    portfolioOnly: Boolean(input.portfolioOnly),
    noFiles: Boolean(input.noFiles),
    noScreenshots: Boolean(input.noScreenshots),
    attachAllRelevantScreenshots: Boolean(input.attachAllRelevantScreenshots),
    instructionHistory: unique(input.instructionHistory ?? []),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : undefined,
  };
}

export function reviseProofPlanOverrides(
  current: ProofPlanOverrideState,
  instruction: string,
  now = new Date(),
): { overrides: ProofPlanOverrideState; summary: ProofPlanRevisionSummary } {
  const normalized = instruction.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  let next: ProofPlanOverrideState = parseProofPlanOverrides(current);
  const included: ProofAliasMatch[] = [];
  const excluded: ProofAliasMatch[] = [];
  const flags: string[] = [];

  if (/\b(?:portfolio\s+only|no\s+files|just\s+portfolio|portfolio\s+only)\b/i.test(lower)) {
    next = { ...next, portfolioOnly: true, noFiles: true };
    flags.push("portfolio only");
  }
  if (/\b(?:don'?t|do\s+not|no)\s+attach\s+screenshots\b/i.test(lower) || /\bno\s+screenshots\b/i.test(lower)) {
    next = { ...next, noScreenshots: true, attachAllRelevantScreenshots: false };
    flags.push("no screenshots");
  }
  if (/\battach\s+all\s+relevant\s+screenshots\b/i.test(lower)) {
    next = { ...next, noScreenshots: false, attachAllRelevantScreenshots: true };
    flags.push("all relevant screenshots");
  }

  if (/\binstead\s+of\b/i.test(normalized)) {
    const [before, after] = normalized.split(/\binstead\s+of\b/i, 2);
    const afterParts = (after ?? "").split(/\band\s+(?:add|attach|include|use)\b/i, 2);
    const includeTail = afterParts[1] ?? "";
    const includeMatches = matchesInText(`${before ?? ""} ${includeTail}`);
    const excludeMatches = matchesInText(afterParts[0] ?? "");
    included.push(...includeMatches);
    excluded.push(...excludeMatches);
    next = applyInclude(next, includeMatches);
    next = applyExclude(next, excludeMatches);
  } else if (/\binstead\b/i.test(lower) && matchesInText(normalized).length > 0) {
    const includeMatches = matchesInText(normalized);
    included.push(...includeMatches);
    next = applyExclude(next, aliasesExcept(includeMatches));
    next = applyInclude(next, includeMatches);
    flags.push("replace default proof");
  } else if (/\breplace\b/i.test(lower) && /\bwith\b/i.test(lower)) {
    const [, afterWith = ""] = normalized.split(/\bwith\b/i, 2);
    const includeMatches = matchesInText(afterWith);
    included.push(...includeMatches);
    next = applyInclude(next, includeMatches);
  } else if (/\b(?:remove|drop|don'?t\s+use|do\s+not\s+use|don'?t\s+attach|do\s+not\s+attach)\b/i.test(lower)) {
    const excludeMatches = matchesInText(normalized);
    excluded.push(...excludeMatches);
    next = applyExclude(next, excludeMatches);
  } else if (/\b(?:use|attach|add|include)\b/i.test(lower)) {
    const includeMatches = matchesInText(normalized);
    included.push(...includeMatches);
    next = applyInclude(next, includeMatches);
  }

  next = {
    ...next,
    instructionHistory: [...next.instructionHistory, `${now.toISOString()}: ${normalized}`].slice(-20),
    updatedAt: now.toISOString(),
  };

  const includedLabels = labels(included);
  const excludedLabels = labels(excluded);
  const changed = includedLabels.length > 0 || excludedLabels.length > 0 || flags.length > 0;
  const replyParts = [
    excludedLabels.length > 0 && includedLabels.length > 0
      ? `swapped ${conciseList(excludedLabels, "")} for ${conciseList(includedLabels, "")}`
      : null,
    excludedLabels.length > 0 && includedLabels.length === 0
      ? `removed ${conciseList(excludedLabels, "")}`
      : null,
    includedLabels.length > 0 && excludedLabels.length === 0
      ? `added ${conciseList(includedLabels, "")}`
      : null,
    flags.length > 0 ? `set ${conciseList(flags, "")}` : null,
  ].filter((item): item is string => Boolean(item));
  return {
    overrides: next,
    summary: {
      changed,
      includedLabels,
      excludedLabels,
      flags,
      reply: changed
        ? `Done - ${replyParts.join(" and ")}. Rechecking now.`
        : "I could not identify a specific proof change. Tell me which proof or file to add/remove.",
    },
  };
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function uniqueAssets(items: PortfolioAsset[]): PortfolioAsset[] {
  const seen = new Set<string>();
  const output: PortfolioAsset[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

function assetIdsForPortfolioItems(items: Array<{ id: string }>): Set<string> {
  const portfolioItemIds = new Set(items.map((item) => item.id));
  const assetIds = new Set<string>();
  for (const alias of PROOF_ALIASES) {
    if (!alias.portfolioItemIds.some((itemId) => portfolioItemIds.has(itemId))) continue;
    for (const assetId of alias.assetIds) {
      assetIds.add(assetId);
    }
  }
  return assetIds;
}

export function applyProofPlanOverridesToSelection(
  selection: PortfolioSelectionResult,
  overrides: ProofPlanOverrideState,
): PortfolioSelectionResult {
  const normalized = parseProofPlanOverrides(overrides);
  const assetsById = byId(loadPortfolioAssets());
  const proofById = byId(loadProofBank());
  const upworkById = byId(UPWORK_PORTFOLIO_ITEMS);
  const excludedAssetIds = new Set(normalized.excludeAssetIds);
  const excludedProofIds = new Set(normalized.excludeProofIds);
  const excludedPortfolioItemIds = new Set(normalized.excludePortfolioItemIds);

  let autoAttachAssets = selection.autoAttachAssets.filter((asset) => !excludedAssetIds.has(asset.id));
  for (const assetId of normalized.includeAssetIds) {
    const asset = assetsById.get(assetId);
    if (asset && !excludedAssetIds.has(asset.id)) {
      autoAttachAssets.push(asset);
    }
  }

  if (normalized.noScreenshots) {
    autoAttachAssets = autoAttachAssets.filter((asset) => asset.kind !== "screenshot");
  }
  if (normalized.attachAllRelevantScreenshots) {
    const screenshotAssets = [
      ...selection.recommendOnlyAssets,
      ...selection.autoAttachAssets,
      ...normalized.includeAssetIds.map((id) => assetsById.get(id)).filter((item): item is PortfolioAsset => Boolean(item)),
    ].filter((asset) => asset.kind === "screenshot" && !excludedAssetIds.has(asset.id));
    autoAttachAssets.push(...screenshotAssets);
  }
  if (normalized.noFiles || normalized.portfolioOnly) {
    autoAttachAssets = [];
  }

  let selectedUpworkPortfolioItems = selection.selectedUpworkPortfolioItems
    .filter((item) => !excludedPortfolioItemIds.has(item.id));
  for (const itemId of normalized.includePortfolioItemIds) {
    const item = upworkById.get(itemId);
    if (item && !excludedPortfolioItemIds.has(item.id)) {
      selectedUpworkPortfolioItems.push(item);
    }
  }
  selectedUpworkPortfolioItems = Array.from(new Map(selectedUpworkPortfolioItems.map((item) => [item.id, item])).values());
  const portfolioBackedAssetIds = assetIdsForPortfolioItems(selectedUpworkPortfolioItems);
  autoAttachAssets = autoAttachAssets.filter((asset) => !portfolioBackedAssetIds.has(asset.id));

  let selectedProof = selection.selectedProof.filter((proof) => !excludedProofIds.has(proof.id));
  for (const proofId of normalized.includeProofIds) {
    const proof = proofById.get(proofId);
    if (proof && !excludedProofIds.has(proof.id)) {
      selectedProof.push(proof);
    }
  }
  const mentionOnlyProof = selection.mentionOnlyProof.filter((proof) => !excludedProofIds.has(proof.id));

  return {
    ...selection,
    selectedProof: Array.from(new Map(selectedProof.map((proof) => [proof.id, proof])).values()).slice(0, 3),
    autoAttachAssets: uniqueAssets(autoAttachAssets).slice(0, normalized.attachAllRelevantScreenshots ? 3 : 3),
    recommendOnlyAssets: selection.recommendOnlyAssets.filter((asset) => !excludedAssetIds.has(asset.id)),
    mentionOnlyProof,
    selectedUpworkPortfolioItems: selectedUpworkPortfolioItems.slice(0, MAX_UPWORK_PORTFOLIO_SELECTIONS),
  };
}

export function looksLikeProofPlanRevision(value: string): boolean {
  const lower = value.toLowerCase();
  if (/\b(?:portfolio\s+only|no\s+files|just\s+portfolio|screenshots?)\b/.test(lower) && /\b(?:proof|portfolio|file|attach|use|remove|add|include|don'?t|do\s+not|no)\b/.test(lower)) {
    return true;
  }
  if (!/\b(?:use|attach|add|include|remove|drop|replace|swap|don'?t\s+use|do\s+not\s+use|don'?t\s+attach|do\s+not\s+attach)\b/i.test(value)) {
    return false;
  }
  return matchesInText(value).length > 0;
}
