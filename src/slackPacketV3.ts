import { buildProposalContextPack } from "./skills/profileContextSkill";
import { selectPortfolioAssetsForJob } from "./skills/portfolioSelectionSkill";
import { ScoredJob } from "./types";
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
  platform?: string;
  businessType?: string;
  ecommerceVertical?: string;
  platformPreferenceTier?: string;
  platformMismatchWarning?: string;
}

export interface SlackPacketV3Message {
  text: string;
  blocks: Array<Record<string, unknown>>;
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
    "💬 *Available replies*",
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

function humanizeAssetLabel(value: string): string {
  const withoutSuffix = value
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[a-z0-9]+$/i, "") ?? value;
  return withoutSuffix
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (["dtc", "sms", "pdf", "crm", "esp"].includes(lower)) return lower.toUpperCase();
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

function formatAssetNames(values: string[], fallback: string, limit = 5): string {
  const safeValues = sanitizeLines(values);
  if (safeValues.length === 0) {
    return `• ${fallback}`;
  }
  return safeValues.slice(0, limit).map((value) => `• ${humanizeAssetLabel(value)}`).join("\n");
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

export function buildV3CapturePacket(job: ScoredJob, context: SlackPacketV3Context): SlackPacketV3Message {
  const draft = job.applicationDraft;
  const commands = context.commandHints?.length ? context.commandHints : DEFAULT_COMMAND_HINTS;
  const required = context.requiredConnects ?? draft?.suggestedConnects ?? job.connectsCost ?? 0;
  const boost = context.suggestedBoostConnects ?? draft?.suggestedBoostConnects ?? 0;
  const bid = context.suggestedBid ?? draft?.suggestedBid ?? draft?.structuredProposal?.rateRetainerAnswer ?? "Not specified";
  const proposalPreview = quoteBlock(
    truncateText(draft?.proposalText ?? "", PROPOSAL_PREVIEW_LENGTH),
    "Proposal draft is not yet available.",
  );
  const questionText = formatQAPairs(context.applicationQuestions, context.questionAnswers);
  const hasQuestions = sanitizeLines(context.applicationQuestions ?? []).length > 0;
  const debugFooter = formatDebugFooter(context);

  const profileContext = buildProposalContextPack(job);
  const portfolioSelection = selectPortfolioAssetsForJob(job);

  const recommendOnlyAssets = portfolioSelection.recommendOnlyAssets.map((asset) => asset.name);
  const autoAttachAssets = profileContext.selectedAttachments;
  const mentionOnlyProof = portfolioSelection.mentionOnlyProof.map((proof) => `${proof.name}: ${proof.headline}`);
  const manualWarnings = profileContext.manualReviewWarnings;

  const title = job.title || "Untitled Upwork job";
  const url = job.url || context.upworkUrl || "(Upwork URL missing)";

  const autoPrepareQueued = isAutoPrepareQueued(context);
  const recommendedAction = autoPrepareQueued ? "Draft is being staged for manual review" : "Review lead";
  const workflowLine = autoPrepareQueued
    ? "Final submit remains manual. The browser draft may be staged for review, but nothing is submitted automatically."
    : "Use `prepare draft` when you want the Upwork draft staged. Final submit remains manual.";
  const includeRetry = isRetryRelevant(context);
  const draftNote = autoPrepareQueued
    ? context.autoPrepareNote
    : includeRetry && context.autoPrepareNote
      ? context.autoPrepareNote
      : "Strong fit. Reply `prepare draft` when ready.";
  const futureIntelligence = [
    optionalField("Platform", context.platform ?? "Not analyzed yet"),
    optionalField("Business type", context.businessType),
    optionalField("Ecommerce vertical", context.ecommerceVertical),
    optionalField("Platform tier", context.platformPreferenceTier),
    optionalField("Platform warning", context.platformMismatchWarning),
  ].filter((value): value is string => Boolean(value));

  const topSection = [
    `🚀 *New Upwork Lead*`,
    `${LEAD_MENTIONS} — new lead found.`,
    ``,
    `*Job:* ${title}`,
    `*URL:* ${url}`,
    `*Fit:* ${matchLevelText(job)}`,
    `*Source:* ${sourceText(context)}`,
    context.postedAtText ? `*Posted:* ${context.postedAtText}` : null,
    `*Recommended action:* ${recommendedAction}`,
  ].filter((value): value is string => value !== null).join("\n");

  const proofSection = [
    `📎 *Suggested proof/assets*`,
    `*Proof points:*\n${bulletList(profileContext.selectedProofPoints, "No proof points selected.")}`,
    `\n*Assets:*\n${formatAssetNames(autoAttachAssets, "No auto-attach assets selected.")}`,
    recommendOnlyAssets.length > 0 ? `\n*Manual review first:*\n${formatAssetNames(recommendOnlyAssets, "No recommend-only assets selected.")}` : null,
    mentionOnlyProof.length > 0 ? `\n*Mention-only proof:*\n${bulletList(mentionOnlyProof, "No mention-only proof selected.")}` : null,
    profileContext.selectedFigmaLinks.length > 0 ? `\n*Figma:*\n${formatLinkList(profileContext.selectedFigmaLinks, "No Figma links recommended.")}` : null,
    profileContext.selectedVideoLinks.length > 0 ? `\n*Video:*\n${formatLinkList(profileContext.selectedVideoLinks, "No video links recommended.")}` : null,
  ].filter((value): value is string => Boolean(value)).join("\n");

  const sections = [
    topSection,
    futureIntelligence.length > 0 ? `🧭 *Lead context*\n${futureIntelligence.join("\n")}` : null,
    `🧠 *Why this might be a fit*\n${bulletList(sanitizeLines(job.scoreBreakdown?.reasons ?? job.applicationDraft?.fitReasons ?? profileContext.selectedPositioning), "No fit reasons captured.")}`,
    `⚠️ *Watch-outs*\n${bulletList(sanitizeLines(job.scoreBreakdown?.risks ?? job.applicationDraft?.redFlags ?? manualWarnings), "No major risks detected.")}`,
    `✍️ *Draft angle*\n${quoteBlock(profileContext.proposalAngle, "Draft angle is not available yet.")}\n\n*Proposal preview (review only):*\n${proposalPreview}`,
    hasQuestions ? `📝 *Screening answers*\n${questionText}` : null,
    proofSection,
    `*Connects / bid:* required ${required} • suggested boost ${boost} • ${bid}`,
    `*Draft note:* ${draftNote}`,
    buildCommandsText(commands, { includeRetry }),
    workflowLine,
    debugFooter || null,
  ].filter((value): value is string => Boolean(value));

  const text = sections.join("\n\n");

  const blocks: Array<Record<string, unknown>> = sections.map((section) => blockSection(section));

  return { text, blocks };
}

export function buildV3CapturePacketText(job: ScoredJob, context: SlackPacketV3Context): string {
  return buildV3CapturePacket(job, context).text;
}
