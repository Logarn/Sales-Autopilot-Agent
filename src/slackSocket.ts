import { App } from "@slack/bolt";
import { clearBrowserManualAttention, getBrowserSessionStatus } from "./browserSession";
import {
  applyApplicationRevision,
  enqueueBrowserActionDeduped,
  getApplicationDraft,
  getApplicationStatus,
  getBrowserActionById,
  getScoredJobForSlackPreview,
  getSlackThreadStateByThreadTs,
  listBrowserActions,
  updateApplicationStatus,
  updateSlackThreadStateStatus,
  upsertSlackThreadState,
  recordApplicationRevisionRequest,
  updateBrowserActionStatus,
} from "./db";
import {
  buildCaptureActionPayload,
  canonicalizeUpworkJobUrl,
  deriveCaptureThreadJobId,
  extractUpworkJobIdFromUrl,
  isSupportedUpworkJobUrl,
} from "./browserCapture";
import {
  SLACK_APP_TOKEN,
  SLACK_BOT_TOKEN,
  SLACK_SOCKET_MODE_ENABLED,
  SLACK_ALLOWED_CHANNEL_IDS,
} from "./config";
import { logger } from "./logger";
import { buildProposalContextPack } from "./skills/profileContextSkill";
import { formatConnectsStrategy } from "./connectsStrategy";
import { classifySlackThreadWithLlm, type SlackThreadBrainProvider, type SlackThreadBrainDecision } from "./slackThreadBrain";

const THREAD_MENTIONS = "<@U0A2X5BCNKC> <@U0AHJFYV42K>";

export type SlackSocketParsedCommandType =
  | "status"
  | "approve"
  | "reject"
  | "revise"
  | "approve_prepare"
  | "prepare_draft"
  | "retry_action"
  | "mark_submitted"
  | "clarify"
  | "ignore"
  | "unknown";

export interface ParsedSlackSocketCommand {
  type: SlackSocketParsedCommandType;
  rawText: string;
  instruction?: string;
  actionId?: number;
  confidence?: "high" | "medium" | "low";
  replyText?: string;
  source?: "llm" | "fallback";
}

export interface ParsedUpworkUrl {
  originalUrl: string;
  normalizedUrl: string;
  canonicalJobUrl: string;
  jobId: string | null;
}

function normalizeSlackTextInput(value: string): string {
  return value
    .replace(/<@[A-Za-z0-9_]+(?:\|[^>]+)?>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSlackMention(value: string): boolean {
  return /<@[A-Za-z0-9_]+(?:\|[^>]+)?>/.test(value);
}

function matchesApprovePrepareIntent(value: string, mentioned: boolean): boolean {
  const text = value.toLowerCase();
  return (
    /\b(?:yeah|yes|yep|yup|sure|ok|okay|looks good)\b.*\b(?:prep|prepare|draft|drafts|apply|write|proceed|move forward)\b/.test(text) ||
    /\b(?:prep|prepare)\s+(?:it|this|draft|drafts|the\s+(?:draft|application|proposal))\b/.test(text) ||
    /\b(?:please\s+)?proceed(?:\s+with)?(?:\s+the)?\s+(?:draft|application|proposal|prep)\b/.test(text) ||
    /\b(?:go ahead|move forward|do it)\b(?:\s+and\s+\b(?:prep|prepare|draft|apply|write)\b.*)?$/.test(text) ||
    /\b(?:write\s+(?:it|the\s+draft)|apply)\b$/.test(text) ||
    (mentioned && /\b(?:prep|prepare|draft|drafts|apply|write|listing|link)\b/.test(text))
  );
}

export function shouldAskClarifyingThreadQuestion(text: string): boolean {
  const normalized = normalizeSlackTextInput(text).toLowerCase();
  return hasSlackMention(text) ||
    /\b(?:prep|prepare|draft|apply|listing|link|connects|rate|proof|file|red flags?|risk|why|status|next|should|can you|please)\b/.test(normalized);
}

function parseUrlSafely(value: string): ParsedUpworkUrl | null {
  const trimmed = value
    .trim()
    .replace(/^</, "")
    .replace(/>$/, "")
    .replace(/^\((https?:\/\/[^)]+)\)$/, "$1");
  const withNoLabel = trimmed.split("|")[0].trim();

  if (!isSupportedUpworkJobUrl(withNoLabel)) {
    return null;
  }

  const canonicalJobUrl = canonicalizeUpworkJobUrl(withNoLabel);
  const jobId = extractUpworkJobIdFromUrl(withNoLabel);
  if (!canonicalJobUrl || !jobId) {
    return null;
  }

  return {
    originalUrl: withNoLabel,
    normalizedUrl: canonicalJobUrl,
    canonicalJobUrl,
    jobId,
  };
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
      originalUrl: parsed.originalUrl.replace(/[\n\r\t]+/g, ""),
      normalizedUrl: parsed.normalizedUrl.replace(/[\n\r\t]+/g, ""),
      canonicalJobUrl: parsed.canonicalJobUrl.replace(/[\n\r\t]+/g, ""),
    };
  }
  return null;
}

export function parseSlackThreadCommand(text: string): ParsedSlackSocketCommand {
  const mentioned = hasSlackMention(text);
  const normalized = normalizeSlackTextInput(text).trim();
  const commandText = normalized.replace(/[.!?]+$/g, "").trim();
  const statusMatch = /^(status)$/i.test(normalized) ||
    /\b(details|show details|show proof|show draft|why\b|why did you pick|why pick|what are the red flags|red flags|risks|what still needs manual review|what needs manual review|what is missing|what still needs|manual review)\b/i.test(normalized);
  if (statusMatch) return { type: "status", rawText: normalized };

  if (/^(approve)$/i.test(commandText)) return { type: "approve", rawText: normalized };
  if (/^(reject|skip|skip this one|pass|decline)$/i.test(commandText)) return { type: "reject", rawText: normalized };

  const reviseMatch = normalized.match(/^revise\s*:\s*(.+)$/i) ??
    normalized.match(/^(make|use|lower|raise|remove|rewrite|change|edit|adjust|update)\b\s*(.+)$/i);
  if (reviseMatch) {
    return {
      type: "revise",
      rawText: normalized,
      instruction: (reviseMatch[2] ?? reviseMatch[1])?.trim() || "",
    };
  }

  if (
    /^(prepare\s+draft|prepare\s+application|prepare\s+proposal)$/i.test(commandText)
  ) {
    return { type: "prepare_draft", rawText: normalized };
  }

  if (matchesApprovePrepareIntent(commandText, mentioned) || matchesApprovePrepareIntent(normalized, mentioned)) {
    return { type: "approve_prepare", rawText: normalized, source: "fallback" };
  }

  const retryMatch = commandText.match(/^retry(?:\s+(?:preparation|prep))?(?:\s+(\d+))?$/i);
  if (retryMatch) {
    return {
      type: "retry_action",
      rawText: normalized,
      actionId: retryMatch[1] ? Number.parseInt(retryMatch[1], 10) : undefined,
    };
  }

  if (/^mark\s+submitted$/i.test(commandText)) return { type: "mark_submitted", rawText: normalized };

  return { type: "unknown", rawText: normalized };
}

function commandFromBrainDecision(text: string, decision: SlackThreadBrainDecision): ParsedSlackSocketCommand {
  const type = decision.intent === "approve_prepare" ? "approve_prepare" : decision.intent;
  return {
    type,
    rawText: normalizeSlackTextInput(text),
    instruction: decision.instruction ?? undefined,
    actionId: decision.actionId ?? undefined,
    confidence: decision.confidence,
    replyText: decision.replyText ?? undefined,
    source: "llm",
  };
}

async function resolveSlackThreadCommand(input: {
  channelId: string;
  threadTs: string;
  text: string;
  state: ReturnType<typeof getSlackThreadStateByThreadTs>;
  provider?: SlackThreadBrainProvider;
}): Promise<ParsedSlackSocketCommand> {
  const llm = await classifySlackThreadWithLlm({
    text: input.text,
    botMentioned: hasSlackMention(input.text),
    threadMapped: Boolean(input.state),
    jobId: input.state?.jobId ?? null,
    upworkUrl: input.state?.upworkUrl ?? null,
    threadStatus: input.state?.status ?? null,
  }, input.provider);

  if (llm.ok && llm.decision.intent !== "ignore" && llm.decision.confidence !== "low") {
    return commandFromBrainDecision(input.text, llm.decision);
  }
  if (llm.ok && llm.decision.intent === "ignore") {
    return commandFromBrainDecision(input.text, llm.decision);
  }

  const fallback = parseSlackThreadCommand(input.text);
  return { ...fallback, source: "fallback" };
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

function cleanRevisionInstruction(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildDeterministicProposalRevision(currentText: string, instruction: string): string {
  const current = currentText.trim();
  const cleanInstruction = cleanRevisionInstruction(instruction);
  if (!cleanInstruction) return current;

  const paragraphs = current.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const nextParagraphs = paragraphs.length > 0 ? [...paragraphs] : [current];
  let changed = false;

  if (/(opener|opening|first line|first sentence|lead\b)/i.test(cleanInstruction) && /(direct|clear|short|tight|strong)/i.test(cleanInstruction)) {
    nextParagraphs[0] = "I can help tighten this by focusing first on the highest-leverage retention work, then turning it into clear Klaviyo/SMS execution.";
    changed = true;
  }

  const addMatch = cleanInstruction.match(/\b(?:add|include|mention)\s+(.+)$/i);
  if (addMatch?.[1]) {
    nextParagraphs.push(`I would also address ${addMatch[1].replace(/[.]+$/g, "").trim()}.`);
    changed = true;
  }

  if (!changed) {
    nextParagraphs.push(`Revision guidance applied: ${cleanInstruction}.`);
  }

  return nextParagraphs.join("\n\n");
}

function describeQueuedBrowserDraft(jobId: string): string {
  const activeDraftActions = listBrowserActions(null, 1000)
    .filter((action) =>
      action.jobId === jobId &&
      action.actionType === "prepare_application_review" &&
      !["cancelled", "failed"].includes(action.status)
    );

  if (activeDraftActions.length === 0) {
    return "Browser draft status: no browser draft has been queued yet.";
  }

  const latest = activeDraftActions[activeDraftActions.length - 1];
  return `Browser draft needs update: yes - browser action #${latest.id} is ${latest.status}. Re-run prepare draft after reviewing this revision.`;
}

function buildThreadStatusDetails(state: NonNullable<ReturnType<typeof getSlackThreadStateByThreadTs>>): string[] {
  if (!state.jobId) return [];
  const job = getScoredJobForSlackPreview(state.jobId);
  const draft = getApplicationDraft(state.jobId);
  const profileContext = job ? buildProposalContextPack(job) : null;
  const latestActions = listBrowserActions(null, 1000)
    .filter((action) => action.jobId === state.jobId)
    .slice(-3)
    .map((action) => `#${action.id} ${action.actionType} ${action.status}${action.lastError ? ` (${action.lastError})` : ""}`);
  const strategy = draft?.connectsStrategy ?? job?.scoreBreakdown.connectsStrategy;
  return [
    job ? `Fit: ${job.score}/100 (${job.matchLevel})` : null,
    job?.scoreBreakdown.reasons.length ? `Why picked: ${job.scoreBreakdown.reasons.slice(0, 5).join("; ")}` : null,
    job?.scoreBreakdown.risks.length ? `Red flags/risks: ${job.scoreBreakdown.risks.slice(0, 5).join("; ")}` : "Red flags/risks: none recorded",
    strategy ? `Connects: ${formatConnectsStrategy(strategy)}` : "Connects: not calculated",
    draft ? `Draft: ${draft.status}, v${(draft as { proposalVersion?: number }).proposalVersion ?? "stored"}, ${draft.proposalText.length} chars` : "Draft: missing",
    draft?.proposalText ? `Draft preview: ${draft.proposalText.replace(/\s+/g, " ").trim().slice(0, 900)}` : null,
    profileContext?.selectedAttachments.length ? `Proof selected: ${profileContext.selectedAttachments.join(", ")}` : null,
    profileContext?.selectedProofPoints.length ? `Proof points: ${profileContext.selectedProofPoints.slice(0, 5).join("; ")}` : null,
    draft?.selectedPortfolioItems.length ? `Selected portfolio: ${draft.selectedPortfolioItems.map((item) => item.name).join(", ")}` : "Selected portfolio: none",
    latestActions.length ? `Browser actions: ${latestActions.join(" | ")}` : "Browser actions: none",
  ].filter((line): line is string => Boolean(line));
}

export function applySlackThreadRevision(input: {
  channelId: string;
  threadTs: string;
  instruction: string;
}): { ok: boolean; text: string; proposalVersion?: number } {
  const state = getSlackThreadStateByThreadTs(input.channelId, input.threadTs);
  if (!state?.jobId) {
    return { ok: false, text: "I cannot revise a draft without a tracked job id for this thread." };
  }

  const instruction = cleanRevisionInstruction(input.instruction);
  if (!instruction) {
    return { ok: false, text: `I cannot revise ${state.jobId} without a revision instruction.` };
  }

  const draft = getApplicationDraft(state.jobId);
  if (!draft?.proposalText.trim()) {
    recordApplicationRevisionRequest(state.jobId, instruction);
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "revise_requested");
    return {
      ok: false,
      text: `Revision request recorded for ${state.jobId}: ${instruction} (no stored proposal draft was found to update).`,
    };
  }

  const revisedText = buildDeterministicProposalRevision(draft.proposalText, instruction);
  const revision = applyApplicationRevision(state.jobId, instruction, revisedText);
  updateSlackThreadStateStatus(state.channelId, state.threadTs, "revise_requested");

  if (!revision) {
    return { ok: false, text: `I could not apply the revision for ${state.jobId}; no stored draft row was updated.` };
  }

  return {
    ok: true,
    proposalVersion: revision.proposalVersion,
    text: [
      `Revision applied to stored proposal draft for ${state.jobId}.`,
      `Stored proposal version: v${revision.proposalVersion}`,
      `Instruction: ${instruction}`,
      describeQueuedBrowserDraft(state.jobId),
      "Final submit remains manual.",
    ].join("\n"),
  };
}

export function buildPrepareDraftQueueReply(input: {
  jobId: string;
  threadTitle: string;
  upworkUrl: string;
  actionId: number;
  duplicate: boolean;
  duplicateStatus?: string | null;
  ackText?: string | null;
  queueStatus?: string | null;
}): string {
  const ack = input.ackText?.trim() || "Got it — I’ll prep this now and come back here when it’s ready for QA.";
  return [
    input.duplicate
      ? "Already on it — I already have this queued and I’ll come back here when it’s ready for QA."
      : ack,
    input.queueStatus,
    "I’ll fill what’s safe on Upwork and stop before submit.",
    `Listing: ${input.upworkUrl}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function browserQueueStatusForAction(actionId: number): string | null {
  const active = listBrowserActions(null, 1000)
    .filter((action) =>
      ["pending", "in_progress"].includes(action.status) &&
      ["capture_job_from_url", "prepare_application_review", "open_job", "open_apply_page"].includes(action.actionType)
    );
  const index = active.findIndex((action) => action.id === actionId);
  if (index < 0) return null;
  const action = active[index]!;
  const prefix = action.status === "in_progress" ? "Browser status" : "Browser queue";
  return `${prefix}: ${index + 1} of ${active.length} active Upwork action${active.length === 1 ? "" : "s"} (${action.status}).`;
}

export function queuePrepareDraftFromSlackThread(input: { channelId: string; threadTs: string; ackText?: string | null }): { ok: boolean; text: string; actionId?: number } {
  const state = getSlackThreadStateByThreadTs(input.channelId, input.threadTs);
  if (!state?.jobId) {
    return { ok: false, text: "I cannot queue a browser draft without a tracked job id for this thread." };
  }

  const draft = getApplicationDraft(state.jobId);
  const scoredJob = getScoredJobForSlackPreview(state.jobId);
  if (!draft || !scoredJob || !draft.proposalText.trim()) {
    return { ok: false, text: "Quick blocker: I don’t have the generated draft for this lead yet, so I can’t prep the Upwork page. Send the listing link again or retry once capture finishes." };
  }
  const browserSession = getBrowserSessionStatus();
  if (browserSession.blocked) {
    return { ok: false, text: "Quick blocker: Upwork is asking for a human check, so I paused. Clear the browser and I’ll retry." };
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
      notes: "Slack socket: prepare request from tracked thread. Prepare browser review only; do not submit.",
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
      ackText: input.ackText,
      queueStatus: browserQueueStatusForAction(action.id),
    }),
  };
}

async function postThreadReply(client: App["client"], channel: string, threadTs: string, text: string): Promise<void> {
  await client.chat.postMessage({ channel, thread_ts: threadTs, text });
}

export function queueCaptureFromSlackUrl(input: {
  channelId: string;
  messageTs: string;
  threadTs: string;
  text: string;
}): { parsed: ParsedUpworkUrl; state: ReturnType<typeof upsertSlackThreadState>; action: ReturnType<typeof enqueueBrowserActionDeduped> } | null {
  const upworkUrl = parseUpworkJobUrlFromText(input.text);
  if (!upworkUrl) {
    return null;
  }

  const state = upsertSlackThreadState({
    channelId: input.channelId,
    messageTs: input.messageTs,
    threadTs: input.threadTs,
    upworkUrl: upworkUrl.canonicalJobUrl,
    jobId: upworkUrl.jobId,
    status: "capture_pending",
  });

  const jobIdForAction = deriveCaptureThreadJobId(upworkUrl.canonicalJobUrl, upworkUrl.jobId);
  const action = enqueueBrowserActionDeduped({
    jobId: jobIdForAction,
    actionType: "capture_job_from_url",
    payload: {
      ...buildCaptureActionPayload(
        upworkUrl.canonicalJobUrl,
        input.channelId,
        input.messageTs,
        input.threadTs,
        { originalUrl: upworkUrl.originalUrl, canonicalJobUrl: upworkUrl.canonicalJobUrl },
      ),
      sourceQuery: "slack_url",
      notes: "Slack socket URL posted; browser capture required before scoring and draft prep.",
    },
  });

  return { parsed: upworkUrl, state, action };
}

async function handleUrlMessage(params: {
  channelId: string;
  messageTs: string;
  text: string;
  threadTs: string;
  client: App["client"];
}): Promise<void> {
  const queued = queueCaptureFromSlackUrl(params);
  if (!queued) {
    return;
  }

  const { parsed: upworkUrl, state, action } = queued;

  const details = [
    `✅ Captured Upwork URL for tracking.`,
    `• Thread: ${state.threadTs}`,
    `• Message: ${state.messageTs}`,
    `• Job ID: ${state.jobId ?? "unknown"}`,
    `• Canonical URL: ${upworkUrl.canonicalJobUrl}`,
    `• Original URL: ${upworkUrl.originalUrl}`,
    `• Status: ${statusLabel(state.status)}`,
    action.duplicate
      ? `• Browser capture action already queued as #${action.id} for this posting.`
      : `• Browser capture action queued as #${action.id}.`,
    `
${availableCommandsText()}`,
  ].join("\n");

  await postThreadReply(params.client, params.channelId, params.threadTs, details);
}

export interface SlackSocketTextEvent {
  channel: string;
  ts: string;
  text?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
}

export async function handleSlackSocketTextEvent(rawEvent: SlackSocketTextEvent, client: App["client"]): Promise<void> {
  if (!rawEvent.text) return;
  if (rawEvent.bot_id || rawEvent.subtype === "bot_message" || rawEvent.subtype === "message_changed") {
    return;
  }

  const channelId = rawEvent.channel;
  if (!isAllowedChannel(channelId)) {
    return;
  }

  const text = rawEvent.text.trim();
  const threadTs = rawEvent.thread_ts ?? rawEvent.ts;
  const mappedThread = getSlackThreadStateByThreadTs(channelId, threadTs);
  const upworkUrl = parseUpworkJobUrlFromText(text);
  const botMentioned = hasSlackMention(text);

  if (upworkUrl && (botMentioned || mappedThread)) {
    await handleUrlMessage({
      channelId,
      messageTs: rawEvent.ts,
      threadTs,
      text,
      client,
    });
    return;
  }

  if (mappedThread || botMentioned) {
    await handleThreadCommand({
      channelId,
      threadTs,
      text,
      client,
    });
  }
}

export async function handleThreadCommand(params: {
  channelId: string;
  threadTs: string;
  text: string;
  client: App["client"];
  intentProvider?: SlackThreadBrainProvider;
}): Promise<void> {
  const state = getSlackThreadStateByThreadTs(params.channelId, params.threadTs);
  const command = await resolveSlackThreadCommand({
    channelId: params.channelId,
    threadTs: params.threadTs,
    text: params.text,
    state,
    provider: params.intentProvider,
  });

  if (command.type === "ignore") {
    return;
  }

  if (command.type === "clarify") {
    if (state) {
      await postThreadReply(
        params.client,
        params.channelId,
        params.threadTs,
        command.replyText ?? "I’m not totally sure what you want me to do. Want me to prep it, revise the draft, skip it, or show details?",
      );
    }
    return;
  }

  if (command.type === "unknown") {
    if (state && shouldAskClarifyingThreadQuestion(params.text)) {
      await postThreadReply(
        params.client,
        params.channelId,
        params.threadTs,
        "I’m not totally sure what you want me to do. Want me to prep it, revise the draft, skip it, or show details?",
      );
    }
    return;
  }

  if (!state) {
    await postThreadReply(
      params.client,
      params.channelId,
      params.threadTs,
      "I heard you, but I can’t find the job tied to this thread. Send the Upwork listing link here and I’ll pick it up."
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
      ...buildThreadStatusDetails(state),
    ].join("\n");
    await postThreadReply(params.client, params.channelId, params.threadTs, statusText);
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "status_checked");
    return;
  }

  if (!state.jobId && ["approve", "reject", "revise", "approve_prepare", "prepare_draft", "mark_submitted", "retry_action"].includes(command.type)) {
    const response = `This thread tracks ${state.upworkUrl} but no job id was parsed. ${
      command.type === "approve_prepare" || command.type === "prepare_draft" ? "I can’t prep it until I have the job id. Send the Upwork listing link here and I’ll pick it up." : "Please share a supported Upwork job URL first."
    }`;
    await postThreadReply(params.client, params.channelId, params.threadTs, response);
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "error");
    return;
  }

  if (command.type === "approve") {
    if (state.jobId && maybeJobStatus) {
      updateApplicationStatus(state.jobId, "approved", "Approved from Slack socket thread command.");
    }
    updateSlackThreadStateStatus(state.channelId, state.threadTs, "approve_requested");
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
    const result = applySlackThreadRevision({
      channelId: params.channelId,
      threadTs: params.threadTs,
      instruction: command.instruction ?? "",
    });
    if (!result.ok) {
      updateSlackThreadStateStatus(state.channelId, state.threadTs, "error");
    }
    await postThreadReply(params.client, params.channelId, params.threadTs, result.text);
    return;
  }

  if (command.type === "approve_prepare" || command.type === "prepare_draft") {
    const result = queuePrepareDraftFromSlackThread({ channelId: params.channelId, threadTs: params.threadTs, ackText: command.replyText });
    if (!result.ok) {
      updateSlackThreadStateStatus(state.channelId, state.threadTs, "error");
    }
    await postThreadReply(params.client, params.channelId, params.threadTs, result.text);
    return;
  }

  if (command.type === "retry_action") {
    const action = command.actionId
      ? getBrowserActionById(command.actionId)
      : state.jobId
        ? listBrowserActions(null, 1000)
          .filter((candidate) => {
            const payload = candidate.payload as { channelId?: string; threadTs?: string; applicationId?: string };
            const matchesThread = payload.channelId === state.channelId && payload.threadTs === state.threadTs;
            const matchesJob = candidate.jobId === state.jobId || payload.applicationId === state.jobId;
            return (matchesJob || matchesThread) &&
              ["capture_job_from_url", "prepare_application_review"].includes(candidate.actionType) &&
              ["paused", "failed"].includes(candidate.status);
          })
          .slice(-1)[0] ?? null
        : null;
    if (!action) {
      await postThreadReply(params.client, params.channelId, params.threadTs, command.actionId ? `No browser action found for id=${command.actionId}.` : "No paused or failed browser action found for this thread.");
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
    await handleSlackSocketTextEvent(event as SlackSocketTextEvent, client);
  });

  app.event("app_mention", async ({ event, client }) => {
    await handleSlackSocketTextEvent(event as SlackSocketTextEvent, client);
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
