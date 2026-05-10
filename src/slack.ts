import { IncomingWebhook, IncomingWebhookSendArguments } from "@slack/webhook";
import {
  APP_NAME,
  MAX_DESCRIPTION_LENGTH,
  QUICK_BID_TEMPLATE_URL,
  SLACK_DELAY_MS,
  SLACK_RETRY_ATTEMPTS,
  SLACK_CHANNEL_WEBHOOK_URL,
  TIMEZONE,
} from "./config";
import {
  getQueuedSlackMessages,
  incrementQueuedMessageAttempts,
  markQueuedMessageSent,
  queueSlackMessage,
} from "./db";
import { logger } from "./logger";
import { DailySummary, ScoredJob } from "./types";
import { sleep, timeAgo, truncateText, formatInTimezone } from "./utils";

let webhook: IncomingWebhook | null = null;
if (SLACK_CHANNEL_WEBHOOK_URL) {
  webhook = new IncomingWebhook(SLACK_CHANNEL_WEBHOOK_URL);
}

function ensureWebhook(): IncomingWebhook {
  if (!webhook) {
    throw new Error("SLACK_CHANNEL_WEBHOOK_URL is not configured.");
  }
  return webhook;
}

function levelBadge(job: ScoredJob): string {
  if (job.matchLevel === "high") {
    return "🔥 HIGH MATCH";
  }
  if (job.matchLevel === "medium") {
    return "⚡ MEDIUM MATCH";
  }
  return "🔹 LOW MATCH";
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "$0";
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${Math.round(value)}`;
}

function normalizeLevel(level: string): string {
  const value = (level ?? "").toUpperCase();
  if (value === "EXPERT") {
    return "Expert";
  }
  if (value === "INTERMEDIATE") {
    return "Intermediate";
  }
  if (value === "ENTRY") {
    return "Entry";
  }
  return level || "Not specified";
}

const SLACK_MESSAGE_BLOCK_LIMIT = 50;
const SLACK_SECTION_TEXT_LIMIT = 3000;
const SLACK_FIELD_TEXT_LIMIT = 2000;
const PROPOSAL_DRAFT_PREVIEW_LENGTH = 2200;

function slackText(text: string, maxLength = SLACK_SECTION_TEXT_LIMIT): string {
  return truncateText(text, maxLength);
}

function bulletList(items: string[], fallback: string, limit = 4): string {
  if (items.length === 0) {
    return `• ${fallback}`;
  }
  return items.slice(0, limit).map((item) => `• ${item}`).join("\n");
}

function buildScoreSummary(job: ScoredJob): string {
  const breakdown = job.scoreBreakdown;
  const components = [
    `Fit ${breakdown.fitScore.score}/100`,
    `Client ${breakdown.clientQualityScore.score}/100`,
    `Opportunity ${breakdown.opportunityScore.score}/100`,
    `Red flags ${breakdown.redFlagScore.score}/100`,
    `Connects risk ${breakdown.connectsRiskScore.score}/100`,
  ].join(" • ");
  return slackText(
    `*📊 Match Score:* ${job.score}/100\n${components}\n\n*✅ Reasons to consider:*\n${bulletList(
      breakdown.reasons,
      "No strong reasons captured.",
      4,
    )}\n\n*⚠️ Risks / watch-outs:*\n${bulletList(breakdown.risks, "None detected.", 4)}`,
  );
}

function buildProposalQualityText(job: ScoredJob): string {
  const quality = job.applicationDraft?.proposalQuality;
  if (!quality) {
    return "*🧪 Proposal Quality:* Not generated yet — review the job details before drafting manually.";
  }

  const issues = quality.issues.map((issue) => `${issue.message}${issue.evidence ? ` (${issue.evidence})` : ""}`);
  return slackText(
    `*🧪 Proposal Quality:* ${quality.score}/100 • ${quality.wordCount} words\n*Top issues:*\n${bulletList(
      issues,
      "None detected.",
      3,
    )}\n\n*Positive signals:*\n${bulletList(quality.positiveSignals, "No strong positive signals captured.", 3)}`,
  );
}

function buildProposalPacketBlocks(job: ScoredJob): IncomingWebhookSendArguments["blocks"] {
  const draft = job.applicationDraft;
  if (!draft) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*🧾 Proposal Packet:* No generated draft found yet. Use the job details, score reasons, and risks above to decide whether to draft manually.",
        },
      },
    ];
  }

  const proofItems = draft.selectedPortfolioItems.map((item) => `${item.name} — ${item.result}`);
  const proposalPreview = slackText(draft.proposalText, PROPOSAL_DRAFT_PREVIEW_LENGTH).replace(/\n/g, "\n> ");

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: slackText(
          `*🧠 Fit & Positioning:* ${draft.fitScore}/100\n*Why it fits:*\n${bulletList(
            draft.fitReasons,
            "No strong fit reasons captured.",
            4,
          )}\n\n*Red flags to sanity-check:*\n${bulletList(draft.redFlags, "None detected.", 4)}`,
        ),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: slackText(
          `*🎫 Connects Plan:* Required ${draft.suggestedConnects} connects • Suggested boost ${draft.suggestedBoostConnects} connects\n*Bid:* ${draft.suggestedBid}\n${bulletList(
            draft.connectsWarnings,
            "Within default guardrails.",
            4,
          )}`,
        ),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: slackText(`*📎 Proof to Use:*\n${bulletList(proofItems, "No attachment recommended.", 4)}`),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: buildProposalQualityText(job),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: slackText(`*✍️ Draft Proposal (copy manually into Upwork):*\n> ${proposalPreview}`),
      },
    },
  ];
}

function buildActionElements(job: ScoredJob): Array<{
  type: "button";
  text: { type: "plain_text"; text: string };
  url: string;
  action_id: string;
  style?: "primary";
}> {
  const actionElements: ReturnType<typeof buildActionElements> = [
    {
      type: "button",
      text: { type: "plain_text", text: "🔗 View & Bid on Upwork" },
      url: job.url,
      action_id: `view_job_${job.id.slice(0, 10)}`,
      ...(job.matchLevel === "high" ? { style: "primary" as const } : {}),
    },
  ];

  if (QUICK_BID_TEMPLATE_URL.trim().length > 0) {
    actionElements.push({
      type: "button",
      text: { type: "plain_text", text: "📝 Quick Bid Template" },
      url: QUICK_BID_TEMPLATE_URL,
      action_id: `quick_bid_${job.id.slice(0, 10)}`,
    });
  }

  return actionElements;
}

export function buildJobBlocks(job: ScoredJob): IncomingWebhookSendArguments["blocks"] {
  const description = truncateText(job.description, MAX_DESCRIPTION_LENGTH);
  const headline = `${levelBadge(job)}  •  Score: ${job.score}/100`;
  const posted = `${timeAgo(job.postedAt)} (${formatInTimezone(job.postedAt, TIMEZONE)})`;

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${headline}*\n\n*📋 ${job.title}*\n*🔗 ${job.url}*`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: slackText(`*💰 Budget:*\n${job.budget || "Not specified"}`, SLACK_FIELD_TEXT_LIMIT) },
        { type: "mrkdwn", text: slackText(`*🕐 Posted:*\n${posted}`, SLACK_FIELD_TEXT_LIMIT) },
        { type: "mrkdwn", text: slackText(`*🌍 Client:*\n${job.clientCountry || "Not specified"}`, SLACK_FIELD_TEXT_LIMIT) },
        {
          type: "mrkdwn",
          text: slackText(
            `*⭐ Rating:*\n${job.clientRating.toFixed(1)}/5 (${job.clientFeedbackCount} review${job.clientFeedbackCount === 1 ? "" : "s"})`,
            SLACK_FIELD_TEXT_LIMIT,
          ),
        },
        { type: "mrkdwn", text: slackText(`*💵 Total Spent:*\n${formatCompactUsd(job.clientSpend)}`, SLACK_FIELD_TEXT_LIMIT) },
        { type: "mrkdwn", text: slackText(`*📊 Hire Rate:*\n${job.clientHireRate}% (${job.clientTotalHires} hires)`, SLACK_FIELD_TEXT_LIMIT) },
        { type: "mrkdwn", text: slackText(`*🎯 Level:*\n${normalizeLevel(job.experienceLevel)}`, SLACK_FIELD_TEXT_LIMIT) },
        { type: "mrkdwn", text: slackText(`*🎫 Connects:*\n${job.connectsCost || 0}`, SLACK_FIELD_TEXT_LIMIT) },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: buildScoreSummary(job),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*📝 Job Description:*\n>${description.replace(/\n/g, " ")}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: slackText(
          `*🏷️ Skills:*\n${job.skills.length ? job.skills.join(", ") : "Not specified"}\n\n*🔑 Matched Keywords:*\n${
            job.matchedKeywords.length ? job.matchedKeywords.join(", ") : "None"
          }`,
        ),
      },
    },
    ...(buildProposalPacketBlocks(job) ?? []),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Webhook V0 is one-way: buttons can only open URLs. Approve/revise/reject by copying the draft or using manual notes; true Slack callbacks require a Slack app or later polling flow.",
        },
      ],
    },
    {
      type: "actions",
      elements: buildActionElements(job),
    },
    { type: "divider" },
  ];
}

async function sendPayload(payload: IncomingWebhookSendArguments): Promise<void> {
  const hook = ensureWebhook();
  await hook.send(payload);
}

async function sendWithRetry(payload: IncomingWebhookSendArguments, attempts = 1): Promise<void> {
  try {
    await sendPayload(payload);
  } catch (error) {
    if (attempts >= SLACK_RETRY_ATTEMPTS) {
      throw error;
    }
    const backoffMs = 2 ** (attempts - 1) * 1_000;
    logger.warn(`Slack send attempt ${attempts} failed; retrying in ${backoffMs}ms.`);
    await sleep(backoffMs);
    await sendWithRetry(payload, attempts + 1);
  }
}

export async function sendSlackPreviewMessage(payload: IncomingWebhookSendArguments): Promise<void> {
  await sendWithRetry(payload);
  await sleep(SLACK_DELAY_MS);
}

export async function sendSlackMessage(payload: IncomingWebhookSendArguments): Promise<boolean> {
  try {
    await sendSlackPreviewMessage(payload);
    return true;
  } catch (error) {
    logger.error(`Slack send failed, queueing payload: ${String(error)}`);
    queueSlackMessage(JSON.stringify(payload));
    return false;
  }
}

export async function flushSlackQueue(): Promise<void> {
  const queue = getQueuedSlackMessages();
  if (queue.length === 0) {
    return;
  }

  logger.info(`Attempting to flush ${queue.length} queued Slack message(s).`);
  for (const item of queue) {
    try {
      const parsed = JSON.parse(item.payload) as IncomingWebhookSendArguments;
      await sendWithRetry(parsed);
      markQueuedMessageSent(item.id);
      await sleep(SLACK_DELAY_MS);
    } catch (error) {
      incrementQueuedMessageAttempts(item.id);
      logger.error(`Queued Slack message ${item.id} failed: ${String(error)}`);
    }
  }
}

export function buildBatchedJobNotificationPayloads(jobs: ScoredJob[]): Array<IncomingWebhookSendArguments & { jobIds: string[] }> {
  const sorted = [...jobs].sort((a, b) => b.score - a.score).slice(0, 10);
  const hasHigh = sorted.some((job) => job.matchLevel === "high");
  const header = hasHigh ? "<!channel> 🔥 *High-priority Upwork matches found*" : "⚡ *New Upwork matches found*";
  const payloads: Array<IncomingWebhookSendArguments & { jobIds: string[] }> = [];
  let batchBlocks: NonNullable<IncomingWebhookSendArguments["blocks"]> = [];
  let batchJobIds: string[] = [];

  const startBatch = (part: number): NonNullable<IncomingWebhookSendArguments["blocks"]> => [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${header}\n*${jobs.length} jobs found this cycle*${part > 1 ? ` — packet ${part}` : ""}`,
      },
    },
    { type: "divider" },
  ];

  const flushBatch = () => {
    if (batchJobIds.length === 0) {
      return;
    }
    payloads.push({
      text: `${APP_NAME}: ${jobs.length} new jobs`,
      blocks: batchBlocks,
      jobIds: batchJobIds,
    });
    batchBlocks = [];
    batchJobIds = [];
  };

  for (const job of sorted) {
    const jobBlocks = buildJobBlocks(job) ?? [];
    if (batchBlocks.length === 0) {
      batchBlocks = startBatch(payloads.length + 1);
    }
    if (batchJobIds.length > 0 && batchBlocks.length + jobBlocks.length > SLACK_MESSAGE_BLOCK_LIMIT) {
      flushBatch();
      batchBlocks = startBatch(payloads.length + 1);
    }
    batchBlocks.push(...jobBlocks.slice(0, Math.max(0, SLACK_MESSAGE_BLOCK_LIMIT - batchBlocks.length)));
    batchJobIds.push(job.id);
  }
  flushBatch();
  return payloads;
}

export async function sendJobNotifications(jobs: ScoredJob[]): Promise<Set<string>> {
  if (jobs.length === 0) {
    return new Set<string>();
  }

  const sorted = [...jobs].sort((a, b) => b.score - a.score);
  const notifiedIds = new Set<string>();

  if (sorted.length > 3) {
    for (const payload of buildBatchedJobNotificationPayloads(sorted)) {
      const { jobIds, ...slackPayload } = payload;
      const sent = await sendSlackMessage(slackPayload);
      if (sent) {
        for (const jobId of jobIds) {
          notifiedIds.add(jobId);
        }
      }
    }
    return notifiedIds;
  }

  for (const job of sorted) {
    const mention = job.matchLevel === "high" ? "<!channel>\n" : "";
    const sent = await sendSlackMessage({
      text: `${levelBadge(job)} ${job.title}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${mention}${levelBadge(job)}  •  Score: ${job.score}/100`,
          },
        },
        ...(buildJobBlocks(job) ?? []),
      ],
    });
    if (sent) {
      notifiedIds.add(job.id);
    }
  }
  return notifiedIds;
}

export async function sendStartupMessage(feedCount: number): Promise<void> {
  await sendSlackMessage({
    text: `🟢 ${APP_NAME} started`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🟢 *Upwork Notifier started.* Monitoring *${feedCount} queries* every 5 minutes.`,
        },
      },
    ],
  });
}

export async function sendFeedFailureAlert(): Promise<void> {
  await sendSlackMessage({
    text: "⚠️ Feed fetch failed",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "⚠️ *Feed fetch failed* - all feeds were unreachable in the latest cycle.",
        },
      },
    ],
  });
}

export async function sendDailySummary(summary: DailySummary): Promise<void> {
  const now = new Date();
  const dayLabel = new Intl.DateTimeFormat("en-KE", {
    timeZone: TIMEZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);

  await sendSlackMessage({
    text: `📊 Daily Upwork Job Summary — ${dayLabel}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📊 *Daily Upwork Job Summary — ${dayLabel}*`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*🔥 High Matches:*\n${summary.high}` },
          { type: "mrkdwn", text: `*⚡ Medium Matches:*\n${summary.medium}` },
          { type: "mrkdwn", text: `*🔹 Low Matches:*\n${summary.low}` },
          { type: "mrkdwn", text: `*🚫 Filtered Out:*\n${summary.filteredOut}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Top job:* ${
            summary.topJobTitle
              ? `"${summary.topJobTitle}" — Score: ${summary.topJobScore ?? 0}`
              : "No qualifying jobs tracked today."
          }`,
        },
      },
    ],
  });
}

export async function testSlackWebhook(): Promise<boolean> {
  try {
    await sendWithRetry({
      text: `✅ ${APP_NAME} Slack webhook check passed`,
    });
    return true;
  } catch (error) {
    logger.error(`Slack health check failed: ${String(error)}`);
    return false;
  }
}

if (require.main === module) {
  (async () => {
    const sent = await testSlackWebhook();
    if (!sent) {
      process.exitCode = 1;
      return;
    }
    logger.info("Slack webhook test message sent.");
  })().catch((error) => {
    logger.error(`test:slack failed: ${String(error)}`);
    process.exitCode = 1;
  });
}
