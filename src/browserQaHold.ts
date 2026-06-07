import type { ApplicationStatus, BrowserAction } from "./types";

export interface BrowserQaHoldPayload {
  protected?: boolean;
  jobId?: string;
  applyUrl?: string;
  status?: ApplicationStatus;
  state?: string;
  reason?: string;
  doNotReuse?: boolean;
  createdAt?: string;
}

const PROTECTED_QA_STATUSES = new Set<ApplicationStatus>([
  "prepared_for_qa",
  "needs_review",
  "draft_prepared",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isProtectedQaApplicationStatus(status: ApplicationStatus | null): boolean {
  return Boolean(status && PROTECTED_QA_STATUSES.has(status));
}

export function readBrowserQaHoldPayload(action: BrowserAction): BrowserQaHoldPayload | null {
  const qaHold = action.payload.qaHold;
  if (!isRecord(qaHold)) return null;
  return {
    protected: qaHold.protected === true,
    jobId: typeof qaHold.jobId === "string" ? qaHold.jobId : undefined,
    applyUrl: typeof qaHold.applyUrl === "string" ? qaHold.applyUrl : undefined,
    status: typeof qaHold.status === "string" ? qaHold.status as ApplicationStatus : undefined,
    state: typeof qaHold.state === "string" ? qaHold.state : undefined,
    reason: typeof qaHold.reason === "string" ? qaHold.reason : undefined,
    doNotReuse: qaHold.doNotReuse === true || qaHold.do_not_reuse === true,
    createdAt: typeof qaHold.createdAt === "string" ? qaHold.createdAt : undefined,
  };
}

export function isProtectedQaApplyAction(
  action: BrowserAction,
  getApplicationStatus: (jobId: string) => ApplicationStatus | null,
): boolean {
  if (action.actionType !== "prepare_application_review") return false;
  if (action.status !== "completed" && action.status !== "paused") return false;
  const qaHold = readBrowserQaHoldPayload(action);
  if (!qaHold?.protected) return false;
  return isProtectedQaApplicationStatus(getApplicationStatus(action.jobId));
}

export function getProtectedQaApplyUrl(
  action: BrowserAction,
  getApplicationStatus: (jobId: string) => ApplicationStatus | null,
): string | null {
  if (!isProtectedQaApplyAction(action, getApplicationStatus)) return null;
  const qaHold = readBrowserQaHoldPayload(action);
  const applyPlan = action.payload.applyPlan;
  const applyPlanUrl = isRecord(applyPlan) && typeof applyPlan.applyUrl === "string" ? applyPlan.applyUrl : null;
  const payloadUrl = typeof action.payload.url === "string" ? action.payload.url : null;
  return qaHold?.applyUrl ?? applyPlanUrl ?? payloadUrl;
}

export function listProtectedQaApplyUrls(
  actions: BrowserAction[],
  getApplicationStatus: (jobId: string) => ApplicationStatus | null,
): string[] {
  return Array.from(new Set(actions
    .map((action) => getProtectedQaApplyUrl(action, getApplicationStatus))
    .filter((url): url is string => Boolean(url))));
}

export function countProtectedQaApplyActions(
  actions: BrowserAction[],
  getApplicationStatus: (jobId: string) => ApplicationStatus | null,
): number {
  return actions.filter((action) => isProtectedQaApplyAction(action, getApplicationStatus)).length;
}
