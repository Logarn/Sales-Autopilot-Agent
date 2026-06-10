import { buildProposalContextPack } from "./skills/profileContextSkill";
import { selectPortfolioAssetsForJob } from "./skills/portfolioSelectionSkill";
import { buildProofAvailabilityReport, formatProofAvailabilityLines } from "./proofAvailability";
import { formatConnectsStrategy } from "./connectsStrategy";
import { qaProposalPlatformGrounding } from "./proposalQa";
import { decideLeadHandling } from "./leadDecision";
import { evaluatePlatformEligibility, type PlatformEligibility } from "./platformEligibility";
import { JobIntelligence, ScoredJob, SourceBackedConnects } from "./types";
import { truncateText } from "./utils";
import { buildSalesLearningPromptContext } from "./salesLearningMemory";
import { rewriteSlackCopyWithKimi, type SlackCopyProvider } from "./slackCopywriter";

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

const RETRY_COMMAND_HINT = "retry — retry the latest paused browser step for this thread";

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

function hasAutoPrepareActionEvidence(context: SlackPacketV3Context): boolean {
  const status = context.browserDraftStatus?.trim().toLowerCase() ?? "";
  return Boolean(
    context.browserDraftActionId ||
      /^(?:queued|pending|in_progress|preparing)$/.test(status),
  );
}

function isAutoPrepareProceeding(context: SlackPacketV3Context): boolean {
  if (isAutoPrepareBlocked(context)) return false;
  return hasAutoPrepareActionEvidence(context);
}

function formatAutonomousPrepStatus(
  leadDecision: ReturnType<typeof decideLeadHandling>,
  context: SlackPacketV3Context,
): string {
  const note = context.autoPrepareNote?.trim();
  const proceeding = isAutoPrepareProceeding(context);
  const statusLine = isAutoPrepareBlocked(context)
    ? `Not proceeding: ${note}`
    : proceeding
      ? `Proceeding: ${note ?? "draft staging is queued for manual review."}`
      : leadDecision.shouldAutoPrepare
        ? "Recommended: this lead passes prep policy, but I do not see a queued prep action in this packet yet. Final submit remains manual."
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

function leadScope(job: ScoredJob, context: SlackPacketV3Context): string {
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
  return `${platform} ${task.toLowerCase()} for ${articleFor(clientType)} ${clientType}`;
}

function conciseFitReason(job: ScoredJob, context: SlackPacketV3Context): string {
  const intelligence = context.jobIntelligence ?? job.applicationDraft?.jobIntelligence;
  const reason = firstUsefulLine(
    [
      intelligence?.fitScoreReasoning,
      job.scoreBreakdown?.reasons?.[0],
      job.applicationDraft?.fitReasons?.[0],
    ],
    "it matches my profile",
    90,
  );
  return humanizeSlackText(reason, "it lines up with my wheelhouse").toLowerCase();
}

function conciseLeadSentence(job: ScoredJob, context: SlackPacketV3Context, prepRecommended: boolean, connectsUnknown: boolean): string {
  const scope = leadScope(job, context);
  const fitReason = conciseFitReason(job, context);
  if (prepRecommended) {
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

function conciseRequiredConnects(job: ScoredJob, context: SlackPacketV3Context): string {
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

function visibleBoostConnects(job: ScoredJob, context: SlackPacketV3Context): number | null {
  const draft = job.applicationDraft;
  const value = context.suggestedBoostConnects ??
    draft?.connectsStrategy?.suggestedBoostConnects ??
    draft?.suggestedBoostConnects ??
    job.scoreBreakdown?.connectsStrategy?.suggestedBoostConnects;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function connectsBoostNote(job: ScoredJob, context: SlackPacketV3Context, connectsLabel: string): string {
  const boost = visibleBoostConnects(job, context);
  if (/unknown/i.test(connectsLabel)) {
    return boost === null
      ? "Connects are not visible yet; verify on the apply page before spending."
      : `Connects are not visible yet; do not boost ${boost} until required Connects are confirmed.`;
  }
  return boost === null
    ? `${connectsLabel} required; no boost suggested from visible data.`
    : `${connectsLabel} required; boost suggestion ${boost} if the apply page confirms it.`;
}

function proofAngle(job: ScoredJob, context: SlackPacketV3Context): string {
  const intelligence = context.jobIntelligence ?? job.applicationDraft?.jobIntelligence;
  const proof = firstUsefulLine(
    [
      intelligence?.proofRecommendations?.[0],
      context.proofRecommendations?.[0],
      intelligence?.proposalAngle,
    ],
    "proof not selected yet",
    120,
  );
  if (/proof not selected yet/i.test(proof)) {
    return "Proof not selected yet; use only verified portfolio evidence during prep.";
  }
  return `Lead with ${humanizeSlackText(proof, "the closest verified portfolio proof")}.`;
}

function leadRecommendation(
  leadDecision: ReturnType<typeof decideLeadHandling>,
  postingDecision: SlackLeadPostingDecision,
  prepRecommended: boolean,
): "prep" | "maybe" | "skip" {
  if (!postingDecision.shouldPost || leadDecision.decision === "skip") return "skip";
  return prepRecommended ? "prep" : "maybe";
}

function recommendationLine(value: "prep" | "maybe" | "skip"): string {
  if (value === "prep") return "*Recommendation:* prep";
  if (value === "maybe") return "*Recommendation:* maybe";
  return "*Recommendation:* skip";
}

function conciseNextAction(
  leadDecision: ReturnType<typeof decideLeadHandling>,
  postingDecision: SlackLeadPostingDecision,
  context: SlackPacketV3Context,
  proceeding: boolean,
  recommendation: "prep" | "maybe" | "skip",
): string {
  if (proceeding) {
    return "Prep is queued; review it in VNC when I say it’s ready. I’ll stop before submit.";
  }
  if (!postingDecision.shouldPost || leadDecision.decision === "skip") {
    return "I’m not preparing this unless you ask me to override. I’ll stop before submit.";
  }
  if (recommendation === "prep") {
    return "If you want this prepared, just say so naturally. I’ll stop before submit.";
  }
  void context;
  return "If you want this prepared, just say so naturally. I’ll stop before submit.";
}

export function buildV3CapturePacket(job: ScoredJob, context: SlackPacketV3Context): SlackPacketV3Message {
  const draft = job.applicationDraft;
  const intelligence = context.jobIntelligence ?? draft?.jobIntelligence;
  const leadDecision = decideLeadHandling(job, intelligence);
  const postingDecision = getSlackLeadPostingDecision(job, context);

  const title = job.title || "Untitled Upwork job";
  const url = job.url || context.upworkUrl || "(Upwork URL missing)";
  const autoPrepareBlocked = isAutoPrepareBlocked(context);
  const autoPrepareProceeding = isAutoPrepareProceeding(context);
  const prepRecommended = !autoPrepareBlocked && (autoPrepareProceeding || leadDecision.shouldAutoPrepare);
  const connectsLabel = conciseRequiredConnects(job, context);
  const connectsUnknown = connectsLabel.toLowerCase().includes("unknown");
  const recommendation = leadRecommendation(leadDecision, postingDecision, prepRecommended);

  const text = [
    `🚀 *New lead: ${compactTitle(title)}*`,
    "",
    `${LEAD_MENTIONS} — ${conciseLeadSentence(job, context, recommendation === "prep", connectsUnknown)}`,
    "",
    `*Hot take:* ${autoPrepareProceeding ? "Strong enough to stage now." : recommendation === "skip" ? "Not worth staging by default." : "Useful lead, but get a quick yes before spending time or Connects."}`,
    `*Why it fits:* ${fitLabel(job)} fit on ${leadScope(job, context)} because ${conciseFitReason(job, context)}.`,
    `*Proof angle:* ${proofAngle(job, context)}`,
    `*Risks/watchouts:* ${conciseRisk(job, context)}`,
    `*Connects/boost:* ${connectsBoostNote(job, context, connectsLabel)}`,
    recommendationLine(recommendation),
    "",
    `*Next:* ${conciseNextAction(leadDecision, postingDecision, context, autoPrepareProceeding, recommendation)}`,
    "",
    url,
  ].join("\n");

  const blocks: Array<Record<string, unknown>> = [blockSection(text)];

  return { text, blocks };
}

export function buildV3CapturePacketText(job: ScoredJob, context: SlackPacketV3Context): string {
  return buildV3CapturePacket(job, context).text;
}

function isSdrDecisionPacket(text: string): boolean {
  return [
    "*Hot take:*",
    "*Why it fits:*",
    "*Proof angle:*",
    "*Risks/watchouts:*",
    "*Connects/boost:*",
    "*Recommendation:*",
    "*Next:*",
  ].every((label) => text.includes(label));
}

export async function writeV3CapturePacketWithLlm(
  job: ScoredJob,
  context: SlackPacketV3Context,
  copyProvider?: SlackCopyProvider,
): Promise<SlackPacketV3Message> {
  const packet = buildV3CapturePacket(job, context);
  const intelligence = context.jobIntelligence ?? job.applicationDraft?.jobIntelligence;
  const leadDecision = decideLeadHandling(job, intelligence);
  const postingDecision = getSlackLeadPostingDecision(job, context);
  const salesLearning = buildSalesLearningPromptContext({
    jobId: job.id,
    job,
    text: [
      job.title,
      job.description,
      intelligence?.proposalAngle,
      intelligence?.proofRecommendations?.join(" "),
      context.autoPrepareNote,
    ].filter(Boolean).join(" "),
    types: ["proposal_style", "screening_answer", "proof_preference", "boost_strategy", "source_quality", "operator_preference"],
    limit: 8,
  });
  const upworkUrl = job.url || context.upworkUrl;
  const copy = await rewriteSlackCopyWithKimi({
    path: "lead_packet",
    deterministicText: packet.text,
    intent: "new_lead_packet",
    context: {
      jobId: job.id,
      title: job.title,
      upworkUrl,
      score: job.score,
      matchLevel: job.matchLevel,
      budget: job.budget,
      platform: intelligence?.primaryPlatform ?? null,
      proofRecommendations: intelligence?.proofRecommendations ?? context.proofRecommendations ?? [],
      draftAngle: intelligence?.proposalAngle ?? null,
      boostStrategy: job.applicationDraft?.connectsStrategy ?? job.scoreBreakdown?.connectsStrategy ?? null,
      autoPrepare: {
        shouldAutoPrepare: leadDecision.shouldAutoPrepare,
        reason: leadDecision.reason,
        note: context.autoPrepareNote ?? null,
      },
      leadFitDecision: {
        shouldPost: postingDecision.shouldPost,
        classification: postingDecision.classification,
        reason: postingDecision.reason,
      },
      salesLearning,
      safety: {
        finalSubmit: "manual_only",
        browserSecurity: "fail_closed",
        proofVerification: "deterministic_required",
        boostCap: "deterministic_connects_rules",
      },
    },
    preservePhrases: [
      LEAD_MENTIONS,
      upworkUrl,
      "stop before submit",
    ].filter((value): value is string => Boolean(value)),
  }, copyProvider);

  if (!copy.usedLlm || !isSdrDecisionPacket(copy.text)) {
    return packet;
  }

  return {
    text: copy.text,
    blocks: packet.blocks.map((block, index) => {
      if (index !== 0 || block.type !== "section") return block;
      return {
        ...block,
        text: {
          type: "mrkdwn",
          text: copy.text,
        },
      };
    }),
  };
}
