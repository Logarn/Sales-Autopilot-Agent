import { APP_NAME, SLACK_CHANNEL_WEBHOOK_URL } from "./config";
import {
  applyApplicationRevision,
  closeDb,
  enqueueBrowserAction,
  getApplicationDraft,
  getScoredJobForSlackPreview,
  recordApplicationRevisionRequest,
  updateApplicationStatus,
} from "./db";
import { OpenAiCompatibleProvider } from "./llm/provider";
import { logger } from "./logger";
import { buildJobBlocks, sendSlackPreviewMessage } from "./slack";
import { SlackConversationIntent, SlackConversationIntentType } from "./types";

const INTENT_ALIASES: Array<{ type: SlackConversationIntentType; patterns: RegExp[] }> = [
  { type: "approve", patterns: [/\b(approve|approved|ok|okay|ship it|looks good|send to apply queue)\b/i] },
  { type: "enqueue_browser_apply", patterns: [/\b(queue|enqueue)\b.*\b(browser|apply|application)\b/i, /\bprepare\b.*\b(apply|application)\b/i] },
  { type: "mark_applied", patterns: [/\bmark\b.*\b(applied|submitted)\b/i, /\b(already|now)\s+(applied|submitted)\b/i] },
  { type: "mark_replied", patterns: [/\bmark\b.*\b(replied|response|responded)\b/i, /\b(client|they)\s+(replied|responded)\b/i] },
  { type: "regenerate", patterns: [/\b(regenerate|rewrite|start over|new draft)\b/i] },
  { type: "revise", patterns: [/\b(revise|revision|change|edit|adjust|update)\b/i] },
  { type: "reject", patterns: [/\b(reject|decline|skip|pass)\b/i] },
];

function stripQuotes(value: string): string {
  return value.replace(/^["'`]+|["'`]+$/g, "").trim();
}

export function extractConversationJobId(text: string): string | null {
  const patterns = [
    /(?:--job-id|job[_\s-]?id|application[_\s-]?id|app[_\s-]?id)[:=\s]+([A-Za-z0-9][A-Za-z0-9._~:-]{1,})/i,
    /\bjob[:#\s]+([A-Za-z0-9][A-Za-z0-9._~:-]{1,})/i,
    /\b(app|application)[:#\s]+([A-Za-z0-9][A-Za-z0-9._~:-]{1,})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[2] ?? match?.[1];
    if (value) return stripQuotes(value.replace(/[),.;]+$/g, ""));
  }

  return null;
}

function detectIntentType(text: string): SlackConversationIntentType {
  for (const alias of INTENT_ALIASES) {
    if (alias.patterns.some((pattern) => pattern.test(text))) return alias.type;
  }
  return "unknown";
}

function extractInstruction(text: string, type: SlackConversationIntentType, jobId: string | null): string | null {
  if (!["revise", "regenerate", "reject", "enqueue_browser_apply"].includes(type)) return null;

  const cleaned = text
    .replace(/(?:--job-id|job[_\s-]?id|application[_\s-]?id|app[_\s-]?id)[:=\s]+[A-Za-z0-9._~:-]+/gi, "")
    .replace(/\bjob[:#\s]+[A-Za-z0-9._~:-]+/gi, "")
    .replace(/\b(app|application)[:#\s]+[A-Za-z0-9._~:-]+/gi, "")
    .trim();

  const revisionMatch = cleaned.match(/(?:revise|revision|change|edit|adjust|update|regenerate|rewrite|reject|decline|skip|pass|queue|enqueue|prepare)(?:\s+(?:draft|proposal|application|browser|apply))?[:\s-]*(.+)$/i);
  const instruction = stripQuotes(revisionMatch?.[1] ?? cleaned);
  if (!instruction || instruction.toLowerCase() === type.replace(/_/g, " ") || instruction === jobId) return null;
  return instruction;
}

export function parseSlackConversationIntent(text: string): SlackConversationIntent {
  const rawText = text.trim();
  const jobId = extractConversationJobId(rawText);
  const type = rawText ? detectIntentType(rawText) : "unknown";
  const instruction = extractInstruction(rawText, type, jobId);
  const confidence = type === "unknown" || !jobId ? "low" : instruction || ["approve", "mark_applied", "mark_replied"].includes(type) ? "high" : "medium";

  return { type, jobId, instruction, confidence, rawText };
}

function readFlagValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const next = args[index + 1];
  return next && !next.startsWith("--") ? next : null;
}

export interface SlackConversationHandleResult {
  ok: boolean;
  message: string;
  intent: SlackConversationIntent;
  slackPreviewSent?: boolean;
  browserActionId?: number;
}

interface RevisedProposalPayload {
  proposalText: string;
}

async function reviseProposalWithLlm(jobId: string, instruction: string): Promise<{ ok: true; proposalText: string } | { ok: false; reason: string }> {
  const draft = getApplicationDraft(jobId);
  if (!draft) return { ok: false, reason: "No stored application draft found." };

  const provider = new OpenAiCompatibleProvider();
  if (!provider.isAvailable()) return { ok: false, reason: "LLM provider is disabled or missing credentials." };

  const response = await provider.completeJson<RevisedProposalPayload>({
    temperature: 0.2,
    maxTokens: 1200,
    messages: [
      {
        role: "system",
        content:
          "You revise Upwork proposal drafts. Preserve truthful claims, human-in-control wording, concise tone, and all facts from the original draft unless the instruction explicitly changes wording. Return JSON only with proposalText.",
      },
      {
        role: "user",
        content: JSON.stringify({ jobId, instruction, currentProposalText: draft.proposalText }),
      },
    ],
  });

  const proposalText = response.data?.proposalText?.trim();
  if (!response.ok || !proposalText) {
    return { ok: false, reason: response.error ?? response.skippedReason ?? "LLM did not return proposalText." };
  }
  return { ok: true, proposalText };
}

async function maybeSendRevisionPreview(jobId: string): Promise<boolean> {
  if (!SLACK_CHANNEL_WEBHOOK_URL.trim()) return false;
  const job = getScoredJobForSlackPreview(jobId);
  if (!job) return false;
  await sendSlackPreviewMessage({
    text: `${APP_NAME}: revised proposal packet ready for review — ${job.title}`,
    blocks: buildJobBlocks(job),
  });
  return true;
}

function shouldEnqueueBrowserApply(intent: SlackConversationIntent): boolean {
  if (intent.type === "enqueue_browser_apply") return true;
  return intent.type === "approve" && /\b(queue|enqueue|browser|apply queue|send to apply queue)\b/i.test(intent.rawText);
}

function enqueueBrowserApply(intent: SlackConversationIntent): number | null {
  if (!intent.jobId) return null;
  const job = getScoredJobForSlackPreview(intent.jobId);
  return enqueueBrowserAction({
    jobId: intent.jobId,
    actionType: "prepare_application_review",
    payload: {
      url: job?.url,
      applicationId: intent.jobId,
      notes: intent.instruction ?? `Slack command: ${intent.type}. Open the draft for human review; do not auto-submit.`,
    },
  });
}

function handleStatusIntent(intent: SlackConversationIntent): SlackConversationHandleResult | null {
  if (!intent.jobId) {
    return { ok: false, message: `Missing job/application ID for ${intent.type} command.`, intent };
  }

  if (intent.type === "approve") {
    const updated = updateApplicationStatus(intent.jobId, "approved", "Approved from Slack conversation command.");
    if (!updated) return { ok: false, message: `No stored application draft found for job_id=${intent.jobId}.`, intent };
    const browserActionId = shouldEnqueueBrowserApply(intent) ? enqueueBrowserApply(intent) ?? undefined : undefined;
    return {
      ok: true,
      message: `Application ${intent.jobId} approved.${browserActionId ? ` Browser review action #${browserActionId} queued.` : ""}`,
      intent,
      browserActionId,
    };
  }

  if (intent.type === "reject") {
    const note = intent.instruction ? `Rejected from Slack conversation command: ${intent.instruction}` : "Rejected from Slack conversation command.";
    const updated = updateApplicationStatus(intent.jobId, "rejected", note);
    return updated
      ? { ok: true, message: `Application ${intent.jobId} rejected.`, intent }
      : { ok: false, message: `No stored application draft found for job_id=${intent.jobId}.`, intent };
  }

  if (intent.type === "mark_applied" || intent.type === "mark_replied") {
    const status = intent.type === "mark_applied" ? "applied" : "replied";
    const updated = updateApplicationStatus(intent.jobId, status, `Marked ${status} from Slack conversation command.`);
    return updated
      ? { ok: true, message: `Application ${intent.jobId} marked ${status}.`, intent }
      : { ok: false, message: `No stored application draft found for job_id=${intent.jobId}.`, intent };
  }

  if (intent.type === "enqueue_browser_apply") {
    const draft = getApplicationDraft(intent.jobId);
    if (!draft) return { ok: false, message: `No stored application draft found for job_id=${intent.jobId}.`, intent };
    const browserActionId = enqueueBrowserApply(intent);
    return {
      ok: true,
      message: `Browser review action #${browserActionId} queued for ${intent.jobId}. Human review required before applying.`,
      intent,
      browserActionId: browserActionId ?? undefined,
    };
  }

  return null;
}

export async function handleSlackConversationCommand(text: string): Promise<SlackConversationHandleResult> {
  const intent = parseSlackConversationIntent(text);
  const statusResult = handleStatusIntent(intent);
  if (statusResult) return statusResult;

  if (intent.type !== "revise" && intent.type !== "regenerate") {
    return { ok: false, message: `Intent ${intent.type} is parsed but not handled yet.`, intent };
  }
  if (!intent.jobId) {
    return { ok: false, message: "Missing job/application ID for revision command.", intent };
  }
  const instruction = intent.instruction ?? (intent.type === "regenerate" ? "Regenerate proposal draft." : null);
  if (!instruction) {
    return { ok: false, message: "Missing revision instruction.", intent };
  }

  const llmRevision = await reviseProposalWithLlm(intent.jobId, instruction);
  if (llmRevision.ok) {
    const applied = applyApplicationRevision(intent.jobId, instruction, llmRevision.proposalText);
    if (!applied) {
      return { ok: false, message: `No stored application draft found for job_id=${intent.jobId}.`, intent };
    }

    let slackPreviewSent = false;
    try {
      slackPreviewSent = await maybeSendRevisionPreview(intent.jobId);
    } catch (error) {
      logger.warn(`Revision applied but Slack preview send failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      ok: true,
      message: `Revision applied for ${intent.jobId} as proposal v${applied.proposalVersion}. Slack preview ${slackPreviewSent ? "sent" : "not sent"}.`,
      intent,
      slackPreviewSent,
    };
  }

  const result = recordApplicationRevisionRequest(
    intent.jobId,
    `${instruction} (pending; ${llmRevision.reason})`
  );
  if (!result) {
    return { ok: false, message: `No stored application draft found for job_id=${intent.jobId}.`, intent };
  }

  return {
    ok: true,
    message: `Revision request stored for ${intent.jobId} as pending proposal guidance. No revised Slack preview was sent because the proposal text was not changed. Instruction: ${instruction}`,
    intent,
    slackPreviewSent: false,
  };
}

function usage(): string {
  return `Usage:\n  npm run slack:conversation -- parse --job-id <id> --text "approve"\n  npm run slack:conversation -- parse "revise job abc123 mention Shopify proof"\n  npm run slack:conversation -- handle --job-id <id> --text "revise opening to mention Shopify proof"\n  npm run slack:conversation -- handle --job-id <id> --text "approve and queue browser apply"\n  npm run slack:conversation -- handle --job-id <id> --text "mark applied"\n\nLocal parsing works without Slack credentials. handle updates local DB state, stores revision requests, and can queue browser review actions. Slack preview resend only runs when SLACK_CHANNEL_WEBHOOK_URL is configured.`;
}

export async function runSlackConversationCli(args = process.argv.slice(2)): Promise<boolean> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return true;
  }

  if (command !== "parse" && command !== "handle") {
    console.error(usage());
    return false;
  }

  const explicitJobId = readFlagValue(rest, "--job-id");
  const textFlag = readFlagValue(rest, "--text");
  const positionalText = rest.filter((item, index) => {
    const previous = rest[index - 1];
    return !item.startsWith("--") && previous !== "--job-id" && previous !== "--text";
  }).join(" ");
  const text = [textFlag ?? positionalText, explicitJobId ? `job ${explicitJobId}` : ""].filter(Boolean).join(" ").trim();

  if (!text) {
    console.error(usage());
    return false;
  }

  if (command === "parse") {
    console.log(JSON.stringify(parseSlackConversationIntent(text), null, 2));
    return true;
  }

  const result = await handleSlackConversationCommand(text);
  console.log(JSON.stringify(result, null, 2));
  return result.ok;
}

if (require.main === module) {
  runSlackConversationCli()
    .then((ok) => {
      if (!ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
