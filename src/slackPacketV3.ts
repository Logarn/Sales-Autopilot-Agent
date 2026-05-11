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

function bulletList(values: string[], fallback: string, limit = 4): string {
  const safeValues = values.filter(Boolean).map((value) => value.trim()).filter(Boolean);
  if (safeValues.length === 0) {
    return `• ${fallback}`;
  }
  return safeValues.slice(0, limit).map((value) => `• ${value}`).join("\n");
}

function formatScoreComponents(job: ScoredJob): string {
  const breakdown = job.scoreBreakdown;
  const components = [
    `Fit: ${breakdown?.fitScore?.score ?? job.score}/100`,
    `Client quality: ${breakdown?.clientQualityScore?.score ?? "n/a"}/100`,
    `Opportunity: ${breakdown?.opportunityScore?.score ?? "n/a"}/100`,
    `Red flags: ${breakdown?.redFlagScore?.score ?? "n/a"}/100`,
    `Connects risk: ${breakdown?.connectsRiskScore?.score ?? "n/a"}/100`,
  ].join(" • ");

  const reasons = breakdown?.reasons?.length ? breakdown.reasons : [];
  const risks = breakdown?.risks?.length ? breakdown.risks : [];

  return [
    `*📊 Match Score:* ${job.score}/100`,
    `Score components: ${components}`,
    `*✅ Reasons:*`,
    `${bulletList(reasons, "No strong reasons captured.", 4)}`,
    `*⚠️ Risks:*`,
    `${bulletList(risks, "No major risks detected.", 4)}`,
  ].join("\n");
}

function formatQAPairs(questions: string[] = [], answers: string[] = []): string {
  if (!questions.length) {
    return "No explicit screening questions detected on capture.";
  }

  return questions
    .filter(Boolean)
    .slice(0, 6)
    .map((question, index) => {
      const answer = answers[index]?.trim() || "Proposed answer pending from packet context.";
      return `Q: ${question}\nA: ${answer}`;
    })
    .join("\n\n");
}

function formatProofRecommendations(items: string[] = []): string {
  const safeItems = items.filter(Boolean).map((item) => item.trim()).filter(Boolean);
  if (!safeItems.length) {
    return "No explicit proof/portfolio recommendation captured yet.";
  }
  return safeItems.map((item) => `• ${item}`).join("\n");
}

function buildCommandsText(values: string[]): string {
  const lines = values.length > 0 ? values : DEFAULT_COMMAND_HINTS;
  const commandLines = lines.map((line) => `• ${line}`).join("\n");
  return `*Available commands (reply in this thread):*\n${commandLines}`;
}

function formatBrowserStatus(context: SlackPacketV3Context): string {
  const lines: string[] = [];
  lines.push(`Capture status: ${context.captureStatus}`);
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

export function buildV3CapturePacket(job: ScoredJob, context: SlackPacketV3Context): SlackPacketV3Message {
  const draft = job.applicationDraft;
  const commands = context.commandHints && context.commandHints.length > 0 ? context.commandHints : DEFAULT_COMMAND_HINTS;

  const required = context.requiredConnects ?? draft?.suggestedConnects ?? job.connectsCost ?? 0;
  const boost = context.suggestedBoostConnects ?? draft?.suggestedBoostConnects ?? 0;
  const bid = context.suggestedBid ?? draft?.suggestedBid ?? "Not specified";

  const draftText = draft?.proposalText ?? "Proposal draft is not yet available.";
  const proposalPreview = truncateText(draftText, PROPOSAL_PREVIEW_LENGTH).replace(/\n/g, "\n> ");

  const proofItems = context.proofRecommendations?.length
    ? context.proofRecommendations
    : draft?.selectedPortfolioItems?.map((item) => `${item.name}: ${item.result}`) ?? [];

  const safeTitle = job.title || "Untitled Upwork job";
  const safeUrl = job.url || context.upworkUrl || "(Upwork URL missing)";
  const scoreLine = formatScoreComponents(job);
  const browserLine = formatBrowserStatus(context);
  const questionText = formatQAPairs(context.applicationQuestions, context.questionAnswers);

  const text = [
    `✅ *V3 Review Packet*`,
    `*Job:* ${safeTitle}`,
    `*Upwork URL:* ${safeUrl}`,
    `*Bid recommendation:* ${bid}`,
    `*Connects:* required ${required} • suggested boost ${boost}`,
    scoreLine,
    `*Proposal preview (review only):*\n> ${proposalPreview}`,
    `*Screening Q&A:*\n${questionText}`,
    `*Proof / portfolio recommendations:*\n${formatProofRecommendations(proofItems)}`,
    `*Browser status:*\n${browserLine}`,
    buildCommandsText(commands),
    "",
    "*⚠️ Sales workflow:* no copy-paste is required for this step. Use `prepare draft` to fill the Upwork page in-browser for review, then manually submit from Upwork after your final check.",
  ].join("\n\n");

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*✅ V3 Review Packet*\n*Job:* ${safeTitle}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Upwork URL:* ${safeUrl}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${scoreLine}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Bid:* ${bid}\n*Connects plan:* required ${required} • suggested boost ${boost}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Proposal preview (review only):*\n> ${proposalPreview}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Screening Q&A:*\n${questionText}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Proof / portfolio recommendations:*\n${formatProofRecommendations(proofItems)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: buildCommandsText(commands),
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Browser status: ${browserLine}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Workflow:* Use `prepare draft` to stage fields in the browser, then manually review and submit in Upwork once approved.",
      },
    },
  ];

  return { text, blocks };
}

export function buildV3CapturePacketText(job: ScoredJob, context: SlackPacketV3Context): string {
  return buildV3CapturePacket(job, context).text;
}
