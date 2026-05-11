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

export async function postSlackThreadMessage(params: SlackThreadMessage): Promise<boolean> {
  const slack = getSlackClient();
  if (!slack) {
    return false;
  }

  try {
    await slack.chat.postMessage({
      channel: params.channel,
      thread_ts: params.threadTs,
      text: params.text,
      ...(params.blocks ? { blocks: params.blocks } : {}),
    });
    return true;
  } catch (error) {
    logger.error(`Failed to post Slack thread message: ${String(error)}`);
    return false;
  }
}
