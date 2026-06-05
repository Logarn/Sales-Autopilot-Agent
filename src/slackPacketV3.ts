import { selectPortfolioAssetsForJob, type PortfolioSelectionResult } from "./skills/portfolioSelectionSkill";
import { buildProofAvailabilityReport, formatProofAvailabilityLines, type ProofAvailabilityItem } from "./proofAvailability";
import { formatConnectsStrategy } from "./connectsStrategy";
import { qaProposalPlatformGrounding } from "./proposalQa";
import { decideLeadHandling } from "./leadDecision";
import { evaluatePlatformEligibility, type PlatformEligibility } from "./platformEligibility";
import { JobIntelligence, ScoredJob, SourceBackedConnects } from "./types";
import { truncateText } from "./utils";

export interface SlackPacketV3Context {
  upworkUrl: string;
  captureStatus: string;
  browserCaptureActionId?: number;
  browserDraftStatus?: string;
  browserDraftActionId?: number;
  applicationQuestions?: string[];
  questionAnswers?: string[];
  proofRecommendations?: string[];
  requiredConnects?: number;
  suggestedBoostConnects?: number;
  suggestedBid?: string;
  autoPrepareNote?: string;
  sourceType?: string;
  sourceLabel?: string;
  postedAtText?: string;
  commandHints?: string[];
  outcomeMemory?: string;
  platform?: string;
  businessType?: string;
  ecommerceVertical?: string;
  platformPreferenceTier?: string;
  platformMismatchWarning?: string;
  jobIntelligence?: JobIntelligence;
}

export interface SlackPacketV3Message {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

export interface SlackLeadPostingDecision {
  shouldPost: boolean;
  classification: "skip" | "manual_review" | "post_to_slack";
  reason: string;
  internalSkipReason?: string;
  platformEligibility: PlatformEligibility;
  skippedBecausePlatform: boolean;
  source: "lead_decision" | "connects_strategy_manual_review";
}

const CONNECTS_MANUAL_REVIEW_POST_SCORE_FLOOR = 58;
const NON_POSTABLE_SKIP_REASONS = new Set([
  "major_red_flags",
  "low_score",
  "stale_weak_lead",
  "connects_strategy_skip",
]);

export function getSlackLeadPostingDecision(job: ScoredJob, context: SlackPacketV3Context): SlackLeadPostingDecision {
  const intelligence = context.jobIntelligence ?? job.applicationDraft?.jobIntelligence;
  const leadDecision = decideLeadHandling(job, intelligence);
  const eligibility = evaluatePlatformEligibility(intelligence);
  if (leadDecision.shouldPostToSlack) {
    return {
      shouldPost: true,
      classification: leadDecision.decision,
      reason: leadDecision.reason,
      internalSkipReason: leadDecision.internalSkipReason,
      platformEligibility: eligibility.platformEligibility,
      skippedBecausePlatform: eligibility.skippedBecausePlatform,
      source: "lead_decision",
    };
  }

  const connectsStrategy = job.applicationDraft?.connectsStrategy ?? job.scoreBreakdown?.connectsStrategy;
  const qualifiesForConnectsManualReview =
    connectsStrategy?.decision === "manual_review" &&
    eligibility.platformEligibility !== "ineligible" &&
    job.score >= CONNECTS_MANUAL_REVIEW_POST_SCORE_FLOOR &&
    !NON_POSTABLE_SKIP_REASONS.has(leadDecision.internalSkipReason ?? "");

  if (qualifiesForConnectsManualReview) {
    return {
      shouldPost: true,
      classification: "manual_review",
      reason: "Connects spend needs manual review before applying.",
      internalSkipReason: leadDecision.internalSkipReason,
      platformEligibility: eligibility.platformEligibility,
      skippedBecausePlatform: eligibility.skippedBecausePlatform,
      source: "connects_strategy_manual_review",
    };
  }

  return {
    shouldPost: false,
    classification: "skip",
    reason: leadDecision.reason,
    internalSkipReason: leadDecision.internalSkipReason,
    platformEligibility: eligibility.platformEligibility,
    skippedBecausePlatform: eligibility.skippedBecausePlatform,
    source: "lead_decision",
  };
}

export function shouldPostLeadPacket(job: ScoredJob, context: SlackPacketV3Context): boolean {
  return getSlackLeadPostingDecision(job, context).shouldPost;
}

const DEFAULT_COMMAND_HINTS = [
  "prepare draft — prepare the Upwork draft",
  "revise: <instruction> — revise the proposal",
  "skip — skip this job",
  "status — check current status",
  "mark submitted — update status after you manually submit",
];

const RETRY_COMMAND_HINT = "retry <action-id> — retry a browser step if needed";

const LEAD_MENTIONS = "<@U0A2X5BCNKC> <@U0AHJFYV42K>";

const PROPOSAL_PREVIEW_LENGTH = 2200;
const BLOCK_TEXT_LIMIT = 2900;

function sanitizeLines(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function bulletList(values: string[], fallback: string, limit = 5): string {
  const safeValues = sanitizeLines(values);
  if (safeValues.length === 0) {
    return `• ${fallback}`;
  }
  return safeValues.slice(0, limit).map((value) => `• ${value}`).join("\n");
}

function scoreComponentsText(job: ScoredJob): string {
  const breakdown = job.scoreBreakdown;
  return [
    `Fit: ${breakdown?.fitScore?.score ?? job.score}/100`,
    `Client quality: ${breakdown?.clientQualityScore?.score ?? "n/a"}/100`,
    `Opportunity: ${breakdown?.opportunityScore?.score ?? "n/a"}/100`,
    `Red flags: ${breakdown?.redFlagScore?.score ?? "n/a"}/100`,
    `Connects risk: ${breakdown?.connectsRiskScore?.score ?? "n/a"}/100`,
  ].join(" • ");
}

function formatScoreSection(job: ScoredJob): string {
  const reasons = sanitizeLines(job.scoreBreakdown?.reasons ?? job.applicationDraft?.fitReasons ?? []);
  const risks = sanitizeLines(job.scoreBreakdown?.risks ?? job.applicationDraft?.redFlags ?? []);
  return [
    `*📊 Fit score:* ${job.score}/100`,
    `Score components: ${scoreComponentsText(job)}`,
    `*✅ Fit reasons:*`,
    bulletList(reasons, "No fit reasons captured."),
    `*⚠️ Risks / red flags:*`,
    bulletList(risks, "No major risks detected."),
  ].join("\n");
}

function formatQAPairs(questions: string[] = [], answers: string[] = []): string {
  const safeQuestions = sanitizeLines(questions).slice(0, 6);
  if (safeQuestions.length === 0) {
    return "No explicit screening questions detected on capture.";
  }

  return safeQuestions
    .map((question, index) => {
      const answer = answers[index]?.trim() || "Proposed answer pending from lead context.";
      return `Q: ${question}\nA: ${answer}`;
    })
    .join("\n\n");
}

function formatDebugFooter(context: SlackPacketV3Context): string {
  const parts: string[] = [];
  if (context.browserCaptureActionId) parts.push(`action #${context.browserCaptureActionId}`);
  if (context.browserDraftActionId) parts.push(`draft action #${context.browserDraftActionId}`);
  if (context.captureStatus) parts.push(`status: ${context.captureStatus}`);
  return parts.length > 0 ? `_Debug: ${parts.join(" · ")}_` : "";
}

function buildCommandsText(values: string[], options: { includeRetry: boolean }): string {
  const lines = values.length > 0 ? values : DEFAULT_COMMAND_HINTS;
  const filteredLines = lines.filter((line) => options.includeRetry || !/^retry\b/i.test(line));
  const commandLines = options.includeRetry && !filteredLines.some((line) => /^retry\b/i.test(line))
    ? [...filteredLines, RETRY_COMMAND_HINT]
    : filteredLines;
  return [
    "💬 *Manual overrides (optional)*",
    "_Use these only to override, inspect, or recover the autonomous flow. Slack is not the workflow controller._",
    ...commandLines.map((line) => {
      const [command, ...description] = line.split(" — ");
      return `• \`${command}\`${description.length > 0 ? ` — ${description.join(" — ")}` : ""}`;
    }),
  ].join("\n");
}

function quoteBlock(value: string, fallback: string): string {
  const source = value.trim() || fallback;
  return source
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function formatLinkList(values: Array<{ name: string; url: string }>, fallback: string, limit = 4): string {
  if (values.length === 0) {
    return `• ${fallback}`;
  }
  return values.slice(0, limit).map((value) => `• ${value.name}: ${value.url}`).join("\n");
}

function blockSection(text: string): Record<string, unknown> {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: truncateText(text, BLOCK_TEXT_LIMIT),
    },
  };
}

function isAutoPrepareQueued(context: SlackPacketV3Context): boolean {
  return Boolean(
    (context.browserDraftActionId || context.browserDraftStatus) &&
      context.autoPrepareNote &&
      /Strong fit\. I’m preparing the Upwork draft now\./.test(context.autoPrepareNote),
  );
}

function isRetryRelevant(context: SlackPacketV3Context): boolean {
  return [context.captureStatus, context.browserDraftStatus, context.autoPrepareNote]
    .filter(Boolean)
    .some((value) => /fail|failed|paused|manual attention|blocked|incomplete|retry/i.test(String(value)));
}

function matchLevelText(job: ScoredJob): string {
  const level = job.matchLevel ?? (job.score >= 80 ? "high" : job.score >= 60 ? "medium" : job.score >= 40 ? "low" : "skip");
  if (level === "high") return `🟢 High — ${job.score}/100`;
  if (level === "medium") return `🟡 Medium — ${job.score}/100`;
  if (level === "low") return `🟠 Low — ${job.score}/100`;
  return `🔴 Skip — ${job.score}/100`;
}

function sourceText(context: SlackPacketV3Context): string {
  if (context.sourceLabel) return `${context.sourceLabel} — discovered automatically`;
  return "Manual Slack URL";
}

function optionalField(label: string, value?: string): string | null {
  const safe = value?.trim();
  return safe ? `*${label}:* ${safe}` : null;
}

function sentenceCase(value: string): string {
  const normalized = value.replace(/_/g, " ").trim();
  return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : normalized;
}

function formatPlatformTier(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "core") return "Core";
  if (normalized === "secondary") return "Secondary";
  if (normalized === "non_core_review") return "Non-core / review carefully";
  if (normalized === "unknown") return "Unknown";
  return sentenceCase(value);
}

function formatLeadContext(job: ScoredJob, context: SlackPacketV3Context): { text: string; watchOuts: string[] } {
  const intelligence = context.jobIntelligence ?? job.applicationDraft?.jobIntelligence;
  const platform = intelligence?.primaryPlatform ?? context.platform;
  const platformTier = formatPlatformTier(intelligence?.platformPreferenceTier ?? context.platformPreferenceTier);
  const businessType = intelligence?.businessType ?? context.businessType;
  const vertical = intelligence?.ecommerceVertical ?? context.ecommerceVertical;
  const jobCategory = intelligence?.jobCategory;
  const taskType = intelligence?.taskType;
  const workType = [jobCategory, taskType].map((value) => value?.trim()).filter(Boolean).join(" / ");

  const lines = [
    `• Platform: ${platform?.trim() || "Not analyzed yet"}`,
    platformTier ? `• Platform tier: ${platformTier}` : null,
    businessType ? `• Business: ${sentenceCase(businessType)}` : null,
    vertical && vertical !== "unknown" ? `• Vertical: ${sentenceCase(vertical)}` : null,
    workType ? `• Work type: ${sentenceCase(workType)}` : null,
  ].filter((value): value is string => Boolean(value));

  const qa = qaProposalPlatformGrounding({
    draftText: job.applicationDraft?.proposalText,
    intelligence,
  });
  const contextMismatchWarnings = context.platformMismatchWarning ? [`Platform mismatch: ${context.platformMismatchWarning.replace(/^platform_mismatch:\s*/i, "")}`] : [];
  const watchOuts = [
    ...qa.warnings.map((warning) => warning.message),
    ...contextMismatchWarnings,
    intelligence?.needsManualReview ? "Needs manual review before draft prep." : null,
    intelligence?.skipReason ? `Platform review note: ${intelligence.skipReason}` : null,
  ].filter((value): value is string => Boolean(value));

  return { text: `🧭 *Platform / business / vertical fit*\n${lines.join("\n")}`, watchOuts };
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "not available";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "not available";
  return `${Math.round(value)}%`;
}

function formatClientQualitySignals(job: ScoredJob): string {
  const component = job.scoreBreakdown?.clientQualityScore;
  const reasons = sanitizeLines(component?.reasons ?? []);
  const risks = sanitizeLines(component?.risks ?? []);
  const lines = [
    `• Client quality score: ${component?.score ?? "n/a"}/100`,
    `• Country: ${job.clientCountry || "not captured"}`,
    `• Rating: ${job.clientRating > 0 ? job.clientRating.toFixed(1) : "not available"} (${job.clientFeedbackCount || 0} feedback)`,
    `• Spend: ${formatMoney(job.clientSpend)}`,
    `• Hire rate: ${formatPercent(job.clientHireRate)}`,
    `• Hires: ${job.clientTotalHires || 0}`,
    reasons.length > 0 ? `• Positive signals: ${reasons.slice(0, 3).join("; ")}` : null,
    risks.length > 0 ? `• Client quality risks: ${risks.slice(0, 3).join("; ")}` : null,
  ].filter((value): value is string => Boolean(value));
  return `👤 *Client quality signals*\n${lines.join("\n")}`;
}

function getConnectsSource(
  job: ScoredJob,
  context: SlackPacketV3Context,
): { confidence: "high" | "medium" | "low" | "unknown"; source: string; sourceBacked?: SourceBackedConnects } {
  const draft = job.applicationDraft;
  const sourceBacked = draft?.connectsStrategy?.sourceBackedConnects ?? job.scoreBreakdown?.connectsStrategy?.sourceBackedConnects ?? job.connects;
  if (context.requiredConnects !== undefined) {
    return { confidence: "high", source: "explicit Slack context" };
  }
  if (sourceBacked) {
    if (sourceBacked.requiredConnects === null) {
      return { confidence: "unknown", source: "not visible in captured Upwork source text", sourceBacked };
    }
    const source = sourceBacked.sourceText
      ? `${sourceBacked.sourceLocation ?? "visible text"}: ${sourceBacked.sourceText}`
      : `${sourceBacked.extractionMethod}${sourceBacked.sourceLocation ? ` (${sourceBacked.sourceLocation})` : ""}`;
    return { confidence: sourceBacked.confidence, source, sourceBacked };
  }
  if (draft?.suggestedConnects !== undefined && draft.suggestedConnects > 0) {
    return { confidence: "medium", source: "application draft" };
  }
  if (job.connectsCost > 0) {
    return { confidence: "medium", source: "captured Upwork job" };
  }
  return { confidence: "unknown", source: "not captured" };
}

function formatRecommendedBidConnects(job: ScoredJob, context: SlackPacketV3Context): string {
  const draft = job.applicationDraft;
  const source = getConnectsSource(job, context);
  const sourceRequired = source.sourceBacked?.requiredConnects;
  const requiredValue = context.requiredConnects ??
    (sourceRequired !== undefined ? sourceRequired : undefined) ??
    (draft?.suggestedConnects && draft.suggestedConnects > 0 ? draft.suggestedConnects : undefined) ??
    (job.connectsCost > 0 ? job.connectsCost : null);
  const required = requiredValue === null ? "unknown" : String(requiredValue);
  const boostValue = context.suggestedBoostConnects ?? draft?.connectsStrategy?.suggestedBoostConnects ?? draft?.suggestedBoostConnects ?? 0;
  const boost = sourceRequired === null ? "unknown until required Connects are confirmed" : String(boostValue);
  const bid = context.suggestedBid ?? draft?.suggestedBid ?? draft?.structuredProposal?.rateRetainerAnswer ?? "Not specified";
  const strategy = draft?.connectsStrategy ?? job.scoreBreakdown?.connectsStrategy;
  return [
    `🔌 *Recommended bid / Connects strategy*`,
    `• Required Connects: ${required}`,
    `• Connects confidence/source: ${sentenceCase(source.confidence)} (${source.source})`,
    `• Suggested boost: ${boost}`,
    `• Recommended bid: ${bid}`,
    strategy ? formatConnectsStrategy(strategy) : "Connects strategy: not calculated.",
  ].join("\n");
}

function isAutoPrepareBlocked(context: SlackPacketV3Context): boolean {
  return /not auto-prepar|manual attention|blocked|failed|paused|incomplete|retry/i.test(context.autoPrepareNote ?? "");
}

function isAutoPrepareProceeding(context: SlackPacketV3Context, autoPrepareQueued: boolean): boolean {
  if (isAutoPrepareBlocked(context)) return false;
  if (autoPrepareQueued) return true;
  return /prepar|staging|queued|draft/i.test(context.autoPrepareNote ?? "");
}

function formatAutonomousPrepStatus(
  leadDecision: ReturnType<typeof decideLeadHandling>,
  context: SlackPacketV3Context,
  autoPrepareQueued: boolean,
): string {
  const note = context.autoPrepareNote?.trim();
  const proceeding = isAutoPrepareProceeding(context, autoPrepareQueued);
  const statusLine = isAutoPrepareBlocked(context)
    ? `Not proceeding: ${note}`
    : proceeding
      ? `Proceeding: ${note ?? "draft staging is queued for manual review."}`
      : leadDecision.shouldAutoPrepare
        ? "Proceeding: lead passed auto-prep policy; draft staging continues outside Slack. Final submit remains manual."
        : `Not proceeding: ${leadDecision.reason}`;

  return [
    `⚙️ *Autonomous prep*`,
    statusLine,
    "Slack replies are optional manual overrides only; they are not the workflow controller.",
  ].join("\n");
}

function fitLabel(job: ScoredJob): string {
  const level = job.matchLevel ?? (job.score >= 80 ? "high" : job.score >= 60 ? "medium" : job.score >= 40 ? "low" : "skip");
  if (level === "high") return "High";
  if (level === "medium") return "Medium";
  if (level === "low") return "Low";
  return "Low";
}

function compactTitle(value: string): string {
  return truncateText(value.replace(/\s+/g, " ").trim() || "Untitled Upwork job", 72);
}

function compactSentence(value: string, limit = 150): string {
  return truncateText(value.replace(/\s+/g, " ").trim(), limit).replace(/[.。]+$/g, "");
}

function firstUsefulLine(values: Array<string | null | undefined>, fallback: string, limit = 110): string {
  const value = values.map((item) => item?.trim()).find((item): item is string => Boolean(item));
  return compactSentence(value ?? fallback, limit);
}

function normalizeProofName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function proofNamesMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeProofName(left);
  const normalizedRight = normalizeProofName(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      (normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)),
  );
}

function proofSignalName(value: string): string {
  return value.split(":")[0]?.trim() || value.trim();
}

function proofSignalDetail(value: string): string | null {
  const [, ...detailParts] = value.split(":");
  const detail = detailParts.join(":").trim();
  return detail || null;
}

function compactProofText(value: string, limit = 74): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= limit) return cleaned.replace(/[.。]+$/g, "");
  const sliced = cleaned.slice(0, limit);
  const wordBoundary = sliced.lastIndexOf(" ");
  return `${(wordBoundary > 24 ? sliced.slice(0, wordBoundary) : sliced).replace(/[.。]+$/g, "")}...`;
}

function safePortfolioSelection(job: ScoredJob): PortfolioSelectionResult | null {
  try {
    return selectPortfolioAssetsForJob(job);
  } catch {
    return null;
  }
}

function compactProofAvailabilityStatus(item: ProofAvailabilityItem, formattedLine?: string): string {
  const formattedStatus = formattedLine?.match(/Status:\s*([^;]+)/)?.[1] ?? item.statusText;
  if (item.status === "available_uploadable") return "file available/uploadable";
  if (item.status === "available_manual_review") return "file available; review before upload";
  if (item.status === "missing_manual_upload") return "file missing locally; manual upload needed";
  if (item.status === "mention_only") return "mention-only; do not attach";
  return formattedStatus.toLowerCase();
}

function conciseProofLine(job: ScoredJob, context: SlackPacketV3Context): string {
  const draft = job.applicationDraft;
  const intelligence = context.jobIntelligence ?? draft?.jobIntelligence;
  const portfolioSelection = safePortfolioSelection(job);
  const proofAvailability = portfolioSelection ? buildProofAvailabilityReport(portfolioSelection) : [];
  const proofAvailabilityLines = proofAvailability.length > 0
    ? formatProofAvailabilityLines(proofAvailability, { limit: proofAvailability.length })
    : [];
  const proofSignals = [
    ...(context.proofRecommendations ?? []).map((text) => ({ text, source: "selected_portfolio" as const })),
    ...(draft?.selectedPortfolioItems ?? []).map((item) => ({
      text: `${item.name}: ${item.result || item.description || "good portfolio match"}`,
      source: "selected_portfolio" as const,
    })),
    ...(intelligence?.proofRecommendations ?? []).map((text) => ({ text, source: "lead_analysis" as const })),
  ].filter((item) => item.text.trim());

  const proofFromSignal = proofSignals
    .map((signal) => ({
      signal,
      availabilityIndex: proofAvailability.findIndex((item) => proofNamesMatch(item.name, proofSignalName(signal.text))),
    }))
    .find((item) => item.availabilityIndex >= 0);
  const fallbackAvailabilityIndex = proofSignals.length === 0 && proofAvailability.length > 0 ? 0 : -1;
  const availabilityIndex = proofFromSignal?.availabilityIndex ?? fallbackAvailabilityIndex;
  const availabilityItem = availabilityIndex >= 0 ? proofAvailability[availabilityIndex] : null;
  const selectedProof = portfolioSelection?.selectedProof.find((proof) =>
    availabilityItem
      ? proofNamesMatch(proof.name, availabilityItem.name)
      : proofSignals.some((signal) => proofNamesMatch(proof.name, proofSignalName(signal.text))),
  );
  const signal = proofFromSignal?.signal ?? proofSignals[0];
  const proofName = availabilityItem?.name ?? selectedProof?.name ?? (signal ? proofSignalName(signal.text) : "");

  if (!proofName) {
    return "No specific proof picked yet";
  }

  const signalDetail = signal ? proofSignalDetail(signal.text) : null;
  const reason = signal?.source === "selected_portfolio" && signalDetail
    ? `selected portfolio: ${compactProofText(signalDetail, 74)}`
    : signal?.source === "lead_analysis"
      ? "lead analysis recommends it"
      : selectedProof?.headline
        ? `portfolio match: ${compactProofText(selectedProof.headline, 74)}`
        : "portfolio match";
  const availability = availabilityItem ? compactProofAvailabilityStatus(availabilityItem, proofAvailabilityLines[availabilityIndex]) : null;
  return `${proofName} — ${reason}${availability ? `; ${availability}` : ""}`;
}

function concisePlatform(job: ScoredJob, context: SlackPacketV3Context): string {
  const intelligence = context.jobIntelligence ?? job.applicationDraft?.jobIntelligence;
  return compactSentence(intelligence?.primaryPlatform ?? context.platform ?? job.skills?.[0] ?? "unknown", 42);
}

function humanizeSlackText(value: string, fallback = "it needs a closer look"): string {
  const cleaned = value
    .replace(/\bmanual review\b/gi, "a closer look")
    .replace(/\blead decision\b/gi, "call")
    .replace(/\bplatformEligibility\b/gi, "platform fit")
    .replace(/\bsource[_\s-]*context[_\s-]*unavailable\b/gi, "the page was not readable")
    .replace(/\bpacket[_\s-]*sent\b/gi, "sent")
    .replace(/\bpacket\b/gi, "message")
    .replace(/\baction\s*#?\d+\b/gi, "browser step")
    .replace(/\bnot auto-preparing\b/gi, "I’m not prepping it yet")
    .replace(/\bauto-prepar(?:e|ing)\b/gi, "prep")
    .replace(/\bdeterministic parser found\b/gi, "")
    .replace(/\bdeterministic parser needs\b/gi, "it needs")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.;:,\s-]+/, "");
  return cleaned || fallback;
}

function conciseClientType(job: ScoredJob, context: SlackPacketV3Context): string {
  const intelligence = context.jobIntelligence ?? job.applicationDraft?.jobIntelligence;
  const vertical = intelligence?.ecommerceVertical ?? context.ecommerceVertical;
  const business = intelligence?.businessType ?? context.businessType;
  if (vertical && vertical !== "unknown") return `${sentenceCase(vertical)} brand`;
  if (business && business !== "unknown") return sentenceCase(business);
  return job.clientCountry ? `${job.clientCountry} client` : "client";
}

function articleFor(value: string): "a" | "an" {
  return /^[aeiou]/i.test(value.trim()) ? "an" : "a";
}

function variantIndex(seed: string, count: number): number {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return count > 0 ? hash % count : 0;
}

function conciseLeadSentence(job: ScoredJob, context: SlackPacketV3Context, proceeding: boolean, connectsUnknown: boolean): string {
  const intelligence = context.jobIntelligence ?? job.applicationDraft?.jobIntelligence;
  const platform = concisePlatform(job, context);
  const clientType = conciseClientType(job, context).toLowerCase();
  const task = compactSentence(
    intelligence?.taskType ??
      intelligence?.clientGoal ??
      job.category ??
      "project",
    86,
  );
  const reason = firstUsefulLine(
    [
      intelligence?.fitScoreReasoning,
      job.scoreBreakdown?.reasons?.[0],
      job.applicationDraft?.fitReasons?.[0],
    ],
    "it matches Steve's profile",
    90,
  );
  const scope = `${platform} ${task.toLowerCase()} for ${articleFor(clientType)} ${clientType}`;
  const fitReason = humanizeSlackText(reason, "it lines up with Steve’s wheelhouse").toLowerCase();
  if (proceeding) {
    const connectsNote = connectsUnknown ? " The Connects aren’t visible yet, so I’ll check them on the apply page before doing anything risky." : "";
    const variants = [
      `This is worth prepping: ${scope}. ${fitLabel(job)} fit because ${fitReason}.${connectsNote}`,
      `I’d move this into prep: ${scope}. ${fitLabel(job)} fit because ${fitReason}.${connectsNote}`,
      `This one has enough signal to stage: ${scope}. ${fitLabel(job)} fit because ${fitReason}.${connectsNote}`,
    ];
    return variants[variantIndex(job.id || job.url || job.title, variants.length)];
  }
  const risk = conciseRisk(job, context);
  const riskNote = risk === "none obvious" ? "" : ` The weak part: ${risk.toLowerCase()}.`;
  const variants = [
    `This is relevant, but I’d get a quick yes before spending Connects: ${scope}.${riskNote}`,
    `Worth a look, not an automatic prep yet: ${scope}.${riskNote}`,
    `This could be useful, but I’d wait for a human call before staging it: ${scope}.${riskNote}`,
  ];
  return variants[variantIndex(job.id || job.url || job.title, variants.length)];
}

function conciseRisk(job: ScoredJob, context: SlackPacketV3Context): string {
  const intelligence = context.jobIntelligence ?? job.applicationDraft?.jobIntelligence;
  const qa = qaProposalPlatformGrounding({
    draftText: job.applicationDraft?.proposalText,
    intelligence,
  });
  const leadContext = formatLeadContext(job, context);
  const raw = firstUsefulLine(
    [
      job.scoreBreakdown?.risks?.[0],
      job.applicationDraft?.redFlags?.find((risk) => !/no major/i.test(risk)),
      intelligence?.redFlags?.[0],
      qa.warnings[0]?.message,
      leadContext.watchOuts[0],
    ],
    "none obvious",
    105,
  );
  return humanizeSlackText(raw, "none obvious");
}

function conciseRequiredConnects(job: ScoredJob, context: SlackPacketV3Context, proceeding: boolean): string {
  const source = getConnectsSource(job, context);
  const draft = job.applicationDraft;
  const sourceRequired = source.sourceBacked?.requiredConnects;
  const requiredValue = context.requiredConnects ??
    (sourceRequired !== undefined ? sourceRequired : undefined) ??
    (draft?.suggestedConnects && draft.suggestedConnects > 0 ? draft.suggestedConnects : undefined) ??
    (job.connectsCost > 0 ? job.connectsCost : undefined);
  if (requiredValue === null || requiredValue === undefined) {
    return "unknown for now";
  }
  return String(requiredValue);
}

function conciseNextAction(
  leadDecision: ReturnType<typeof decideLeadHandling>,
  postingDecision: SlackLeadPostingDecision,
  context: SlackPacketV3Context,
  proceeding: boolean,
): string {
  if (proceeding) {
    return "I’m preparing this now.";
  }
  void leadDecision;
  void postingDecision;
  void context;
  return "Reply *“prep it”* if you want me to prepare the draft.";
}

export function buildV3CapturePacket(job: ScoredJob, context: SlackPacketV3Context): SlackPacketV3Message {
  const draft = job.applicationDraft;
  const intelligence = context.jobIntelligence ?? draft?.jobIntelligence;
  const leadDecision = decideLeadHandling(job, intelligence);
  const postingDecision = getSlackLeadPostingDecision(job, context);

  const title = job.title || "Untitled Upwork job";
  const url = job.url || context.upworkUrl || "(Upwork URL missing)";
  const autoPrepareQueued = isAutoPrepareQueued(context);
  const autoPrepareBlocked = isAutoPrepareBlocked(context);
  const autoPrepareProceeding = isAutoPrepareProceeding(context, autoPrepareQueued) || (!autoPrepareBlocked && leadDecision.shouldAutoPrepare);
  const connectsLabel = conciseRequiredConnects(job, context, autoPrepareProceeding);
  const connectsUnknown = connectsLabel.toLowerCase().includes("unknown");

  const text = [
    `🚀 *New lead: ${compactTitle(title)}*`,
    "",
    `${LEAD_MENTIONS} — ${conciseLeadSentence(job, context, autoPrepareProceeding, connectsUnknown)}`,
    "",
    [
      `• *Fit:* ${fitLabel(job)}`,
      `• *Platform:* ${concisePlatform(job, context)}`,
      `• *Budget:* ${job.budget || "unknown"}`,
      `• *Connects:* ${connectsLabel}`,
      `• *Proof:* ${conciseProofLine(job, context)}`,
      context.outcomeMemory ? `• *Pattern:* ${compactSentence(context.outcomeMemory, 180)}` : null,
      `• *Risk:* ${conciseRisk(job, context)}`,
    ].filter((line): line is string => Boolean(line)).join("\n"),
    "",
    `*Next:* ${conciseNextAction(leadDecision, postingDecision, context, autoPrepareProceeding)}`,
    "",
    url,
  ].join("\n");

  const blocks: Array<Record<string, unknown>> = [blockSection(text)];

  return { text, blocks };
}

export function buildV3CapturePacketText(job: ScoredJob, context: SlackPacketV3Context): string {
  return buildV3CapturePacket(job, context).text;
}
