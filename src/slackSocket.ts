import { App } from "@slack/bolt";
import { clearBrowserManualAttention, getBrowserSessionStatus } from "./browserSession";
import {
  enqueueBrowserActionDeduped,
  getApplicationDraft,
  getApplicationStatus,
  getBrowserActionById,
  getScoredJobForSlackPreview,
  getSlackThreadStateByThreadTs,
  updateApplicationStatus,
  updateSlackThreadStateStatus,
  upsertSlackThreadState,
  recordApplicationRevisionRequest,
  updateBrowserActionStatus,
} from "./db";
import {
  buildCaptureActionPayload,
  deriveCaptureThreadJobId,
} from "./browserCapture";
import {
  SLACK_APP_TOKEN,
  SLACK_BOT_TOKEN,
  SLACK_SOCKET_MODE_ENABLED,
  SLACK_ALLOWED_CHANNEL_IDS,
} from "./config";
import { logger } from "./logger";
import { buildProposalContextPack } from "./skills/profileContextSkill";
import { selectPortfolioAssetsForJob } from "./skills/portfolioSelectionSkill";

export type SlackSocketParsedCommandType =
  | "status"
  | "approve"
  | "reject"
  | "revise"
  | "prepare_draft"
  | "retry_action"
  | "mark_submitted"
  | "unknown";

export interface ParsedSlackSocketCommand {
  type: SlackSocketParsedCommandType;
  rawText: string;
  instruction?: string;
  actionId?: number;
}

export interface ParsedUpworkUrl {
  normalizedUrl: string;
  jobId: string | null;
}

const UPWORK_HOSTS = new Set(["upwork.com", "www.upwork.com"]);
const UPWORK_JOB_ID_PATTERN = /~([A-Za-z0-9_-]{8,})/;

function isUpworkHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");
  return UPWORK_HOSTS.has(normalized);
}

function normalizeSlackTextInput(value: string): string {
  return value
    .replace(/<@[A-Za-z0-9_]+(?:\|[^>]+)?>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseUrlSafely(value: string): ParsedUpworkUrl | null {
  const trimmed = value
    .trim()
    .replace(/^</, "")
    .replace(/>$/, "")
    .replace(/^\((https?:\/\/[^)]+)\)$/, "$1");
  const withNoLabel = trimmed.split("|")[0].trim();

  let parsed: URL;
  try {
    parsed = new URL(withNoLabel);
  } catch {
    return null;
  }

  if (!isUpworkHost(parsed.hostname) || parsed.protocol !== "https:") {
    return null;
  }

  const match = UPWORK_JOB_ID_PATTERN.exec(parsed.pathname);
  if (!match) {
    return null;
  }

  const normalizedUrl = `${parsed.origin}${parsed.pathname}`;
  return { normalizedUrl, jobId: match[1] ?? null };
}

export function parseUpworkJobUrlFromText(text: string): ParsedUpworkUrl | null {
  const matches = text.match(/https?:\/\/[^\s<>]+/gi);
  if (!matches) {
    return null;
  }

  for (const raw of matches) {
    const parsed = parseUrlSafely(raw);
    if (!parsed) continue;
    return {
      ...parsed,
      normalizedUrl: parsed.normalizedUrl.replace(/[\n\r\t]+/g, ""),
    };
  }
  return null;
}

export function parseSlackThreadCommand(text: string): ParsedSlackSocketCommand {
  const normalized = normalizeSlackTextInput(text).trim();
  const statusMatch = /^(status)$/i.test(normalized);
  if (statusMatch) return { type: "status", rawText: normalized };

  if (/^(approve)$/i.test(normalized)) return { type: "approve", rawText: normalized };
  if (/^(reject)$/i.test(normalized)) return { type: "reject", rawText: normalized };

  const reviseMatch = normalized.match(/^revise\s*:\s*(.+)$/i);
  if (reviseMatch) {
    return {
      type: "revise",
      rawText: normalized,
      instruction: reviseMatch[1]?.trim() || "",
    };
  }

  if (/^prepare\s+draft$/i.test(normalized)) return { type: "prepare_draft", rawText: normalized };

  const retryMatch = normalized.match(/^retry\s+(\d+)$/i);
  if (retryMatch) {
    return {
      type: "retry_action",
      rawText: normalized,
      actionId: Number.parseInt(retryMatch[1], 10),
    };
  }

  if (/^mark\s+submitted$/i.test(normalized)) return { type: "mark_submitted", rawText: normalized };

  return { type: "unknown", rawText: normalized };
}

export interface SlackSocketStartupConfig {
  socketEnabled: boolean;
  botToken: string;
  appToken: string;
}

export function buildSlackSocketStartupError(config: SlackSocketStartupConfig): string | null {
  if (!config.socketEnabled) {
    return "Set SLACK_SOCKET_MODE_ENABLED=true before running npm run slack:socket.";
  }
  if (!config.botToken || !config.appToken) {
    return "Missing Slack Socket Mode credentials: set SLACK_BOT_TOKEN and SLACK_APP_TOKEN.\nDo not print token values.";
  }
  return null;
}

export function getSlackSocketStartupError(): string | null {
  return buildSlackSocketStartupError({
    socketEnabled: SLACK_SOCKET_MODE_ENABLED,
    botToken: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
  });
}

function isAllowedChannel(channelId: string): boolean {
  if (SLACK_ALLOWED_CHANNEL_IDS.length === 0) {
    return true;
  }
  return SLACK_ALLOWED_CHANNEL_IDS.includes(channelId);
}

function availableCommandsText(): string {
  return `
Available commands:
• status
• approve
• reject
• revise: <instruction>
• prepare draft
• retry <action-id>
• mark submitted`;
}

function statusLabel(status?: string | null): string {
  if (!status) return "unknown";
  return status;
}

export function buildPrepareDraftQueueReply(input: {
  jobId: string;
  threadTitle: string;
  upworkUrl: string;
  actionId: number;
  duplicate: boolean;
  duplicateStatus?: string | null;
}): string {
  const draft = getApplicationDraft(input.jobId);
  const scoredJob = getScoredJobForSlackPreview(input.jobId);
  const profileContext = scoredJob ? buildProposalContextPack(scoredJob) : null;
  const selection = scoredJob ? selectPortfolioAssetsForJob(scoredJob) : null;

  const autoAttachAssets = profileContext?.selectedAttachments ?? [];
  const recommendOnlyAssets = selection?.recommendOnlyAssets.map((asset) => `${asset.name} — ${asset.path}`) ?? [];
  const warnings = profileContext?.manualReviewWarnings ?? [];

  return [
    input.duplicate
      ? `Draft preparation already exists as browser action #${input.actionId}${input.duplicateStatus ? ` (${input.duplicateStatus})` : ""}.`
      : `Draft preparation queued as browser action #${input.actionId}.`,
    `Job: ${input.threadTitle}`,
    `Job ID: ${input.jobId}`,
    `Upwork URL: ${input.upworkUrl}`,
    `Stored proposal draft: ${draft?.proposalText ? `present (${draft.proposalText.length} chars)` : "missing"}`,
    `Auto-attach assets: ${autoAttachAssets.length > 0 ? autoAttachAssets.join(", ") : "none"}`,
    `Recommend-only assets: ${recommendOnlyAssets.length > 0 ? recommendOnlyAssets.join("; ") : "none"}`,
    `Manual review warnings: ${warnings.length > 0 ? warnings.join("; ") : "none"}`,
    "Browser draft preparation is for human review only. Final submit remains manual and will not be clicked.",
    "Next commands: retry <action-id> | status | mark submitted",
  ].join("\n");
}

export function queuePrepareDraftFromSlackThread(input: { channelId: string; threadTs: string }): { ok: boolean; text: string; actionId?: number } {
  const state = getSlackThreadStateByThreadTs(input.channelId, input.threadTs);
  if (!state?.jobId) {
    return { ok: false, text: "I cannot queue a browser draft without a tracked job id for this thread." };
  }

  const draft = getApplicationDraft(state.jobId);
  const scoredJob = getScoredJobForSlackPreview(state.jobId);
  if (!draft || !scoredJob || !draft.proposalText.trim()) {
    return { ok: false, text: `I cannot prepare a browser draft yet for ${state.jobId}. The stored/generated application draft is missing. Please regenerate or revise the draft first.` };
  }
  const browserSession = getBrowserSessionStatus();
  if (browserSession.blocked) {
    return { ok: false, text: `I cannot prepare a browser draft right now because browser attention is required (${browserSession.state}). Resolve the browser state first, then retry.` };
  }

  const action = enqueueBrowserActionDeduped({
    jobId: state.jobId,
    actionType: "prepare_application_review",
    payload: {
      url: state.upworkUrl,
      channelId: state.channelId,
      threadTs: state.threadTs,
      messageTs: state.messageTs,
      applicationId: state.jobId,
      notes: "Slack socket: prepare draft command from tracked thread. Prepare browser review only; do not submit.",
    },
  });
  const duplicateAction = action.duplicate ? getBrowserActionById(action.id) : null;
  updateSlackThreadStateStatus(state.channelId, state.threadTs, "prepare_draft_requested");
  return {
    ok: true,
    actionId: action.id,
    text: buildPrepareDraftQueueReply({
      jobId: state.jobId,
      threadTitle: scoredJob.title,
      upworkUrl: state.upworkUrl,
      actionId: action.id,
      duplicate: action.duplicate,
      duplicateStatus: duplicateAction?.status ?? null,
    }),
  };
}

async function postThreadReply(client: App["client"], channel: string, threadTs: string, text: string): Promise<void> {
  await client.chat.postMessage({ channel, thread_ts: threadTs, text });
}

async function handleUrlMessage(params: {
  channelId: string;
  messageTs: string;
  text: string;
  threadTs: string;
  client: App["client"];
}): Promise<void> {
  const upworkUrl = parseUpworkJobUrlFromText(params.text);
  if (!upworkUrl) {
    return;
  }

  const state = upsertSlackThreadState({
    channelId: params.channelId,
    messageTs: params.messageTs,
    threadTs: params.threadTs,
    upworkUrl: upworkUrl.normalizedUrl,
    jobId: upworkUrl.jobId,
    status: "capture_pending",
  });

  const jobIdForAction = deriveCaptureThreadJobId(upworkUrl.normalizedUrl, upworkUrl.jobId);
  const action = enqueueBrowserActionDeduped({
    jobId: jobIdForAction,
    actionType: "capture_job_from_url",
    payload: {
      ...buildCaptureActionPayload(
        upworkUrl.normalizedUrl,
        params.channelId,
        params.messageTs,
        params.threadTs,
      ),
      sourceQuery: "slack_url",
      notes: "Slack socket URL posted; browser capture required before scoring and draft prep.",
    },
  });

  const details = [
    `✅ Captured Upwork URL for tracking.`,
    `• Thread: ${state.threadTs}`,
    `• Message: ${state.messageTs}`,
    `• Job ID: ${state.jobId ?? "unknown"}`,
    `• Status: ${statusLabel(state.status)}`,
    action.duplicate
      ? `• Browser capture action already queued as #${action.id} for this posting.`
      : `• Browser capture action queued as #${action.id}.`,
    `
${availableCommandsText()}`,
  ].join("\n");

  await postThreadReply(params.client, params.channelId, params.threadTs, details);
}

async function handleThreadCommand(params: {
  channelId: string;
  threadTs: string;
  text: string;
  client: App["client"];
}): Promise<void> {
  const command = parseSlackThreadCommand(params.text);
  const state = getSlackThreadStateByThreadTs(params.channelId, params.threadTs);

  if (command.type === "unknown") {
    if (state) {
      await postThreadReply(
        params.client,
        params.channelId,
        params.threadTs,
        `Could not parse command. Available commands:${availableCommandsText()}`,
      );
    }
    return;
  }

  if (!state) {
    await postThreadReply(
      params.client,
      params.channelId,
      params.threadTs,
      "No tracked Slack thread mapping found for this thread. Post a Upwork URL first, then use thread commands there."
    );
    return;
  }

  const maybeJobStatus = state.jobId ? getApplicationStatus(state.jobId) : null;

  if (command.type === "status") {
    const statusText = [
      `Status: ${statusLabel(state.status)}`,
      `Channel message: ${state.messageTs}`,
      `Thread: ${state.threadTs}`,
      `URL: ${state.upworkUrl}`,
      state.jobId ? `Job ID: ${state.jobId}` : "Job ID: unknown",
      state.jobId && maybeJobStatus ? `Application status: ${maybeJobStatus}` : "Application status: not yet created",
    ].join("\n");
    await postThreadReply(params.client, params.channelId, params.threadTs, statusText);
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "status_checked");
    return;
  }

  if (!state.jobId && ["approve", "reject", "revise", "prepare_draft", "mark_submitted", "retry_action"].includes(command.type)) {
    const response = `This thread tracks ${state.upworkUrl} but no job id was parsed. ${
      command.type === "prepare_draft" ? "I cannot queue a browser draft without a job id." : "Please share a supported Upwork job URL first."
    }`;
    await postThreadReply(params.client, params.channelId, params.threadTs, response);
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "error");
    return;
  }

  if (command.type === "approve") {
    if (state.jobId && maybeJobStatus) {
      updateApplicationStatus(state.jobId, "approved", "Approved from Slack socket thread command.");
    }
    const updated = updateSlackThreadStateStatus(state.channelId, state.threadTs, "approve_requested");
    await postThreadReply(
      params.client,
      params.channelId,
      params.threadTs,
      `Thread marked approved${state.jobId ? ` for ${state.jobId}` : ""}.`
    );
    return;
  }

  if (command.type === "reject") {
    if (state.jobId && maybeJobStatus) {
      updateApplicationStatus(state.jobId, "rejected", "Rejected from Slack socket thread command.");
    }
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "reject_requested");
    await postThreadReply(params.client, params.channelId, params.threadTs, `Thread marked rejected${state.jobId ? ` for ${state.jobId}` : ""}.`);
    return;
  }

  if (command.type === "revise") {
    if (state.jobId) {
      const revisionText = command.instruction ? command.instruction : "Manual revision requested from Slack socket.";
      const revised = recordApplicationRevisionRequest(state.jobId, revisionText);
      if (!revised) {
        updateSlackThreadStateStatus(state.channelId, state.threadTs, "revise_requested");
        await postThreadReply(
          params.client,
          params.channelId,
          params.threadTs,
          `Revision request recorded for ${state.jobId}: ${revisionText} (no stored draft was found to apply).`
        );
      } else {
        updateSlackThreadStateStatus(state.channelId, state.threadTs, "revise_requested");
        await postThreadReply(
          params.client,
          params.channelId,
          params.threadTs,
          `Revision requested for ${state.jobId}: ${revisionText}`
        );
      }
      return;
    }
  }

  if (command.type === "prepare_draft") {
    const result = queuePrepareDraftFromSlackThread({ channelId: params.channelId, threadTs: params.threadTs });
    if (!result.ok) {
      updateSlackThreadStateStatus(state.channelId, state.threadTs, "error");
    }
    await postThreadReply(params.client, params.channelId, params.threadTs, result.text);
    return;
  }

  if (command.type === "retry_action") {
    const action = command.actionId ? getBrowserActionById(command.actionId) : null;
    if (!action) {
      await postThreadReply(params.client, params.channelId, params.threadTs, `No browser action found for id=${command.actionId}.`);
      return;
    }
    if (action.status !== "paused" && action.status !== "failed") {
      await postThreadReply(
        params.client,
        params.channelId,
        params.threadTs,
        `Action #${action.id} is currently ${action.status}; retry is usually used for paused/failed actions.`
      );
      return;
    }
    updateBrowserActionStatus(action.id, "pending", "Slack socket retry request.");
    const session = getBrowserSessionStatus();
    if (session.blocked) {
      const clearResult = await clearBrowserManualAttention(action.id);
      logger.info(`Cleared browser manual attention for action #${action.id}; state=${clearResult.state}.`);
    }
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "retry_requested");
    await postThreadReply(params.client, params.channelId, params.threadTs, `Retry requested for browser action #${action.id}. Run the worker when ready.`);
    return;
  }

  if (command.type === "mark_submitted") {
    if (state.jobId) {
      updateApplicationStatus(state.jobId, "applied", "Marked submitted from Slack socket thread command.");
    }
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "submitted_marked");
    await postThreadReply(params.client, params.channelId, params.threadTs, `Marked ${state.jobId} as submitted in local state.`);
    return;
  }
}

export async function runSlackSocket(): Promise<void> {
  const startupError = getSlackSocketStartupError();
  if (startupError) {
    throw new Error(startupError);
  }

  const app = new App({
    token: SLACK_BOT_TOKEN,
    appToken: SLACK_APP_TOKEN,
    socketMode: true,
  });

  app.error(async (error) => {
    logger.error(`Slack socket error: ${String((error as Error).message || error)}`);
  });

  app.event("message", async ({ event, client }) => {
    const rawEvent = event as {
      channel: string;
      ts: string;
      text?: string;
      thread_ts?: string;
      bot_id?: string;
      subtype?: string;
    };

    if (!rawEvent.text) return;
    if (rawEvent.bot_id || rawEvent.subtype === "bot_message" || rawEvent.subtype === "message_changed") {
      return;
    }

    const channelId = rawEvent.channel;
    if (!isAllowedChannel(channelId)) {
      return;
    }

    const text = rawEvent.text.trim();
    const command = parseSlackThreadCommand(normalizeSlackTextInput(text));
    const threadTs = rawEvent.thread_ts ?? rawEvent.ts;

    if (command.type !== "unknown") {
      await handleThreadCommand({
        channelId,
        threadTs,
        text,
        client,
      });
      return;
    }

    await handleUrlMessage({
      channelId,
      messageTs: rawEvent.ts,
      threadTs,
      text,
      client,
    });
  });

  await app.start();
  logger.info("Slack Socket Mode started.");
  const allowed = SLACK_ALLOWED_CHANNEL_IDS.length ? SLACK_ALLOWED_CHANNEL_IDS.join(", ") : "all configured channels";
  logger.info(`Listening on channel(s): ${allowed}`);
}

if (require.main === module) {
  runSlackSocket().catch((error) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
