import { WebClient } from "@slack/web-api";
import { SLACK_BOT_TOKEN } from "./config";
import { logger } from "./logger";

let client: WebClient | null | undefined;

function getSlackClient(): WebClient | null {
  if (client !== undefined) {
    return client;
  }

  if (!SLACK_BOT_TOKEN) {
    logger.warn("SLACK_BOT_TOKEN is not configured; browser worker cannot post Slack thread replies. Configure SLACK_BOT_TOKEN to verify real Slack thread delivery. Do not print token values.");
    client = null;
    return null;
  }

  client = new WebClient(SLACK_BOT_TOKEN);
  return client;
}

export interface SlackThreadMessage {
  channel: string;
  threadTs: string;
  text: string;
  blocks?: Array<Record<string, unknown>>;
}

export interface SlackChannelMessage {
  channel: string;
  text: string;
  blocks?: Array<Record<string, unknown>>;
}

export interface SlackPostResult {
  ok: boolean;
  channel?: string;
  ts?: string;
}

export async function postSlackThreadMessage(params: SlackThreadMessage): Promise<boolean> {
  const result = await postSlackChannelMessage({ ...params, threadTs: params.threadTs });
  return result.ok;
}

export async function postSlackChannelMessage(params: SlackChannelMessage & { threadTs?: string }): Promise<SlackPostResult> {
  const slack = getSlackClient();
  if (!slack) {
    return { ok: false };
  }

  try {
    const response = await slack.chat.postMessage({
      channel: params.channel,
      ...(params.threadTs ? { thread_ts: params.threadTs } : {}),
      text: params.text,
      unfurl_links: false,
      unfurl_media: false,
      ...(params.blocks ? { blocks: params.blocks } : {}),
    });
    return { ok: Boolean(response.ok), channel: response.channel, ts: response.ts };
  } catch (error) {
    logger.error(`Failed to post Slack message: ${String(error)}`);
    return { ok: false };
  }
}
