import { createHash } from "node:crypto";
import {
  getSlackWorkflowState,
  listSlackWorkflowNotifications,
  markSlackWorkflowNotificationStatus,
  markSlackWorkflowPromiseStatus,
  reserveSlackWorkflowNotification,
  upsertSlackWorkflowState,
  type SlackWorkflowNotificationStatus,
} from "./db";
import type {
  SlackWorkflowStateName,
  UnifiedSlackJobContext,
  SlackWorkflowProofPlanSnapshot,
} from "./slackWorkflowContext";
import type { ApplicationDraft, ScoredJob } from "./types";

export type SlackPromiseNotificationType =
  | "capture_draft_proof_plan_ready"
  | "draft_ready"
  | "proof_plan_ready"
  | "capture_blocked"
  | "prep_blocked_missing_draft"
  | "qa_ready"
  | "qa_blocked";

export interface SlackPromiseNotificationPlan {
  notificationType: SlackPromiseNotificationType;
  workflowState: SlackWorkflowStateName;
  stateKey: string;
  text: string;
  promiseStatus: "fulfilled" | "blocked";
  blocker?: string | null;
}

export interface SlackThreadPostTarget {
  channel: string;
  threadTs: string;
  text: string;
}

function cleanLine(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function compactList(items: string[], fallback: string): string {
  const clean = items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!clean.length) return fallback;
  return clean.slice(0, 4).join(", ");
}

function labelFor(input: { job?: Pick<ScoredJob, "title"> | null; fallback?: string | null }): string {
  return cleanLine(input.job?.title) ?? cleanLine(input.fallback) ?? "this application";
}

function humanSafeBlockerReason(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "I hit a blocker before I could continue safely.";
  return cleaned
    .replace(/\bsource_context_unavailable\b/gi, "the page was not readable")
    .replace(/\bno_url\b/gi, "the listing URL was not usable")
    .replace(/\bbrowser_actions?\b/gi, "the browser queue")
    .replace(/\bworkflow_state\b/gi, "workflow state")
    .replace(/\b(?:xox[baprs]-|sk-)[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "[redacted]");
}

function proofLines(proofPlan: SlackWorkflowProofPlanSnapshot | null | undefined, draft?: ApplicationDraft | null): string[] {
  const selectedPortfolio = draft?.selectedPortfolioItems?.map((item) => item.name || item.description || item.id) ?? [];
  return [
    `- Files: ${compactList(proofPlan?.files ?? [], "none planned")}`,
    `- Portfolio: ${compactList([...(proofPlan?.portfolioHighlights ?? []), ...selectedPortfolio], "none planned")}`,
    `- Certificates: ${compactList(proofPlan?.certificates ?? [], "none planned")}`,
    `- Mention-only proof: ${compactList(proofPlan?.mentionOnly ?? [], "none planned")}`,
  ];
}

export function buildDraftProofPlanNotificationText(input: {
  job?: Pick<ScoredJob, "title" | "url"> | null;
  draft: Pick<ApplicationDraft, "proposalText" | "selectedPortfolioItems" | "suggestedBid" | "suggestedConnects" | "suggestedBoostConnects">;
  proofPlan?: SlackWorkflowProofPlanSnapshot | null;
  heading?: string;
}): string {
  const title = labelFor({ job: input.job });
  const proposalText = input.draft.proposalText.trim();
  const connects = [
    input.draft.suggestedConnects ? `${input.draft.suggestedConnects} required` : null,
    input.draft.suggestedBoostConnects ? `${input.draft.suggestedBoostConnects} boost` : null,
  ].filter((item): item is string => Boolean(item)).join(", ") || "not verified yet";
  return [
    input.heading ?? `Draft and proof plan are ready for ${title}.`,
    "",
    proposalText,
    "",
    "Proof plan:",
    ...proofLines(input.proofPlan, input.draft as ApplicationDraft),
    `- Bid: ${input.draft.suggestedBid || "not specified"}`,
    `- Connects: ${connects}`,
    "",
    "Next safe step: say \"prep it\" when you want me to fill the safe fields in Upwork and stop before submit.",
    "Final submit remains manual.",
  ].join("\n");
}

export function buildBlockerNotificationText(input: {
  job?: Pick<ScoredJob, "title"> | null;
  fallbackLabel?: string | null;
  reason: string;
  nextSafeAction: string;
}): string {
  const reason = humanSafeBlockerReason(input.reason);
  return [
    `Quick blocker for ${labelFor({ job: input.job, fallback: input.fallbackLabel })}.`,
    reason,
    `Next safe step: ${input.nextSafeAction.replace(/\s+/g, " ").trim()}`,
    "Final submit remains manual.",
  ].join("\n");
}

export function buildQaReadyNotificationText(input: {
  job?: Pick<ScoredJob, "title"> | null;
  proofPlan?: SlackWorkflowProofPlanSnapshot | null;
  connects?: { required: number | null; boost: number | null; total: number | null } | null;
}): string {
  const connects = input.connects?.total !== null && input.connects?.total !== undefined
    ? `${input.connects.total} total${input.connects.boost ? ` (${input.connects.boost} boost)` : ""}`
    : input.connects?.required !== null && input.connects?.required !== undefined
      ? `${input.connects.required} required`
      : "not verified";
  return [
    `QA is ready for ${labelFor({ job: input.job })}.`,
    "I prepared the safe Upwork fields and stopped before submit.",
    "Proof plan:",
    ...proofLines(input.proofPlan, null),
    `- Connects: ${connects}`,
    "Next safe step: review the held application in QA. Final submit remains manual.",
  ].join("\n");
}

export function slackPromiseStateKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => cleanLine(String(part ?? "")))
    .filter((part): part is string => Boolean(part))
    .join("|")
    .slice(0, 500);
}

export function slackPromiseMessageHash(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}

export async function postSlackPromiseNotification(input: {
  channelId: string;
  threadTs: string;
  plan: SlackPromiseNotificationPlan;
  postThreadMessage: (target: SlackThreadPostTarget) => Promise<boolean>;
}): Promise<{ status: SlackWorkflowNotificationStatus; posted: boolean; duplicate: boolean }> {
  const messageHash = slackPromiseMessageHash(input.plan.text);
  const reservation = reserveSlackWorkflowNotification({
    channelId: input.channelId,
    threadTs: input.threadTs,
    notificationType: input.plan.notificationType,
    stateKey: input.plan.stateKey,
    messageHash,
  });
  const retryingFailedPost = !reservation.reserved && reservation.notification.postStatus === "failed";
  if (!reservation.reserved && !retryingFailedPost) {
    return { status: "skipped", posted: false, duplicate: true };
  }

  let status: SlackWorkflowNotificationStatus = "failed";
  let posted = false;
  try {
    posted = await input.postThreadMessage({
      channel: input.channelId,
      threadTs: input.threadTs,
      text: input.plan.text,
    });
    status = posted ? "posted" : "failed";
    return { status, posted, duplicate: false };
  } finally {
    markSlackWorkflowNotificationStatus({
      channelId: input.channelId,
      threadTs: input.threadTs,
      notificationType: input.plan.notificationType,
      stateKey: input.plan.stateKey,
      postStatus: status,
    });
    if (posted) {
      markSlackWorkflowPromiseStatus({
        channelId: input.channelId,
        threadTs: input.threadTs,
        status: input.plan.promiseStatus,
        workflowState: input.plan.workflowState,
        blocker: input.plan.blocker ?? null,
        lastAgentReply: input.plan.text,
      });
    } else {
      upsertSlackWorkflowState({
        channelId: input.channelId,
        threadTs: input.threadTs,
        workflowState: input.plan.workflowState,
      });
    }
  }
}

export function selectPromiseNotificationForContext(ctx: UnifiedSlackJobContext): SlackPromiseNotificationPlan | null {
  if (ctx.qaState === "waiting") {
    return {
      notificationType: "qa_ready",
      workflowState: "qa_ready",
      stateKey: slackPromiseStateKey(["qa_ready", ctx.normalizedJobId, ctx.applicationStatus, ctx.draft?.proposalVersion, ctx.draft?.generatedAt]),
      text: buildQaReadyNotificationText({ job: ctx.job, proofPlan: ctx.proofPlan, connects: ctx.connects }),
      promiseStatus: "fulfilled",
    };
  }

  if (ctx.captureState === "failed") {
    const reason = ctx.blocker ?? "Capture failed before I could generate the draft safely.";
    return {
      notificationType: "capture_blocked",
      workflowState: "capture_failed",
      stateKey: slackPromiseStateKey(["capture_blocked", ctx.normalizedJobId, ctx.latestBrowserAction?.id, ctx.latestBrowserAction?.status, reason]),
      text: buildBlockerNotificationText({
        job: ctx.job,
        fallbackLabel: ctx.threadState?.upworkUrl ?? ctx.explicitUpworkUrl,
        reason,
        nextSafeAction: ctx.nextSafeAction,
      }),
      promiseStatus: "blocked",
      blocker: reason,
    };
  }

  if (ctx.prepState === "blocked_missing_draft") {
    const reason = ctx.blocker ?? "Safe browser prep is blocked until the proposal draft exists.";
    return {
      notificationType: "prep_blocked_missing_draft",
      workflowState: "prep_blocked_missing_draft",
      stateKey: slackPromiseStateKey(["prep_blocked_missing_draft", ctx.normalizedJobId, ctx.latestAgentPromise?.createdAt, reason]),
      text: buildBlockerNotificationText({
        job: ctx.job,
        fallbackLabel: ctx.threadState?.upworkUrl ?? ctx.explicitUpworkUrl,
        reason,
        nextSafeAction: "I need capture/draft generation first; say \"retry capture\" or send the listing link again.",
      }),
      promiseStatus: "blocked",
      blocker: reason,
    };
  }

  if (ctx.qaState === "blocked" || ctx.prepState === "blocked") {
    const reason = ctx.blocker ?? "Browser prep is blocked and needs review.";
    return {
      notificationType: "qa_blocked",
      workflowState: "qa_blocked",
      stateKey: slackPromiseStateKey(["qa_blocked", ctx.normalizedJobId, ctx.latestBrowserAction?.id, ctx.latestBrowserAction?.status, reason]),
      text: buildBlockerNotificationText({
        job: ctx.job,
        fallbackLabel: ctx.threadState?.upworkUrl ?? ctx.explicitUpworkUrl,
        reason,
        nextSafeAction: ctx.nextSafeAction,
      }),
      promiseStatus: "blocked",
      blocker: reason,
    };
  }

  if (ctx.draftState === "ready" && ctx.draft && ctx.latestAgentPromise?.status === "pending") {
    const type = ctx.proofPlanState === "ready" ? "proof_plan_ready" : "draft_ready";
    return {
      notificationType: type,
      workflowState: type,
      stateKey: slackPromiseStateKey([type, ctx.normalizedJobId, ctx.draft.proposalVersion, ctx.draft.generatedAt]),
      text: buildDraftProofPlanNotificationText({
        job: ctx.job,
        draft: ctx.draft,
        proofPlan: ctx.proofPlan,
        heading: ctx.proofPlanState === "ready"
          ? `Draft and proof plan are ready for ${labelFor({ job: ctx.job })}.`
          : `Draft is ready for ${labelFor({ job: ctx.job })}.`,
      }),
      promiseStatus: "fulfilled",
    };
  }

  return null;
}

export function buildSlackWorkflowDebugTrace(channelId: string, threadTs: string): string {
  const workflow = getSlackWorkflowState(channelId, threadTs);
  const notifications = listSlackWorkflowNotifications(channelId, threadTs, 10);
  return [
    "Promise/state trace:",
    workflow
      ? `- workflow=${workflow.workflowState}; draftRequested=${workflow.draftRequested}; prepRequested=${workflow.prepRequested}; promise=${workflow.latestAgentPromise?.type ?? "none"}/${workflow.latestAgentPromise?.status ?? "none"}`
      : "- workflow=none",
    notifications.length ? "- notifications:" : "- notifications: none",
    ...notifications.map((item) =>
      `  - ${item.notificationType}: ${item.postStatus}; state=${item.stateKey}; hash=${item.messageHash.slice(0, 12)}; at=${item.updatedAt}`
    ),
  ].join("\n");
}
