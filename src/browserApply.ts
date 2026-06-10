import * as fs from "node:fs";
import * as path from "node:path";
import { CONNECTS_RULES_CONFIG_PATH } from "./config";
import { evaluateConnectsStrategy } from "./connectsStrategy";
import { getApplicationDraft, getApplicationJobLink, getApplicationProofPlanOverrides, getScoredJobForSlackPreview, listApplicationAssets, type ApplicationAsset } from "./db";
import { proofAssetExists } from "./proofAssets";
import { buildProofAvailabilityReport, formatProofAvailabilityLines } from "./proofAvailability";
import { applyProofPlanOverridesToSelection, parseProofPlanOverrides } from "./proofPlanOverrides";
import { buildProposalContextPack } from "./skills/profileContextSkill";
import { selectPortfolioAssetsForJob, UPWORK_PORTFOLIO_ITEMS } from "./skills/portfolioSelectionSkill";
import {
  ApplicationDraft,
  BrowserApplyAttachmentInstruction,
  BrowserApplyConnectsPlan,
  BrowserApplyFillPlan,
  BrowserApplySkippedAttachment,
  BrowserApplyValidationIssue,
  ConnectsStrategySnapshot,
  ConnectsRules,
  PortfolioItem,
  ScoredJob,
} from "./types";

const DEFAULT_CONNECTS_RULES: ConnectsRules = {
  maxRequiredPerJob: 50,
  idealBoostMin: 10,
  idealBoostMax: 30,
  maxBoost: 50,
  dailyCap: 75,
  weeklyCap: 225,
  neverBidMax: true,
  requireApprovalAbove: 30,
  targetBoostRank: 3,
  skipIfTopBidAbove: 50,
};

export interface BrowserApplyPlanOptions {
  now?: Date;
  connectsRulesPath?: string;
}

export interface BrowserApplyAttachmentDiagnostic {
  id: string;
  name: string;
  filePath: string;
  sensitivity: PortfolioItem["sensitivity"];
  existsLocally: boolean;
}

export interface BrowserApplyFinalPreparationDiagnostics {
  stopBeforeSubmit: true;
  coverLetter: {
    present: boolean;
    length: number;
  };
  screeningAnswers: {
    count: number;
    answers: string[];
  };
  rateBid: string | null;
  connects: {
    required: number | null;
    boost: number | null;
    total: number | null;
    approvalRequired: boolean;
    decision: ConnectsStrategySnapshot["decision"];
    expectedValueScore: number;
    evidence: string[];
    notes: string[];
  };
  filesAttached: string[];
  attachmentDiagnostics: BrowserApplyAttachmentDiagnostic[];
  missingFiles: string[];
  skippedAttachments: BrowserApplySkippedAttachment[];
  proofHighlights: string[];
  portfolioHighlights: string[];
  profileHighlights: string[];
  manualFields: string[];
  blockers: string[];
  validationIssues: BrowserApplyValidationIssue[];
}

export type BrowserApplyPlanWithDiagnostics = BrowserApplyFillPlan & {
  filesAttached: string[];
  missingFiles: string[];
  manualFields: string[];
  connectsEvidence: string[];
  attachmentDiagnostics: BrowserApplyAttachmentDiagnostic[];
  proofHighlights: string[];
  portfolioHighlights: string[];
  profileHighlights: string[];
  finalPreparationDiagnostics: BrowserApplyFinalPreparationDiagnostics;
};

export interface BrowserApplyPlanResult {
  plan: BrowserApplyPlanWithDiagnostics | null;
  valid: boolean;
  issues: BrowserApplyValidationIssue[];
}

function issue(severity: BrowserApplyValidationIssue["severity"], code: string, message: string): BrowserApplyValidationIssue {
  return { severity, code, message };
}

function loadConnectsRules(configPath = CONNECTS_RULES_CONFIG_PATH): ConnectsRules {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), configPath), "utf8");
    return { ...DEFAULT_CONNECTS_RULES, ...(JSON.parse(raw) as Partial<ConnectsRules>) };
  } catch {
    return DEFAULT_CONNECTS_RULES;
  }
}

function parseUpworkUrl(rawUrl: string | null | undefined): URL | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (host !== "upwork.com" && !host.endsWith(".upwork.com")) return null;
    return url;
  } catch {
    return null;
  }
}

function extractUpworkJobId(url: URL): string | null {
  const decodedPath = decodeURIComponent(url.pathname);
  const applyMatch = decodedPath.match(/\/ab\/proposals\/job\/(~?[A-Za-z0-9_-]{8,})\/apply\/?/i);
  if (applyMatch) return applyMatch[1].startsWith("~") ? applyMatch[1] : `~${applyMatch[1]}`;
  const jobMatch = decodedPath.match(/\/jobs\/[^\s/]*~([A-Za-z0-9_-]{8,})/i);
  return jobMatch ? `~${jobMatch[1]}` : null;
}

function deriveApplyUrl(rawUrl: string | null | undefined): { sourceUrl: string; applyUrl: string } | null {
  const parsed = parseUpworkUrl(rawUrl);
  if (!parsed) return null;
  const sourceUrl = parsed.toString();
  const upworkJobId = extractUpworkJobId(parsed);
  if (!upworkJobId) return null;
  if (parsed.pathname.includes("/apply")) {
    return { sourceUrl, applyUrl: sourceUrl };
  }
  return {
    sourceUrl,
    applyUrl: `https://www.upwork.com/ab/proposals/job/${encodeURIComponent(upworkJobId)}/apply/`,
  };
}

function safeTrim(value: string | undefined): string {
  return value?.trim() ?? "";
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim() ?? "").filter(Boolean)));
}

function isSpecifiedRate(rate: string): boolean {
  const normalized = rate.trim().toLowerCase();
  return Boolean(normalized && normalized !== "not specified" && normalized !== "n/a");
}

function parseBudgetNumbers(value: string): number[] {
  return (value.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [])
    .map((item) => Number(item.replace(/,/g, "")))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function isHourlyBudget(value: string): boolean {
  return /\/\s*hr|hourly|per\s+hour/i.test(value);
}

function rateNumber(rate: string): number | null {
  const match = rate.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function clientBudgetAwareRate(rate: string, scoredJob: ScoredJob | null): string {
  const current = rateNumber(rate);
  if (!scoredJob || !isHourlyBudget(scoredJob.budget) || current === null) return rate;
  const budgetNumbers = parseBudgetNumbers(scoredJob.budget);
  if (budgetNumbers.length === 0) return rate;
  const low = Math.min(...budgetNumbers);
  const high = Math.max(...budgetNumbers);
  const minimumAcceptableRate = 10;
  const planned = current > high
    ? Math.min(current, Math.max(minimumAcceptableRate, high + 5))
    : current < low
      ? Math.max(minimumAcceptableRate, low)
      : Math.max(minimumAcceptableRate, current);
  return `$${planned}/hr`;
}

function buildAttachmentInstructions(items: PortfolioItem[]): {
  attachments: BrowserApplyAttachmentInstruction[];
  skipped: BrowserApplySkippedAttachment[];
} {
  const attachments: BrowserApplyAttachmentInstruction[] = [];
  const skipped: BrowserApplySkippedAttachment[] = [];

  for (const item of items) {
    const name = item.name || item.id;
    if (item.sensitivity === "private") {
      skipped.push({ id: item.id, name, reason: "Private portfolio item is not allowed for browser apply preparation." });
      continue;
    }
    if (item.allowedUsage === "never") {
      skipped.push({ id: item.id, name, reason: "Portfolio item is marked never-use." });
      continue;
    }
    if (!item.filePath) {
      skipped.push({ id: item.id, name, reason: "Portfolio item has no file path." });
      continue;
    }
    attachments.push({ id: item.id, name, filePath: item.filePath, sensitivity: item.sensitivity });
  }

  return { attachments, skipped };
}

function displayNameForAttachmentPath(filePath: string): string {
  const basename = path.basename(filePath).replace(/\.(pdf|png|jpe?g)$/i, "");
  return basename
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function upworkPortfolioLabelsFromDraftItems(items: PortfolioItem[]): string[] {
  const text = items
    .flatMap((item) => [item.id, item.name, item.filePath, item.description, item.result])
    .join(" ")
    .toLowerCase();
  return UPWORK_PORTFOLIO_ITEMS
    .filter((item) => item.aliases.some((alias) => text.includes(alias.toLowerCase())))
    .map((item) => item.name);
}

function sanitizeCoverLetterForApply(text: string): string {
  return text.replace(
    /\b(?:(?:profile\/attachments|slack-intake\/[^\s)]+)\/)?([A-Za-z0-9][A-Za-z0-9_-]{2,})\.(pdf|png|jpe?g)\b/gi,
    (_match, name: string) => displayNameForAttachmentPath(name),
  );
}

function buildAutoAttachmentInstructions(paths: string[]): {
  attachments: BrowserApplyAttachmentInstruction[];
  skipped: BrowserApplySkippedAttachment[];
} {
  const attachments: BrowserApplyAttachmentInstruction[] = [];
  const skipped: BrowserApplySkippedAttachment[] = [];

  for (const filePath of paths) {
    const name = displayNameForAttachmentPath(filePath);
    attachments.push({ id: filePath, name, filePath, sensitivity: "approved_external" });
  }

  return { attachments, skipped };
}

function attachmentsWithApplicationAssets(
  attachments: BrowserApplyAttachmentInstruction[],
  applicationAssets: ApplicationAsset[],
): BrowserApplyAttachmentInstruction[] {
  const attachableAssets = applicationAssets.filter((asset) =>
    asset.proofType === "file" &&
    asset.attachPolicy === "auto_attach" &&
    Boolean(asset.relativePath)
  );
  if (attachableAssets.length === 0) return attachments;

  const byOriginalName = new Map<string, ApplicationAsset>();
  for (const asset of attachableAssets) {
    byOriginalName.set(path.basename(asset.originalName).toLowerCase(), asset);
  }

  const replaced = attachments.map((attachment) => {
    if (proofAssetExists(attachment.filePath)) return attachment;
    const replacement = byOriginalName.get(path.basename(attachment.filePath).toLowerCase());
    if (!replacement?.relativePath) return attachment;
    return {
      id: `slack:${replacement.id}`,
      name: replacement.originalName,
      filePath: replacement.relativePath,
      sensitivity: "approved_external" as const,
    };
  });

  return replaced;
}

function parseRate(draft: ApplicationDraft, scoredJob: ScoredJob | null): string {
  const structuredRate = safeTrim(draft.structuredProposal?.browserFillNotes.rate);
  const planned = structuredRate || draft.suggestedBid || "Not specified";
  return clientBudgetAwareRate(planned, scoredJob);
}

function parseProfile(draft: ApplicationDraft): string {
  const notes = draft.structuredProposal?.browserFillNotes.profileNotes ?? [];
  return notes.find((note) => note.trim().length > 0)?.trim() ?? "Default Upwork profile; verify manually before submission.";
}

function buildConnectsPlan(draft: ApplicationDraft, rules: ConnectsRules, issues: BrowserApplyValidationIssue[]): BrowserApplyConnectsPlan {
  const sourceBacked = draft.connectsStrategy?.sourceBackedConnects;
  const required = sourceBacked?.requiredConnects ?? null;
  const suggestedBoost = required === null ? 0 : Math.max(0, draft.suggestedBoostConnects || 0);
  const requestedBoost = 0;
  let boost: number | null = required === null ? null : requestedBoost;
  const notes = [...draft.connectsWarnings];

  if (draft.suggestedConnects < 0 || draft.suggestedBoostConnects < 0) {
    issues.push(issue("error", "invalid_connects", "Connects values must be non-negative."));
  }
  if (suggestedBoost > 0) {
    notes.push(`Suggested boost ${suggestedBoost} left unset because optional boost requires explicit approval.`);
    issues.push(issue("warning", "boost_requires_explicit_approval", "Optional boost was left unset; explicit approval is required before setting boost Connects."));
  }
  if (required === null) {
    notes.push("Required Connects are unknown from visible Upwork source text.");
    issues.push(issue("warning", "required_connects_unknown_apply_page_verification", "Required Connects are not source-backed yet; open the apply page and verify before final preparation."));
  } else if (required > rules.maxRequiredPerJob) {
    issues.push(issue("error", "required_connects_cap", `Required Connects ${required} exceeds cap ${rules.maxRequiredPerJob}.`));
  }
  const total = required === null || boost === null ? null : required + boost;
  const approvalRequired = total === null || total > rules.requireApprovalAbove || boost === null || boost > rules.idealBoostMax;
  if (approvalRequired) {
    notes.push(total === null ? "Human verification required because total Connects are unknown." : `Human approval/verification required for total Connects ${total}.`);
    issues.push(issue("warning", "connects_approval_required", total === null ? "Connects total is unknown until the apply page is inspected." : `Connects total ${total} exceeds approval threshold ${rules.requireApprovalAbove}.`));
  }

  return { required, boost, total, approvalRequired, notes };
}

function findMissingLocalAssets(attachments: BrowserApplyAttachmentInstruction[]): string[] {
  return attachments
    .map((attachment) => attachment.filePath)
    .filter((filePath) => !proofAssetExists(filePath));
}

function buildAttachmentDiagnostics(attachments: BrowserApplyAttachmentInstruction[]): BrowserApplyAttachmentDiagnostic[] {
  return attachments.map((attachment) => ({
    ...attachment,
    existsLocally: proofAssetExists(attachment.filePath),
  }));
}

function buildConnectsEvidence(
  draft: ApplicationDraft,
  connects: BrowserApplyConnectsPlan,
  connectsStrategy: ConnectsStrategySnapshot,
  scoredJob: ScoredJob | null,
): string[] {
  return uniqueStrings([
    `Required Connects: ${connects.required ?? "unknown"}`,
    `Suggested boost Connects: ${connects.boost ?? "unknown"}`,
    `Total planned Connects: ${connects.total ?? "unknown"}`,
    connectsStrategy.sourceBackedConnects?.confidence ? `Connects confidence: ${connectsStrategy.sourceBackedConnects.confidence}` : null,
    connectsStrategy.sourceBackedConnects?.sourceText ? `Connects source: ${connectsStrategy.sourceBackedConnects.sourceLocation ?? "visible text"}: ${connectsStrategy.sourceBackedConnects.sourceText}` : null,
    `Connects decision: ${connectsStrategy.decision}`,
    ...connects.notes,
    ...draft.connectsWarnings,
    ...connectsStrategy.reasons.map((reason) => `Connects reason: ${reason}`),
    ...connectsStrategy.risks.map((risk) => `Connects risk: ${risk}`),
    ...(scoredJob?.scoreBreakdown.connectsRiskScore.reasons ?? []).map((reason) => `Connects score reason: ${reason}`),
    ...(scoredJob?.scoreBreakdown.connectsRiskScore.risks ?? []).map((risk) => `Connects score risk: ${risk}`),
  ]);
}

function buildManualFields(input: {
  coverLetter: string;
  rate: string;
  connects: BrowserApplyConnectsPlan;
  connectsStrategy: ConnectsStrategySnapshot;
  skippedAttachments: BrowserApplySkippedAttachment[];
  missingLocalAssets: string[];
  manualReviewAssets: string[];
  mentionOnlyProof: string[];
  manualReviewWarnings: string[];
  issues: BrowserApplyValidationIssue[];
}): string[] {
  const fields = ["finalSubmit"];
  if (!input.coverLetter.trim()) fields.push("coverLetter");
  if (!isSpecifiedRate(input.rate)) fields.push("rate");
  if (input.connects.required === null || input.connects.approvalRequired || input.connectsStrategy.decision !== "safe_apply") fields.push("connects");
  if (input.skippedAttachments.length > 0 || input.missingLocalAssets.length > 0) fields.push("attachments");
  if (input.manualReviewAssets.length > 0 || input.manualReviewWarnings.length > 0) {
    fields.push("proofPortfolioProfileReview");
  }
  if (input.issues.some((validationIssue) => validationIssue.code === "invalid_upwork_link")) fields.push("applyUrl");
  return uniqueStrings(fields);
}

function buildPreparationDiagnostics(input: {
  coverLetter: string;
  screeningAnswers: string[];
  rate: string;
  connects: BrowserApplyConnectsPlan;
  connectsStrategy: ConnectsStrategySnapshot;
  connectsEvidence: string[];
  attachments: BrowserApplyAttachmentInstruction[];
  skippedAttachments: BrowserApplySkippedAttachment[];
  attachmentDiagnostics: BrowserApplyAttachmentDiagnostic[];
  missingLocalAssets: string[];
  manualReviewAssets: string[];
  mentionOnlyProof: string[];
  proofAvailability: string[];
  figmaRecommendations: string[];
  videoRecommendations: string[];
  manualReviewWarnings: string[];
  highlights: string[];
  proofHighlights: string[];
  profileHighlights: string[];
  manualFields: string[];
  issues: BrowserApplyValidationIssue[];
}): BrowserApplyFinalPreparationDiagnostics {
  return {
    stopBeforeSubmit: true,
    coverLetter: {
      present: Boolean(input.coverLetter.trim()),
      length: input.coverLetter.length,
    },
    screeningAnswers: {
      count: input.screeningAnswers.length,
      answers: input.screeningAnswers,
    },
    rateBid: isSpecifiedRate(input.rate) ? input.rate : null,
    connects: {
      required: input.connects.required,
      boost: input.connects.boost,
      total: input.connects.total,
      approvalRequired: input.connects.approvalRequired,
      decision: input.connectsStrategy.decision,
      expectedValueScore: input.connectsStrategy.expectedValueScore,
      evidence: input.connectsEvidence,
      notes: input.connects.notes,
    },
    filesAttached: input.attachments.map((attachment) => attachment.filePath),
    attachmentDiagnostics: input.attachmentDiagnostics,
    missingFiles: input.missingLocalAssets,
    skippedAttachments: input.skippedAttachments,
    proofHighlights: uniqueStrings([...input.proofHighlights, ...input.mentionOnlyProof]),
    portfolioHighlights: uniqueStrings([
      ...input.attachments.map((attachment) => `${attachment.name}: selected for upload`),
      ...input.manualReviewAssets,
      ...input.figmaRecommendations,
      ...input.videoRecommendations,
    ]),
    profileHighlights: uniqueStrings([...input.profileHighlights, ...input.highlights, ...input.manualReviewWarnings]),
    manualFields: input.manualFields,
    blockers: input.issues.filter((validationIssue) => validationIssue.severity === "error").map((validationIssue) => `${validationIssue.code}: ${validationIssue.message}`),
    validationIssues: minimizedIssues(input.issues),
  };
}

function minimizedIssues(issues: BrowserApplyValidationIssue[]): BrowserApplyValidationIssue[] {
  return issues.map(({ severity, code, message }) => ({ severity, code, message }));
}

export function buildBrowserApplyPlan(jobId: string, options: BrowserApplyPlanOptions = {}): BrowserApplyPlanResult {
  const issues: BrowserApplyValidationIssue[] = [];
  const draft = getApplicationDraft(jobId);
  const link = getApplicationJobLink(jobId);

  if (!draft) {
    return {
      plan: null,
      valid: false,
      issues: [issue("error", "application_not_found", `No application draft found for job_id=${jobId}.`)],
    };
  }

  if (draft.status !== "approved") {
    issues.push(issue("warning", "not_approved", `Application is ${draft.status}; prepare draft is allowed for human review, but final submit remains manual.`));
  }
  if (!draft.proposalText.trim()) {
    issues.push(issue("error", "missing_proposal", "Application draft has no proposal text to fill."));
  }
  const coverLetter = sanitizeCoverLetterForApply(draft.proposalText);
  if (coverLetter !== draft.proposalText) {
    issues.push(issue("warning", "cover_letter_filename_sanitized", "Cover letter proof filenames/paths were replaced with client-safe proof labels before browser fill."));
  }
  const scoredJob = getScoredJobForSlackPreview(jobId);
  const rate = parseRate(draft, scoredJob);
  if (!isSpecifiedRate(rate)) {
    issues.push(issue("error", "missing_rate", "Application draft has no rate/bid value to fill safely."));
  }

  const urlInfo = deriveApplyUrl(link?.url);
  if (!urlInfo) {
    issues.push(issue("error", "invalid_upwork_link", "A direct Upwork job/apply URL is required before browser preparation."));
  }

  const profileContext = scoredJob ? buildProposalContextPack(scoredJob) : null;
  const basePortfolioSelection = scoredJob ? selectPortfolioAssetsForJob(scoredJob) : null;
  const proofOverrides = parseProofPlanOverrides(getApplicationProofPlanOverrides(jobId) ?? {});
  const portfolioSelection = basePortfolioSelection
    ? applyProofPlanOverridesToSelection(basePortfolioSelection, proofOverrides)
    : null;

  const profileAttachments = portfolioSelection?.autoAttachAssets.map((asset) => asset.path) ?? profileContext?.selectedAttachments ?? [];
  const fallbackDraftAttachments = draft.selectedPortfolioItems.map((item) => item.filePath).filter(Boolean);
  const selected = profileAttachments.length > 0
    ? buildAutoAttachmentInstructions(profileAttachments)
    : buildAttachmentInstructions(draft.selectedPortfolioItems);
  const skipped = selected.skipped;
  const applicationAssets = listApplicationAssets(jobId);
  const attachments = attachmentsWithApplicationAssets(selected.attachments, applicationAssets);
  for (const skippedAttachment of skipped) {
    issues.push(issue("warning", "attachment_skipped", `${skippedAttachment.name}: ${skippedAttachment.reason}`));
  }
  const missingLocalAssets = findMissingLocalAssets(attachments);
  for (const missingPath of missingLocalAssets) {
    issues.push(issue("error", "required_attachment_missing_locally", `${missingPath} is selected for browser preparation but is missing locally.`));
  }

  const manualReviewAssets = portfolioSelection?.recommendOnlyAssets.map((asset) => `${asset.name} — ${asset.path}`) ?? [];
  const mentionOnlyProof = portfolioSelection?.mentionOnlyProof.map((proof) => `${proof.name}: ${proof.headline}`) ?? [];
  const proofAvailability = portfolioSelection
    ? formatProofAvailabilityLines(buildProofAvailabilityReport(portfolioSelection), { includePath: false, limit: 8 })
    : [];
  const figmaRecommendations = profileContext?.selectedFigmaLinks.map((link) => `${link.name}: ${link.url}`) ?? [];
  const videoRecommendations = profileContext?.selectedVideoLinks.map((link) => `${link.name}: ${link.url}`) ?? [];
  const manualReviewWarnings = profileContext?.manualReviewWarnings ?? [];
  const profileHighlights = profileContext?.selectedPositioning ?? draft.structuredProposal?.browserFillNotes.profileNotes ?? [];
  const upworkPortfolioHighlights = uniqueStrings([
    ...(portfolioSelection?.selectedUpworkPortfolioItems.map((item) => item.name) ?? []),
    ...upworkPortfolioLabelsFromDraftItems(draft.selectedPortfolioItems),
  ]);
  const proofHighlights = [
    ...(portfolioSelection?.selectedProof.flatMap((proof) => [
      `${proof.name}: ${proof.headline}`,
      ...proof.supporting.slice(0, 2).map((line) => `${proof.name}: ${line}`),
    ]) ?? profileContext?.selectedProofLines ?? []),
  ].slice(0, 8);
  const screeningAnswers = draft.structuredProposal?.clientRequestAnswers ?? [];
  const highlights = uniqueStrings([
    ...upworkPortfolioHighlights,
  ]);

  const connects = buildConnectsPlan(draft, loadConnectsRules(options.connectsRulesPath), issues);
  const baseConnectsStrategy = draft.connectsStrategy ?? (scoredJob
    ? evaluateConnectsStrategy({
        job: scoredJob,
        score: scoredJob.score,
        scoreBreakdown: scoredJob.scoreBreakdown,
        suggestedBoostConnects: connects.boost ?? 0,
      })
    : {
        decision: connects.approvalRequired ? "manual_review" : "safe_apply",
        requiredConnects: connects.required ?? 0,
        suggestedBoostConnects: connects.boost ?? 0,
        totalConnects: connects.total ?? 0,
        expectedValueScore: connects.approvalRequired ? 50 : 70,
        sourceBackedConnects: {
          requiredConnects: connects.required,
          boostConnects: connects.boost,
          totalConnects: connects.total,
          confidence: connects.required === null ? "unknown" : "low",
          sourceText: null,
          sourceLocation: null,
          extractionMethod: connects.required === null ? "not_found" : "legacy_field",
        },
        reasons: [],
        risks: connects.notes,
      });
  const connectsStrategy: ConnectsStrategySnapshot = {
    ...baseConnectsStrategy,
    suggestedBoostConnects: connects.boost ?? 0,
    totalConnects: connects.total,
    sourceBackedConnects: baseConnectsStrategy.sourceBackedConnects
      ? {
          ...baseConnectsStrategy.sourceBackedConnects,
          boostConnects: null,
          totalConnects: connects.total,
        }
      : undefined,
    reasons: [...baseConnectsStrategy.reasons],
    risks: [...baseConnectsStrategy.risks],
  };
  const sourceRequired = connectsStrategy.sourceBackedConnects?.requiredConnects ?? connects.required;
  const applyPageVerificationOnly = sourceRequired === null && connectsStrategy.decision === "manual_review";
  if (connectsStrategy.decision !== "safe_apply" && !applyPageVerificationOnly) {
    issues.push(issue("error", "connects_manual_review_required", "Connects strategy requires human review before autonomous browser preparation."));
  } else if (applyPageVerificationOnly) {
    issues.push(issue("warning", "connects_apply_page_verification_required", "Connects are unknown from the job page; browser preparation may open the apply page to verify them, but final submit remains manual."));
  }
  const connectsEvidence = buildConnectsEvidence(draft, connects, connectsStrategy, scoredJob);
  const attachmentDiagnostics = buildAttachmentDiagnostics(attachments);
  const manualFields = buildManualFields({
    coverLetter,
    rate,
    connects,
    connectsStrategy,
    skippedAttachments: skipped,
    missingLocalAssets,
    manualReviewAssets,
    mentionOnlyProof,
    manualReviewWarnings,
    issues,
  });
  const finalPreparationDiagnostics = buildPreparationDiagnostics({
    coverLetter,
    screeningAnswers,
    rate,
    connects,
    connectsStrategy,
    connectsEvidence,
    attachments,
    skippedAttachments: skipped,
    attachmentDiagnostics,
    missingLocalAssets,
    manualReviewAssets,
    mentionOnlyProof,
    proofAvailability,
    figmaRecommendations,
    videoRecommendations,
    manualReviewWarnings,
    highlights,
    proofHighlights,
    profileHighlights,
    manualFields,
    issues,
  });
  const plan: BrowserApplyPlanWithDiagnostics | null = urlInfo
    ? {
        schemaVersion: "1.0",
        jobId,
        jobTitle: scoredJob?.title ?? link?.title ?? jobId,
        sourceUrl: urlInfo.sourceUrl,
        applyUrl: urlInfo.applyUrl,
        status: draft.status,
        profile: parseProfile(draft),
        rate,
        coverLetter,
        screeningAnswers,
        attachments,
        skippedAttachments: skipped,
        manualReviewAssets,
        mentionOnlyProof,
        proofAvailability,
        figmaRecommendations,
        videoRecommendations,
        manualReviewWarnings,
        missingLocalAssets,
        highlights,
        connects,
        connectsStrategy,
        stopBeforeSubmit: true,
        dryRunSafe: true,
        validationIssues: issues,
        filesAttached: attachments.map((attachment) => attachment.filePath),
        missingFiles: missingLocalAssets,
        manualFields,
        connectsEvidence,
        attachmentDiagnostics,
        proofHighlights,
        portfolioHighlights: uniqueStrings([
          ...upworkPortfolioHighlights.map((label) => `Upwork portfolio: ${label}`),
          ...attachments.map((attachment) => `${attachment.name}: selected for upload`),
          ...manualReviewAssets,
          ...figmaRecommendations,
          ...videoRecommendations,
        ]),
        profileHighlights,
        finalPreparationDiagnostics,
        createdAt: (options.now ?? new Date()).toISOString(),
      }
    : null;

  return {
    plan,
    valid: issues.every((validationIssue) => validationIssue.severity !== "error"),
    issues,
  };
}
