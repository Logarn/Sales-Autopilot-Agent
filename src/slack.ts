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

function buildJobBlocks(job: ScoredJob): IncomingWebhookSendArguments["blocks"] {
  const description = truncateText(job.description, MAX_DESCRIPTION_LENGTH);
  const headline = `${levelBadge(job)}  •  Score: ${job.score}`;
  const posted = `${timeAgo(job.postedAt)} (${formatInTimezone(job.postedAt, TIMEZONE)})`;

  const actionElements: Array<{
    type: "button";
    text: { type: "plain_text"; text: string };
    url: string;
    action_id: string;
  }> = [
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
        { type: "mrkdwn", text: `*💰 Budget:*\n${job.budget || "Not specified"}` },
        { type: "mrkdwn", text: `*🕐 Posted:*\n${posted}` },
        { type: "mrkdwn", text: `*🌍 Client:*\n${job.clientCountry || "Not specified"}` },
        {
          type: "mrkdwn",
          text: `*⭐ Rating:*\n${job.clientRating.toFixed(1)}/5 (${job.clientFeedbackCount} review${job.clientFeedbackCount === 1 ? "" : "s"})`,
        },
        { type: "mrkdwn", text: `*💵 Total Spent:*\n${formatCompactUsd(job.clientSpend)}` },
        { type: "mrkdwn", text: `*📊 Hire Rate:*\n${job.clientHireRate}% (${job.clientTotalHires} hires)` },
        { type: "mrkdwn", text: `*🎯 Level:*\n${normalizeLevel(job.experienceLevel)}` },
        { type: "mrkdwn", text: `*🎫 Connects:*\n${job.connectsCost || 0}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*📝 Description:*\n>${description.replace(/\n/g, " ")}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🏷️ Skills:*\n${job.skills.length ? job.skills.join(", ") : "Not specified"}\n\n*🔑 Matched Keywords:*\n${job.matchedKeywords.length ? job.matchedKeywords.join(", ") : "None"}`,
      },
    },
    {
      type: "actions",
      elements: actionElements,
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

export async function sendSlackMessage(payload: IncomingWebhookSendArguments): Promise<boolean> {
  try {
    await sendWithRetry(payload);
    await sleep(SLACK_DELAY_MS);
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

export async function sendJobNotifications(jobs: ScoredJob[]): Promise<Set<string>> {
  if (jobs.length === 0) {
    return new Set<string>();
  }

  const sorted = [...jobs].sort((a, b) => b.score - a.score);
  const notifiedIds = new Set<string>();

  if (sorted.length > 3) {
    const hasHigh = sorted.some((job) => job.matchLevel === "high");
    const header = hasHigh
      ? "<!channel> 🔥 *High-priority Upwork matches found*"
      : "⚡ *New Upwork matches found*";
    const blocks: IncomingWebhookSendArguments["blocks"] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${header}\n*${sorted.length} jobs found this cycle*`,
        },
      },
      { type: "divider" },
    ];
    for (const job of sorted.slice(0, 10)) {
      blocks.push(...(buildJobBlocks(job) ?? []));
    }
    const sent = await sendSlackMessage({
      text: `${APP_NAME}: ${sorted.length} new jobs`,
      blocks,
    });
    if (sent) {
      for (const job of sorted) {
        notifiedIds.add(job.id);
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
            text: `${mention}${levelBadge(job)}  •  Score: ${job.score}`,
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
          text: `🟢 *Upwork Notifier started.* Monitoring *${feedCount} queries* every 30 minutes.`,
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
