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
  commandHints?: string[];
}

export interface SlackPacketV3Message {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

const DEFAULT_COMMAND_HINTS = [
  "status",
  "approve",
  "reject",
  "revise: <instruction>",
  "prepare draft",
  "retry <action-id>",
  "mark submitted",
];

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
      const answer = answers[index]?.trim() || "Proposed answer pending from packet context.";
      return `Q: ${question}\nA: ${answer}`;
    })
    .join("\n\n");
}

function formatBrowserStatus(context: SlackPacketV3Context): string {
  const lines: string[] = [`Capture status: ${context.captureStatus}`];
  if (context.browserCaptureActionId) {
    lines.push(`Capture action: #${context.browserCaptureActionId}`);
  }
  if (context.browserDraftStatus) {
    lines.push(`Browser draft status: ${context.browserDraftStatus}`);
  }
  if (context.browserDraftActionId) {
    lines.push(`Browser draft action: #${context.browserDraftActionId}`);
  }
  return lines.join("\n");
}

function buildCommandsText(values: string[]): string {
  const lines = values.length > 0 ? values : DEFAULT_COMMAND_HINTS;
  return [
    "*Available commands (reply in this thread):*",
    ...lines.map((line) => `• ${line}`),
  ].join("\n");
}

function quoteBlock(value: string, fallback: string): string {
  const source = value.trim() || fallback;
  return source
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function formatAssetNames(values: string[], fallback: string, limit = 5): string {
  const safeValues = sanitizeLines(values);
  if (safeValues.length === 0) {
    return `• ${fallback}`;
  }
  return safeValues.slice(0, limit).map((value) => `• ${value}`).join("\n");
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
  const browserText = formatBrowserStatus(context);

  const profileContext = buildProposalContextPack(job);
  const portfolioSelection = selectPortfolioAssetsForJob(job);

  const recommendOnlyAssets = portfolioSelection.recommendOnlyAssets.map((asset) => `${asset.name} — ${asset.path}`);
  const autoAttachAssets = profileContext.selectedAttachments;
  const mentionOnlyProof = portfolioSelection.mentionOnlyProof.map((proof) => `${proof.name}: ${proof.headline}`);
  const manualWarnings = profileContext.manualReviewWarnings;

  const title = job.title || "Untitled Upwork job";
  const url = job.url || context.upworkUrl || "(Upwork URL missing)";

  const text = [
    `✅ *V3 Review Packet*`,
    `*Job:* ${title}`,
    `*Upwork URL:* ${url}`,
    formatScoreSection(job),
    `*Connects plan:* required ${required} • suggested boost ${boost}`,
    `*Bid / rate recommendation:* ${bid}`,
    `*Proposal angle:* ${profileContext.proposalAngle}`,
    `*Selected positioning:*\n${bulletList(profileContext.selectedPositioning, "No positioning selected.")}`,
    `*Proposal draft (review only):*\n${proposalPreview}`,
    `*Screening Q&A:*\n${questionText}`,
    `*Selected proof points:*\n${bulletList(profileContext.selectedProofPoints, "No proof points selected.")}`,
    `*Selected proof lines:*\n${bulletList(profileContext.selectedProofLines, "No supporting proof lines selected.", 8)}`,
    `*Auto-attach assets for browser draft prep:*\n${formatAssetNames(autoAttachAssets, "No auto-attach assets selected.")}`,
    `*Recommend-only assets (manual review first):*\n${formatAssetNames(recommendOnlyAssets, "No recommend-only assets selected.")}`,
    `*Mention-only proof:*\n${bulletList(mentionOnlyProof, "No mention-only proof selected.")}`,
    `*Figma recommendations:*\n${formatLinkList(profileContext.selectedFigmaLinks, "No Figma links recommended.")}`,
    `*Video recommendations:*\n${formatLinkList(profileContext.selectedVideoLinks, "No video links recommended.")}`,
    `*Manual review warnings:*\n${bulletList(manualWarnings, "No manual review warnings.", 8)}`,
    `*Browser status:*\n${browserText}`,
    buildCommandsText(commands),
    "*Workflow:* Use `prepare draft` to stage the Upwork application in-browser for review. No copy-paste step is required, and final submit stays manual.",
  ].join("\n\n");

  const blocks: Array<Record<string, unknown>> = [
    blockSection(`*✅ V3 Review Packet*\n*Job:* ${title}\n*Upwork URL:* ${url}`),
    blockSection(formatScoreSection(job)),
    blockSection(`*Connects plan:* required ${required} • suggested boost ${boost}\n*Bid / rate recommendation:* ${bid}`),
    blockSection(`*Proposal angle:* ${profileContext.proposalAngle}\n*Selected positioning:*\n${bulletList(profileContext.selectedPositioning, "No positioning selected.")}`),
    blockSection(`*Proposal draft (review only):*\n${proposalPreview}`),
    blockSection(`*Screening Q&A:*\n${questionText}`),
    blockSection(`*Selected proof points:*\n${bulletList(profileContext.selectedProofPoints, "No proof points selected.")}\n\n*Selected proof lines:*\n${bulletList(profileContext.selectedProofLines, "No supporting proof lines selected.", 8)}`),
    blockSection(`*Auto-attach assets for browser draft prep:*\n${formatAssetNames(autoAttachAssets, "No auto-attach assets selected.")}\n\n*Recommend-only assets (manual review first):*\n${formatAssetNames(recommendOnlyAssets, "No recommend-only assets selected.")}\n\n*Mention-only proof:*\n${bulletList(mentionOnlyProof, "No mention-only proof selected.")}`),
    blockSection(`*Figma recommendations:*\n${formatLinkList(profileContext.selectedFigmaLinks, "No Figma links recommended.")}\n\n*Video recommendations:*\n${formatLinkList(profileContext.selectedVideoLinks, "No video links recommended.")}`),
    blockSection(`*Manual review warnings:*\n${bulletList(manualWarnings, "No manual review warnings.", 8)}`),
    blockSection(buildCommandsText(commands)),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: truncateText(`Browser status: ${browserText}`, BLOCK_TEXT_LIMIT),
        },
      ],
    },
    blockSection("*Workflow:* Use `prepare draft` to stage the Upwork application in-browser for review. No copy-paste step is required, and final submit stays manual."),
  ];

  return { text, blocks };
}

export function buildV3CapturePacketText(job: ScoredJob, context: SlackPacketV3Context): string {
  return buildV3CapturePacket(job, context).text;
}
