import * as fs from "node:fs";
import * as path from "node:path";
import {
  AUTO_PREPARE_DRAFT_ENABLED,
  AUTO_PREPARE_MAX_CONNECTS,
  AUTO_PREPARE_MIN_SCORE,
  AUTO_PREPARE_REQUIRE_BROWSER_HEALTHY,
  BROWSER_ACTION_LIMIT,
  BROWSER_ARTIFACT_DIR,
  BROWSER_CDP_URL,
  BROWSER_CHROME_EXECUTABLE_PATH,
  BROWSER_DRY_RUN,
  BROWSER_HEADLESS,
  BROWSER_LIVE_ACTION_LIMIT,
  BROWSER_SESSION_MODE,
  BROWSER_USER_DATA_DIR,
  BROWSER_WORKER_ENABLED,
} from "./config";
import { buildBrowserApplyPlan } from "./browserApply";
import {
  closeDb,
  enqueueBrowserActionDeduped,
  getBrowserActionById,
  getSlackThreadStateByThreadTs,
  incrementBrowserActionAttempts,
  listBrowserActions,
  markJobSeen,
  updateBrowserActionStatus,
  updateSlackThreadStateStatus,
} from "./db";
import { buildApplicationDraft } from "./agent";
import { buildDeterministicOpportunityPacket, normalizedPacketToJobPosting } from "./normalization";
import { scoreJob } from "./filter";
import { buildQuestionAnswers, isSafeUpworkJobUrl, parseCaptureQuestions } from "./browserCapture";
import { logger } from "./logger";
import {
  BrowserAction,
  BrowserApplyFillPlan,
  BrowserApplyValidationIssue,
  ScoredJob,
} from "./types";
import { buildV3CapturePacket, SlackPacketV3Context } from "./slackPacketV3";
import { postSlackThreadMessage } from "./slackThread";
import {
  BrowserSessionStatus,
  formatBrowserSessionStatus,
  getBrowserSessionStatus,
  recordBrowserManualAttention,
} from "./browserSession";
import {
  acquireBrowserSession,
  BrowserSessionMode,
  classifyBrowserSessionError,
  findChromeExecutable,
  PlaywrightChromiumLike,
  checkCdpEndpoint,
} from "./browserSessionControl";

type DetectedBrowserState =
  | "dry_run"
  | "browser_unavailable"
  | "browser_profile_in_use"
  | "cdp_unavailable"
  | "login_required"
  | "two_factor_required"
  | "captcha_or_security_challenge"
  | "job_page_loaded"
  | "apply_page_loaded"
  | "page_loaded"
  | "field_preparation_incomplete"
  | "submit_guard_failed"
  | "no_url"
  | "captured";

interface SlackThreadContext {
  channelId: string;
  messageTs: string;
  threadTs: string;
}

interface AutoPrepareDraftOptions {
  enabled?: boolean;
  minScore?: number;
  maxConnects?: number;
  requireBrowserHealthy?: boolean;
  sessionStatus?: BrowserSessionStatus;
}

export type AutoPrepareDraftDecisionCategory =
  | "eligible_auto_prepare"
  | "skipped_manual_override_available"
  | "blocked_no_manual_override"
  | "duplicate_existing_action";

export interface AutoPrepareDraftDecision {
  shouldQueue: boolean;
  category: AutoPrepareDraftDecisionCategory;
  reason: string;
  note: string;
  actionId?: number;
  duplicate?: boolean;
  duplicateStatus?: string | null;
}

interface BrowserWorkerOptions {
  dryRun: boolean;
  headless: boolean;
  sessionMode: BrowserSessionMode;
  cdpUrl: string;
  userDataDir: string;
  chromeExecutablePath: string | null;
  artifactDir: string | null;
  limit: number;
  liveActionLimit: number;
}

interface PageSnapshot {
  url: string;
  title: string;
  textExcerpt: string;
}

interface PlaywrightLocatorLike {
  count(): Promise<number>;
  first(): PlaywrightLocatorLike;
  textContent(options?: { timeout?: number }): Promise<string | null>;
  fill(value: string, options?: { timeout?: number }): Promise<unknown>;
  setInputFiles(files: string[], options?: { timeout?: number }): Promise<unknown>;
  check(options?: { timeout?: number }): Promise<unknown>;
}

interface PlaywrightPageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  locator(selector: string): PlaywrightLocatorLike;
}

interface ApplyPreparationDiagnostics {
  actionId: number;
  jobId: string;
  jobTitle: string | null;
  actionType: string;
  sourceUrl: string | null;
  applyUrl: string | null;
  intendedAction: string;
  state: DetectedBrowserState | "validation_failed" | "prepared";
  stopBeforeSubmit: boolean;
  validationIssues: Array<Pick<BrowserApplyValidationIssue, "severity" | "code" | "message">>;
  coverLetterPresent: boolean;
  coverLetterLength: number;
  screeningAnswersCount: number;
  rate: string | null;
  requiredConnects: number | null;
  boostConnects: number | null;
  totalConnects: number | null;
  selectedAttachments: string[];
  manualReviewAssets: string[];
  mentionOnlyProof: string[];
  figmaRecommendations: string[];
  videoRecommendations: string[];
  manualReviewWarnings: string[];
  skippedAttachments: Array<{ name: string; reason: string }>;
  selectedHighlights: string[];
  warnings: string[];
  attemptedFields: string[];
  skippedFields: string[];
  manualFields: string[];
}


function loadOptions(): BrowserWorkerOptions {
  return {
    dryRun: BROWSER_DRY_RUN,
    headless: BROWSER_HEADLESS,
    sessionMode: BROWSER_SESSION_MODE,
    cdpUrl: BROWSER_CDP_URL,
    userDataDir: path.resolve(process.cwd(), BROWSER_USER_DATA_DIR),
    chromeExecutablePath: BROWSER_CHROME_EXECUTABLE_PATH ? path.resolve(process.cwd(), BROWSER_CHROME_EXECUTABLE_PATH) : findChromeExecutable(),
    artifactDir: BROWSER_ARTIFACT_DIR ? path.resolve(process.cwd(), BROWSER_ARTIFACT_DIR) : null,
    limit: BROWSER_ACTION_LIMIT,
    liveActionLimit: BROWSER_LIVE_ACTION_LIMIT,
  };
}

function getActionUrl(action: BrowserAction): string | null {
  const payloadUrl = typeof action.payload.url === "string" ? action.payload.url : null;
  if (payloadUrl) return payloadUrl;
  if (action.actionType === "prepare_application_review") {
    const plan = action.payload.applyPlan as BrowserApplyFillPlan | undefined;
    return typeof plan?.applyUrl === "string" ? plan.applyUrl : null;
  }
  if (action.actionType === "open_job") return `https://www.upwork.com/jobs/${action.jobId}`;
  if (action.actionType === "open_apply_page") return `https://www.upwork.com/ab/proposals/job/${action.jobId}/apply/`;
  if (action.actionType === "capture_job_from_url") return `https://www.upwork.com/jobs/${action.jobId}`;
  return null;
}

function getSlackThreadContextFromPayload(action: BrowserAction): SlackThreadContext | null {
  const payload = action.payload as {
    channelId?: string;
    threadTs?: string;
    messageTs?: string;
  };
  if (!payload.channelId || !payload.threadTs || !payload.messageTs) {
    return null;
  }
  return {
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    messageTs: payload.messageTs,
  };
}

function detectState(snapshot: PageSnapshot, action: BrowserAction): DetectedBrowserState {
  if (!snapshot.url) return "no_url";
  const haystack = `${snapshot.url}\n${snapshot.title}\n${snapshot.textExcerpt}`.toLowerCase();
  if (haystack.includes("two-factor") || haystack.includes("two factor") || haystack.includes("verification code")) {
    return "two_factor_required";
  }
  if (
    haystack.includes("captcha") ||
    haystack.includes("cloudflare") ||
    haystack.includes("__cf_chl") ||
    haystack.includes("challenge - upwork") ||
    haystack.includes("security check") ||
    haystack.includes("verify you are human") ||
    haystack.includes("checking if the site connection is secure")
  ) {
    return "captcha_or_security_challenge";
  }
  if (haystack.includes("log in") || haystack.includes("login") || haystack.includes("sign in")) {
    return "login_required";
  }
  if (
    action.actionType === "capture_job_from_url" &&
    (isSafeUpworkJobUrl(snapshot.url) || snapshot.url.includes("/ab/proposals/job/") || snapshot.url.includes("/jobs/") )
  ) {
    return "captured";
  }
  if (action.actionType === "open_apply_page" || snapshot.url.includes("/apply")) {
    return "apply_page_loaded";
  }
  if (action.actionType === "open_job" || snapshot.url.includes("/jobs/")) {
    return "job_page_loaded";
  }
  return "page_loaded";
}

function artifactSafeName(action: BrowserAction, suffix: string): string {
  return `browser-action-${action.id}-${action.actionType}-${suffix}`.replace(/[^a-z0-9._-]/gi, "_");
}

function saveTextArtifact(options: BrowserWorkerOptions, action: BrowserAction, name: string, content: string): void {
  if (!options.artifactDir) return;
  fs.mkdirSync(options.artifactDir, { recursive: true });
  fs.writeFileSync(path.join(options.artifactDir, artifactSafeName(action, name)), content);
}

function minimizedIssues(issues: BrowserApplyValidationIssue[]): Array<Pick<BrowserApplyValidationIssue, "severity" | "code" | "message">> {
  return issues.map(({ severity, code, message }) => ({ severity, code, message }));
}

function buildWarnings(plan: BrowserApplyFillPlan | null, issues: BrowserApplyValidationIssue[]): string[] {
  const warnings = issues.map((item) => `[${item.severity}] ${item.code}: ${item.message}`);
  if (plan) {
    warnings.push(...plan.connects.notes);
    warnings.push(...plan.skippedAttachments.map((attachment) => `${attachment.name}: ${attachment.reason}`));
    warnings.push(...plan.manualReviewWarnings);
  }
  return Array.from(new Set(warnings));
}

function buildApplyDiagnostics(
  action: BrowserAction,
  plan: BrowserApplyFillPlan | null,
  issues: BrowserApplyValidationIssue[],
  state: ApplyPreparationDiagnostics["state"],
  fields: Partial<Pick<ApplyPreparationDiagnostics, "attemptedFields" | "skippedFields" | "manualFields">> = {}
): ApplyPreparationDiagnostics {
  return {
    actionId: action.id,
    jobId: action.jobId,
    actionType: action.actionType,
    jobTitle: plan?.jobTitle ?? null,
    sourceUrl: plan?.sourceUrl ?? null,
    applyUrl: plan?.applyUrl ?? null,
    intendedAction: action.actionType === "prepare_application_review" ? "Open Upwork apply page, prepare fields for human review, and stop before submit." : action.actionType,
    state,
    stopBeforeSubmit: plan?.stopBeforeSubmit ?? true,
    validationIssues: minimizedIssues(issues),
    coverLetterPresent: Boolean(plan?.coverLetter.trim()),
    coverLetterLength: plan?.coverLetter.length ?? 0,
    screeningAnswersCount: plan?.screeningAnswers.length ?? 0,
    rate: plan?.rate ?? null,
    requiredConnects: plan?.connects.required ?? null,
    boostConnects: plan?.connects.boost ?? null,
    totalConnects: plan?.connects.total ?? null,
    selectedAttachments: plan?.attachments.map((attachment) => attachment.name) ?? [],
    manualReviewAssets: plan?.manualReviewAssets ?? [],
    mentionOnlyProof: plan?.mentionOnlyProof ?? [],
    figmaRecommendations: plan?.figmaRecommendations ?? [],
    videoRecommendations: plan?.videoRecommendations ?? [],
    manualReviewWarnings: plan?.manualReviewWarnings ?? [],
    skippedAttachments: plan?.skippedAttachments.map(({ name, reason }) => ({ name, reason })) ?? [],
    selectedHighlights: plan?.highlights ?? [],
    warnings: buildWarnings(plan, issues),
    attemptedFields: fields.attemptedFields ?? [],
    skippedFields: fields.skippedFields ?? [],
    manualFields: fields.manualFields ?? [],
  };
}

function saveApplyDiagnostics(
  options: BrowserWorkerOptions,
  action: BrowserAction,
  diagnostics: ApplyPreparationDiagnostics
): void {
  saveTextArtifact(options, action, "apply-diagnostics.json", JSON.stringify(diagnostics, null, 2));
}

function formatApplyDiagnostics(diagnostics: ApplyPreparationDiagnostics): string {
  return [
    `Browser apply preparation plan #${diagnostics.actionId}`,
    `  job_id: ${diagnostics.jobId}`,
    `  job_title: ${diagnostics.jobTitle ?? "n/a"}`,
    `  source_url: ${diagnostics.sourceUrl ?? "n/a"}`,
    `  apply_url: ${diagnostics.applyUrl ?? "n/a"}`,
    `  intended_action: ${diagnostics.intendedAction}`,
    `  cover_letter: present=${diagnostics.coverLetterPresent} length=${diagnostics.coverLetterLength}`,
    `  screening_answers_count: ${diagnostics.screeningAnswersCount}`,
    `  rate_bid_amount: ${diagnostics.rate ?? "n/a"}`,
    `  connects: required=${diagnostics.requiredConnects ?? "n/a"} boost=${diagnostics.boostConnects ?? "n/a"} total=${diagnostics.totalConnects ?? "n/a"}`,
    `  auto_attach_assets: ${diagnostics.selectedAttachments.length > 0 ? diagnostics.selectedAttachments.join(", ") : "none"}`,
    `  manual_review_assets: ${diagnostics.manualReviewAssets.length > 0 ? diagnostics.manualReviewAssets.join("; ") : "none"}`,
    `  mention_only_proof: ${diagnostics.mentionOnlyProof.length > 0 ? diagnostics.mentionOnlyProof.join("; ") : "none"}`,
    `  figma_recommendations: ${diagnostics.figmaRecommendations.length > 0 ? diagnostics.figmaRecommendations.join("; ") : "none"}`,
    `  video_recommendations: ${diagnostics.videoRecommendations.length > 0 ? diagnostics.videoRecommendations.join("; ") : "none"}`,
    `  skipped_attachments: ${diagnostics.skippedAttachments.length > 0 ? diagnostics.skippedAttachments.map((item) => `${item.name} (${item.reason})`).join("; ") : "none"}`,
    `  manual_review_warnings: ${diagnostics.manualReviewWarnings.length > 0 ? diagnostics.manualReviewWarnings.join("; ") : "none"}`,
    `  selected_highlights: ${diagnostics.selectedHighlights.length > 0 ? diagnostics.selectedHighlights.join("; ") : "none"}`,
    `  stop_before_submit: ${diagnostics.stopBeforeSubmit}`,
    `  final_submit_blocked: true`,
    `  warnings: ${diagnostics.warnings.length > 0 ? diagnostics.warnings.join("; ") : "none"}`,
  ].join("\n");
}

function boundedExcerpt(value: string, maxLength = 2000): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeCaptureQuestions(rawText: string): string[] {
  return parseCaptureQuestions(rawText).slice(0, 6);
}

async function postV3CapturePacketToThread(
  job: ScoredJob,
  thread: SlackThreadContext,
  context: SlackPacketV3Context,
): Promise<void> {
  const packet = buildV3CapturePacket(job, context);
  await postSlackThreadMessage({
    channel: thread.channelId,
    threadTs: thread.threadTs,
    text: packet.text,
    blocks: packet.blocks,
  });
}

function buildPrepareDraftStatusMessage(input: {
  heading: string;
  diagnostics: ApplyPreparationDiagnostics;
  nextCommand?: string;
}): string {
  const { diagnostics } = input;
  return [
    input.heading,
    `Job: ${diagnostics.jobTitle ?? diagnostics.jobId}`,
    `Job ID: ${diagnostics.jobId}`,
    `Apply URL: ${diagnostics.applyUrl ?? diagnostics.sourceUrl ?? "n/a"}`,
    `Cover letter: present=${diagnostics.coverLetterPresent} length=${diagnostics.coverLetterLength}`,
    `Screening answers: ${diagnostics.screeningAnswersCount}`,
    `Rate/bid: ${diagnostics.rate ?? "n/a"}`,
    `Connects: required=${diagnostics.requiredConnects ?? "n/a"} boost=${diagnostics.boostConnects ?? "n/a"} total=${diagnostics.totalConnects ?? "n/a"}`,
    `Auto-attach assets: ${diagnostics.selectedAttachments.length > 0 ? diagnostics.selectedAttachments.join(", ") : "none"}`,
    `Manual-review assets: ${diagnostics.manualReviewAssets.length > 0 ? diagnostics.manualReviewAssets.join("; ") : "none"}`,
    `Mention-only proof: ${diagnostics.mentionOnlyProof.length > 0 ? diagnostics.mentionOnlyProof.join("; ") : "none"}`,
    `Warnings: ${diagnostics.warnings.length > 0 ? diagnostics.warnings.join("; ") : "none"}`,
    `Stop before submit: ${diagnostics.stopBeforeSubmit}`,
    "Final submit was not clicked.",
    input.nextCommand ? `Next command: ${input.nextCommand}` : "Next commands: retry <action-id> | status | mark submitted",
  ].join("\n");
}

async function postPrepareDraftStatusToThread(
  thread: SlackThreadContext | null,
  input: { heading: string; diagnostics: ApplyPreparationDiagnostics; nextCommand?: string },
): Promise<void> {
  if (!thread) return;
  await postSlackThreadMessage({
    channel: thread.channelId,
    threadTs: thread.threadTs,
    text: buildPrepareDraftStatusMessage(input),
  });
}

function hasHardRedFlags(job: ScoredJob): boolean {
  const redFlagTerms = ["scam", "commission only", "full-time", "full time", "on-site", "onsite", "w2", "verification", "blocked"];
  const signals = [
    ...(job.scoreBreakdown?.risks ?? []),
    ...(job.applicationDraft?.redFlags ?? []),
  ].map((item) => item.toLowerCase());
  return (job.scoreBreakdown?.redFlagScore?.score ?? 100) < 40 || signals.some((item) => redFlagTerms.some((term) => item.includes(term)));
}

export function decideAutoPrepareDraft(
  job: ScoredJob,
  options: AutoPrepareDraftOptions = {},
): AutoPrepareDraftDecision {
  const enabled = options.enabled ?? AUTO_PREPARE_DRAFT_ENABLED;
  const minScore = options.minScore ?? AUTO_PREPARE_MIN_SCORE;
  const maxConnects = options.maxConnects ?? AUTO_PREPARE_MAX_CONNECTS;
  const requireBrowserHealthy = options.requireBrowserHealthy ?? AUTO_PREPARE_REQUIRE_BROWSER_HEALTHY;
  const session = options.sessionStatus ?? getBrowserSessionStatus();
  const draft = job.applicationDraft;
  const totalConnects = (draft?.suggestedConnects ?? job.connectsCost ?? 0) + (draft?.suggestedBoostConnects ?? 0);

  if (!enabled) {
    return {
      shouldQueue: false,
      category: "skipped_manual_override_available",
      reason: "auto-prepare disabled",
      note: "Not auto-preparing because: auto-prepare is disabled. You can still reply `prepare draft` if you want me to stage it.",
    };
  }
  if (!draft?.proposalText?.trim()) {
    return {
      shouldQueue: false,
      category: "blocked_no_manual_override",
      reason: "draft missing",
      note: "Not auto-preparing because no stored proposal draft exists yet. Revise/regenerate the proposal first.",
    };
  }
  if (job.score < minScore) {
    return {
      shouldQueue: false,
      category: "skipped_manual_override_available",
      reason: "score too low",
      note: "Not auto-preparing because: score is below the auto-prepare threshold. You can still reply `prepare draft` if you want me to stage it.",
    };
  }
  if (totalConnects > maxConnects) {
    return {
      shouldQueue: false,
      category: "skipped_manual_override_available",
      reason: "Connects too high",
      note: "Not auto-preparing because: total Connects exceeds the auto-prepare threshold. Reply `prepare draft` if you want to manually approve staging this one.",
    };
  }
  if (requireBrowserHealthy && session.blocked) {
    return {
      shouldQueue: false,
      category: "blocked_no_manual_override",
      reason: "browser needs attention",
      note: "Not auto-preparing because Upwork needs manual browser attention. Resolve the browser issue first, then use `retry <action-id>` or `status`. I did not submit anything.",
    };
  }
  if (hasHardRedFlags(job)) {
    return {
      shouldQueue: false,
      category: "blocked_no_manual_override",
      reason: "red flag",
      note: "Not auto-preparing because a hard red flag was detected. Review the job first before staging any browser draft.",
    };
  }

  return {
    shouldQueue: true,
    category: "eligible_auto_prepare",
    reason: "eligible",
    note: "Strong fit. I’m preparing the Upwork draft now. Final submit remains manual.",
  };
}

function queuePrepareDraftActionForThread(
  job: ScoredJob,
  thread: SlackThreadContext,
): AutoPrepareDraftDecision {
  const action = enqueueBrowserActionDeduped({
    jobId: job.id,
    actionType: "prepare_application_review",
    payload: {
      url: job.url,
      channelId: thread.channelId,
      threadTs: thread.threadTs,
      messageTs: thread.messageTs,
      applicationId: job.id,
      notes: "Auto-prepare browser draft from browser capture worker. Prepare review only; do not submit.",
    },
  });
  const duplicateAction = action.duplicate ? getBrowserActionById(action.id) : null;
  return {
    shouldQueue: !action.duplicate,
    category: action.duplicate ? "duplicate_existing_action" : "eligible_auto_prepare",
    reason: action.duplicate ? "duplicate prepare action exists" : "eligible",
    note: action.duplicate
      ? `Draft preparation is already queued/paused as browser action #${action.id}${duplicateAction?.status ? ` (${duplicateAction.status})` : ""}. No duplicate was created.`
      : `Strong fit. I’m preparing the Upwork draft now. Final submit remains manual. Browser action #${action.id}.`,
    actionId: action.id,
    duplicate: action.duplicate,
    duplicateStatus: duplicateAction?.status ?? null,
  };
}

export function autoPrepareDraftForThread(
  job: ScoredJob,
  thread: SlackThreadContext,
  options: AutoPrepareDraftOptions = {},
): AutoPrepareDraftDecision {
  const decision = decideAutoPrepareDraft(job, options);
  if (!decision.shouldQueue) {
    return decision;
  }
  return queuePrepareDraftActionForThread(job, thread);
}

async function loadChromium(): Promise<PlaywrightChromiumLike | null> {
  try {
    const mod = (await import("playwright")) as { chromium?: PlaywrightChromiumLike };
    return mod.chromium ?? null;
  } catch {
    return null;
  }
}

async function getReadiness(options: BrowserWorkerOptions): Promise<{
  playwrightAvailable: boolean;
  chromeExecutableFound: boolean;
  chromeExecutablePath: string | null;
  sessionMode: BrowserSessionMode;
  cdpUrl: string;
  cdpReachable: boolean;
  userDataDir: string;
  dryRun: boolean;
  workerEnabled: boolean;
  submitGuardEnabled: true;
  liveActionLimit: number;
}> {
  const cdpCheck = options.sessionMode === "cdp" ? await checkCdpEndpoint(options.cdpUrl) : null;
  return {
    playwrightAvailable: Boolean(await loadChromium()),
    chromeExecutableFound: Boolean(options.chromeExecutablePath),
    chromeExecutablePath: options.chromeExecutablePath,
    sessionMode: options.sessionMode,
    cdpUrl: options.cdpUrl,
    cdpReachable: cdpCheck?.reachable ?? false,
    userDataDir: options.userDataDir,
    dryRun: options.dryRun,
    workerEnabled: BROWSER_WORKER_ENABLED,
    submitGuardEnabled: true,
    liveActionLimit: options.liveActionLimit,
  };
}

async function logReadiness(options: BrowserWorkerOptions): Promise<void> {
  const readiness = await getReadiness(options);
  logger.info(
    `Browser readiness: playwrightAvailable=${readiness.playwrightAvailable} chromeExecutableFound=${readiness.chromeExecutableFound} ` +
      `chromeExecutablePath=${readiness.chromeExecutablePath ?? "n/a"} sessionMode=${readiness.sessionMode} ` +
      `cdpUrl=${readiness.cdpUrl} cdpReachable=${readiness.cdpReachable} userDataDir=${readiness.userDataDir} ` +
      `dryRun=${readiness.dryRun} workerEnabled=${readiness.workerEnabled} submitGuardEnabled=${readiness.submitGuardEnabled} ` +
      `liveActionLimit=${readiness.liveActionLimit} ${formatBrowserSessionStatus()}`
  );
}

async function tryFillFirst(page: PlaywrightPageLike, selectors: string[], value: string): Promise<boolean> {
  if (!value.trim()) return false;
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0) {
        await locator.fill(value, { timeout: 1500 });
        return true;
      }
    } catch {
      // Try the next conservative selector.
    }
  }
  return false;
}

async function trySetFiles(page: PlaywrightPageLike, selectors: string[], files: string[]): Promise<boolean> {
  if (files.length === 0) return false;
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0) {
        await locator.setInputFiles(files, { timeout: 1500 });
        return true;
      }
    } catch {
      // Try the next conservative selector.
    }
  }
  return false;
}

async function tryCheckHighlight(page: PlaywrightPageLike, highlight: string): Promise<boolean> {
  const escaped = highlight.replace(/["\\]/g, "\\$&");
  const selectors = [`label:has-text("${escaped}") input[type='checkbox']`, `text="${escaped}"`];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0) {
        await locator.check({ timeout: 1500 });
        return true;
      }
    } catch {
      // Try the next conservative selector.
    }
  }
  return false;
}

function assertSubmitGuard(plan: BrowserApplyFillPlan | null): asserts plan is BrowserApplyFillPlan {
  if (!plan || plan.stopBeforeSubmit !== true) {
    throw new Error("Submit guard failed: stopBeforeSubmit must be true for browser apply preparation.");
  }
}

function getRequiredSkippedFields(fields: Pick<ApplyPreparationDiagnostics, "skippedFields">): string[] {
  return fields.skippedFields.filter((field) => ["coverLetter", "rate", "connectsBoost"].includes(field));
}

async function fillApplyFields(page: PlaywrightPageLike, plan: BrowserApplyFillPlan): Promise<Pick<ApplyPreparationDiagnostics, "attemptedFields" | "skippedFields" | "manualFields">> {
  assertSubmitGuard(plan);
  logger.info(`Submit guard before fill: stopBeforeSubmit=${plan.stopBeforeSubmit}; final submit will not be clicked.`);
  const attemptedFields: string[] = [];
  const skippedFields: string[] = [];
  const manualFields: string[] = [];

  if (await tryFillFirst(page, ["textarea[name*='cover']", "textarea[aria-label*='Cover']", "textarea"], plan.coverLetter)) {
    attemptedFields.push("coverLetter");
  } else {
    skippedFields.push("coverLetter");
  }

  if (await tryFillFirst(page, ["input[name*='rate']", "input[aria-label*='rate' i]", "input[placeholder*='$']"], plan.rate)) {
    attemptedFields.push("rate");
  } else {
    skippedFields.push("rate");
  }

  if (await tryFillFirst(page, ["input[name*='boost']", "input[aria-label*='boost' i]", "input[name*='connect']"], String(plan.connects.boost))) {
    attemptedFields.push("connectsBoost");
  } else {
    skippedFields.push("connectsBoost");
  }

  const attachmentFiles = plan.attachments.map((attachment) => path.resolve(process.cwd(), attachment.filePath));
  if (await trySetFiles(page, ["input[type='file']"], attachmentFiles)) {
    attemptedFields.push("attachments");
  } else if (attachmentFiles.length > 0) {
    manualFields.push("attachments");
  }

  let checkedHighlights = 0;
  for (const highlight of plan.highlights) {
    if (await tryCheckHighlight(page, highlight)) checkedHighlights += 1;
  }
  if (checkedHighlights > 0) {
    attemptedFields.push("highlights");
  } else if (plan.highlights.length > 0) {
    manualFields.push("highlights");
  }

  manualFields.push("finalSubmit");
  logger.info(`Submit guard after fill: stopBeforeSubmit=${plan.stopBeforeSubmit}; final submit remains manual.`);
  return { attemptedFields, skippedFields, manualFields };
}

async function inspectWithBrowser(
  action: BrowserAction,
  options: BrowserWorkerOptions,
  url: string,
  plan?: BrowserApplyFillPlan
): Promise<{
  state: DetectedBrowserState;
  snapshot?: PageSnapshot;
  fields: Pick<ApplyPreparationDiagnostics, "attemptedFields" | "skippedFields" | "manualFields">;
  bodyText: string;
}> {
  const chromium = await loadChromium();
  if (!chromium) {
    saveTextArtifact(
      options,
      action,
      "browser-unavailable.json",
      JSON.stringify({ actionId: action.id, jobId: action.jobId, actionType: action.actionType, url }, null, 2)
    );
    return {
      state: "browser_unavailable",
      fields: { attemptedFields: [], skippedFields: [], manualFields: [] },
      bodyText: "",
    };
  }

  let sessionHandle: Awaited<ReturnType<typeof acquireBrowserSession>> | null = null;
  try {
    try {
      sessionHandle = await acquireBrowserSession(chromium, {
        mode: options.sessionMode,
        userDataDir: options.userDataDir,
        chromeExecutablePath: options.chromeExecutablePath,
        cdpUrl: options.cdpUrl,
        headless: options.headless,
      });
    } catch (error) {
      const classified = classifyBrowserSessionError(error);
      const message = error instanceof Error ? error.message : String(error);
      if (classified === "browser_profile_in_use") {
        saveTextArtifact(options, action, "browser-profile-in-use.json", JSON.stringify({ actionId: action.id, jobId: action.jobId, actionType: action.actionType, url, message }, null, 2));
        return {
          state: "browser_profile_in_use",
          fields: { attemptedFields: [], skippedFields: [], manualFields: [] },
          bodyText: "",
        };
      }
      if (classified === "cdp_unavailable" || options.sessionMode === "cdp") {
        saveTextArtifact(options, action, "cdp-unavailable.json", JSON.stringify({ actionId: action.id, jobId: action.jobId, actionType: action.actionType, url, message, cdpUrl: options.cdpUrl }, null, 2));
        return {
          state: "cdp_unavailable",
          fields: { attemptedFields: [], skippedFields: [], manualFields: [] },
          bodyText: "",
        };
      }
      throw error;
    }
    const page = await sessionHandle.context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    const bodyText = (await page.locator("body").first().textContent({ timeout: 5000 })) ?? "";
    const snapshot: PageSnapshot = {
      url: page.url(),
      title: await page.title(),
      textExcerpt: boundedExcerpt(bodyText),
    };
    let state = detectState(snapshot, action);
    const fields =
      plan && state === "apply_page_loaded"
        ? await fillApplyFields(page, plan)
        : { attemptedFields: [], skippedFields: [], manualFields: [] };
    if (plan && state === "apply_page_loaded" && getRequiredSkippedFields(fields).length > 0) {
      state = "field_preparation_incomplete";
    }
    saveTextArtifact(
      options,
      action,
      "snapshot.json",
      JSON.stringify(
        {
          state,
          url: snapshot.url,
          title: snapshot.title,
          textLength: bodyText.length,
          artifactPolicy: "minimized-no-html-no-screenshot",
        },
        null,
        2
      )
    );
    return { state, snapshot, fields, bodyText };
  } finally {
    await sessionHandle?.close();
  }
}

function extractProofRecommendations(draft?: { selectedPortfolioItems?: { name: string; result?: string }[] } | null): string[] {
  if (!draft?.selectedPortfolioItems || draft.selectedPortfolioItems.length === 0) {
    return [];
  }
  return draft.selectedPortfolioItems
    .slice(0, 5)
    .map((item) => `${item.name}: ${item.result ? item.result : "good portfolio match"}`);
}

function terminalStatusForState(state: DetectedBrowserState): "completed" | "paused" {
  if (["login_required", "two_factor_required", "captcha_or_security_challenge", "browser_unavailable", "browser_profile_in_use", "cdp_unavailable", "field_preparation_incomplete", "submit_guard_failed"].includes(state)) {
    return "paused";
  }
  return "completed";
}

function stateStatusMessage(state: DetectedBrowserState): string {
  if (state === "browser_profile_in_use") {
    return "Chrome profile is already open. Use CDP mode or close Chrome before retrying.";
  }
  if (state === "cdp_unavailable") {
    return "Persistent Chrome session is not running. Start it with npm run browser:session.";
  }
  if (state === "captcha_or_security_challenge" || state === "login_required" || state === "two_factor_required") {
    return `Detected state: ${state}. Resolve the browser page in the visible Chrome session, then retry.`;
  }
  return `Detected state: ${state}; stop-before-submit enforced.`;
}

async function processAction(action: BrowserAction, options: BrowserWorkerOptions): Promise<void> {
  updateBrowserActionStatus(action.id, "in_progress");
  incrementBrowserActionAttempts(action.id);

  const applyPlanResult = action.actionType === "prepare_application_review" ? buildBrowserApplyPlan(action.jobId) : null;
  const stalePayloadErrors =
    action.actionType === "prepare_application_review"
      ? ((action.payload.applyPlan as BrowserApplyFillPlan | undefined)?.validationIssues ?? []).filter(
          (validationIssue) => validationIssue.severity === "error"
        )
      : [];
  const plan = applyPlanResult?.plan ?? null;
  const url = plan?.applyUrl ?? getActionUrl(action);
  const thread = getSlackThreadContextFromPayload(action);

  if (action.actionType === "prepare_application_review" && (!applyPlanResult?.valid || stalePayloadErrors.length > 0)) {
    const issues = [...(applyPlanResult?.issues ?? []), ...stalePayloadErrors];
    const diagnostics = buildApplyDiagnostics(action, plan, issues, "validation_failed");
    saveApplyDiagnostics(options, action, diagnostics);
    await postPrepareDraftStatusToThread(thread, {
      heading: `⚠️ Draft preparation paused for browser action #${action.id}.`,
      diagnostics,
      nextCommand: `retry ${action.id}`,
    });
    updateBrowserActionStatus(action.id, "paused", `Apply preparation validation failed: ${issues.map((item) => item.code).join(", ")}`);
    return;
  }

  if (!url) {
    updateBrowserActionStatus(action.id, "paused", "No URL available for browser action.");
    if (thread) {
      updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "capture_failed");
    }
    return;
  }

  if (action.actionType === "prepare_application_review") {
    try {
      assertSubmitGuard(plan);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      saveApplyDiagnostics(options, action, buildApplyDiagnostics(action, plan, applyPlanResult?.issues ?? [], "submit_guard_failed"));
      updateBrowserActionStatus(action.id, "paused", message);
      return;
    }
  }

  if (options.dryRun) {
    const state: DetectedBrowserState = "dry_run";
    if (action.actionType === "capture_job_from_url") {
      const capture = buildDeterministicOpportunityPacket(`Upwork URL capture preview (dry-run): ${url}`, {
        url,
        source: "deterministic",
        capturedAt: new Date(),
      });
      const job = normalizedPacketToJobPosting(capture);
      const scored = scoreJob(job);
      scored.applicationDraft = buildApplicationDraft(scored);

      const questions = normalizeCaptureQuestions(`Upwork URL capture (dry-run): ${url}`);
      const answers = buildQuestionAnswers(questions, {
        bid: scored.applicationDraft?.suggestedBid ?? "standard",
        profileSummary: scored.title,
      });

      markJobSeen(scored, false);
      let autoPrepareDecision: AutoPrepareDraftDecision = {
        shouldQueue: false,
        category: "blocked_no_manual_override",
        reason: "no thread context",
        note: "Not auto-preparing because no Slack thread context was available for browser staging.",
      };
      if (thread) {
        autoPrepareDecision = decideAutoPrepareDraft(scored);
        if (autoPrepareDecision.shouldQueue) {
          autoPrepareDecision = queuePrepareDraftActionForThread(scored, thread);
        }
        updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "captured", { jobId: scored.id });
        updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "scored", { jobId: scored.id });
        updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "packet_sent", { jobId: scored.id });
        await postV3CapturePacketToThread(scored, thread, {
          upworkUrl: url,
          captureStatus: "packet_sent",
          browserCaptureActionId: action.id,
          browserDraftStatus: autoPrepareDecision.actionId ? (autoPrepareDecision.duplicate ? autoPrepareDecision.duplicateStatus ?? "queued" : "queued") : undefined,
          browserDraftActionId: autoPrepareDecision.actionId,
          requiredConnects: scored.applicationDraft?.suggestedConnects ?? 0,
          suggestedBoostConnects: scored.applicationDraft?.suggestedBoostConnects ?? 0,
          suggestedBid: scored.applicationDraft?.suggestedBid ?? "n/a",
          applicationQuestions: questions,
          questionAnswers: answers,
          proofRecommendations: extractProofRecommendations(scored.applicationDraft),
          autoPrepareNote: autoPrepareDecision.note,
        });
        if (autoPrepareDecision.actionId && !autoPrepareDecision.duplicate) {
          updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "prepare_draft_requested", { jobId: scored.id });
        }
      }
      updateBrowserActionStatus(action.id, "paused", "Dry run: browser capture simulated from URL. Set BROWSER_DRY_RUN=false for real extraction.");
      logger.info(`[dry-run] Browser capture action #${action.id} simulated for ${url}`);
      return;
    }

    const diagnostics = buildApplyDiagnostics(action, plan, applyPlanResult?.issues ?? [], state);
    logger.info(`[dry-run]\n${formatApplyDiagnostics(diagnostics)}`);
    saveApplyDiagnostics(options, action, diagnostics);
    saveTextArtifact(options, action, "dry-run.json", JSON.stringify({ actionId: action.id, jobId: action.jobId, actionType: action.actionType, url, state }, null, 2));
    updateBrowserActionStatus(action.id, "paused", "Dry run: browser action not opened. Set BROWSER_DRY_RUN=false to inspect pages.");
    if (thread) {
      updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "status_checked");
    }
    if (action.actionType === "prepare_application_review") {
      await postPrepareDraftStatusToThread(thread, {
        heading: `🧪 Draft preparation dry-run ready for browser action #${action.id}.`,
        diagnostics,
      });
    }
    return;
  }

  try {
    const { state, snapshot, fields, bodyText } = await inspectWithBrowser(action, options, url, plan ?? undefined);

    if (action.actionType === "prepare_application_review") {
      const diagnostics = buildApplyDiagnostics(action, plan, applyPlanResult?.issues ?? [], state, fields);
      saveApplyDiagnostics(options, action, diagnostics);
      if (state === "field_preparation_incomplete") {
        logger.warn(`Required fields not filled confidently for browser action #${action.id}: ${getRequiredSkippedFields(fields).join(", ")}`);
      }
      updateBrowserActionStatus(action.id, terminalStatusForState(state), stateStatusMessage(state));
      if (["login_required", "two_factor_required", "captcha_or_security_challenge", "field_preparation_incomplete"].includes(state)) {
        await recordBrowserManualAttention({
          actionId: action.id,
          jobId: action.jobId,
          url: snapshot?.url ?? url,
          title: snapshot?.title ?? null,
          reason: state,
        });
      }
      await postPrepareDraftStatusToThread(thread, {
        heading: state === "apply_page_loaded" ? `✅ Draft preparation ready for review for browser action #${action.id}.` : `⚠️ Draft preparation paused for browser action #${action.id}.`,
        diagnostics,
        nextCommand: state === "apply_page_loaded" ? "status" : `retry ${action.id}`,
      });
      logger.info(`Browser action #${action.id} detected state: ${state}`);
      return;
    }

    if (action.actionType === "capture_job_from_url") {
      if (thread) {
        updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "captured", { jobId: action.jobId });
      }

      if (["login_required", "two_factor_required", "captcha_or_security_challenge", "browser_unavailable", "browser_profile_in_use", "cdp_unavailable", "no_url"].includes(state)) {
        const threadStatus = String(state);
        const alreadyManual = thread ? getSlackThreadStateByThreadTs(thread.channelId, thread.threadTs)?.status === "manual_attention_required" : false;
        if (thread) {
          updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "manual_attention_required");
          if (!alreadyManual) {
            await postSlackThreadMessage({
              channel: thread.channelId,
              threadTs: thread.threadTs,
              text: [
                "⚠️ Browser capture is blocked.",
                `State: ${threadStatus}`,
                `URL: ${url}`,
                threadStatus === "browser_profile_in_use"
                  ? "Chrome profile is already open. Use CDP mode or close Chrome before retrying."
                  : threadStatus === "cdp_unavailable"
                    ? "Persistent Chrome session is not running. Start it with npm run browser:session."
                    : "Resolve the browser page in the visible Chrome session, then retry.",
                `Retry command: npm run browser:retry -- --id ${action.id}`, 
              ].join("\n"),
            });
          }
          if (["login_required", "two_factor_required", "captcha_or_security_challenge"].includes(threadStatus)) {
            await recordBrowserManualAttention({
              actionId: action.id,
              jobId: action.jobId,
              url: snapshot?.url ?? url,
              title: snapshot?.title ?? null,
              reason: threadStatus,
            });
          }
        }
        updateBrowserActionStatus(action.id, "paused", stateStatusMessage(state));
        logger.warn(`Browser action #${action.id} blocked: ${threadStatus}`);
        return;
      }

      const normalized = buildDeterministicOpportunityPacket(bodyText, {
        url: snapshot?.url ?? url,
        source: "deterministic",
        capturedAt: new Date(),
      });
      const job = normalizedPacketToJobPosting(normalized);
      const scored = scoreJob(job);
      scored.applicationDraft = buildApplicationDraft(scored);

      const mergedQuestions = normalizeCaptureQuestions(bodyText);
      const applicationQuestions = mergedQuestions.length > 0 ? mergedQuestions : normalized.applicationQuestions.slice(0, 6);
      const questionAnswers = buildQuestionAnswers(applicationQuestions, {
        bid: scored.applicationDraft?.suggestedBid ?? "standard",
        profileSummary: scored.title,
      });

      markJobSeen(scored, false);
      let autoPrepareDecision: AutoPrepareDraftDecision = {
        shouldQueue: false,
        category: "blocked_no_manual_override",
        reason: "no thread context",
        note: "Not auto-preparing because no Slack thread context was available for browser staging.",
      };
      if (thread) {
        autoPrepareDecision = decideAutoPrepareDraft(scored);
        if (autoPrepareDecision.shouldQueue) {
          autoPrepareDecision = queuePrepareDraftActionForThread(scored, thread);
        }
        updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "captured", { jobId: scored.id });
        updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "scored", { jobId: scored.id });
      }
      if (thread) {
        await postV3CapturePacketToThread(scored, thread, {
          upworkUrl: url,
          captureStatus: "packet_sent",
          browserCaptureActionId: action.id,
          browserDraftStatus: autoPrepareDecision.actionId ? (autoPrepareDecision.duplicate ? autoPrepareDecision.duplicateStatus ?? "queued" : "queued") : undefined,
          browserDraftActionId: autoPrepareDecision.actionId,
          requiredConnects: scored.applicationDraft?.suggestedConnects ?? 0,
          suggestedBoostConnects: scored.applicationDraft?.suggestedBoostConnects ?? 0,
          suggestedBid: scored.applicationDraft?.suggestedBid ?? "n/a",
          applicationQuestions,
          questionAnswers,
          proofRecommendations: extractProofRecommendations(scored.applicationDraft),
          autoPrepareNote: autoPrepareDecision.note,
        });
        updateSlackThreadStateStatus(thread.channelId, thread.threadTs, autoPrepareDecision.actionId && !autoPrepareDecision.duplicate ? "prepare_draft_requested" : "packet_sent", { jobId: scored.id });
      }
      updateBrowserActionStatus(action.id, "completed", "Capture completed and packet posted to Slack thread.");
      return;
    }

    updateBrowserActionStatus(action.id, terminalStatusForState(state), stateStatusMessage(state));
    logger.info(`Browser action #${action.id} detected state: ${state}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateBrowserActionStatus(action.id, "failed", message);
    if (thread) {
      updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "capture_failed");
    }
    logger.error(`Browser action #${action.id} failed: ${message}`);
  }
}

export async function runBrowserWorker(options = loadOptions()): Promise<void> {
  await logReadiness(options);
  const session = getBrowserSessionStatus();
  if (session.blocked) {
    logger.warn(`Browser worker paused due to session state: ${formatBrowserSessionStatus(session)}`);
    return;
  }
  if (!BROWSER_WORKER_ENABLED) {
    logger.info("Browser worker is disabled. Set BROWSER_WORKER_ENABLED=true to process queued browser actions.");
    return;
  }

  const actionLimit = options.dryRun ? options.limit : Math.min(options.limit, options.liveActionLimit);
  const pending = listBrowserActions("pending", actionLimit);
  if (!options.dryRun && options.liveActionLimit === 1) {
    logger.info("Live browser mode action limit enforced: processing at most 1 pending action this run.");
  }
  if (pending.length === 0) {
    logger.info("No pending browser actions.");
    return;
  }

  logger.info(`Processing ${pending.length} browser action(s). dryRun=${options.dryRun}`);
  for (const action of pending) {
    await processAction(action, options);
  }
}

if (require.main === module) {
  const options = loadOptions();
  const command = process.argv[2];
  const run = command === "--readiness" ? logReadiness(options) : runBrowserWorker(options);
  run
    .catch((error: unknown) => {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
