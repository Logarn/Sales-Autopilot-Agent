import { APP_NAME, LLM_API_KEY, LLM_NORMALIZATION_ENABLED, SLACK_CHANNEL_WEBHOOK_URL } from "./config";
import { closeDb, getScoredJobForSlackPreview, recordApplicationRevisionRequest } from "./db";
import { logger } from "./logger";
import { buildJobBlocks, sendSlackPreviewMessage } from "./slack";
import { SlackConversationIntent, SlackConversationIntentType } from "./types";

const INTENT_ALIASES: Array<{ type: SlackConversationIntentType; patterns: RegExp[] }> = [
  { type: "enqueue_browser_apply", patterns: [/\b(queue|enqueue)\b.*\b(browser|apply|application)\b/i, /\bprepare\b.*\b(apply|application)\b/i] },
  { type: "mark_applied", patterns: [/\bmark\b.*\b(applied|submitted)\b/i, /\b(already|now)\s+(applied|submitted)\b/i] },
  { type: "mark_replied", patterns: [/\bmark\b.*\b(replied|response|responded)\b/i, /\b(client|they)\s+(replied|responded)\b/i] },
  { type: "regenerate", patterns: [/\b(regenerate|rewrite|start over|new draft)\b/i] },
  { type: "revise", patterns: [/\b(revise|revision|change|edit|adjust|update)\b/i] },
  { type: "reject", patterns: [/\b(reject|decline|skip|pass)\b/i] },
  { type: "approve", patterns: [/\b(approve|approved|ok|okay|ship it|looks good|send to apply queue)\b/i] },
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

export async function handleSlackConversationCommand(text: string): Promise<SlackConversationHandleResult> {
  const intent = parseSlackConversationIntent(text);
  if (intent.type !== "revise" && intent.type !== "regenerate") {
    return { ok: false, message: `Intent ${intent.type} is parsed but not handled by the revision flow yet.`, intent };
  }
  if (!intent.jobId) {
    return { ok: false, message: "Missing job/application ID for revision command.", intent };
  }
  const instruction = intent.instruction ?? (intent.type === "regenerate" ? "Regenerate proposal draft." : null);
  if (!instruction) {
    return { ok: false, message: "Missing revision instruction.", intent };
  }

  const llmAvailable = LLM_NORMALIZATION_ENABLED && Boolean(LLM_API_KEY.trim());
  const result = recordApplicationRevisionRequest(
    intent.jobId,
    llmAvailable
      ? `${instruction} (LLM rewrite hook available; deterministic local path stored request for audit.)`
      : `${instruction} (stored for manual/LLM revision; no local LLM rewrite configured.)`
  );
  if (!result) {
    return { ok: false, message: `No stored application draft found for job_id=${intent.jobId}.`, intent };
  }

  let slackPreviewSent = false;
  try {
    slackPreviewSent = await maybeSendRevisionPreview(intent.jobId);
  } catch (error) {
    logger.warn(`Revision saved but Slack preview send failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    ok: true,
    message: `Revision request stored for ${intent.jobId} as proposal v${result.proposalVersion}. Slack preview ${slackPreviewSent ? "sent" : "not sent"}.`,
    intent,
    slackPreviewSent,
  };
}

function usage(): string {
  return `Usage:\n  npm run slack:conversation -- parse --job-id <id> --text "approve"\n  npm run slack:conversation -- parse "revise job abc123 mention Shopify proof"\n  npm run slack:conversation -- handle --job-id <id> --text "revise opening to mention Shopify proof"\n\nLocal parsing works without Slack credentials. handle stores revision requests in the local DB; Slack preview resend only runs when SLACK_CHANNEL_WEBHOOK_URL is configured.`;
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
