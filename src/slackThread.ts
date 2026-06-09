import { WebClient } from "@slack/web-api";
import { SLACK_BOT_TOKEN } from "./config";
import { logger } from "./logger";
import { rewriteSlackCopyWithKimi, type SlackCopyPath } from "./slackCopywriter";

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
  copyIntent?: string;
  copyPath?: SlackCopyPath;
  preservePhrases?: string[];
  soulComposed?: boolean;
}

export interface SlackChannelMessage {
  channel: string;
  text: string;
  blocks?: Array<Record<string, unknown>>;
  copyIntent?: string;
  copyPath?: SlackCopyPath;
  preservePhrases?: string[];
  soulComposed?: boolean;
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

function extractPreservePhrases(text: string, explicit: string[] = []): string[] {
  const urls = text.match(/https?:\/\/[^\s<>)]+/gi) ?? [];
  const safetyPhrases = [
    "final submit remains manual",
    "Final submit remains manual",
    "stop before submit",
    "Submit untouched",
    "I did not submit",
  ].filter((phrase) => text.includes(phrase));
  return [...new Set([...explicit, ...urls, ...safetyPhrases].filter((phrase) => phrase.trim()))];
}

async function finalizeThreadCopy(params: SlackChannelMessage & { threadTs?: string }): Promise<SlackChannelMessage & { threadTs?: string }> {
  if (params.soulComposed || !params.text.trim()) {
    return params;
  }
  const copy = await rewriteSlackCopyWithKimi({
    path: params.copyPath ?? "conversation_reply",
    deterministicText: params.text,
    intent: params.copyIntent ?? "slack_thread_message",
    preservePhrases: extractPreservePhrases(params.text, params.preservePhrases),
  });
  return { ...params, text: copy.text };
}

export async function postSlackChannelMessage(params: SlackChannelMessage & { threadTs?: string }): Promise<SlackPostResult> {
  const slack = getSlackClient();
  if (!slack) {
    return { ok: false };
  }

  try {
    const finalized = await finalizeThreadCopy(params);
    const response = await slack.chat.postMessage({
      channel: finalized.channel,
      ...(finalized.threadTs ? { thread_ts: finalized.threadTs } : {}),
      text: finalized.text,
      unfurl_links: false,
      unfurl_media: false,
      ...(finalized.blocks ? { blocks: finalized.blocks } : {}),
    });
    return { ok: Boolean(response.ok), channel: response.channel, ts: response.ts };
  } catch (error) {
    logger.error(`Failed to post Slack message: ${String(error)}`);
    return { ok: false };
  }
}
