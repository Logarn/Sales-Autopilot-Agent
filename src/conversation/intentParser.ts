import type { ScoredJob } from "../types";
import type { ConversationState } from "./stateMachine";

export interface ParsedIntent {
  primary: "prep" | "retry" | "show" | "revise" | "skip" | "status" | "answer";
  modifiers: {
    then?: ParsedIntent[];
    condition?: string;
    scope?: "draft" | "browser" | "proof" | "all";
    negation: boolean;
  };
  entities: { jobId?: string; proofName?: string };
  confidence: "high" | "medium" | "low";
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.!?]+$/g, "").trim();
}

function extractJobId(text: string, job: ScoredJob | null): string | undefined {
  const upworkId = text.match(/~([a-z0-9]+)/i)?.[1];
  return upworkId ?? job?.id;
}

function extractProofName(text: string): string | undefined {
  const quoted = text.match(/["“](.+?)["”]/)?.[1]?.trim();
  if (quoted) return quoted;
  const proofMatch = text.match(/\b(?:use|show|swap|replace)\s+(.+?)\s+(?:proof|portfolio|case study|file)\b/i)?.[1]?.trim();
  return proofMatch || undefined;
}

function parseScope(text: string): ParsedIntent["modifiers"]["scope"] {
  if (/\b(?:everything|all safe prep|all)\b/.test(text)) return "all";
  if (/\b(?:browser|chrome|upwork|application page|apply page)\b/.test(text)) return "browser";
  if (/\b(?:proof|portfolio|certificate|file|attachment)\b/.test(text)) return "proof";
  if (/\b(?:draft|cover letter|cv|proposal)\b/.test(text)) return "draft";
  return undefined;
}

function hasNegatedPrep(text: string): boolean {
  return /\b(?:don['’]?t|do not|dont|never|not|stop)\b.*\b(?:prep|prepare|put (?:it|this) in upwork|fill (?:it|this) in upwork|apply|browser|chrome)\b/.test(text) ||
    /\b(?:no|nope)\b.*\b(?:prep|prepare|upwork|browser|chrome)\b/.test(text);
}

function parseOne(rawMessage: string, state: ConversationState, job: ScoredJob | null): ParsedIntent {
  const text = stripTrailingPunctuation(normalize(rawMessage));
  const negation = hasNegatedPrep(text);
  const scope = parseScope(text);
  const entities = {
    jobId: extractJobId(text, job) ?? state.activeJobId ?? undefined,
    proofName: extractProofName(rawMessage),
  };

  if (/\b(?:retry capture|recapture|re-capture|capture again|retry the capture|try again)\b/.test(text)) {
    return { primary: "retry", modifiers: { scope, negation: false }, entities, confidence: "high" };
  }

  if (negation || /\b(?:use this|looks good|put it in upwork|fill it in upwork|prepare it|prep it|prepare application|prepare applications|proceed with applications?)\b/.test(text)) {
    return { primary: "prep", modifiers: { scope: scope ?? "browser", negation }, entities, confidence: "high" };
  }

  if (/\b(?:show|send|post|what(?:'|’)?s|where(?:'|’)?s)\b.*\b(?:draft|cover letter|cv|proposal|proof|portfolio|file|qa queue)\b/.test(text)) {
    return { primary: "show", modifiers: { scope, negation: false }, entities, confidence: "high" };
  }

  if (/\b(?:revise|rewrite|change|edit|adjust|update|make|use|swap|replace)\b/.test(text)) {
    return { primary: "revise", modifiers: { scope, negation: false }, entities, confidence: "medium" };
  }

  if (/^(?:skip|pass|decline|archive|reject)(?:\s+this|\s+it|\s+this one)?$/.test(text)) {
    return { primary: "skip", modifiers: { scope, negation: false }, entities, confidence: "high" };
  }

  if (/^(?:status|where are we|what now|what(?:'|’)?s next|next|what(?:'|’)?s happening|what is happening)$/.test(text)) {
    return { primary: "status", modifiers: { scope, negation: false }, entities, confidence: "high" };
  }

  return { primary: "answer", modifiers: { scope, negation: false }, entities, confidence: "low" };
}

export class IntentParser {
  static parse(message: string, state: ConversationState, job: ScoredJob | null): ParsedIntent {
    const parts = message
      .split(/\bthen\b/i)
      .map((part) => part.trim())
      .filter(Boolean);
    const [first, ...rest] = parts.length > 0 ? parts : [message];
    const intent = parseOne(first ?? message, state, job);
    if (rest.length > 0) {
      intent.modifiers.then = rest.map((part) => parseOne(part, state, job));
    }
    return intent;
  }
}
