import { closeDb } from "./db";
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

function usage(): string {
  return `Usage:\n  npm run slack:conversation -- parse --job-id <id> --text "approve"\n  npm run slack:conversation -- parse "revise job abc123 mention Shopify proof"\n\nLocal parser only: no Slack credentials required and no messages are sent.`;
}

export async function runSlackConversationCli(args = process.argv.slice(2)): Promise<boolean> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return true;
  }

  if (command !== "parse") {
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

  console.log(JSON.stringify(parseSlackConversationIntent(text), null, 2));
  return true;
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
