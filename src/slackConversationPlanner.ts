import type { ApplicationDraft, BrowserAction, ScoredJob } from "./types";
import { looksLikeProofPlanRevision } from "./proofPlanOverrides";

export type SlackConversationIntent =
  | "answer_file_capability_question"
  | "show_cover_letter"
  | "show_qa_queue"
  | "prepare_application"
  | "draft_preview_first"
  | "attach_uploaded_files"
  | "retry_after_files"
  | "revise_proof_plan"
  | "revise_draft"
  | "explain_risk"
  | "explain_proof"
  | "explain_boost"
  | "status_summary"
  | "skip_job"
  | "debug_details"
  | "banter_no_action"
  | "unknown_clarify";

export type SlackConversationAction =
  | "queue_prepare_application"
  | "send_draft_preview"
  | "retry_prepare_after_files"
  | "queue_proof_recheck"
  | "show_debug_details"
  | "mark_skip"
  | "none";

export interface SlackConversationPlannerInput {
  latestMessage: string;
  threadHistory: string[];
  job: ScoredJob | null;
  draft: ApplicationDraft | null;
  currentBrowserAction: BrowserAction | null;
  missingFiles: string[];
  proofPlan: {
    files: string[];
    portfolioHighlights: string[];
    certificates: string[];
    mentionOnly: string[];
    unavailableOnPage: boolean;
  };
  connects: {
    required: number | null;
    boost: number | null;
    total: number | null;
    boostReason?: string | null;
  };
  hasSlackFiles: boolean;
}

export interface SlackConversationPlan {
  intent: SlackConversationIntent;
  confidence: "high" | "medium" | "low";
  reply: string;
  actions: SlackConversationAction[];
  clarificationNeeded: boolean;
  debugRequested: boolean;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function fileNames(paths: string[]): string[] {
  return paths.map((item) => item.split(/[\\/]/).pop() ?? item).filter(Boolean);
}

function conciseJobLabel(job: ScoredJob | null): string {
  if (!job) return "this lead";
  return job.title.length > 72 ? `${job.title.slice(0, 69)}...` : job.title;
}

function fileCapabilityReply(input: SlackConversationPlannerInput): string {
  const reusable = fileNames(input.proofPlan.files);
  const missing = fileNames(input.missingFiles);
  const reusableLine = reusable.length > 0
    ? `For this job, I already have these reusable files available: ${reusable.slice(0, 4).join(", ")}.`
    : "For this job, I do not have a reusable file selected yet.";
  const missingLine = missing.length > 0 ? ` I’m currently missing: ${missing.slice(0, 4).join(", ")}.` : "";
  return [
    "Yes. For reusable proof, I can use files already in my proof-assets folder.",
    "For one-off files, attach them in this Slack thread and I can ingest them when Slack files access is enabled.",
    reusableLine + missingLine,
  ].join(" ");
}

function statusReply(input: SlackConversationPlannerInput): string {
  const bits = [
    input.draft?.proposalText ? "draft ready" : "draft not ready",
    input.missingFiles.length > 0 ? `${input.missingFiles.length} file${input.missingFiles.length === 1 ? "" : "s"} missing` : "files ok or not needed",
    input.connects.required === null ? "Connects unknown" : `${input.connects.required} required Connects`,
    input.connects.boost && input.connects.boost > 0 ? `${input.connects.boost} boost` : "no boost set",
  ];
  const next = input.missingFiles.length > 0
    ? "Attach the missing files here and I’ll ingest them."
    : input.draft?.proposalText
      ? "Say “put it in Upwork” when you want me to fill the page."
      : "Send the listing or retry capture so I can generate the draft.";
  return `${conciseJobLabel(input.job)}: ${bits.join("; ")}. ${next}`;
}

function proofReply(input: SlackConversationPlannerInput): string {
  const parts = [
    input.proofPlan.files.length > 0 ? `Files: ${fileNames(input.proofPlan.files).slice(0, 4).join(", ")}` : "Files: none selected yet",
    input.proofPlan.portfolioHighlights.length > 0 ? `Portfolio/profile: ${input.proofPlan.portfolioHighlights.slice(0, 3).join(", ")}` : "Portfolio/profile: none selected yet",
    input.proofPlan.certificates.length > 0 ? `Certificates: ${input.proofPlan.certificates.slice(0, 3).join(", ")}` : "Certificates: none selected yet",
    input.proofPlan.mentionOnly.length > 0 ? `Mention-only: ${input.proofPlan.mentionOnly.slice(0, 3).join(", ")}` : "Mention-only: none",
  ];
  const unavailable = input.proofPlan.unavailableOnPage ? " If Upwork only shows add-portfolio/add-certificate controls, I’ll report proof unavailable instead of claiming it was selected." : "";
  return `${parts.join(". ")}.${unavailable}`;
}

function boostReply(input: SlackConversationPlannerInput): string {
  if (input.connects.required === null) {
    return "Required Connects are still unknown. I won’t set a boost until the apply page exposes the Connects and boost table.";
  }
  if (!input.connects.boost || input.connects.boost <= 0) {
    return input.connects.boostReason || "No boost is set. I only boost high-fit jobs when the visible table shows a safe top-4 bid under 50 Connects.";
  }
  return `Boost is planned at ${input.connects.boost} Connects. I will never set optional boost above 50, and final submit remains manual.`;
}

function coverLetterReply(input: SlackConversationPlannerInput): string {
  const draft = input.draft?.proposalText?.trim();
  if (!draft) {
    return "I haven’t generated the cover letter yet. I can draft it here first, then wait for your approval before filling Upwork.";
  }
  const verificationLine = input.currentBrowserAction?.status === "paused" || input.currentBrowserAction?.status === "failed"
    ? "I have not verified it on the Upwork page yet because the browser prep is paused."
    : input.currentBrowserAction?.status === "completed"
      ? "The last remote Chrome prep completed, but final submit is still manual."
      : "I have not filled Upwork unless you explicitly told me to put it in the remote Chrome page.";
  return [
    "Here’s the cover letter I drafted.",
    verificationLine,
    "",
    draft,
    "",
    "Want me to revise it before filling or retrying remote Chrome?",
  ].join("\n");
}

export function planSlackConversation(input: SlackConversationPlannerInput): SlackConversationPlan {
  const text = normalize(input.latestMessage);
  const debugRequested = /\b(debug|technical details|raw status|full details|dump)\b/.test(text);

  if (debugRequested) {
    return {
      intent: "debug_details",
      confidence: "high",
      reply: "I’ll show the technical details for this thread.",
      actions: ["show_debug_details"],
      clarificationNeeded: false,
      debugRequested: true,
    };
  }

  if (input.hasSlackFiles) {
    return {
      intent: "attach_uploaded_files",
      confidence: "high",
      reply: "I’ll ingest the attached files for this application.",
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/\b(can|could|are you able to|would you be able to)\b.*\b(upload|attach|use)\b.*\b(file|files|pdf|pdfs|asset|assets)\b/.test(text) ||
    /\b(upload|attach)\b.*\bfrom here\b/.test(text)) {
    return {
      intent: "answer_file_capability_question",
      confidence: "high",
      reply: fileCapabilityReply(input),
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/\b(show|send|post|what'?s|where'?s)\b.*\bcover\s*letter\b/.test(text) ||
    /\b(show|send|post)\b.*\bdraft\b.*\b(used|wrote|filled)\b/.test(text) ||
    /\bcover\s*letter\b.*\b(used|drafted|wrote|show|send|post)\b/.test(text)) {
    return {
      intent: "show_cover_letter",
      confidence: "high",
      reply: coverLetterReply(input),
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/\b(what[’']?s ready|show qa queue|qa queue|what is blocked|what[’']?s blocked)\b/.test(text)) {
    return {
      intent: "show_qa_queue",
      confidence: "high",
      reply: "I’ll show the current QA queue.",
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (looksLikeProofPlanRevision(input.latestMessage)) {
    return {
      intent: "revise_proof_plan",
      confidence: "high",
      reply: "Got it - I’ll update the proof plan and recheck the remote Chrome draft.",
      actions: ["queue_proof_recheck"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/\b(show|send|post)\b.*\bdraft\b.*\b(here|first|before filling|before fill|slack)\b/.test(text) ||
    /\bdraft\b.*\bhere first\b/.test(text) ||
    /\blet me see\b.*\bdraft\b/.test(text)) {
    return {
      intent: "draft_preview_first",
      confidence: "high",
      reply: "I’ll show the draft here first and won’t fill Upwork yet.",
      actions: ["send_draft_preview"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/\b(everything that needs to be done|do everything|all safe prep|handle everything)\b/.test(text)) {
    return {
      intent: "prepare_application",
      confidence: "high",
      reply: "Got it — I’ll do all safe prep steps: draft, files, portfolio, Connects, and boost. I’ll still stop before submit.",
      actions: ["queue_prepare_application"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/\b(use this|looks good|put it in upwork|fill it in upwork|prepare it|prep it|prepare application)\b/.test(text)) {
    return {
      intent: "prepare_application",
      confidence: "high",
      reply: "I’ll fill the safe fields in remote Chrome and stop before submit.",
      actions: ["queue_prepare_application"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/\b(retry after files|retry.*files|try again.*files)\b/.test(text)) {
    return {
      intent: "retry_after_files",
      confidence: "high",
      reply: "I’ll retry application prep using the ingested files.",
      actions: ["retry_prepare_after_files"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/\b(why|risk|red flags?|concern)\b/.test(text)) {
    const risk = input.job?.scoreBreakdown.risks.slice(0, 2).join("; ") || input.draft?.redFlags.slice(0, 2).join("; ") || "No major risk is recorded yet.";
    return {
      intent: "explain_risk",
      confidence: "medium",
      reply: `Main risk: ${risk}`,
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/\b(proof|portfolio|certificate|file|attachment)\b/.test(text)) {
    return {
      intent: "explain_proof",
      confidence: "medium",
      reply: proofReply(input),
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/\b(boost|bid|connects)\b/.test(text)) {
    return {
      intent: "explain_boost",
      confidence: "medium",
      reply: boostReply(input),
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/^(status|where are we|what now|what's next|next)$/i.test(input.latestMessage.trim())) {
    return {
      intent: "status_summary",
      confidence: "high",
      reply: statusReply(input),
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/\b(skip|pass|decline)\b/.test(text)) {
    return {
      intent: "skip_job",
      confidence: "high",
      reply: "Got it. I’ll mark this one skipped.",
      actions: ["mark_skip"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  if (/^(thanks|thank you|nice|cool|ok|okay|got it|👍)$/i.test(input.latestMessage.trim())) {
    return {
      intent: "banter_no_action",
      confidence: "medium",
      reply: "Got it.",
      actions: ["none"],
      clarificationNeeded: false,
      debugRequested: false,
    };
  }

  return {
    intent: "unknown_clarify",
    confidence: "low",
    reply: "I’m not sure which part you want changed. Tell me the specific draft, proof, file, boost, or QA update and I’ll apply it.",
    actions: ["none"],
    clarificationNeeded: true,
    debugRequested: false,
  };
}
