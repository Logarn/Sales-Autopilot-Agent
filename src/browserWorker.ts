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
  DISCOVERY_SLACK_CHANNEL_ID,
  SLACK_ALLOWED_CHANNEL_IDS,
  SLACK_CHANNEL_WEBHOOK_URL,
} from "./config";
import { buildBrowserApplyPlan } from "./browserApply";
import {
  analyzeApplyPageSnapshot,
  type ApplyPageAnalyzerResult,
  type ApplyPageSnapshot as ApplyVerificationSnapshot,
} from "./browser/applyPageAnalyzer";
import {
  closeDb,
  enqueueBrowserActionDeduped,
  getApplicationStatus,
  getBrowserActionById,
  getApplicationDraft,
  getLatestProposalVersion,
  getScoredJobForSlackPreview,
  getSlackThreadStateByJobId,
  getSlackThreadStateByThreadTs,
  incrementBrowserActionAttempts,
  listScreeningCoverage,
  listBrowserActions,
  markJobSeen,
  mergeBrowserActionPayload,
  recordPlannedScreeningCoverage,
  recordLatestVerifiedProposalFallback,
  recordProposalVersion,
  markSlackWorkflowPromiseStatus,
  updateApplicationStatus,
  updateBrowserActionStatus,
  upsertScreeningCoverageItem,
  updateSlackThreadStateStatus,
  upsertSlackThreadState,
} from "./db";
import { buildApplicationDraftWithResearch } from "./agent";
import { buildDeterministicOpportunityPacket, normalizedPacketToJobPosting } from "./normalization";
import { scoreJob } from "./filter";
import { detectPlatformMismatchWarnings, parseJobIntelligence } from "./jobIntelligenceParser";
import { assessCaptureQuality, buildQuestionAnswers, canonicalizeUpworkJobUrl, extractUpworkJobContent, extractUpworkJobIdFromUrl, extractUpworkSourceContextJobContent, isSafeUpworkJobUrl, parseCaptureQuestions } from "./browserCapture";
import type { UpworkStructuredExtractionResult } from "./browserCapture";
import { logger } from "./logger";
import {
  BrowserAction,
  BrowserApplyFillPlan,
  BrowserApplyValidationIssue,
  ProposalVersionSource,
  ScoredJob,
} from "./types";
import { extractConnectsFromVisibleText } from "./connectsExtraction";
import { chooseVisibleBoost, extractVisibleBoostBids, type VisibleBoostBid } from "./connectsStrategy";
import { guardedClick } from "./browserSafetyGuard";
import { getSlackLeadPostingDecision, SlackPacketV3Context, writeV3CapturePacketWithLlm } from "./slackPacketV3";
import { evaluatePlatformEligibility } from "./platformEligibility";
import { decideLeadHandling } from "./leadDecision";
import { sendSlackMessage } from "./slack";
import { postSlackChannelMessage, postSlackThreadMessage } from "./slackThread";
import { rewriteSlackCopyWithKimi, type SlackCopyProvider } from "./slackCopywriter";
import {
  buildBlockerNotificationText,
  postSlackPromiseNotification,
  slackPromiseStateKey,
  type SlackPromiseNotificationPlan,
} from "./slackPromiseNotifications";
import { captureThreadTargetsForAction } from "./captureActionOwnership";
import type { IncomingWebhookSendArguments } from "@slack/webhook";
import {
  BrowserSessionStatus,
  formatBrowserSessionStatus,
  getBrowserSessionStatus,
  markBrowserChallengeResolved,
  markBrowserManualAttentionThreadAlert,
  recordBrowserManualAttention,
} from "./browserSession";
import { hasAllowedCaptureSourceMetadata } from "./browserDiscoveryTool";
import {
  acquireBrowserSession,
  BrowserSessionMode,
  classifyBrowserSessionError,
  findChromeExecutable,
  getChromeProfileProcessDiagnostics,
  PlaywrightChromiumLike,
  checkCdpEndpoint,
} from "./browserSessionControl";
import { isUpworkFindWorkFeedUrl, isUpworkWorkTabUrl } from "./browserSessionInspector";
import { listProtectedQaApplyUrls } from "./browserQaHold";
import { canQueueNewQaPreparation } from "./browserQaWorkspace";
import { proofAssetExists, resolveProofAssetPath } from "./proofAssets";
import {
  recordApplicationOutcomeLearning,
  recordApplyPreparationFailureLearning,
  recordBrowserApplyPlanLearning,
  recordProposalStyleSignal,
  recordScreeningAnswerDiffLearning,
  recordProposalVersionDiffLearning,
} from "./salesLearningMemory";

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
  | "connects_not_verified"
  | "field_preparation_incomplete"
  | "submit_guard_failed"
  | "source_context_unavailable"
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

export interface ControlledWorkerRunOptions {
  maxActions?: number;
  dryRun?: boolean;
  allowedActionTypes?: Array<BrowserAction["actionType"]>;
  processActionOverride?: (action: BrowserAction) => Promise<ProcessActionResult>;
}

export interface ControlledWorkerRunSummary {
  actionsProcessed: number;
  actionsCompleted: number;
  actionsPaused: number;
  actionsSkipped: number;
  slackPostsSucceeded: number;
  slackPostFailures: number;
  stoppedReason: string;
  remainingPendingCount: number;
}

interface PageSnapshot {
  url: string;
  title: string;
  textExcerpt: string;
}

export interface BrowserStateDetection {
  state: DetectedBrowserState;
  source: "url" | "title" | "body_text" | "action_type" | "none";
  matchedText?: string;
  matchedPattern?: string;
  matchedVisible?: boolean | "unknown";
  signalStrength?: "strong" | "weak";
  summary: string;
}

export interface BrowserInspectionDiagnostics {
  actionId: number;
  jobId: string;
  actionType: string;
  sessionMode: BrowserSessionMode;
  targetUrl: string;
  pageReuse: {
    reusedExistingPage: boolean;
    reason: string;
    selectedPageUrl: string;
  };
  tabHygiene?: {
    openPagesBefore: number;
    upworkWorkTabsBefore: number;
    staleWorkTabsClosed: number;
    staleWorkTabsIgnored: number;
    selectedFeedTabUrl?: string;
  };
  settleSamples: Array<{
    step: number;
    url: string;
    title: string;
    textExcerpt: string;
    detection: BrowserStateDetection;
  }>;
  finalSnapshot: PageSnapshot;
  finalDetection: BrowserStateDetection;
  captureStrategy?: "source_context" | "direct_fallback" | "source_context_unavailable" | "blocked_before_capture";
  selectedPageKind?: "source_context" | "direct_job_page" | "none";
  directJobPageRejectedForDiscovery?: boolean;
  sourceContextPageFound?: boolean;
  sourceContextAttempted?: boolean;
  sourceContextMatchedTarget?: boolean;
  sourceContextReadable?: boolean;
  directFallbackAttempted?: boolean;
  blockingDetectorSource?: "url" | "title" | "body_text" | "stored_session" | "unknown";
  blockingMatchedText?: string;
  blockingMatchedPattern?: string;
  blockingMatchedVisible?: boolean | "unknown";
  blockingSignalStrength?: "strong" | "weak";
  blockingPageUrl?: string;
  blockingPageTitle?: string;
  targetJobId?: string;
  currentPageUrlBeforeCapture?: string;
}

interface PlaywrightLocatorLike {
  count(): Promise<number>;
  first(): PlaywrightLocatorLike;
  nth?(index: number): PlaywrightLocatorLike;
  textContent(options?: { timeout?: number }): Promise<string | null>;
  click?(options?: { timeout?: number }): Promise<unknown>;
  fill(value: string, options?: { timeout?: number }): Promise<unknown>;
  setInputFiles(files: string[], options?: { timeout?: number }): Promise<unknown>;
  check(options?: { timeout?: number }): Promise<unknown>;
}

interface PlaywrightPageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  locator(selector: string): PlaywrightLocatorLike;
  close?(options?: { runBeforeUnload?: boolean }): Promise<unknown>;
  evaluate?<R>(fn: () => R): Promise<R>;
}

export type ApplyVerificationStatus =
  | "verified"
  | "attempted_unverified"
  | "unavailable_on_page"
  | "missing_local_file"
  | "blocked_by_upwork_ui"
  | "skipped_by_strategy";

export interface ApplyFieldVerification {
  field: string;
  status: ApplyVerificationStatus;
  expected?: string;
  actual?: string;
  detail: string;
}

interface PlaywrightContextLike {
  pages?(): PlaywrightPageLike[];
  newPage(): Promise<PlaywrightPageLike>;
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
  coverLetterPreview: string | null;
  screeningAnswersCount: number;
  screeningAnswers: string[];
  rate: string | null;
  requiredConnects: number | null;
  boostConnects: number | null;
  totalConnects: number | null;
  connectsDecision: string | null;
  connectsExpectedValue: number | null;
  connectsConfidence: string | null;
  connectsSource: string | null;
  selectedAttachments: string[];
  filesAttached: string[];
  manualReviewAssets: string[];
  mentionOnlyProof: string[];
  proofAvailability: string[];
  portfolioHighlights: string[];
  profileHighlights: string[];
  figmaRecommendations: string[];
  videoRecommendations: string[];
  manualReviewWarnings: string[];
  missingLocalAssets: string[];
  skippedAttachments: Array<{ name: string; reason: string }>;
  selectedHighlights: string[];
  warnings: string[];
  attemptedFields: string[];
  skippedFields: string[];
  manualFields: string[];
  fieldVerification: ApplyFieldVerification[];
  verifiedFields: string[];
  unverifiedFields: string[];
  unavailableFields: string[];
  missingFileFields: string[];
  blockedByUiFields: string[];
  skippedByStrategyFields: string[];
  applyPageAnalysis?: ApplyPageAnalyzerResult;
}

function humanSlackPrepDetail(value: string): string {
  return value
    .replace(/\bmanual review\b/gi, "a quick look")
    .replace(/\bmanual field(s)?\b/gi, "couldn’t safely fill")
    .replace(/\bfield_preparation_incomplete\b/gi, "an apply-page field still needs verification")
    .replace(/\brequired_attachment_missing_locally\b/gi, "a selected file is missing locally")
    .replace(/\bconnects_apply_page_manual_review_required\b/gi, "Connects need a quick look")
    .replace(/\brequired_connects_unverified_on_apply_page\b/gi, "I couldn’t verify the Connects on the apply page")
    .replace(/\bsource[_\s-]*context[_\s-]*unavailable\b/gi, "the page was not readable")
    .replace(/\bsubmit_guard_failed\b/gi, "I stopped before submit")
    .replace(/\bvalidation_failed\b/gi, "the page needs a human check")
    .replace(/\bselected for browser preparation\b/gi, "needed for this application")
    .replace(/\bautonomous preparation\b/gi, "prep")
    .replace(/\s+/g, " ")
    .trim();
}

function isBrowserChallengeState(state: ApplyPreparationDiagnostics["state"] | DetectedBrowserState): boolean {
  return state === "captcha_or_security_challenge" || state === "login_required" || state === "two_factor_required";
}

function isConnectsNotVerified(diagnostics: Pick<ApplyPreparationDiagnostics, "state" | "requiredConnects" | "fieldVerification" | "connectsDecision">): boolean {
  if (isBrowserChallengeState(diagnostics.state)) return false;
  const requiredVerification = getVerification(diagnostics.fieldVerification ?? [], "requiredConnects");
  return diagnostics.state === "connects_not_verified" ||
    (diagnostics.requiredConnects === null && requiredVerification?.status === "attempted_unverified") ||
    (diagnostics.requiredConnects === null && diagnostics.connectsDecision !== "safe_apply");
}

function getUnverifiedRequiredApplyFields(results: ApplyFieldVerification[]): string[] {
  const alwaysRequired = ["targetTab", "coverLetter", "rate", "requiredConnects"];
  const plannedRequired = ["screeningAnswers", "boostConnects", "attachments", "profileHighlights"];
  const failures = alwaysRequired.filter((field) => getVerification(results, field)?.status !== "verified");
  for (const analyzerRequired of ["pageStructure", "finalSubmitButton"]) {
    const verificationResult = getVerification(results, analyzerRequired);
    if (verificationResult && verificationResult.status !== "verified") failures.push(analyzerRequired);
  }
  for (const field of plannedRequired) {
    const verificationResult = getVerification(results, field);
    if (!verificationResult || verificationResult.status === "verified" || verificationResult.status === "skipped_by_strategy") continue;
    failures.push(field);
  }
  return failures;
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
  const canonicalPayloadUrl = typeof action.payload.canonicalJobUrl === "string" ? action.payload.canonicalJobUrl : null;
  if (canonicalPayloadUrl) return canonicalizeUpworkJobUrl(canonicalPayloadUrl) ?? canonicalPayloadUrl;
  const payloadUrl = typeof action.payload.url === "string" ? action.payload.url : null;
  if (payloadUrl && action.actionType === "capture_application_snapshot") return payloadUrl;
  if (payloadUrl) return canonicalizeUpworkJobUrl(payloadUrl) ?? payloadUrl;
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
  if (payload.channelId && payload.threadTs && payload.messageTs) {
    return {
      channelId: payload.channelId,
      threadTs: payload.threadTs,
      messageTs: payload.messageTs,
    };
  }
  const mapped = getSlackThreadStateByJobId(action.jobId);
  return mapped
    ? { channelId: mapped.channelId, threadTs: mapped.threadTs, messageTs: mapped.messageTs }
    : null;
}

function getSlackThreadContextsForCaptureAction(action: BrowserAction): SlackThreadContext[] {
  if (action.actionType !== "capture_job_from_url") {
    const thread = getSlackThreadContextFromPayload(action);
    return thread ? [thread] : [];
  }

  const contexts: SlackThreadContext[] = captureThreadTargetsForAction(action).map((target) => ({
    channelId: target.channelId,
    messageTs: target.messageTs,
    threadTs: target.threadTs,
  }));
  const fallback = getSlackThreadContextFromPayload(action);
  if (fallback) contexts.push(fallback);

  const seen = new Set<string>();
  return contexts.filter((context) => {
    if (SLACK_ALLOWED_CHANNEL_IDS.length > 0 && !SLACK_ALLOWED_CHANNEL_IDS.includes(context.channelId)) {
      logger.warn(`Skipped capture fan-out to non-allowlisted Slack channel ${context.channelId} for action #${action.id}.`);
      return false;
    }
    const key = `${context.channelId}:${context.threadTs}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractUpworkUrlToken(value: string): string | null {
  const match = value.match(/~[a-z0-9_-]+/i);
  if (match) return match[0].toLowerCase();
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    const jobMatch = pathname.match(/\/jobs\/(?:[^/?#]+_)?(~[a-z0-9_-]+)/i);
    if (jobMatch) return jobMatch[1].toLowerCase();
    const proposalMatch = pathname.match(/\/(?:ab|nx)\/proposals\/job\/(~[a-z0-9_-]+)/i);
    if (proposalMatch) return proposalMatch[1].toLowerCase();
    const detailMatch = pathname.match(/\/nx\/find-work\/best-matches\/details\/(~[a-z0-9_-]+)/i);
    if (detailMatch) return detailMatch[1].toLowerCase();
  } catch {
    // ignore malformed URLs here
  }
  return null;
}

function urlsReferToSameUpworkJob(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftToken = extractUpworkUrlToken(left);
  const rightToken = extractUpworkUrlToken(right);
  return Boolean(leftToken && rightToken && leftToken === rightToken);
}

async function buildPageSnapshot(page: PlaywrightPageLike): Promise<{ snapshot: PageSnapshot; bodyText: string }> {
  const url = page.url();
  const title = await page.title();
  const bodyText = (await page.locator("body").first().textContent({ timeout: 5000 })) ?? "";
  return {
    bodyText,
    snapshot: {
      url,
      title,
      textExcerpt: boundedExcerpt(bodyText),
    },
  };
}

export function detectState(snapshot: PageSnapshot, action: BrowserAction): DetectedBrowserState {
  return detectStateWithDiagnostics(snapshot, action).state;
}

export function isCaptureBlockedState(state: DetectedBrowserState): boolean {
  return ["login_required", "two_factor_required", "captcha_or_security_challenge", "browser_unavailable", "browser_profile_in_use", "cdp_unavailable", "source_context_unavailable", "no_url"].includes(state);
}

export function isCaptureManualAttentionState(state: DetectedBrowserState): boolean {
  return ["login_required", "two_factor_required", "captcha_or_security_challenge", "browser_unavailable", "browser_profile_in_use", "cdp_unavailable"].includes(state);
}

export function detectStateWithDiagnostics(snapshot: PageSnapshot, action: BrowserAction): BrowserStateDetection {
  if (!snapshot.url) {
    return { state: "no_url", source: "none", summary: "No URL was available for the current page." };
  }

  const urlValue = snapshot.url.toLowerCase();
  const titleValue = snapshot.title.toLowerCase();
  const bodyValue = snapshot.textExcerpt.toLowerCase();
  const combined = `${urlValue}\n${titleValue}\n${bodyValue}`;
  const canonicalJobUrl = canonicalizeUpworkJobUrl(snapshot.url) ?? canonicalizeUpworkJobUrl(getActionUrl(action) ?? "");
  const validJobDetailShape = Boolean(
    snapshot.url.match(/\/jobs\/(?:[^/?#]+_)?~[A-Za-z0-9_-]{8,}\/?/i) ||
    snapshot.url.match(/\/nx\/find-work\/best-matches\/details\/~[A-Za-z0-9_-]{8,}/i) ||
    snapshot.url.match(/\/(?:ab|nx)\/proposals\/job\/~[A-Za-z0-9_-]{8,}\/apply\/?/i)
  );
  const targetLooksLikeJobPage =
    isSafeUpworkJobUrl(snapshot.url) ||
    validJobDetailShape ||
    urlsReferToSameUpworkJob(snapshot.url, getActionUrl(action) ?? "");

  if (combined.includes("two-factor") || combined.includes("two factor") || combined.includes("verification code")) {
    return { state: "two_factor_required", source: combined.includes("verification code") ? "body_text" : "title", matchedText: combined.includes("verification code") ? "verification code" : "two-factor", summary: "Detected two-factor verification on the current page." };
  }

  const challengeSignals = [
    { source: "url" as const, value: "__cf_chl" },
    { source: "url" as const, value: "__cf_chl_rt_tk" },
    { source: "url" as const, value: "/cdn-cgi/challenge" },
    { source: "title" as const, value: "challenge" },
    { source: "title" as const, value: "challenge - upwork" },
    { source: "title" as const, value: "just a moment" },
    { source: "title" as const, value: "security check" },
    { source: "title" as const, value: "attention required" },
    { source: "body_text" as const, value: "verify you are human" },
    { source: "body_text" as const, value: "i'm not a robot" },
    { source: "body_text" as const, value: "i’m not a robot" },
    { source: "body_text" as const, value: "checking your browser" },
    { source: "body_text" as const, value: "checking if the site connection is secure" },
    { source: "body_text" as const, value: "security check" },
    { source: "body_text" as const, value: "captcha" },
    { source: "body_text" as const, value: "cloudflare" },
    { source: "body_text" as const, value: "unusual traffic" },
  ];
  for (const signal of challengeSignals) {
    const haystack = signal.source === "url" ? urlValue : signal.source === "title" ? titleValue : bodyValue;
    if (haystack.includes(signal.value)) {
      return {
        state: "captcha_or_security_challenge",
        source: signal.source,
        matchedText: signal.value,
        summary: `Detected restricted/unreadable browser page from ${signal.source} match: ${signal.value}; restricted state takes precedence over validJobDetailShape=${validJobDetailShape}; canonicalJobUrl=${canonicalJobUrl ?? "n/a"}`,
      };
    }
  }

  if ((combined.includes("log in") || combined.includes("login") || combined.includes("sign in")) && !targetLooksLikeJobPage) {
    return { state: "login_required", source: titleValue.includes("sign in") || titleValue.includes("log in") || titleValue.includes("login") ? "title" : "body_text", matchedText: titleValue.includes("sign in") ? "sign in" : titleValue.includes("log in") ? "log in" : "login", summary: "Detected login-required page state." };
  }

  if (action.actionType === "capture_job_from_url" && targetLooksLikeJobPage) {
    return { state: "captured", source: "url", matchedText: snapshot.url, summary: "Detected Upwork job detail/apply page for capture." };
  }
  if (action.actionType === "open_apply_page" || snapshot.url.includes("/apply")) {
    return { state: "apply_page_loaded", source: snapshot.url.includes("/apply") ? "url" : "action_type", matchedText: snapshot.url.includes("/apply") ? snapshot.url : action.actionType, summary: "Detected Upwork apply page." };
  }
  if (action.actionType === "open_job" || snapshot.url.includes("/jobs/")) {
    return { state: "job_page_loaded", source: snapshot.url.includes("/jobs/") ? "url" : "action_type", matchedText: snapshot.url.includes("/jobs/") ? snapshot.url : action.actionType, summary: "Detected Upwork job detail page." };
  }
  return { state: "page_loaded", source: "none", summary: "Loaded a page that did not match a known Upwork terminal state." };
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
    warnings.push(...plan.connectsStrategy.risks.map((risk) => `Connects strategy: ${risk}`));
    warnings.push(...plan.skippedAttachments.map((attachment) => `${attachment.name}: ${attachment.reason}`));
    warnings.push(...plan.missingLocalAssets.map((asset) => `Missing local asset: ${asset}`));
    warnings.push(...plan.manualReviewWarnings);
  }
  return Array.from(new Set(warnings));
}

function buildApplyDiagnostics(
  action: BrowserAction,
  plan: BrowserApplyFillPlan | null,
  issues: BrowserApplyValidationIssue[],
  state: ApplyPreparationDiagnostics["state"],
  fields: Partial<Pick<ApplyPreparationDiagnostics, "attemptedFields" | "skippedFields" | "manualFields" | "fieldVerification">> = {}
): ApplyPreparationDiagnostics {
  const extendedPlan = plan as (BrowserApplyFillPlan & Partial<{
    filesAttached: string[];
    portfolioHighlights: string[];
    profileHighlights: string[];
  }>) | null;
  const sourceBackedConnects = plan?.connectsStrategy.sourceBackedConnects;
  const connectsSource = sourceBackedConnects
    ? sourceBackedConnects.sourceText
      ? `${sourceBackedConnects.sourceLocation ?? "visible text"}: ${sourceBackedConnects.sourceText}`
      : sourceBackedConnects.extractionMethod
    : null;
  const fieldVerification = fields.fieldVerification ?? [];
  const fieldsWithStatus = (status: ApplyVerificationStatus): string[] => fieldVerification
    .filter((item) => item.status === status)
    .map((item) => item.field);
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
    coverLetterPreview: plan?.coverLetter ? boundedExcerpt(plan.coverLetter, 1800) : null,
    screeningAnswersCount: plan?.screeningAnswers.length ?? 0,
    screeningAnswers: plan?.screeningAnswers ?? [],
    rate: plan?.rate ?? null,
    requiredConnects: plan?.connects.required ?? null,
    boostConnects: plan?.connects.boost ?? null,
    totalConnects: plan?.connects.total ?? null,
    connectsDecision: plan?.connectsStrategy.decision ?? null,
    connectsExpectedValue: plan?.connectsStrategy.expectedValueScore ?? null,
    connectsConfidence: sourceBackedConnects?.confidence ?? null,
    connectsSource,
    selectedAttachments: plan?.attachments.map((attachment) => attachment.name) ?? [],
    filesAttached: extendedPlan?.filesAttached ?? plan?.attachments.map((attachment) => attachment.filePath) ?? [],
    manualReviewAssets: plan?.manualReviewAssets ?? [],
    mentionOnlyProof: plan?.mentionOnlyProof ?? [],
    proofAvailability: plan?.proofAvailability ?? [],
    portfolioHighlights: extendedPlan?.portfolioHighlights ?? [],
    profileHighlights: extendedPlan?.profileHighlights ?? [],
    figmaRecommendations: plan?.figmaRecommendations ?? [],
    videoRecommendations: plan?.videoRecommendations ?? [],
    manualReviewWarnings: plan?.manualReviewWarnings ?? [],
    missingLocalAssets: plan?.missingLocalAssets ?? [],
    skippedAttachments: plan?.skippedAttachments.map(({ name, reason }) => ({ name, reason })) ?? [],
    selectedHighlights: plan?.highlights ?? [],
    warnings: buildWarnings(plan, issues),
    attemptedFields: fields.attemptedFields ?? [],
    skippedFields: fields.skippedFields ?? [],
    manualFields: fields.manualFields ?? [],
    fieldVerification,
    verifiedFields: fieldsWithStatus("verified"),
    unverifiedFields: fieldsWithStatus("attempted_unverified"),
    unavailableFields: fieldsWithStatus("unavailable_on_page"),
    missingFileFields: fieldsWithStatus("missing_local_file"),
    blockedByUiFields: fieldsWithStatus("blocked_by_upwork_ui"),
    skippedByStrategyFields: fieldsWithStatus("skipped_by_strategy"),
    applyPageAnalysis: (fields as { applyPageAnalysis?: ApplyPageAnalyzerResult }).applyPageAnalysis,
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
    `  connects_decision: ${diagnostics.connectsDecision ?? "n/a"} ev=${diagnostics.connectsExpectedValue ?? "n/a"}`,
    `  auto_attach_assets: ${diagnostics.selectedAttachments.length > 0 ? diagnostics.selectedAttachments.join(", ") : "none"}`,
    `  manual_review_assets: ${diagnostics.manualReviewAssets.length > 0 ? diagnostics.manualReviewAssets.join("; ") : "none"}`,
    `  mention_only_proof: ${diagnostics.mentionOnlyProof.length > 0 ? diagnostics.mentionOnlyProof.join("; ") : "none"}`,
    `  proof_availability: ${diagnostics.proofAvailability.length > 0 ? diagnostics.proofAvailability.join("; ") : "none"}`,
    `  figma_recommendations: ${diagnostics.figmaRecommendations.length > 0 ? diagnostics.figmaRecommendations.join("; ") : "none"}`,
    `  video_recommendations: ${diagnostics.videoRecommendations.length > 0 ? diagnostics.videoRecommendations.join("; ") : "none"}`,
    `  missing_local_assets: ${diagnostics.missingLocalAssets.length > 0 ? diagnostics.missingLocalAssets.join("; ") : "none"}`,
    `  skipped_attachments: ${diagnostics.skippedAttachments.length > 0 ? diagnostics.skippedAttachments.map((item) => `${item.name} (${item.reason})`).join("; ") : "none"}`,
    `  manual_review_warnings: ${diagnostics.manualReviewWarnings.length > 0 ? diagnostics.manualReviewWarnings.join("; ") : "none"}`,
    `  selected_highlights: ${diagnostics.selectedHighlights.length > 0 ? diagnostics.selectedHighlights.join("; ") : "none"}`,
    `  fields_filled: ${diagnostics.attemptedFields.length > 0 ? diagnostics.attemptedFields.join(", ") : "none"}`,
    `  fields_verified: ${diagnostics.verifiedFields.length > 0 ? diagnostics.verifiedFields.join(", ") : "none"}`,
    `  fields_attempted_unverified: ${diagnostics.unverifiedFields.length > 0 ? diagnostics.unverifiedFields.join(", ") : "none"}`,
    `  fields_unavailable: ${diagnostics.unavailableFields.length > 0 ? diagnostics.unavailableFields.join(", ") : "none"}`,
    `  fields_not_filled: ${diagnostics.skippedFields.length > 0 ? diagnostics.skippedFields.join(", ") : "none"}`,
    `  fields_manual_review: ${diagnostics.manualFields.length > 0 ? diagnostics.manualFields.join(", ") : "none"}`,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function selectPageForBrowserAction(
  context: { pages?: () => PlaywrightPageLike[]; newPage: () => Promise<PlaywrightPageLike> },
  targetUrl: string,
  options: { protectedApplyUrls?: string[] } = {},
): Promise<{ page: PlaywrightPageLike; reusedExistingPage: boolean; reason: string }> {
  const pages = context.pages?.() ?? [];
  const exactMatch = pages.find((candidate) => urlsReferToSameUpworkJob(candidate.url(), targetUrl) || candidate.url() === targetUrl);
  if (exactMatch) {
    return { page: exactMatch, reusedExistingPage: true, reason: `Reused existing page matching target URL/job token: ${exactMatch.url()}` };
  }
  const protectedApplyUrls = options.protectedApplyUrls ?? [];
  const reusableWorkTab = pages.find((candidate) => isUpworkWorkTabUrl(candidate.url()) && !isProtectedQaApplyTab(candidate.url(), targetUrl, protectedApplyUrls));
  if (reusableWorkTab) {
    return { page: reusableWorkTab, reusedExistingPage: true, reason: `Reused the single active work tab and will navigate it to the target URL: ${reusableWorkTab.url()}` };
  }
  return {
    page: await context.newPage(),
    reusedExistingPage: false,
    reason: protectedApplyUrls.length > 0
      ? "Opened a new page because existing apply tabs are protected while awaiting QA."
      : "Opened a new page because no matching existing Upwork page was found.",
  };
}

function selectVisibleApplicationSnapshotPage(
  context: { pages?: () => PlaywrightPageLike[] },
  targetUrl: string,
): { page: PlaywrightPageLike; reusedExistingPage: true; reason: string } | null {
  const pages = context.pages?.() ?? [];
  const exactMatch = pages.find((candidate) => urlsReferToSameUpworkJob(candidate.url(), targetUrl) || candidate.url() === targetUrl);
  if (!exactMatch) return null;
  return {
    page: exactMatch,
    reusedExistingPage: true,
    reason: `Reused visible application tab for read-only snapshot: ${exactMatch.url()}`,
  };
}

async function cleanStaleWorkTabs(input: {
  context: { pages?: () => PlaywrightPageLike[] };
  selectedPage?: PlaywrightPageLike | null;
  targetUrl: string;
  protectedApplyUrls?: string[];
}): Promise<{ openPagesBefore: number; upworkWorkTabsBefore: number; staleWorkTabsClosed: number; staleWorkTabsIgnored: number; selectedFeedTabUrl?: string }> {
  const pages = input.context.pages?.() ?? [];
  let staleWorkTabsClosed = 0;
  let staleWorkTabsIgnored = 0;
  const selectedFeedTabUrl = pages.find((page) => isUpworkFindWorkFeedUrl(page.url()))?.url();
  const workTabs = pages.filter((page) => isUpworkWorkTabUrl(page.url()));
  for (const page of workTabs) {
    if (page === input.selectedPage) continue;
    if (urlsReferToSameUpworkJob(page.url(), input.targetUrl)) continue;
    if (isProtectedQaApplyTab(page.url(), input.targetUrl, input.protectedApplyUrls ?? [])) {
      staleWorkTabsIgnored += 1;
      continue;
    }
    if (typeof page.close === "function") {
      try {
        await page.close({ runBeforeUnload: false });
        staleWorkTabsClosed += 1;
      } catch {
        staleWorkTabsIgnored += 1;
      }
    } else {
      staleWorkTabsIgnored += 1;
    }
  }
  return {
    openPagesBefore: pages.length,
    upworkWorkTabsBefore: workTabs.length,
    staleWorkTabsClosed,
    staleWorkTabsIgnored,
    ...(selectedFeedTabUrl ? { selectedFeedTabUrl } : {}),
  };
}

function isProtectedQaApplyTab(pageUrl: string, targetUrl: string, protectedApplyUrls: string[]): boolean {
  return protectedApplyUrls.some((protectedUrl) =>
    (pageUrl === protectedUrl || urlsReferToSameUpworkJob(pageUrl, protectedUrl)) &&
    !(targetUrl === protectedUrl || urlsReferToSameUpworkJob(targetUrl, protectedUrl))
  );
}

function currentProtectedQaApplyUrls(): string[] {
  return listProtectedQaApplyUrls(listBrowserActions(null, 1000), getApplicationStatus);
}

export async function readPageOuterHtml(page: PlaywrightPageLike): Promise<string> {
  if (!page.evaluate) return "";
  try {
    return await page.evaluate(() => (globalThis as unknown as { document?: { documentElement?: { outerHTML?: string } } }).document?.documentElement?.outerHTML ?? "");
  } catch {
    return "";
  }
}

async function readVisibleBodyText(page: PlaywrightPageLike, fallback: string): Promise<string> {
  if (!page.evaluate) return fallback;
  try {
    const visibleText = await page.evaluate(() => (globalThis as unknown as { document?: { body?: { innerText?: string } } }).document?.body?.innerText ?? "");
    return typeof visibleText === "string" && visibleText.trim() ? visibleText : fallback;
  } catch {
    return fallback;
  }
}

function buildSourceContextBlockDetection(input: { snapshot: PageSnapshot; bodyText: string; visibleText: string; html: string }): BrowserStateDetection | null {
  const urlValue = input.snapshot.url.toLowerCase();
  const titleValue = input.snapshot.title.toLowerCase();
  const visibleValue = input.visibleText.toLowerCase();
  const bodyValue = input.bodyText.toLowerCase();
  const htmlHeadValue = input.html.slice(0, 3000).toLowerCase();
  const strongSignals = [
    { source: "url" as const, value: "__cf_chl", pattern: "__cf_chl" },
    { source: "url" as const, value: "__cf_chl_rt_tk", pattern: "__cf_chl_rt_tk" },
    { source: "url" as const, value: "/cdn-cgi/challenge", pattern: "/cdn-cgi/challenge" },
    { source: "title" as const, value: "just a moment", pattern: "just a moment" },
    { source: "title" as const, value: "security check", pattern: "security check" },
    { source: "title" as const, value: "attention required", pattern: "attention required" },
    { source: "body_text" as const, value: "verify you are human", pattern: "visible: verify you are human" },
    { source: "body_text" as const, value: "i'm not a robot", pattern: "visible: i'm not a robot" },
    { source: "body_text" as const, value: "i’m not a robot", pattern: "visible: i’m not a robot" },
    { source: "body_text" as const, value: "checking your browser", pattern: "visible: checking your browser" },
    { source: "body_text" as const, value: "checking if the site connection is secure", pattern: "visible: checking if the site connection is secure" },
    { source: "body_text" as const, value: "security check", pattern: "visible: security check" },
    { source: "body_text" as const, value: "unusual traffic", pattern: "visible: unusual traffic" },
  ];
  for (const signal of strongSignals) {
    const haystack = signal.source === "url" ? urlValue : signal.source === "title" ? titleValue : visibleValue;
    if (haystack.includes(signal.value)) {
      return { state: "captcha_or_security_challenge", source: signal.source, matchedText: signal.value, matchedPattern: signal.pattern, matchedVisible: signal.source === "body_text" ? true : "unknown", signalStrength: "strong", summary: `Detected strong source-context blocker from ${signal.source} match: ${signal.value}` };
    }
  }
  const weakSignals = ["captcha", "cloudflare", "challenge", "checking if the site connection is secure", "verify you are human"];
  for (const value of weakSignals) {
    if (bodyValue.includes(value) || htmlHeadValue.includes(value)) {
      return { state: "page_loaded", source: "body_text", matchedText: value, matchedPattern: `weak hidden/full-dom: ${value}`, matchedVisible: false, signalStrength: "weak", summary: `Ignored weak hidden/full-DOM source-context blocker-like text on normal source page: ${value}` };
    }
  }
  return null;
}

function getDiscoveryPayload(action: BrowserAction): { sourceType?: string; sourceLabel?: string; canonicalJobUrl?: string; originalUrl?: string } | null {
  const discovery = action.payload.discovery as { sourceType?: string; sourceLabel?: string; canonicalJobUrl?: string } | undefined;
  const canonicalJobUrl = typeof action.payload.canonicalJobUrl === "string" ? action.payload.canonicalJobUrl : discovery?.canonicalJobUrl;
  if (discovery?.sourceType !== "best_matches" || discovery.sourceLabel !== "Best Matches" || !canonicalJobUrl) return null;
  return {
    sourceType: discovery.sourceType,
    sourceLabel: discovery.sourceLabel,
    canonicalJobUrl,
    originalUrl: typeof action.payload.originalUrl === "string" ? action.payload.originalUrl : undefined,
  };
}

export function isDiscoveryBestMatchesCaptureAction(action: BrowserAction): boolean {
  return action.actionType === "capture_job_from_url" && getDiscoveryPayload(action)?.sourceType === "best_matches";
}

export function isDirectUpworkJobPage(pageUrl: string): boolean {
  try {
    const parsed = new URL(pageUrl);
    return /\/jobs\/(?:~\d{12,24}|[^/?#]+_~\d{12,24})(?:[/?#]|$)/i.test(parsed.pathname + parsed.search + parsed.hash);
  } catch {
    return /\/jobs\/(?:~\d{12,24}|[^/?#]+_~\d{12,24})(?:[/?#]|$)/i.test(pageUrl);
  }
}

export function isDiscoverySourceContextPage(pageUrl: string): boolean {
  return /\/nx\/find-work\/best-matches(?:[/?#]|$)/i.test(pageUrl);
}

function isBestMatchesSourcePage(pageUrl: string): boolean {
  return isDiscoverySourceContextPage(pageUrl) && !isDirectUpworkJobPage(pageUrl);
}

function getTargetJobIdForCapture(action: BrowserAction, targetUrl: string): string | null {
  const payload = getDiscoveryPayload(action);
  const canonicalJobUrl = canonicalizeUpworkJobUrl(payload?.canonicalJobUrl ?? targetUrl);
  return canonicalJobUrl ? extractUpworkJobIdFromUrl(canonicalJobUrl) : null;
}

export function shouldUseDirectFallbackForCaptureAction(action: BrowserAction): boolean {
  return action.actionType === "capture_job_from_url" && !isDiscoveryBestMatchesCaptureAction(action);
}

export async function tryCaptureDiscoverySourceContext(
  context: { pages?: () => PlaywrightPageLike[] },
  action: BrowserAction,
  targetUrl: string,
): Promise<{
  state: DetectedBrowserState;
  snapshot: PageSnapshot;
  bodyText: string;
  extracted: UpworkStructuredExtractionResult;
  detection: BrowserStateDetection;
  sourcePageUrl: string;
  matchedTarget: boolean;
  readable: boolean;
} | null> {
  const payload = getDiscoveryPayload(action);
  const canonicalJobUrl = canonicalizeUpworkJobUrl(payload?.canonicalJobUrl ?? targetUrl);
  const targetJobId = canonicalJobUrl ? extractUpworkJobIdFromUrl(canonicalJobUrl) : null;
  if (!payload || !canonicalJobUrl || !targetJobId || !/^\d{12,24}$/.test(targetJobId)) return null;

  const candidates = (context.pages?.() ?? []).filter((page) => isBestMatchesSourcePage(page.url()));
  for (const page of candidates) {
    const { snapshot, bodyText } = await buildPageSnapshot(page);
    const html = await readPageOuterHtml(page);
    const visibleText = await readVisibleBodyText(page, bodyText);
    const blockDetection = buildSourceContextBlockDetection({ snapshot, bodyText, visibleText, html });
    if (blockDetection?.state === "captcha_or_security_challenge") {
      const extracted = extractUpworkSourceContextJobContent({
        html,
        text: visibleText,
        pageUrl: snapshot.url,
        pageTitle: snapshot.title,
        targetJobId,
        canonicalJobUrl,
      }) ?? {
        rawText: visibleText || bodyText,
        title: snapshot.title,
        description: visibleText || bodyText,
        skills: [],
        applicationQuestions: [],
        diagnostics: {
          titleSource: "page_title",
          descriptionSource: "fallback",
          capturedTitle: snapshot.title,
          descriptionLength: (visibleText || bodyText).length,
          descriptionPreview: (visibleText || bodyText).slice(0, 300),
          removedNoiseMarkers: 0,
          rawConfigNoiseDetected: false,
          lowConfidence: true,
          reasons: ["blocked_source_context_page"],
        },
      };
      return { state: blockDetection.state, snapshot, bodyText: visibleText || bodyText, extracted, detection: blockDetection, sourcePageUrl: snapshot.url, matchedTarget: extracted.rawText.includes(targetJobId), readable: false };
    }
    const extracted = extractUpworkSourceContextJobContent({ html, text: visibleText, pageUrl: snapshot.url, pageTitle: snapshot.title, targetJobId, canonicalJobUrl });
    if (!extracted) continue;
    const state: DetectedBrowserState = extracted.diagnostics.lowConfidence ? "source_context_unavailable" : "captured";
    const detection: BrowserStateDetection = state === "captured"
      ? { state, source: "body_text", matchedText: targetJobId, summary: "Captured Upwork job from Best Matches source context before direct navigation." }
      : { state, source: blockDetection?.source ?? "body_text", matchedText: blockDetection?.matchedText ?? targetJobId, matchedPattern: blockDetection?.matchedPattern, matchedVisible: blockDetection?.matchedVisible ?? false, signalStrength: blockDetection?.signalStrength ?? "weak", summary: "Source context matched target but readable job content was low confidence; direct fallback is disabled for discovery-origin captures." };
    return { state, snapshot: { ...snapshot, url: canonicalJobUrl }, bodyText: visibleText || bodyText, extracted, detection, sourcePageUrl: snapshot.url, matchedTarget: true, readable: state === "captured" };
  }
  return null;
}

export async function settlePageAndDetect(
  page: PlaywrightPageLike,
  action: BrowserAction,
): Promise<{ snapshot: PageSnapshot; bodyText: string; detection: BrowserStateDetection; samples: BrowserInspectionDiagnostics["settleSamples"] }> {
  const samples: BrowserInspectionDiagnostics["settleSamples"] = [];
  let finalSnapshot: PageSnapshot = { url: "", title: "", textExcerpt: "" };
  let finalBodyText = "";
  let finalDetection: BrowserStateDetection = { state: "no_url", source: "none", summary: "No page sampled." };

  for (let index = 0; index < 3; index += 1) {
    if (index > 0) {
      await sleep(1200);
    }
    const { snapshot, bodyText } = await buildPageSnapshot(page);
    const detection = detectStateWithDiagnostics(snapshot, action);
    samples.push({
      step: index + 1,
      url: snapshot.url,
      title: snapshot.title,
      textExcerpt: snapshot.textExcerpt,
      detection,
    });
    finalSnapshot = snapshot;
    finalBodyText = bodyText;
    finalDetection = detection;
    if (!["login_required", "two_factor_required", "captcha_or_security_challenge", "page_loaded"].includes(detection.state)) {
      break;
    }
  }

  return { snapshot: finalSnapshot, bodyText: finalBodyText, detection: finalDetection, samples };
}

export async function postV3CapturePacketToThread(
  job: ScoredJob,
  thread: SlackThreadContext,
  context: SlackPacketV3Context,
  postThreadMessage: typeof postSlackThreadMessage = postSlackThreadMessage,
): Promise<"posted" | "skipped" | "failed"> {
  const postingDecision = getSlackLeadPostingDecision(job, context);
  if (!postingDecision.shouldPost) {
    const intelligence = context.jobIntelligence ?? job.applicationDraft?.jobIntelligence;
    logger.info(
      `Lead not posted to Slack: jobId=${job.id} primaryPlatform=${intelligence?.primaryPlatform ?? "unknown"} ` +
      `platformEligibility=${postingDecision.platformEligibility} skippedBecausePlatform=${postingDecision.skippedBecausePlatform} ` +
      `reason=${postingDecision.reason} internalSkipReason=${postingDecision.internalSkipReason ?? "none"}`
    );
    return "skipped";
  }
  const packet = await writeV3CapturePacketWithLlm(job, context);
  const workflowState = job.applicationDraft?.proofStrategy ? "proof_plan_ready" : "draft_ready";
  const stateKey = slackPromiseStateKey([
    "capture_draft_proof_plan_ready",
    job.id,
    job.applicationDraft?.proposalVersion,
    job.applicationDraft?.generatedAt,
    context.browserCaptureActionId,
  ]);
  const result = await postSlackPromiseNotification({
    channelId: thread.channelId,
    threadTs: thread.threadTs,
    plan: {
      notificationType: "capture_draft_proof_plan_ready",
      workflowState,
      stateKey,
      text: packet.text,
      promiseStatus: "fulfilled",
    },
    postThreadMessage: async () => postThreadMessage({
      channel: thread.channelId,
      threadTs: thread.threadTs,
      text: packet.text,
      blocks: packet.blocks,
    }),
  });
  if (result.posted && job.applicationDraft) {
    updateApplicationStatus(job.id, "sent_to_slack", "Lead packet posted to Slack for review.");
  } else if (result.status === "failed") {
    markSlackWorkflowPromiseStatus({
      channelId: thread.channelId,
      threadTs: thread.threadTs,
      status: "blocked",
      workflowState: "capture_failed",
      blocker: "Capture completed, but the Slack draft/proof plan post failed.",
      lastAgentReply: "Capture completed, but the Slack draft/proof plan post failed.",
    });
  }
  return result.posted ? "posted" : result.duplicate ? "skipped" : "failed";
}

function buildPrepareDraftStatusMessage(input: {
  heading: string;
  diagnostics: ApplyPreparationDiagnostics;
  nextCommand?: string;
}): string {
  const { diagnostics } = input;
  const fieldVerification = diagnostics.fieldVerification ?? [];
  const coverLetterVerification = getVerification(fieldVerification, "coverLetter");
  const screeningVerification = getVerification(fieldVerification, "screeningAnswers");
  const attachmentVerification = getVerification(fieldVerification, "attachments");
  const highlightVerification = getVerification(fieldVerification, "profileHighlights");
  const targetTabVerification = getVerification(fieldVerification, "targetTab");
  const connectsNotVerified = isConnectsNotVerified(diagnostics);
  const needsManualReview = diagnostics.validationIssues.some((issue) => issue.severity === "warning" || issue.severity === "error") ||
    diagnostics.missingLocalAssets.length > 0 ||
    diagnostics.manualFields.some((field) => field !== "finalSubmit") ||
    diagnostics.connectsDecision !== "safe_apply" ||
    hasUnverifiedRequiredApplyFields(fieldVerification);
  const readyForFinalManualSubmit = diagnostics.state === "apply_page_loaded" && diagnostics.stopBeforeSubmit && !needsManualReview;
  const coverLetterSummary = coverLetterVerification?.status === "verified"
    ? "filled"
    : coverLetterVerification?.status === "attempted_unverified"
      ? "attempted, not verified"
      : coverLetterVerification?.status === "blocked_by_upwork_ui"
        ? "blocked by Upwork UI"
        : "not verified";
  const screeningSummary = screeningVerification?.status === "verified"
    ? "filled"
    : screeningVerification?.status === "skipped_by_strategy"
      ? "none generated"
      : "needs QA";
  const selectedFiles = (diagnostics.filesAttached ?? []).length > 0
    ? (diagnostics.filesAttached ?? []).map((item) => path.basename(item)).slice(0, 3)
    : (diagnostics.selectedAttachments ?? []).slice(0, 3);
  const selectedPortfolio = (diagnostics.selectedHighlights ?? diagnostics.profileHighlights ?? diagnostics.portfolioHighlights ?? []).slice(0, 2);
  const plannedProofParts = [
    selectedPortfolio.length > 0 ? `Portfolio: ${selectedPortfolio.join(", ")}` : null,
    selectedFiles.length > 0 ? `Files: ${selectedFiles.join(", ")}` : null,
  ].filter((item): item is string => Boolean(item));
  const plannedProofSummary = plannedProofParts.length > 0 ? plannedProofParts.join("; ") : "none selected";
  const proofFilesSummary = selectedFiles.length > 0 ? selectedFiles.join(", ") : "none";
  const portfolioSummary = selectedPortfolio.length > 0 ? selectedPortfolio.join(", ") : "none";
  const attachmentsVerified = selectedFiles.length === 0 || attachmentVerification?.status === "verified";
  const portfolioVerified = selectedPortfolio.length === 0 || highlightVerification?.status === "verified";
  const proofVerified = plannedProofParts.length > 0 && attachmentsVerified && portfolioVerified;
  const proofLabel = proofVerified ? "Proof verified" : "Proof planned";
  const correctionLine = "You can correct proof here in Slack: “Use Fly Boutique instead”, “Remove the intro PDF”, “Attach Design Case Studies too”, “Use Truly + Lifely”, “Don’t attach screenshots”, or “Use portfolio only”.";
  const missingFiles = diagnostics.missingLocalAssets.map((asset) => path.basename(asset)).slice(0, 2);
  const manualFields = [
    ...(diagnostics.unverifiedFields ?? []),
    ...(diagnostics.unavailableFields ?? []),
    ...(diagnostics.blockedByUiFields ?? []),
  ].filter((field) => field !== "finalSubmit" && !(connectsNotVerified && field === "requiredConnects")).slice(0, 5);
  const reviewItems = [
    missingFiles.length > 0 ? `${missingFiles.length} missing file${missingFiles.length === 1 ? "" : "s"}: ${missingFiles.join(", ")}` : null,
    targetTabVerification && targetTabVerification.status !== "verified" ? targetTabVerification.detail : null,
    manualFields.length > 0 ? `Not verified: ${manualFields.join(", ")}` : null,
    diagnostics.connectsDecision !== "safe_apply" ? (connectsNotVerified ? "Connects not verified" : "Connects need a quick look") : null,
    diagnostics.validationIssues.find((issue) => issue.severity === "error")?.message,
  ].filter((item): item is string => Boolean(item));
  const reviewText = reviewItems.length > 0 ? reviewItems.slice(0, 3).map(humanSlackPrepDetail).join("; ") : "none";
  const submitLabel = diagnostics.requiredConnects === null ? "Submit" : `Send for ${diagnostics.requiredConnects} Connects`;
  const connectsSummary = diagnostics.requiredConnects === null ? "not verified" : `${diagnostics.requiredConnects} required`;
  const boostSummary = diagnostics.boostConnects && diagnostics.boostConnects > 0
    ? `${diagnostics.boostConnects} selected, under your 50 cap`
    : "not set yet";

  if (readyForFinalManualSubmit) {
    return [
      "✅ *Ready for QA*",
      "",
      "I prepared this in remote Chrome and stopped before submit.",
      "Nothing submitted: I did not click the final Upwork submit button.",
      "",
      [
        `• *Cover letter:* ${coverLetterSummary}`,
        `• *Screening answers:* ${screeningSummary}`,
        `• *${proofLabel}:* ${plannedProofSummary}`,
        `• *Proof files:* ${proofFilesSummary}`,
        `• *Portfolio:* ${portfolioSummary}`,
        `• *Connects:* ${connectsSummary}`,
        `• *Boost:* ${boostSummary}`,
        "• *Final submit:* untouched — nothing submitted",
      ].join("\n"),
      "",
      correctionLine,
      "",
      `*Next:* review in VNC. Reply with changes, or manually click *${submitLabel}* if it looks good.`,
    ].join("\n");
  }

  if (connectsNotVerified) {
    return [
      "⚠️ *I couldn’t verify the Connects cost yet.*",
      "",
      "I can see the proposal page, but the Connects section isn’t readable right now. I left submit untouched and skipped boost for now.",
      "Nothing submitted: I did not click the final Upwork submit button.",
      "",
      "What I planned:",
      [
        `• *Cover letter:* ${coverLetterSummary}`,
        `• *Screening answers:* ${screeningSummary}`,
        `• *${proofLabel}:* ${plannedProofSummary}`,
        `• *Proof files:* ${proofFilesSummary}`,
        `• *Portfolio:* ${portfolioSummary}`,
        "• *Connects:* not verified",
        "• *Boost:* not set yet",
        "• *Final submit:* untouched — nothing submitted",
      ].join("\n"),
      "",
      `*Next:* I’ll keep the application open in remote Chrome. Reply “retry” after the page finishes loading, or “open it” and I’ll bring the tab forward.`,
    ].join("\n");
  }

  const blockerReason = isBrowserChallengeState(diagnostics.state)
    ? "Upwork is asking for a browser check."
    : reviewText === "none"
      ? "Something on the apply page still needs a quick QA look before I call it ready."
      : `Some apply-page fields still need QA: ${reviewText}.`;
  const nextStep = isBrowserChallengeState(diagnostics.state)
    ? "clear it in remote Chrome, then reply “retry” and I’ll pick this back up."
    : "reply “retry” after the page finishes loading, or “open it” and I’ll bring the tab forward.";
  return [
    "⚠️ *Blocked before QA*",
    "",
    isBrowserChallengeState(diagnostics.state)
      ? blockerReason
      : `I reached the Upwork apply page, but ${blockerReason}`,
    "Nothing submitted: I did not click the final Upwork submit button.",
    "",
    "What I planned:",
    [
      `• *Cover letter:* ${diagnostics.coverLetterPresent ? "drafted" : "not generated yet"}`,
      `• *${proofLabel}:* ${plannedProofSummary}`,
      `• *Proof files:* ${proofFilesSummary}`,
      `• *Portfolio:* ${portfolioSummary}`,
      `• *Connects:* ${connectsSummary}`,
      `• *Boost:* ${boostSummary}`,
      "• *Final submit:* untouched — nothing submitted",
    ].join("\n"),
    "",
    `*Next:* ${nextStep}`,
  ].join("\n");
}

export async function postPrepareDraftStatus(
  input: {
    thread?: SlackThreadContext | null;
    heading: string;
    diagnostics: ApplyPreparationDiagnostics;
    nextCommand?: string;
  },
  deps: {
    postThreadMessage?: typeof postSlackThreadMessage;
    postChannelMessage?: typeof postSlackChannelMessage;
    postWebhookMessage?: typeof sendSlackMessage;
    copyProvider?: SlackCopyProvider;
  } = {},
): Promise<"posted" | "skipped" | "failed"> {
  if (isBrowserChallengeState(input.diagnostics.state)) {
    const incident = markBrowserManualAttentionThreadAlert({
      actionId: input.diagnostics.actionId,
      jobId: input.diagnostics.jobId,
      url: input.diagnostics.applyUrl ?? input.diagnostics.sourceUrl,
      reason: input.diagnostics.state,
    });
    if (!incident.shouldPost) {
      logger.info(`Suppressed duplicate browser-check QA handoff. incidentKey=${incident.incidentKey}`);
      return "skipped";
    }
  }
  const deterministicText = buildPrepareDraftStatusMessage(input);
  const safetyPhrases = [
    "Final submit remains manual.",
    "• *Final submit:* untouched — nothing submitted",
    ...(deterministicText.includes("Proof planned") ? ["Proof planned"] : []),
    ...(deterministicText.includes("Proof verified") ? ["Proof verified"] : []),
  ];
  const copy = await rewriteSlackCopyWithKimi({
    path: "qa_handoff",
    deterministicText,
    intent: "prepare_application_review_status",
    context: {
      browserState: input.diagnostics.state,
      blockerType: isConnectsNotVerified(input.diagnostics)
        ? "connects_not_verified"
        : isBrowserChallengeState(input.diagnostics.state)
          ? "browser_check"
          : "apply_page_needs_review",
      stopBeforeSubmit: input.diagnostics.stopBeforeSubmit,
      filesAttachedCount: input.diagnostics.filesAttached?.length ?? 0,
      selectedHighlightsCount: input.diagnostics.selectedHighlights?.length ?? 0,
      connectsVerified: input.diagnostics.requiredConnects !== null,
      boostVerified: Boolean(input.diagnostics.boostConnects && input.diagnostics.boostConnects > 0),
    },
    preservePhrases: safetyPhrases,
  }, deps.copyProvider);
  const text = copy.text;
  if (input.thread) {
    const result = await postSlackPromiseNotification({
      channelId: input.thread.channelId,
      threadTs: input.thread.threadTs,
      plan: promiseNotificationForPrepareDraftStatus({ diagnostics: input.diagnostics, text }),
      postThreadMessage: async (target) => (deps.postThreadMessage ?? postSlackThreadMessage)(target),
    });
    return result.posted ? "posted" : result.duplicate ? "skipped" : "failed";
  }

  const discoveryChannelId = DISCOVERY_SLACK_CHANNEL_ID.trim();
  if (discoveryChannelId) {
    const result = await (deps.postChannelMessage ?? postSlackChannelMessage)({
      channel: discoveryChannelId,
      text,
    });
    if (result.ok) return "posted";
  }

  const postWebhookMessage = deps.postWebhookMessage ?? sendSlackMessage;
  const canUseWebhook = Boolean(deps.postWebhookMessage) || Boolean(SLACK_CHANNEL_WEBHOOK_URL.trim());
  if (!canUseWebhook) {
    return "skipped";
  }

  const sent = await postWebhookMessage({ text });
  return sent ? "posted" : "failed";
}

function countPrepareDraftStatusPost(result: ProcessActionResult, postStatus: "posted" | "skipped" | "failed"): void {
  if (postStatus === "posted") {
    result.slackPostsSucceeded += 1;
  } else if (postStatus === "failed") {
    result.slackPostFailures += 1;
  }
}

function promiseNotificationForPrepareDraftStatus(input: {
  diagnostics: ApplyPreparationDiagnostics;
  text: string;
}): SlackPromiseNotificationPlan {
  const isReady = input.diagnostics.state === "apply_page_loaded";
  const blocker = isReady ? null : stateStatusMessage(input.diagnostics.state as DetectedBrowserState);
  return {
    notificationType: isReady ? "qa_ready" : "qa_blocked",
    workflowState: isReady ? "qa_ready" : "qa_blocked",
    stateKey: slackPromiseStateKey([
      isReady ? "qa_ready" : "qa_blocked",
      input.diagnostics.jobId,
      input.diagnostics.state,
      input.diagnostics.coverLetterLength,
      (input.diagnostics.filesAttached ?? []).join(","),
      (input.diagnostics.selectedHighlights ?? []).join(","),
      (input.diagnostics.validationIssues ?? []).map((issue) => issue.code).join(","),
    ]),
    text: input.text,
    soulComposed: true,
    promiseStatus: isReady ? "fulfilled" : "blocked",
    blocker,
  };
}

async function postSoulAwareBrowserThreadMessage(input: {
  thread: SlackThreadContext;
  deterministicText: string;
  intent: string;
  context?: Record<string, unknown>;
  preservePhrases?: string[];
}): Promise<boolean> {
  const copy = await rewriteSlackCopyWithKimi({
    path: "conversation_reply",
    deterministicText: input.deterministicText,
    intent: input.intent,
    context: input.context,
    preservePhrases: input.preservePhrases,
  });
  return postSlackThreadMessage({
    channel: input.thread.channelId,
    threadTs: input.thread.threadTs,
    text: copy.text,
    soulComposed: true,
  });
}

async function postCaptureBlockerNotification(input: {
  thread: SlackThreadContext | null;
  action: BrowserAction;
  reason: string;
  nextSafeAction?: string;
  stateKeyPart?: string | null;
}): Promise<"posted" | "skipped" | "failed"> {
  if (!input.thread) return "skipped";
  const text = buildBlockerNotificationText({
    fallbackLabel: typeof input.action.payload.url === "string" ? input.action.payload.url : input.action.jobId,
    reason: input.reason,
    nextSafeAction: input.nextSafeAction ?? "Reply \"retry capture\" in this thread after the page is readable, or send the listing link again.",
  });
  const result = await postSlackPromiseNotification({
    channelId: input.thread.channelId,
    threadTs: input.thread.threadTs,
    plan: {
      notificationType: "capture_blocked",
      workflowState: "capture_failed",
      stateKey: slackPromiseStateKey(["capture_blocked", input.action.jobId, input.stateKeyPart, input.reason]),
      text,
      promiseStatus: "blocked",
      blocker: input.reason,
    },
    postThreadMessage: async (target) => postSlackThreadMessage(target),
  });
  return result.posted ? "posted" : result.duplicate ? "skipped" : "failed";
}

function updateCaptureThreadStates(
  action: BrowserAction,
  status: string,
  options?: { jobId?: string | null; upworkUrl?: string | null }
): void {
  for (const target of getSlackThreadContextsForCaptureAction(action)) {
    updateSlackThreadStateStatus(target.channelId, target.threadTs, status, {
      jobId: options?.jobId ?? action.jobId,
      upworkUrl: options?.upworkUrl ?? (typeof action.payload.url === "string" ? action.payload.url : undefined),
    });
  }
}

async function postCaptureBlockerNotificationsForAction(input: {
  action: BrowserAction;
  reason: string;
  nextSafeAction?: string;
  stateKeyPart?: string | null;
}): Promise<{ posted: number; failed: number }> {
  let posted = 0;
  let failed = 0;
  const threads = getSlackThreadContextsForCaptureAction(input.action);
  for (const target of threads) {
    const status = await postCaptureBlockerNotification({
      thread: target,
      action: input.action,
      reason: input.reason,
      nextSafeAction: input.nextSafeAction,
      stateKeyPart: input.stateKeyPart,
    });
    if (status === "posted") posted += 1;
    if (status === "failed") failed += 1;
  }
  return { posted, failed };
}

async function postV3CapturePacketToThreads(input: {
  action: BrowserAction;
  job: ScoredJob;
  context: SlackPacketV3Context;
}): Promise<{ posted: number; failed: number; skipped: number }> {
  let posted = 0;
  let failed = 0;
  let skipped = 0;
  for (const target of getSlackThreadContextsForCaptureAction(input.action)) {
    updateSlackThreadStateStatus(target.channelId, target.threadTs, "captured", { jobId: input.job.id });
    updateSlackThreadStateStatus(target.channelId, target.threadTs, "scored", { jobId: input.job.id });
    const status = await postV3CapturePacketToThread(input.job, target, input.context);
    if (status === "posted") {
      posted += 1;
    } else if (status === "failed") {
      failed += 1;
    } else {
      skipped += 1;
    }
  }
  return { posted, failed, skipped };
}

function hasHardRedFlags(job: ScoredJob): boolean {
  const redFlagTerms = ["scam", "commission only", "full-time", "full time", "on-site", "onsite", "w2", "verification", "blocked"];
  const signals = [
    ...(job.scoreBreakdown?.risks ?? []),
    ...(job.applicationDraft?.redFlags ?? []),
  ].map((item) => item.toLowerCase());
  return (job.scoreBreakdown?.redFlagScore?.score ?? 100) < 40 || signals.some((item) => redFlagTerms.some((term) => item.includes(term)));
}

function requiredConnectsForSlack(job: ScoredJob): number | undefined {
  const sourceBacked = job.applicationDraft?.connectsStrategy?.sourceBackedConnects ?? job.scoreBreakdown?.connectsStrategy?.sourceBackedConnects ?? job.connects;
  if (sourceBacked) return sourceBacked.requiredConnects ?? undefined;
  const draftRequired = job.applicationDraft?.suggestedConnects;
  if (draftRequired && draftRequired > 0) return draftRequired;
  return job.connectsCost > 0 ? job.connectsCost : undefined;
}

function boostConnectsForSlack(job: ScoredJob): number | undefined {
  const sourceBacked = job.applicationDraft?.connectsStrategy?.sourceBackedConnects ?? job.scoreBreakdown?.connectsStrategy?.sourceBackedConnects ?? job.connects;
  if (sourceBacked?.requiredConnects === null) return undefined;
  return job.applicationDraft?.suggestedBoostConnects ?? job.scoreBreakdown?.connectsStrategy?.suggestedBoostConnects ?? undefined;
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
  if (!draft.jobIntelligence) {
    return {
      shouldQueue: false,
      category: "skipped_manual_override_available",
      reason: "job intelligence missing",
      note: "Not auto-preparing until job intelligence and platform eligibility are available or manually reviewed. You can still reply `prepare draft` after review.",
    };
  }
  const leadDecision = decideLeadHandling(job, draft.jobIntelligence);
  if (leadDecision.decision === "skip") {
    return {
      shouldQueue: false,
      category: "blocked_no_manual_override",
      reason: "lead decision skip",
      note: `Not auto-preparing because lead decision is skip. ${leadDecision.reason}`,
    };
  }
  if (leadDecision.decision === "manual_review") {
    return {
      shouldQueue: false,
      category: "skipped_manual_override_available",
      reason: "lead decision manual review",
      note: `Not auto-preparing until manual review is completed. ${leadDecision.reason} You can still reply \`prepare draft\` after review.`,
    };
  }
  const connectsStrategy = draft.connectsStrategy ?? job.scoreBreakdown.connectsStrategy;
  if (connectsStrategy?.decision === "skip") {
    return {
      shouldQueue: false,
      category: "blocked_no_manual_override",
      reason: "connects strategy skip",
      note: "Not auto-preparing because the Connects strategy says expected value is too weak. Do not spend Connects on this lead without explicit review.",
    };
  }
  if (connectsStrategy?.decision === "manual_review") {
    return {
      shouldQueue: false,
      category: "skipped_manual_override_available",
      reason: "connects strategy manual review",
      note: "Not auto-preparing because Connects spend needs manual review. Reply `prepare draft` only after confirming the spend is worth it.",
    };
  }
  const eligibility = evaluatePlatformEligibility(draft.jobIntelligence);
  if (eligibility.platformEligibility === "ineligible") {
    return {
      shouldQueue: false,
      category: "blocked_no_manual_override",
      reason: "platform ineligible",
      note: `Not auto-preparing because platform is currently ineligible. ${eligibility.eligibilityReason}`,
    };
  }
  if (eligibility.platformEligibility === "manual_review") {
    return {
      shouldQueue: false,
      category: "skipped_manual_override_available",
      reason: "platform manual review",
      note: `Not auto-preparing until platform is confirmed. ${eligibility.eligibilityReason} You can still reply \`prepare draft\` after manual review.`,
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
      note: "Not auto-preparing because Upwork needs manual browser attention. Resolve the browser issue first, then reply `retry` in the Slack thread. I did not submit anything.",
    };
  }
  const qaCapacity = canQueueNewQaPreparation(job.id);
  if (!qaCapacity.ok) {
    return {
      shouldQueue: false,
      category: "blocked_no_manual_override",
      reason: "protected QA workspace full",
      note: `I have ${qaCapacity.count} applications waiting for QA. I’ll pause new prep until you submit/skip one.`,
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

function queuePrepareDraftAction(
  job: ScoredJob,
  thread: SlackThreadContext | null,
): AutoPrepareDraftDecision {
  const action = enqueueBrowserActionDeduped({
    jobId: job.id,
    actionType: "prepare_application_review",
    payload: {
      url: job.url,
      ...(thread ? {
        channelId: thread.channelId,
        threadTs: thread.threadTs,
        messageTs: thread.messageTs,
      } : {}),
      applicationId: job.id,
      autoPrepareSource: thread ? "slack_thread_capture" : "autonomous_discovery_capture",
      notes: thread
        ? "Auto-prepare browser draft from browser capture worker. Prepare review only; do not submit."
        : "Auto-prepare browser draft from autonomous discovery capture. Prepare review only; do not submit.",
    },
  });
  const duplicateAction = action.duplicate ? getBrowserActionById(action.id) : null;
  return {
    shouldQueue: !action.duplicate,
    category: action.duplicate ? "duplicate_existing_action" : "eligible_auto_prepare",
    reason: action.duplicate ? "duplicate prepare action exists" : "eligible",
    note: action.duplicate
      ? `Draft preparation is already ${duplicateAction?.status ?? "queued"}. No duplicate was created.`
      : "Strong fit. I’m preparing the Upwork draft now. Final submit remains manual.",
    actionId: action.id,
    duplicate: action.duplicate,
    duplicateStatus: duplicateAction?.status ?? null,
  };
}

export function autoQueuePrepareDraft(
  job: ScoredJob,
  options: AutoPrepareDraftOptions = {},
  thread: SlackThreadContext | null = null,
): AutoPrepareDraftDecision {
  const decision = decideAutoPrepareDraft(job, options);
  if (!decision.shouldQueue) {
    return decision;
  }
  return queuePrepareDraftAction(job, thread);
}

export function autoPrepareDraftForThread(
  job: ScoredJob,
  thread: SlackThreadContext,
  options: AutoPrepareDraftOptions = {},
): AutoPrepareDraftDecision {
  return autoQueuePrepareDraft(job, options, thread);
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
        await locator.fill("", { timeout: 1500 });
        await locator.fill(value, { timeout: 1500 });
        return true;
      }
    } catch {
      // Try the next conservative selector.
    }
  }
  return false;
}

function hourlyRateInputValue(value: string): string | null {
  const match = value.match(/\d+(?:\.\d+)?/);
  return match?.[0] ?? null;
}

async function tryFillScreeningAnswers(page: PlaywrightPageLike, answers: string[]): Promise<{ filled: number; skipped: number }> {
  const cleanAnswers = answers.map((answer) => answer.trim()).filter(Boolean);
  if (cleanAnswers.length === 0) return { filled: 0, skipped: 0 };

  const textareas = page.locator("textarea");
  if (typeof textareas.nth !== "function") {
    return { filled: 0, skipped: cleanAnswers.length };
  }

  const count = await textareas.count();
  if (count <= 1) {
    return { filled: 0, skipped: cleanAnswers.length };
  }

  let filled = 0;
  for (let index = 0; index < cleanAnswers.length && index + 1 < count; index += 1) {
    try {
      await textareas.nth(index + 1).fill(cleanAnswers[index], { timeout: 1500 });
      filled += 1;
    } catch {
      // Leave the remaining answer for manual review rather than risking a wrong field.
      break;
    }
  }

  return { filled, skipped: cleanAnswers.length - filled };
}

async function tryClickFirst(page: PlaywrightPageLike, targets: Array<{ selector: string; label: string }>): Promise<boolean> {
  for (const target of targets) {
    const locator = page.locator(target.selector).first();
    try {
      if ((await locator.count()) > 0 && typeof locator.click === "function") {
        await guardedClick(locator as PlaywrightLocatorLike & { click(options?: { timeout?: number }): Promise<unknown> }, { selector: target.selector, label: target.label }, { timeout: 1500 });
        return true;
      }
    } catch {
      // Try the next conservative selector. Final submit/send buttons are blocked by guardedClick.
    }
  }
  return false;
}

async function tryClickApplyNow(page: PlaywrightPageLike): Promise<boolean> {
  return tryClickFirst(page, [
    { selector: "a:has-text('Apply now')", label: "Apply now" },
    { selector: "button:has-text('Apply now')", label: "Apply now" },
    { selector: "[role='button']:has-text('Apply now')", label: "Apply now" },
  ]);
}

function profileNeedsExplicitSelection(profile: string): boolean {
  return Boolean(profile.trim()) && !/default\s+upwork\s+profile|verify\s+manually/i.test(profile);
}

async function trySelectProposalSettings(page: PlaywrightPageLike, plan: BrowserApplyFillPlan): Promise<{ attempted: string[]; manual: string[] }> {
  const attempted: string[] = [];
  const manual: string[] = [];

  if (await tryClickFirst(page, [
    { selector: "label:has-text('Freelancer')", label: "Freelancer proposal setting" },
    { selector: "button:has-text('Freelancer')", label: "Freelancer proposal setting" },
    { selector: "[role='radio']:has-text('Freelancer')", label: "Freelancer proposal setting" },
    { selector: "label:has-text('Individual')", label: "Individual proposal setting" },
  ])) {
    attempted.push("proposalSettings:freelancer");
  }

  if (profileNeedsExplicitSelection(plan.profile)) {
    const escapedProfile = plan.profile.replace(/["\\]/g, "\\$&");
    if (await tryClickFirst(page, [
      { selector: `label:has-text("${escapedProfile}")`, label: plan.profile },
      { selector: `button:has-text("${escapedProfile}")`, label: plan.profile },
      { selector: `[role='radio']:has-text("${escapedProfile}")`, label: plan.profile },
      { selector: `[role='option']:has-text("${escapedProfile}")`, label: plan.profile },
    ])) {
      attempted.push("profile");
    } else {
      manual.push("profile");
    }
  }

  return { attempted, manual };
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
  const selectors = [
    `label:has-text("${escaped}") input[type='checkbox']`,
    `label:has-text("${escaped}")`,
    `button:has-text("${escaped}")`,
    `[role='option']:has-text("${escaped}")`,
    `[role='checkbox']:has-text("${escaped}")`,
    `text="${escaped}"`,
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0) {
        try {
          await locator.check({ timeout: 1500 });
        } catch {
          if (typeof locator.click !== "function") throw new Error("Highlight locator was not clickable.");
          await guardedClick(locator as PlaywrightLocatorLike & { click(options?: { timeout?: number }): Promise<unknown> }, { selector, label: highlight }, { timeout: 1500 });
        }
        return true;
      }
    } catch {
      // Try the next conservative selector.
    }
  }
  return false;
}

async function trySelectProofFromSelector(page: PlaywrightPageLike, highlight: string): Promise<boolean> {
  if (await tryCheckHighlight(page, highlight)) return true;
  const opened = await tryClickFirst(page, [
    { selector: "button:has-text('Add portfolio project')", label: "Add portfolio project" },
    { selector: "a:has-text('Add portfolio project')", label: "Add portfolio project" },
    { selector: "[role='button']:has-text('Add portfolio project')", label: "Add portfolio project" },
    { selector: "button:has-text('Add certificate')", label: "Add certificate" },
    { selector: "a:has-text('Add certificate')", label: "Add certificate" },
    { selector: "[role='button']:has-text('Add certificate')", label: "Add certificate" },
  ]);
  if (!opened) return false;
  const selected = await tryCheckHighlight(page, highlight);
  if (!selected) return false;
  await tryClickFirst(page, [
    { selector: "button:has-text('Add')", label: "Confirm proof selection" },
    { selector: "button:has-text('Save')", label: "Save proof selection" },
    { selector: "button:has-text('Done')", label: "Done proof selection" },
  ]);
  return true;
}

function assertSubmitGuard(plan: BrowserApplyFillPlan | null): asserts plan is BrowserApplyFillPlan {
  if (!plan || plan.stopBeforeSubmit !== true) {
    throw new Error("Submit guard failed: stopBeforeSubmit must be true for browser apply preparation.");
  }
}

function getRequiredSkippedFields(fields: Pick<ApplyPreparationDiagnostics, "skippedFields">): string[] {
  return fields.skippedFields.filter((field) => ["coverLetter", "rate", "connectsBoost"].includes(field));
}

function removeConnectsVerificationIssues(issues: BrowserApplyValidationIssue[]): void {
  const verificationCodes = new Set([
    "required_connects_unknown_apply_page_verification",
    "connects_apply_page_verification_required",
    "connects_approval_required",
  ]);
  for (let index = issues.length - 1; index >= 0; index -= 1) {
    if (verificationCodes.has(issues[index].code)) issues.splice(index, 1);
  }
}

function removeUnknownConnectsRisks(risks: string[]): string[] {
  return risks.filter((risk) => !/required connects are unknown|without a source-backed required cost|connects total is unknown/i.test(risk));
}

function verifyApplyPageConnects(plan: BrowserApplyFillPlan, bodyText: string): BrowserApplyValidationIssue[] {
  const issues = plan.validationIssues;
  const extracted = extractConnectsFromVisibleText(bodyText);
  if (extracted.requiredConnects === null) {
    const issue = {
      severity: "warning" as const,
      code: "required_connects_unverified_on_apply_page",
      message: "Required Connects were not visible on the apply page yet; leave boost unset and verify Connects during QA.",
    };
    plan.connects.required = null;
    plan.connects.boost = 0;
    plan.connects.total = null;
    plan.connects.approvalRequired = true;
    plan.connects.notes = [
      "Connects not verified on the apply page.",
      "Boost skipped until the Connects and boost table are readable.",
    ];
    plan.connectsStrategy.suggestedBoostConnects = 0;
    plan.connectsStrategy.totalConnects = null;
    plan.connectsStrategy.decision = "manual_review";
    plan.connectsStrategy.sourceBackedConnects = {
      ...extracted,
      boostConnects: null,
      totalConnects: null,
    };
    issues.push(issue);
    return [issue];
  }

  removeConnectsVerificationIssues(issues);
  const requestedBoost = plan.connects.boost ?? 0;
  const visibleBoostBids = extractVisibleBoostBids(bodyText);
  const visibleBoostDecision = chooseVisibleBoost({
    requiredConnects: extracted.requiredConnects,
    expectedValueScore: plan.connectsStrategy.expectedValueScore,
    clientQualityScore: plan.connectsStrategy.decision === "safe_apply" ? 60 : 0,
    opportunityScore: plan.connectsStrategy.decision === "safe_apply" ? 60 : 0,
    currentBids: visibleBoostBids,
  });
  const plannedBoost = 0;
  if (requestedBoost > 50) {
    issues.push({
      severity: "warning",
      code: "boost_hard_cap_applied",
      message: `Requested boost ${requestedBoost} exceeds the hard cap 50; boost was capped before any browser fill attempt.`,
    });
  } else if (requestedBoost > 0 || visibleBoostDecision.boostConnects > 0) {
    issues.push({
      severity: "warning",
      code: "boost_requires_explicit_approval",
      message: "Optional boost was left unset; explicit approval is required before setting boost Connects.",
    });
  }
  const required = extracted.requiredConnects;
  const total = required + plannedBoost;
  const requiresManualReview = total > AUTO_PREPARE_MAX_CONNECTS;
  plan.connects.required = required;
  plan.connects.boost = plannedBoost;
  plan.connects.total = total;
  plan.connects.approvalRequired = requiresManualReview;
  plan.connects.notes = [
    `Required Connects verified on the apply page (${required}).`,
    "No boost set; optional boost requires explicit approval.",
    visibleBoostDecision.skippedReason ? `Boost skipped: ${visibleBoostDecision.skippedReason}` : null,
    visibleBoostDecision.boostConnects > 0 ? `Visible boost option ${visibleBoostDecision.boostConnects} was not selected automatically.` : null,
    requestedBoost > 0 ? `Initial boost request ${requestedBoost} was left unset pending explicit approval.` : null,
  ].filter((line): line is string => Boolean(line));
  plan.connectsStrategy.requiredConnects = required;
  plan.connectsStrategy.suggestedBoostConnects = plannedBoost;
  plan.connectsStrategy.totalConnects = total;
  (plan.connectsStrategy as typeof plan.connectsStrategy & { visibleBoostBids?: VisibleBoostBid[]; chosenBoostRank?: number | null }).visibleBoostBids = visibleBoostBids;
  (plan.connectsStrategy as typeof plan.connectsStrategy & { visibleBoostBids?: VisibleBoostBid[]; chosenBoostRank?: number | null }).chosenBoostRank = visibleBoostDecision.targetRank;
  plan.connectsStrategy.sourceBackedConnects = {
    ...extracted,
    boostConnects: null,
    totalConnects: total,
  };
  plan.connectsStrategy.risks = removeUnknownConnectsRisks(plan.connectsStrategy.risks);
  if (requiresManualReview) {
    plan.connectsStrategy.decision = "manual_review";
    const issue = {
      severity: "error" as const,
      code: "connects_apply_page_manual_review_required",
      message: `Verified Connects total ${total} exceeds the autonomous preparation threshold ${AUTO_PREPARE_MAX_CONNECTS}.`,
    };
    issues.push(issue);
    return [issue];
  }
  if (plan.connectsStrategy.decision === "manual_review" && plan.connectsStrategy.risks.length === 0 && plan.connectsStrategy.expectedValueScore >= 68) {
    plan.connectsStrategy.decision = "safe_apply";
  } else if (plan.connectsStrategy.decision !== "safe_apply") {
    const issue = {
      severity: "error" as const,
      code: "connects_apply_page_manual_review_required",
      message: "Verified Connects were readable, but the Connects strategy still requires manual review before autonomous preparation.",
    };
    issues.push(issue);
    return [issue];
  }
  return [];
}

function normalizeVerificationValue(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function significantExpectedText(value: string): string {
  const normalized = normalizeVerificationValue(value);
  return normalized.length > 120 ? normalized.slice(0, 120) : normalized;
}

function textCollectionContains(values: string[], expected: string): boolean {
  const significant = significantExpectedText(expected);
  if (!significant) return false;
  return values.some((value) => normalizeVerificationValue(value).includes(significant));
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function bestMatchingValue(values: string[], expected: string | null | undefined): string | null {
  if (!expected?.trim()) return null;
  const significant = significantExpectedText(expected);
  if (!significant) return null;
  return values.find((value) => normalizeVerificationValue(value).includes(significant)) ?? null;
}

function longestValue(values: string[]): string | null {
  return [...values].sort((a, b) => b.length - a.length)[0] ?? null;
}

function fieldDescriptor(field: ApplyVerificationSnapshot["fieldValues"][number]): string {
  return [field.kind, field.inputType, field.label, field.id, field.name, field.ariaLabel, field.placeholder, field.dataTest].filter(Boolean).join(" ").toLowerCase();
}

function isUserTextField(field: ApplyVerificationSnapshot["fieldValues"][number]): boolean {
  if (field.kind === "textarea") return true;
  const inputType = (field.inputType ?? "text").toLowerCase();
  return !["button", "checkbox", "file", "hidden", "image", "radio", "reset", "submit"].includes(inputType);
}

function coverLetterFieldValues(snapshot: ApplyVerificationSnapshot): string[] {
  const textareas = snapshot.fieldValues
    .filter((field) => field.kind === "textarea" && isUserTextField(field))
    .filter((field) => /\b(?:cover|letter|proposal|message)\b/i.test(fieldDescriptor(field)))
    .map((field) => field.value)
    .filter((value) => value.trim().length > 0);
  if (textareas.length > 0) return textareas;
  return snapshot.fieldValues
    .filter((field) => field.kind === "textarea" && isUserTextField(field))
    .map((field) => field.value)
    .filter((value) => value.trim().length > 0);
}

function rateFieldValues(snapshot: ApplyVerificationSnapshot): string[] {
  return snapshot.fieldValues
    .filter((field) => field.kind === "input" && isUserTextField(field))
    .filter((field) => /\b(?:bid|hourly|rate|currency|amount|terms)\b/i.test(fieldDescriptor(field)))
    .map((field) => field.value)
    .filter((value) => value.trim().length > 0);
}

function bestCoverLetterValue(snapshot: ApplyVerificationSnapshot, expected: string | null | undefined): string | null {
  const matched = bestMatchingValue(coverLetterFieldValues(snapshot), expected);
  if (matched) return matched;

  const coverLike = coverLetterFieldValues(snapshot);
  if (coverLike.length > 0) return longestValue(coverLike);

  return null;
}

function screeningValuesForIndex(snapshot: ApplyVerificationSnapshot, coverLetter: string, index: number): string[] {
  const nonCoverFields = snapshot.fieldValues.filter((field) => {
    if (!isUserTextField(field)) return false;
    if (field.value === coverLetter) return false;
    return !/\b(?:cover|letter|proposal|message)\b/i.test(fieldDescriptor(field));
  });
  const questionNumberPattern = new RegExp(`\\b(?:question|answer)\\s*${index + 1}\\b`, "i");
  const exactIndex = nonCoverFields
    .filter((field) => questionNumberPattern.test(fieldDescriptor(field)))
    .map((field) => field.value)
    .filter((value) => value.trim().length > 0);
  if (exactIndex.length > 0) return exactIndex;

  const likelyScreening = nonCoverFields
    .filter((field) => field.kind === "textarea" || /\b(?:question|answer|screening)\b/i.test(fieldDescriptor(field)))
    .map((field) => field.value)
    .filter((value) => value.trim().length > 0);
  return likelyScreening;
}

function textDiffers(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizeVerificationValue(left ?? "");
  const b = normalizeVerificationValue(right ?? "");
  return Boolean(a && b && a !== b);
}

function proposalVersionSourceFromPayload(value: unknown): ProposalVersionSource {
  return value === "draft_generated" ||
    value === "slack_preview" ||
    value === "slack_revision" ||
    value === "upwork_inserted" ||
    value === "remote_chrome_qa" ||
    value === "human_edit_reread" ||
    value === "final_submitted" ||
    value === "latest_verified_fallback"
    ? value
    : "human_edit_reread";
}

function screeningJobContext(input: { jobId: string; plan?: BrowserApplyFillPlan | null }): Record<string, unknown> {
  const draft = getApplicationDraft(input.jobId);
  const scoredJob = getScoredJobForSlackPreview(input.jobId);
  return {
    jobId: input.jobId,
    title: input.plan?.jobTitle ?? scoredJob?.title ?? null,
    sourceUrl: input.plan?.sourceUrl ?? scoredJob?.url ?? null,
    vertical: draft?.jobIntelligence?.ecommerceVertical ?? null,
    platform: draft?.jobIntelligence?.primaryPlatform ?? null,
    taskType: draft?.jobIntelligence?.taskType ?? null,
    sourceQuery: scoredJob?.sourceQuery ?? null,
  };
}

export function persistApplicationSnapshot(input: {
  jobId: string;
  snapshot: ApplyVerificationSnapshot;
  plan?: BrowserApplyFillPlan | null;
  source: ProposalVersionSource;
  note?: string | null;
  markSubmittedAfterCapture?: boolean;
}): { ok: boolean; label?: string; fallbackReason?: string } {
  const draft = getApplicationDraft(input.jobId);
  const plannedCover = input.plan?.coverLetter ?? draft?.proposalText ?? "";
  const plannedScreening = input.plan?.screeningAnswers ?? draft?.structuredProposal?.clientRequestAnswers ?? [];
  const values = uniqueNonEmpty(input.snapshot.inputValues);
  const coverLetter = bestCoverLetterValue(input.snapshot, plannedCover);
  if (!coverLetter || coverLetter.length < 20) {
    const reason = "Remote Chrome did not expose readable application text; final version is the last captured QA/readback version if available.";
    const fallback = input.markSubmittedAfterCapture
      ? recordLatestVerifiedProposalFallback({
        jobId: input.jobId,
        reason,
        note: "Steve said submitted, but the page no longer exposed readable proposal text.",
      })
      : null;
    if (input.markSubmittedAfterCapture) {
      updateApplicationStatus(
        input.jobId,
        "submitted",
        fallback
          ? `Steve said submitted, but final readback was unavailable. Preserved ${fallback.label} as a lower-confidence latest verified fallback.`
          : "Steve said submitted, but the page no longer exposed readable proposal text. Final version is the last captured QA version if available."
      );
    }
    return {
      ok: false,
      label: fallback?.label,
      fallbackReason: fallback
        ? `Remote Chrome did not expose readable application text; preserved ${fallback.label} as a lower-confidence latest verified fallback.`
        : reason,
    };
  }

  const remainingValues = values.filter((value) => value !== coverLetter);
  const screeningAnswers = plannedScreening.map((answer, index) => {
    const fieldCandidates = screeningValuesForIndex(input.snapshot, coverLetter, index);
    return bestMatchingValue(fieldCandidates, answer) ??
      fieldCandidates[fieldCandidates.length - 1] ??
      bestMatchingValue(remainingValues, answer) ??
      remainingValues[index] ??
      answer;
  });
  const beforeVersion = getLatestProposalVersion(input.jobId);
  const versionConfidence = input.source === "final_submitted" || input.source === "human_edit_reread" || input.source === "remote_chrome_qa" ? "high" : "medium";
  const version = recordProposalVersion({
    jobId: input.jobId,
    source: input.source,
    proposalText: coverLetter,
    screeningAnswers,
    confidence: versionConfidence,
    note: input.note ?? null,
  });

  const existingCoverage = listScreeningCoverage(input.jobId);
  if (existingCoverage.length === 0 && plannedScreening.length > 0) {
    recordPlannedScreeningCoverage(input.jobId, [], plannedScreening, {
      jobContext: screeningJobContext({ jobId: input.jobId, plan: input.plan }),
      confidence: "medium",
    });
  }
  const coverage = listScreeningCoverage(input.jobId);
  const count = Math.max(coverage.length, plannedScreening.length, screeningAnswers.length);
  const jobContext = screeningJobContext({ jobId: input.jobId, plan: input.plan });
  const coverageConfidence = input.source === "final_submitted" || input.source === "human_edit_reread" || input.source === "remote_chrome_qa" ? "high" : "medium";
  for (let index = 0; index < count; index += 1) {
    const current = coverage.find((item) => item.questionIndex === index + 1);
    const plannedAnswer = current?.plannedAnswer ?? plannedScreening[index] ?? null;
    const answer = screeningAnswers[index] ?? null;
    const edited = textDiffers(plannedAnswer, answer);
    upsertScreeningCoverageItem({
      jobId: input.jobId,
      questionIndex: index + 1,
      questionText: current?.questionText ?? null,
      plannedAnswer,
      filledAnswer: input.source === "upwork_inserted" ? answer : current?.filledAnswer ?? null,
      verifiedAnswer: input.source === "remote_chrome_qa" ? answer : current?.verifiedAnswer ?? null,
      humanEditedAnswer: input.source === "human_edit_reread" && edited ? answer : current?.humanEditedAnswer ?? null,
      finalAnswer: input.source === "final_submitted" ? answer : current?.finalAnswer ?? null,
      jobContext,
      confidence: coverageConfidence,
      status: input.source === "final_submitted" || input.source === "remote_chrome_qa"
        ? "verified"
        : edited
          ? "edited"
          : input.source === "upwork_inserted"
            ? "filled"
            : "planned",
    });
  }

  if (input.source === "human_edit_reread" && textDiffers(draft?.proposalText ?? beforeVersion?.proposalText, coverLetter)) {
    recordProposalStyleSignal({
      jobId: input.jobId,
      instruction: input.note ?? "Steve edited the proposal/application text in remote Chrome.",
      beforeText: draft?.proposalText ?? beforeVersion?.proposalText ?? null,
      afterText: coverLetter,
      source: "remote_chrome_human_edit",
    });
  }
  if (["human_edit_reread", "remote_chrome_qa", "final_submitted"].includes(input.source)) {
    recordProposalVersionDiffLearning({
      jobId: input.jobId,
      source: `remote_chrome_${input.source}`,
      editor: input.source === "final_submitted" || input.source === "human_edit_reread" ? "Steve" : "operator",
    });
  }
  if (input.source === "human_edit_reread" || input.source === "final_submitted") {
    recordScreeningAnswerDiffLearning({
      jobId: input.jobId,
      source: `remote_chrome_${input.source}`,
      editor: "Steve",
      includeFinalSubmitted: input.source === "final_submitted",
    });
  }
  if (input.markSubmittedAfterCapture) {
    updateApplicationStatus(input.jobId, "submitted", "Steve said submitted; captured current remote Chrome text as final submitted version when possible.");
    recordApplicationOutcomeLearning({
      jobId: input.jobId,
      outcome: "submitted",
      note: "Steve said submitted; captured current remote Chrome text as final submitted version when possible.",
      source: "remote_chrome_final_submitted_capture",
    });
  }
  return { ok: true, label: version.label };
}

function rateNeedle(value: string): string | null {
  return hourlyRateInputValue(value);
}

function rateFieldValueMatches(actual: string, expected: string): boolean {
  const actualNumber = Number.parseFloat(actual.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0] ?? "");
  const expectedNumber = Number.parseFloat(expected.replace(/,/g, ""));
  return Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && Math.abs(actualNumber - expectedNumber) < 0.005;
}

function verification(
  field: string,
  status: ApplyVerificationStatus,
  detail: string,
  extra: Pick<ApplyFieldVerification, "expected" | "actual"> = {},
): ApplyFieldVerification {
  return { field, status, detail, ...extra };
}

async function readApplyVerificationSnapshot(page: PlaywrightPageLike, fallbackBodyText: string): Promise<ApplyVerificationSnapshot> {
  if (!page.evaluate) {
    return {
      url: page.url(),
      visibleText: fallbackBodyText,
      inputValues: [],
      fieldValues: [],
      checkedLabels: [],
      fileNames: [],
      actionLabels: [],
    };
  }
  try {
    const snapshot = await page.evaluate(() => {
      type LooseElement = {
        value?: string;
        checked?: boolean;
        type?: string;
        name?: string;
        files?: ArrayLike<{ name?: string }>;
        tagName?: string;
        getAttribute?: (name: string) => string | null;
        closest?: (selector: string) => { textContent?: string | null } | null;
      };
      const documentLike = (globalThis as unknown as {
        document?: {
          body?: { innerText?: string };
          querySelectorAll?: (selector: string) => ArrayLike<LooseElement>;
        };
      }).document;
      const nodes = Array.from(documentLike?.querySelectorAll?.("textarea,input") ?? []);
      const actionNodes = Array.from(documentLike?.querySelectorAll?.("button,a[role='button'],input[type='submit'],input[type='button']") ?? []);
      const isUserTextNode = (node: LooseElement) => {
        const tagName = String(node.tagName ?? "").toLowerCase();
        if (tagName === "textarea") return true;
        const inputType = String(node.type ?? "text").toLowerCase();
        return !["button", "checkbox", "file", "hidden", "image", "radio", "reset", "submit"].includes(inputType);
      };
      const inputValues = nodes
        .filter(isUserTextNode)
        .map((node) => typeof node.value === "string" ? node.value : "")
        .filter((value) => value.trim().length > 0);
      const fieldValues = nodes
        .map((node) => {
          const value = typeof node.value === "string" ? node.value : "";
          const label = node.closest?.("label")?.textContent ?? "";
          const inputType = node.type ?? node.getAttribute?.("type") ?? null;
          const id = node.getAttribute?.("id") ?? null;
          const ariaLabel = node.getAttribute?.("aria-label") ?? null;
          const placeholder = node.getAttribute?.("placeholder") ?? null;
          const name = node.name ?? node.getAttribute?.("name") ?? null;
          const dataTest = node.getAttribute?.("data-test") ?? null;
          const kind: "input" | "textarea" = String(node.tagName ?? "").toLowerCase() === "textarea" ? "textarea" : "input";
          return { kind, inputType, label, id, name, ariaLabel, placeholder, dataTest, value };
        })
        .filter((field) => field.value.trim().length > 0);
      const checkedLabels = nodes
        .filter((node) => Boolean(node.checked))
        .map((node) => {
          const labelText = node.closest?.("label")?.textContent ?? "";
          const aria = node.getAttribute?.("aria-label") ?? "";
          const name = node.name ?? "";
          return [labelText, aria, name].filter(Boolean).join(" ");
        })
        .filter((value) => value.trim().length > 0);
      const fileNames = nodes
        .flatMap((node) => Array.from(node.files ?? []).map((file) => file.name ?? ""))
        .filter((value) => value.trim().length > 0);
      const actionLabels = actionNodes
        .map((node) => {
          const labelText = node.closest?.("label")?.textContent ?? "";
          const aria = node.getAttribute?.("aria-label") ?? "";
          const text = "textContent" in node && typeof (node as { textContent?: unknown }).textContent === "string"
            ? String((node as { textContent?: string }).textContent)
            : "";
          const value = typeof node.value === "string" ? node.value : "";
          return [text, labelText, aria, value].filter(Boolean).join(" ");
        })
        .filter((value) => value.trim().length > 0);
      return {
        visibleText: documentLike?.body?.innerText ?? "",
        inputValues,
        fieldValues,
        checkedLabels,
        fileNames,
        actionLabels,
      };
    });
    return {
      url: page.url(),
      visibleText: snapshot.visibleText || fallbackBodyText,
      inputValues: snapshot.inputValues ?? [],
      fieldValues: snapshot.fieldValues ?? [],
      checkedLabels: snapshot.checkedLabels ?? [],
      fileNames: snapshot.fileNames ?? [],
      actionLabels: snapshot.actionLabels ?? [],
    };
  } catch {
    return {
      url: page.url(),
      visibleText: fallbackBodyText,
      inputValues: [],
      fieldValues: [],
      checkedLabels: [],
      fileNames: [],
      actionLabels: [],
    };
  }
}

export async function verifyApplyPreparationOnPage(input: {
  page: PlaywrightPageLike;
  plan: BrowserApplyFillPlan;
  fields: Pick<ApplyPreparationDiagnostics, "attemptedFields" | "skippedFields" | "manualFields">;
  bodyText: string;
}): Promise<ApplyFieldVerification[]> {
  const { plan, fields } = input;
  const snapshot = await readApplyVerificationSnapshot(input.page, input.bodyText);
  const analysis = analyzeApplyPageSnapshot(snapshot, plan);
  const visibleAndValues = [snapshot.visibleText, ...snapshot.inputValues, ...snapshot.checkedLabels, ...snapshot.fileNames];
  const results: ApplyFieldVerification[] = [];

  if (analysis.pageKind === "apply") {
    results.push(verification("pageStructure", "verified", "Recognized Upwork apply page structure."));
  } else if (analysis.pageKind === "security_challenge" || analysis.pageKind === "login_required" || analysis.pageKind === "two_factor_required") {
    results.push(verification("pageStructure", "blocked_by_upwork_ui", `Apply page is blocked by ${analysis.pageKind}: ${analysis.challenge.matchedText ?? "restricted page"}.`));
  } else {
    results.push(verification("pageStructure", "attempted_unverified", "Unknown page structure; refusing to mark browser preparation ready."));
  }

  results.push(urlsReferToSameUpworkJob(snapshot.url, plan.applyUrl)
    ? verification("targetTab", "verified", `Apply tab matches target job URL: ${snapshot.url}`)
    : verification("targetTab", "attempted_unverified", `Apply tab URL does not match target job URL. target=${plan.applyUrl} actual=${snapshot.url}`, { expected: plan.applyUrl, actual: snapshot.url }));

  if (!plan.coverLetter.trim()) {
    results.push(verification("coverLetter", "skipped_by_strategy", "No cover letter text was available in the plan."));
  } else if (textCollectionContains(coverLetterFieldValues(snapshot), plan.coverLetter)) {
    results.push(verification("coverLetter", "verified", "Cover letter field contains the intended text.", { expected: significantExpectedText(plan.coverLetter) }));
  } else if (fields.skippedFields.includes("coverLetter") || fields.manualFields.includes("coverLetter")) {
    results.push(verification("coverLetter", "blocked_by_upwork_ui", "Cover letter field was not filled by the Upwork UI.", { expected: significantExpectedText(plan.coverLetter) }));
  } else {
    results.push(verification("coverLetter", "attempted_unverified", "Cover letter fill was attempted, but the field did not verify with the intended text.", { expected: significantExpectedText(plan.coverLetter), actual: coverLetterFieldValues(snapshot).join(" | ").slice(0, 500) }));
  }

  if (plan.screeningAnswers.length === 0) {
    results.push(verification("screeningAnswers", "skipped_by_strategy", "No screening answers were generated for this application."));
  } else {
    const coverLetterValue = bestCoverLetterValue(snapshot, plan.coverLetter) ?? "";
    const verifiedCount = plan.screeningAnswers.filter((answer, index) => textCollectionContains(screeningValuesForIndex(snapshot, coverLetterValue, index), answer)).length;
    if (verifiedCount === plan.screeningAnswers.length) {
      results.push(verification("screeningAnswers", "verified", `${verifiedCount}/${plan.screeningAnswers.length} screening answers are present.`));
    } else if (verifiedCount > 0) {
      results.push(verification("screeningAnswers", "attempted_unverified", `${verifiedCount}/${plan.screeningAnswers.length} screening answers verified; remaining answers need QA.`));
    } else if (fields.manualFields.includes("screeningAnswers")) {
      results.push(verification("screeningAnswers", "blocked_by_upwork_ui", "Screening answer fields were unavailable or could not be filled safely."));
    } else {
      results.push(verification("screeningAnswers", "attempted_unverified", "Screening answers were planned, but none verified on the page."));
    }
  }

  const rateValue = rateNeedle(plan.rate);
  if (!rateValue) {
    results.push(verification("rate", "skipped_by_strategy", "No safe rate value was available in the plan."));
  } else if (rateFieldValues(snapshot).some((value) => rateFieldValueMatches(value, rateValue))) {
    results.push(verification("rate", "verified", `Rate field contains ${rateValue}.`, { expected: rateValue }));
  } else if (fields.skippedFields.includes("rate")) {
    results.push(verification("rate", "blocked_by_upwork_ui", "Rate field was not fillable.", { expected: rateValue }));
  } else {
    results.push(verification("rate", "attempted_unverified", "Rate fill was attempted, but the value was not verified.", { expected: rateValue, actual: rateFieldValues(snapshot).join(" | ").slice(0, 200) }));
  }

  if (!analysis.connects.visible || plan.connects.required === null) {
    results.push(verification("requiredConnects", "attempted_unverified", analysis.connects.detail));
  } else {
    results.push(verification("requiredConnects", "verified", `Required Connects verified as ${analysis.connects.value}.`, { actual: String(analysis.connects.value) }));
  }

  const plannedBoost = plan.connects.boost ?? 0;
  if (plannedBoost <= 0) {
    results.push(verification("boostConnects", "skipped_by_strategy", analysis.boost.visible ? `No boost set. ${analysis.boost.detail}` : "No boost set."));
  } else if (plannedBoost > 50) {
    results.push(verification("boostConnects", "blocked_by_upwork_ui", `Planned boost ${plannedBoost} exceeds the hard cap 50; boost must not be set.`));
  } else if (analysis.boost.selectedValue === plannedBoost || textCollectionContains(snapshot.inputValues, String(plannedBoost))) {
    results.push(verification("boostConnects", "verified", `Boost Connects verified as ${plannedBoost}.`, { actual: String(plannedBoost) }));
  } else if (fields.skippedFields.includes("connectsBoost")) {
    results.push(verification("boostConnects", "blocked_by_upwork_ui", "Boost field was not fillable.", { expected: String(plannedBoost) }));
  } else {
    results.push(verification("boostConnects", "attempted_unverified", `Boost ${plannedBoost} was attempted, but not verified.`, { expected: String(plannedBoost) }));
  }

  if (plan.attachments.length === 0) {
    results.push(verification("attachments", "skipped_by_strategy", "No local files were selected for upload."));
  } else {
    const missing = plan.attachments.filter((attachment) => !proofAssetExists(attachment.filePath));
    if (missing.length > 0) {
      results.push(verification("attachments", "missing_local_file", `Missing local files: ${missing.map((item) => item.filePath).join(", ")}`));
    } else {
      const expectedNames = plan.attachments.map((attachment) => path.basename(attachment.filePath));
      const verifiedNames = expectedNames.filter((name) => textCollectionContains(visibleAndValues, name));
      if (verifiedNames.length === expectedNames.length) {
        results.push(verification("attachments", "verified", `Verified attached files: ${verifiedNames.join(", ")}.`, { actual: verifiedNames.join(", ") }));
      } else if (fields.manualFields.includes("attachments")) {
        results.push(verification("attachments", "blocked_by_upwork_ui", `Upload field was unavailable. Expected files: ${expectedNames.join(", ")}`));
      } else {
        results.push(verification("attachments", "attempted_unverified", `File upload was attempted but not verified. Expected files: ${expectedNames.join(", ")}`, { expected: expectedNames.join(", "), actual: snapshot.fileNames.join(", ") }));
      }
    }
  }

  if (plan.highlights.length === 0) {
    results.push(verification("profileHighlights", "skipped_by_strategy", "No profile highlights were selected by strategy."));
  } else {
    const verifiedHighlights = plan.highlights.filter((highlight) => textCollectionContains([...snapshot.checkedLabels, snapshot.visibleText], highlight));
    if (verifiedHighlights.length === plan.highlights.length) {
      results.push(verification("profileHighlights", "verified", `Verified selected portfolio/profile proof: ${verifiedHighlights.join(", ")}.`, { actual: verifiedHighlights.join(", ") }));
    } else if (/add a portfolio project|add portfolio project|add a certificate|add certificate/i.test(snapshot.visibleText)) {
      results.push(verification("profileHighlights", "attempted_unverified", `Portfolio/certificate selector entry is visible, but selected proof is not verified yet. Expected: ${plan.highlights.join(", ")}`, { expected: plan.highlights.join(", "), actual: snapshot.checkedLabels.join(", ") }));
    } else if (fields.manualFields.includes("highlights")) {
      results.push(verification("profileHighlights", "blocked_by_upwork_ui", "Profile highlight controls were unavailable or could not be selected safely."));
    } else {
      results.push(verification("profileHighlights", "attempted_unverified", "Profile/proof selection was attempted but not verified."));
    }
  }

  results.push(analysis.finalSubmit.visible
    ? verification("finalSubmitButton", "verified", analysis.finalSubmit.detail, { actual: analysis.finalSubmit.label ?? undefined })
    : verification("finalSubmitButton", "attempted_unverified", analysis.finalSubmit.detail));
  results.push(verification("finalSubmit", "skipped_by_strategy", "Final submit/send button was intentionally not clicked."));
  return results;
}

type ApplyFillResult = Pick<ApplyPreparationDiagnostics, "attemptedFields" | "skippedFields" | "manualFields" | "fieldVerification" | "applyPageAnalysis">;

function getVerification(results: ApplyFieldVerification[], field: string): ApplyFieldVerification | null {
  return results.find((item) => item.field === field) ?? null;
}

function hasUnverifiedRequiredApplyFields(results: ApplyFieldVerification[]): boolean {
  if (results.length === 0) return false;
  return getUnverifiedRequiredApplyFields(results).length > 0;
}

async function fillApplyFields(page: PlaywrightPageLike, plan: BrowserApplyFillPlan, bodyText: string): Promise<ApplyFillResult> {
  assertSubmitGuard(plan);
  logger.info(`Submit guard before fill: stopBeforeSubmit=${plan.stopBeforeSubmit}; final submit will not be clicked.`);
  const attemptedFields: string[] = [];
  const skippedFields: string[] = [];
  const manualFields: string[] = [];

  const proposalSettings = await trySelectProposalSettings(page, plan);
  attemptedFields.push(...proposalSettings.attempted);
  manualFields.push(...proposalSettings.manual);

  const coverLetterFilled = await tryFillFirst(page, ["textarea[name*='cover']", "textarea[aria-label*='Cover']", "textarea"], plan.coverLetter);
  if (coverLetterFilled) {
    attemptedFields.push("coverLetter");
  } else {
    skippedFields.push("coverLetter");
  }

  if (plan.screeningAnswers.length > 0) {
    const screening = coverLetterFilled
      ? await tryFillScreeningAnswers(page, plan.screeningAnswers)
      : { filled: 0, skipped: plan.screeningAnswers.length };
    if (screening.filled > 0) {
      attemptedFields.push(`screeningAnswers:${screening.filled}`);
    }
    if (screening.skipped > 0) {
      manualFields.push("screeningAnswers");
    }
  }

  const rateInputValue = hourlyRateInputValue(plan.rate);
  if (rateInputValue && await tryFillFirst(page, [
    "[data-test='up-fe-rate-widget'] [data-test='hourly-rate'] input",
    "[data-test='up-fe-rate-widget'] input[data-test='currency-input']",
    "[data-test='hourly-rate'] input[data-test='currency-input']",
    "input[aria-label*='hourly rate' i]",
    "input[aria-label*='bid' i]",
    "input[name*='hourlyRate' i]",
    "input[name*='hourly-rate' i]",
    "input[name*='bid' i]",
  ], rateInputValue)) {
    attemptedFields.push("rate");
  } else {
    skippedFields.push("rate");
  }

  if (plan.connects.boost !== null && plan.connects.boost > 0) {
    skippedFields.push("connectsBoost");
    manualFields.push("connects");
  }

  const attachmentFiles = plan.attachments.map((attachment) => resolveProofAssetPath(attachment.filePath));
  if (await trySetFiles(page, ["input[type='file']"], attachmentFiles)) {
    attemptedFields.push("attachments");
  } else if (attachmentFiles.length > 0) {
    manualFields.push("attachments");
  }

  let checkedHighlights = 0;
  for (const highlight of plan.highlights) {
    if (await trySelectProofFromSelector(page, highlight)) checkedHighlights += 1;
  }
  if (checkedHighlights > 0) {
    attemptedFields.push("highlights");
  } else if (plan.highlights.length > 0) {
    manualFields.push("highlights");
  }

  manualFields.push("finalSubmit");
  logger.info(`Submit guard after fill: stopBeforeSubmit=${plan.stopBeforeSubmit}; final submit remains manual.`);
  const fieldVerification = await verifyApplyPreparationOnPage({
    page,
    plan,
    fields: { attemptedFields, skippedFields, manualFields },
    bodyText,
  });
  const postFillSnapshot = await readApplyVerificationSnapshot(page, bodyText);
  const applyPageAnalysis = analyzeApplyPageSnapshot(postFillSnapshot, plan);
  return { attemptedFields, skippedFields, manualFields, fieldVerification, applyPageAnalysis };
}

async function inspectWithBrowser(
  action: BrowserAction,
  options: BrowserWorkerOptions,
  url: string,
  plan?: BrowserApplyFillPlan
): Promise<{
  state: DetectedBrowserState;
  snapshot?: PageSnapshot;
  fields: ApplyFillResult;
  bodyText: string;
  inspectionDiagnostics?: BrowserInspectionDiagnostics;
  extractionBodyText?: string;
  extractionDiagnostics?: unknown;
  applicationSnapshot?: ApplyVerificationSnapshot;
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
      fields: { attemptedFields: [], skippedFields: [], manualFields: [], fieldVerification: [] },
      bodyText: "",
    };
  }

  let sessionHandle: Awaited<ReturnType<typeof acquireBrowserSession>> | null = null;
  try {
    const processDiagnostics = getChromeProfileProcessDiagnostics({
      userDataDir: options.userDataDir,
      cdpUrl: options.cdpUrl,
    });
    if (processDiagnostics.duplicateProfileConflict) {
      saveTextArtifact(options, action, "browser-profile-conflict.json", JSON.stringify({ actionId: action.id, jobId: action.jobId, actionType: action.actionType, url, processDiagnostics }, null, 2));
      return {
        state: "browser_profile_in_use",
        fields: { attemptedFields: [], skippedFields: [], manualFields: [], fieldVerification: [] },
        bodyText: "",
      };
    }
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
          fields: { attemptedFields: [], skippedFields: [], manualFields: [], fieldVerification: [] },
          bodyText: "",
        };
      }
      if (classified === "cdp_unavailable" || options.sessionMode === "cdp") {
        saveTextArtifact(options, action, "cdp-unavailable.json", JSON.stringify({ actionId: action.id, jobId: action.jobId, actionType: action.actionType, url, message, cdpUrl: options.cdpUrl }, null, 2));
        return {
          state: "cdp_unavailable",
          fields: { attemptedFields: [], skippedFields: [], manualFields: [], fieldVerification: [] },
          bodyText: "",
        };
      }
      throw error;
    }
    const targetJobId = getTargetJobIdForCapture(action, url) ?? undefined;
    const openPages = sessionHandle.context.pages?.() ?? [];
    const currentPage = openPages[0] ?? null;
    const currentPageUrlBeforeCapture = currentPage?.url() ?? "";
    const currentPageTitleBeforeCapture = currentPage ? await currentPage.title().catch(() => "") : "";
    const sourceContextAttempted = isDiscoveryBestMatchesCaptureAction(action);
    const sourceContextPageFound = sourceContextAttempted && openPages.some((candidate) => isDiscoverySourceContextPage(candidate.url()));
    const directJobPageRejectedForDiscovery = sourceContextAttempted && openPages.some((candidate) => isDirectUpworkJobPage(candidate.url()) && urlsReferToSameUpworkJob(candidate.url(), url));
    const sourceContextCapture = sourceContextAttempted ? await tryCaptureDiscoverySourceContext(sessionHandle.context, action, url) : null;
    const shouldDirectFallback = !sourceContextAttempted || shouldUseDirectFallbackForCaptureAction(action);
    const protectedApplyUrls = currentProtectedQaApplyUrls();
    const selectedPage = sourceContextCapture || !shouldDirectFallback
      ? null
      : action.actionType === "capture_application_snapshot"
        ? selectVisibleApplicationSnapshotPage(sessionHandle.context, url)
        : await selectPageForBrowserAction(sessionHandle.context, url, { protectedApplyUrls });
    const page = selectedPage?.page;
    const tabHygiene = action.actionType === "capture_application_snapshot"
      ? {
        openPagesBefore: openPages.length,
        upworkWorkTabsBefore: openPages.filter((candidate) => isUpworkWorkTabUrl(candidate.url())).length,
        staleWorkTabsClosed: 0,
        staleWorkTabsIgnored: 0,
      }
      : await cleanStaleWorkTabs({ context: sessionHandle.context, selectedPage: page, targetUrl: url, protectedApplyUrls });
    if (page && (!selectedPage.reusedExistingPage || !urlsReferToSameUpworkJob(page.url(), url))) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    }
    const unavailableDetection: BrowserStateDetection = {
      state: "source_context_unavailable",
      source: "none",
      summary: action.actionType === "capture_application_snapshot"
        ? "Visible application tab was not available; preserving latest verified proposal version as lower-confidence fallback."
        : "Discovery source context did not contain readable target job content; direct fallback is disabled for discovery-origin captures.",
    };
    const unavailableSnapshot: PageSnapshot = { url: currentPageUrlBeforeCapture, title: currentPageTitleBeforeCapture, textExcerpt: "" };
    const settled = sourceContextCapture
      ? { snapshot: sourceContextCapture.snapshot, bodyText: sourceContextCapture.bodyText, detection: sourceContextCapture.detection, samples: [{ step: 1, url: sourceContextCapture.sourcePageUrl, title: sourceContextCapture.snapshot.title, textExcerpt: sourceContextCapture.snapshot.textExcerpt, detection: sourceContextCapture.detection }] }
      : !shouldDirectFallback || (action.actionType === "capture_application_snapshot" && !selectedPage)
        ? { snapshot: unavailableSnapshot, bodyText: "", detection: unavailableDetection, samples: [{ step: 1, url: currentPageUrlBeforeCapture, title: "", textExcerpt: "", detection: unavailableDetection }] }
        : await settlePageAndDetect(page!, action);
    let { snapshot, bodyText, detection, samples } = settled;
    let state = sourceContextCapture?.state ?? detection.state;
    let extractedRawText = bodyText;
    let extractionDiagnostics: unknown;
    if (plan && state === "job_page_loaded" && page && await tryClickApplyNow(page)) {
      const applySettled = await settlePageAndDetect(page, action);
      snapshot = applySettled.snapshot;
      bodyText = applySettled.bodyText;
      detection = applySettled.detection;
      samples = [...samples, ...applySettled.samples.map((sample) => ({ ...sample, step: samples.length + sample.step }))];
      state = detection.state;
    }
    if (action.actionType === "capture_job_from_url" && state === "captured") {
      const extracted = sourceContextCapture?.extracted ?? await extractUpworkJobContent(page!);
      extractedRawText = extracted.rawText;
      extractionDiagnostics = extracted.diagnostics;
      logger.info(
        `Capture extraction #${action.id}: titleSource=${extracted.diagnostics.titleSource} descriptionSource=${extracted.diagnostics.descriptionSource} ` +
          `title=${extracted.diagnostics.capturedTitle} descriptionLength=${extracted.diagnostics.descriptionLength} ` +
          `removedNoiseMarkers=${extracted.diagnostics.removedNoiseMarkers} rawConfigNoiseDetected=${extracted.diagnostics.rawConfigNoiseDetected} ` +
          `lowConfidence=${extracted.diagnostics.lowConfidence} sourceContext=${Boolean(sourceContextCapture)}`
      );
      saveTextArtifact(options, action, sourceContextCapture ? "capture-source-context-extraction.json" : "capture-extraction.json", JSON.stringify(extracted, null, 2));
      if (extracted.diagnostics.lowConfidence) {
        state = "source_context_unavailable";
      }
    }
    let fields: ApplyFillResult = { attemptedFields: [], skippedFields: [], manualFields: [], fieldVerification: [] };
    if (plan && state === "apply_page_loaded") {
      const preFillSnapshot = await readApplyVerificationSnapshot(page!, bodyText);
      const preFillAnalysis = analyzeApplyPageSnapshot(preFillSnapshot, plan);
      if (preFillAnalysis.pageKind === "security_challenge") {
        state = "captcha_or_security_challenge";
        fields = {
          attemptedFields: [],
          skippedFields: [],
          manualFields: ["finalSubmit"],
          fieldVerification: await verifyApplyPreparationOnPage({ page: page!, plan, fields: { attemptedFields: [], skippedFields: [], manualFields: ["finalSubmit"] }, bodyText }),
          applyPageAnalysis: preFillAnalysis,
        };
      } else if (preFillAnalysis.pageKind === "login_required" || preFillAnalysis.pageKind === "two_factor_required") {
        state = preFillAnalysis.pageKind;
        fields = {
          attemptedFields: [],
          skippedFields: [],
          manualFields: ["finalSubmit"],
          fieldVerification: await verifyApplyPreparationOnPage({ page: page!, plan, fields: { attemptedFields: [], skippedFields: [], manualFields: ["finalSubmit"] }, bodyText }),
          applyPageAnalysis: preFillAnalysis,
        };
      } else if (preFillAnalysis.pageKind === "unknown") {
        state = "field_preparation_incomplete";
        fields = {
          attemptedFields: [],
          skippedFields: ["coverLetter", "rate"],
          manualFields: ["coverLetter", "rate", "screeningAnswers", "attachments", "highlights", "finalSubmit"],
          fieldVerification: await verifyApplyPreparationOnPage({ page: page!, plan, fields: { attemptedFields: [], skippedFields: ["coverLetter", "rate"], manualFields: ["coverLetter", "rate", "screeningAnswers", "attachments", "highlights", "finalSubmit"] }, bodyText }),
          applyPageAnalysis: preFillAnalysis,
        };
      } else {
        verifyApplyPageConnects(plan, preFillSnapshot.visibleText || bodyText);
        fields = await fillApplyFields(page!, plan, bodyText);
      }
    }
    if (plan && state === "apply_page_loaded" && (getRequiredSkippedFields(fields).length > 0 || hasUnverifiedRequiredApplyFields(fields.fieldVerification ?? []))) {
      const skippedRequired = getRequiredSkippedFields(fields);
      const unverifiedRequired = getUnverifiedRequiredApplyFields(fields.fieldVerification ?? []);
      state = skippedRequired.length === 0 && unverifiedRequired.length === 1 && unverifiedRequired[0] === "requiredConnects"
        ? "connects_not_verified"
        : "field_preparation_incomplete";
    }
    const inspectionDiagnostics: BrowserInspectionDiagnostics = {
      actionId: action.id,
      jobId: action.jobId,
      actionType: action.actionType,
      sessionMode: options.sessionMode,
      targetUrl: url,
      pageReuse: {
        reusedExistingPage: sourceContextCapture ? true : selectedPage?.reusedExistingPage ?? true,
        reason: sourceContextCapture
          ? "Used Best Matches source-context capture before direct navigation."
          : selectedPage?.reason ?? "Discovery source context unavailable; direct fallback disabled.",
        selectedPageUrl: sourceContextCapture?.sourcePageUrl ?? selectedPage?.page.url() ?? snapshot.url,
      },
      tabHygiene,
      settleSamples: samples,
      finalSnapshot: snapshot,
      finalDetection: { ...detection, state },
      captureStrategy: sourceContextCapture
        ? sourceContextCapture.state === "source_context_unavailable" ? "source_context_unavailable" : sourceContextCapture.readable ? "source_context" : "blocked_before_capture"
        : shouldDirectFallback ? "direct_fallback" : "source_context_unavailable",
      selectedPageKind: sourceContextCapture ? "source_context" : selectedPage ? (isDirectUpworkJobPage(selectedPage.page.url()) ? "direct_job_page" : "source_context") : "none",
      directJobPageRejectedForDiscovery,
      sourceContextPageFound,
      sourceContextAttempted,
      sourceContextMatchedTarget: sourceContextCapture?.matchedTarget ?? false,
      sourceContextReadable: sourceContextCapture?.readable ?? false,
      directFallbackAttempted: Boolean(selectedPage),
      blockingDetectorSource: isCaptureBlockedState(state) ? (detection.source === "none" || detection.source === "action_type" ? "unknown" : detection.source) : undefined,
      blockingMatchedText: isCaptureBlockedState(state) ? detection.matchedText : undefined,
      blockingMatchedPattern: isCaptureBlockedState(state) ? detection.matchedPattern : undefined,
      blockingMatchedVisible: isCaptureBlockedState(state) ? detection.matchedVisible ?? "unknown" : undefined,
      blockingSignalStrength: isCaptureBlockedState(state) ? detection.signalStrength : undefined,
      blockingPageUrl: isCaptureBlockedState(state) ? snapshot.url : undefined,
      blockingPageTitle: isCaptureBlockedState(state) ? snapshot.title : undefined,
      targetJobId,
      currentPageUrlBeforeCapture,
    };
    const applicationSnapshot = (action.actionType === "capture_application_snapshot" || action.actionType === "prepare_application_review") && page
      ? await readApplyVerificationSnapshot(page, bodyText)
      : undefined;
    logger.info(
      `Browser inspection #${action.id}: reusedExistingPage=${inspectionDiagnostics.pageReuse.reusedExistingPage} ` +
        `pageUrl=${snapshot.url} title=${snapshot.title} detector=${inspectionDiagnostics.finalDetection.source} ` +
        `matched=${inspectionDiagnostics.finalDetection.matchedText ?? "n/a"} state=${state}`
    );
    saveTextArtifact(options, action, "inspection-diagnostics.json", JSON.stringify(inspectionDiagnostics, null, 2));
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
          detector: inspectionDiagnostics.finalDetection,
          pageReuse: inspectionDiagnostics.pageReuse,
          artifactPolicy: "minimized-no-html-no-screenshot",
        },
        null,
        2
      )
    );
    return { state, snapshot, fields, bodyText, inspectionDiagnostics, extractionBodyText: extractedRawText, extractionDiagnostics, applicationSnapshot };
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
  if (["login_required", "two_factor_required", "captcha_or_security_challenge", "browser_unavailable", "browser_profile_in_use", "cdp_unavailable", "connects_not_verified", "field_preparation_incomplete", "submit_guard_failed"].includes(state)) {
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
  if (state === "source_context_unavailable") {
    return "source_context_unavailable: Discovery source context did not contain readable target job content; action failed without blocking the browser session.";
  }
  if (state === "no_url") {
    return "no_url: Browser capture did not produce a usable URL; action failed without blocking the browser session.";
  }
  if (state === "captcha_or_security_challenge" || state === "login_required" || state === "two_factor_required") {
    return `Detected state: ${state}. Resolve the browser page in the visible Chrome session, then retry.`;
  }
  if (state === "connects_not_verified") {
    return "Connects not verified on the apply page. The application page stays open for QA; boost was skipped and final submit was not clicked.";
  }
  return `Detected state: ${state}; stop-before-submit enforced.`;
}

function quarantineBackoffUntil(repeatCount: number, now = new Date()): string | null {
  if (repeatCount <= 1) return null;
  const pauseMs = Math.min(60 * 60 * 1000, 5 * 60 * 1000 * 2 ** Math.min(5, repeatCount - 2));
  return new Date(now.getTime() + pauseMs).toISOString();
}

async function quarantineBrowserChallenge(input: {
  action: BrowserAction;
  thread: SlackThreadContext | null;
  state: DetectedBrowserState | string;
  url: string | null;
  title: string | null;
}): Promise<void> {
  const action = input.action;
  const source = typeof action.payload.source === "string"
    ? action.payload.source
    : typeof (action.payload.discovery as { sourceLabel?: unknown } | undefined)?.sourceLabel === "string"
      ? String((action.payload.discovery as { sourceLabel?: unknown }).sourceLabel)
      : null;
  const record = await recordBrowserManualAttention({
    actionId: action.id,
    jobId: action.jobId,
    applicationId: typeof action.payload.applicationId === "string" ? action.payload.applicationId : null,
    threadChannelId: input.thread?.channelId ?? (typeof action.payload.channelId === "string" ? action.payload.channelId : null),
    threadTs: input.thread?.threadTs ?? (typeof action.payload.threadTs === "string" ? action.payload.threadTs : null),
    actionType: action.actionType,
    source,
    url: input.url,
    title: input.title,
    reason: String(input.state),
  });
  const quarantine = (record.quarantinedActions ?? []).find((item) => item.actionId === action.id);
  mergeBrowserActionPayload(action.id, {
    challengeQuarantine: {
      actionId: action.id,
      jobId: action.jobId,
      applicationId: typeof action.payload.applicationId === "string" ? action.payload.applicationId : null,
      threadChannelId: input.thread?.channelId ?? null,
      threadTs: input.thread?.threadTs ?? null,
      challengeType: String(input.state),
      firstSeenAt: quarantine?.firstSeenAt ?? record.lastManualAttentionAt ?? new Date().toISOString(),
      lastSeenAt: quarantine?.lastSeenAt ?? record.lastManualAttentionAt ?? new Date().toISOString(),
      retryCommand: quarantine?.retryCommand ?? `retry ${action.id}`,
      status: "paused",
      source,
      pageUrl: input.url,
      pageTitle: input.title,
      repeatCount: quarantine?.repeatCount ?? 1,
      backoffUntil: quarantineBackoffUntil(quarantine?.repeatCount ?? 1),
    },
  });
}

export type DiscoverySlackNotificationStatus = "not_discovery" | "missing_channel" | "post_failed" | "posted";
type DiscoveryLeadPostOutcome = "not_needed" | "posted" | "failed";
interface DiscoveryLeadPostResult {
  status: DiscoverySlackNotificationStatus;
  thread?: SlackThreadContext;
  outcome: DiscoveryLeadPostOutcome;
}

export interface ProcessActionResult {
  slackPostsSucceeded: number;
  slackPostFailures: number;
}

export function buildCaptureCompletionStatus(input: { hasThreadContext: boolean; packetPosted: boolean; discoverySlackStatus?: DiscoverySlackNotificationStatus }): string {
  if (input.packetPosted) {
    if (input.discoverySlackStatus === "posted" && !input.hasThreadContext) {
      return "Capture completed and discovery lead message posted to Slack channel.";
    }
    return "Capture completed and lead message posted to Slack thread.";
  }
  if (input.discoverySlackStatus === "missing_channel") {
    return "Capture completed; no discovery Slack channel configured, lead message not posted.";
  }
  if (input.discoverySlackStatus === "post_failed") {
    return "Capture completed; discovery Slack lead message was not posted.";
  }
  if (!input.hasThreadContext) {
    return "Capture completed; no Slack thread context available, lead message not posted.";
  }
  return "Capture completed; Slack lead message was not posted.";
}

export function getDiscoverySourceMetadata(action: BrowserAction): { sourceType: string; sourceLabel: string; canonicalJobUrl?: string; postedAtText?: string } | null {
  const discovery = action.payload.discovery as { sourceType?: string; sourceLabel?: string; canonicalJobUrl?: string; postedAtText?: string } | undefined;
  if (!discovery?.sourceType || !discovery.sourceLabel) return null;
  return {
    sourceType: discovery.sourceType,
    sourceLabel: discovery.sourceLabel,
    canonicalJobUrl: discovery.canonicalJobUrl,
    ...(discovery.postedAtText ? { postedAtText: discovery.postedAtText } : {}),
  };
}

export async function postDiscoveryCapturePacket(input: {
  action: BrowserAction;
  scored: ScoredJob;
  upworkUrl: string;
  applicationQuestions: string[];
  questionAnswers: string[];
  autoPrepareDecision: AutoPrepareDraftDecision;
}, deps: {
  postChannelMessage?: typeof postSlackChannelMessage;
  postThreadMessage?: typeof postSlackThreadMessage;
  postWebhookMessage?: typeof sendSlackMessage;
  copyProvider?: SlackCopyProvider;
} = {}): Promise<DiscoveryLeadPostResult> {
  const postChannelMessage = deps.postChannelMessage ?? postSlackChannelMessage;
  const postThreadMessage = deps.postThreadMessage ?? postSlackThreadMessage;
  const postWebhookMessage = deps.postWebhookMessage ?? sendSlackMessage;
  const canUseWebhook = Boolean(deps.postWebhookMessage) || Boolean(SLACK_CHANNEL_WEBHOOK_URL.trim());
  const discovery = getDiscoverySourceMetadata(input.action);
  if (!discovery) return { status: "not_discovery", outcome: "not_needed" };
  const postingDecision = getSlackLeadPostingDecision(input.scored, {
    upworkUrl: input.upworkUrl,
    captureStatus: "packet_sent",
    jobIntelligence: input.scored.applicationDraft?.jobIntelligence,
  });
  if (!postingDecision.shouldPost) {
    const intelligence = input.scored.applicationDraft?.jobIntelligence;
    logger.info(
      `Discovery lead not posted to Slack: jobId=${input.scored.id} primaryPlatform=${intelligence?.primaryPlatform ?? "unknown"} ` +
      `platformEligibility=${postingDecision.platformEligibility} skippedBecausePlatform=${postingDecision.skippedBecausePlatform} ` +
      `reason=${postingDecision.reason} internalSkipReason=${postingDecision.internalSkipReason ?? "none"}`
    );
    return { status: "not_discovery", outcome: "not_needed" };
  }
  const packetContext: SlackPacketV3Context = {
    upworkUrl: input.upworkUrl,
    captureStatus: "packet_sent",
    browserCaptureActionId: input.action.id,
    browserDraftStatus: input.autoPrepareDecision.actionId ? (input.autoPrepareDecision.duplicate ? input.autoPrepareDecision.duplicateStatus ?? "queued" : "queued") : undefined,
    browserDraftActionId: input.autoPrepareDecision.actionId,
    requiredConnects: requiredConnectsForSlack(input.scored),
    suggestedBoostConnects: boostConnectsForSlack(input.scored),
    suggestedBid: input.scored.applicationDraft?.suggestedBid ?? "n/a",
    applicationQuestions: input.applicationQuestions,
    questionAnswers: input.questionAnswers,
    proofRecommendations: extractProofRecommendations(input.scored.applicationDraft),
    autoPrepareNote: input.autoPrepareDecision.note,
    sourceType: discovery.sourceType,
    sourceLabel: discovery.sourceLabel,
    postedAtText: discovery.postedAtText,
  };
  const packet = await writeV3CapturePacketWithLlm(input.scored, packetContext, deps.copyProvider);
  const existingThread = getSlackThreadStateByJobId(input.scored.id);
  if (existingThread) {
    const posted = await postThreadMessage({
      channel: existingThread.channelId,
      threadTs: existingThread.threadTs,
      text: packet.text,
      blocks: packet.blocks,
    });
    if (!posted) return { status: "post_failed", outcome: "failed" };
    updateApplicationStatus(input.scored.id, "sent_to_slack", "Discovery lead update posted to existing Slack thread.");
    updateSlackThreadStateStatus(existingThread.channelId, existingThread.threadTs, "packet_sent", {
      jobId: input.scored.id,
      upworkUrl: input.scored.url || input.upworkUrl,
    });
    if (input.autoPrepareDecision.actionId) {
      mergeBrowserActionPayload(input.autoPrepareDecision.actionId, {
        channelId: existingThread.channelId,
        threadTs: existingThread.threadTs,
        messageTs: existingThread.messageTs,
        applicationId: input.scored.id,
      });
    }
    return {
      status: "posted",
      thread: { channelId: existingThread.channelId, messageTs: existingThread.messageTs, threadTs: existingThread.threadTs },
      outcome: "posted",
    };
  }
  const discoveryChannelId = DISCOVERY_SLACK_CHANNEL_ID.trim();
  if (discoveryChannelId) {
    const result = await postChannelMessage({
      channel: discoveryChannelId,
      text: packet.text,
      blocks: packet.blocks,
    });
    if (result.ok && result.ts) {
      updateApplicationStatus(input.scored.id, "sent_to_slack", "Discovery lead packet posted to Slack channel.");

      const channelId = result.channel ?? discoveryChannelId;
      upsertSlackThreadState({
        channelId,
        messageTs: result.ts,
        threadTs: result.ts,
        upworkUrl: input.scored.url || input.upworkUrl,
        jobId: input.scored.id,
        status: "packet_sent",
      });
      if (input.autoPrepareDecision.actionId) {
        mergeBrowserActionPayload(input.autoPrepareDecision.actionId, {
          channelId,
          threadTs: result.ts,
          messageTs: result.ts,
          applicationId: input.scored.id,
        });
      }
      return { status: "posted", thread: { channelId, messageTs: result.ts, threadTs: result.ts }, outcome: "posted" };
    }
  }

  if (!canUseWebhook) {
    return { status: discoveryChannelId ? "post_failed" : "missing_channel", outcome: "failed" };
  }

  const sent = await postWebhookMessage({
    text: packet.text,
    blocks: packet.blocks as unknown as IncomingWebhookSendArguments["blocks"],
  });
  if (!sent) {
    return { status: "post_failed", outcome: "failed" };
  }

  updateApplicationStatus(input.scored.id, "sent_to_slack", "Discovery lead packet posted to Slack webhook channel.");
  return { status: "posted", outcome: "posted" };
}

async function processAction(action: BrowserAction, options: BrowserWorkerOptions): Promise<ProcessActionResult> {
  const result: ProcessActionResult = {
    slackPostsSucceeded: 0,
    slackPostFailures: 0,
  };
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
  const captureThreads = getSlackThreadContextsForCaptureAction(action);
  const thread = action.actionType === "capture_job_from_url"
    ? captureThreads[0] ?? null
    : getSlackThreadContextFromPayload(action);

  if (action.actionType === "prepare_application_review" && (!applyPlanResult?.valid || stalePayloadErrors.length > 0)) {
    const issues = [...(applyPlanResult?.issues ?? []), ...stalePayloadErrors];
    const diagnostics = buildApplyDiagnostics(action, plan, issues, "validation_failed");
    saveApplyDiagnostics(options, action, diagnostics);
    const postStatus = await postPrepareDraftStatus({
      thread,
      heading: `⚠️ Draft preparation paused for browser action #${action.id}.`,
      diagnostics,
      nextCommand: `retry ${action.id}`,
    });
    countPrepareDraftStatusPost(result, postStatus);
    updateBrowserActionStatus(action.id, "paused", `Apply preparation validation failed: ${issues.map((item) => item.code).join(", ")}`);
    return result;
  }

  if (!url) {
    updateBrowserActionStatus(action.id, "paused", "No URL available for browser action.");
    if (action.actionType === "capture_job_from_url") {
      updateCaptureThreadStates(action, "capture_failed");
      const blockerResult = await postCaptureBlockerNotificationsForAction({
        action,
        reason: "I could not find a usable Upwork URL for capture, so I stopped before opening anything.",
        stateKeyPart: "no_url",
      });
      result.slackPostsSucceeded += blockerResult.posted;
      result.slackPostFailures += blockerResult.failed;
    } else if (thread) {
      updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "capture_failed");
    }
    if (action.actionType === "prepare_application_review") {
      const diagnostics = buildApplyDiagnostics(action, plan, applyPlanResult?.issues ?? [], "no_url");
      saveApplyDiagnostics(options, action, diagnostics);
      const postStatus = await postPrepareDraftStatus({
        thread,
        heading: `⚠️ Draft preparation paused for browser action #${action.id}.`,
        diagnostics,
        nextCommand: `retry ${action.id}`,
      });
      countPrepareDraftStatusPost(result, postStatus);
    }
    return result;
  }

  if (action.actionType === "capture_job_from_url" && !hasAllowedCaptureSourceMetadata(action)) {
    const message = "Capture skipped: missing allowed discovery or Slack URL source metadata.";
    saveTextArtifact(options, action, "capture-unknown-source.json", JSON.stringify({
      actionId: action.id,
      jobId: action.jobId,
      url,
      source: action.payload.source ?? null,
      discovery: action.payload.discovery ?? null,
      reason: message,
    }, null, 2));
    for (const targetThread of captureThreads) {
      updateSlackThreadStateStatus(targetThread.channelId, targetThread.threadTs, "capture_failed", { jobId: action.jobId });
      await postSoulAwareBrowserThreadMessage({
        thread: targetThread,
        intent: "browser_capture_unknown_source",
        context: { url },
        deterministicText: [
          "⚠️ Browser capture skipped.",
          "I could not tie this job URL to an allowed discovery source or an explicit Slack URL intake, so I did not open it in Chrome.",
          `URL: ${url}`,
          `Retry command: mention me with the Upwork job URL in this thread or queue it from Best Matches/saved search discovery.`,
        ].join("\n"),
        preservePhrases: [url],
      });
    }
    updateBrowserActionStatus(action.id, "failed", message);
    logger.warn(`Browser action #${action.id} skipped unknown capture source: url=${url}`);
    return result;
  }

  if (action.actionType === "prepare_application_review") {
    try {
      assertSubmitGuard(plan);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const diagnostics = buildApplyDiagnostics(action, plan, applyPlanResult?.issues ?? [], "submit_guard_failed");
      saveApplyDiagnostics(options, action, diagnostics);
      const postStatus = await postPrepareDraftStatus({
        thread,
        heading: `⚠️ Draft preparation paused for browser action #${action.id}.`,
        diagnostics,
        nextCommand: `retry ${action.id}`,
      });
      countPrepareDraftStatusPost(result, postStatus);
      updateBrowserActionStatus(action.id, "paused", message);
      return result;
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
      scored.applicationDraft = await buildApplicationDraftWithResearch(scored);

      const questions = normalizeCaptureQuestions(`Upwork URL capture (dry-run): ${url}`);
      const answers = buildQuestionAnswers(questions, {
        bid: scored.applicationDraft?.suggestedBid ?? "standard",
        profileSummary: scored.title,
      });

      markJobSeen(scored, false);
      let autoPrepareDecision: AutoPrepareDraftDecision = {
        shouldQueue: false,
        category: "blocked_no_manual_override",
        reason: "auto-prepare not evaluated",
        note: "Not auto-preparing because the dry-run capture preview does not include verified live job intelligence.",
      };
      autoPrepareDecision = autoQueuePrepareDraft(scored, {}, thread);
      if (captureThreads.length > 0) {
        const threadPostResult = await postV3CapturePacketToThreads({
          action,
          job: scored,
          context: {
          upworkUrl: url,
          captureStatus: "packet_sent",
          browserCaptureActionId: action.id,
          browserDraftStatus: autoPrepareDecision.actionId ? (autoPrepareDecision.duplicate ? autoPrepareDecision.duplicateStatus ?? "queued" : "queued") : undefined,
          browserDraftActionId: autoPrepareDecision.actionId,
          requiredConnects: requiredConnectsForSlack(scored),
          suggestedBoostConnects: boostConnectsForSlack(scored),
          suggestedBid: scored.applicationDraft?.suggestedBid ?? "n/a",
          applicationQuestions: questions,
          questionAnswers: answers,
          proofRecommendations: extractProofRecommendations(scored.applicationDraft),
          autoPrepareNote: autoPrepareDecision.note,
          },
        });
        result.slackPostsSucceeded += threadPostResult.posted;
        result.slackPostFailures += threadPostResult.failed;
        if (threadPostResult.posted > 0) {
          updateCaptureThreadStates(action, autoPrepareDecision.actionId && !autoPrepareDecision.duplicate ? "prepare_draft_requested" : "packet_sent", { jobId: scored.id, upworkUrl: url });
        } else {
          logger.info(`Dry-run Slack thread lead message was not posted for jobId=${scored.id}; skipped=${threadPostResult.skipped} failed=${threadPostResult.failed}`);
        }
      }
      updateBrowserActionStatus(action.id, "paused", "Dry run: browser capture simulated from URL. Set BROWSER_DRY_RUN=false for real extraction.");
      logger.info(`[dry-run] Browser capture action #${action.id} simulated for ${url}`);
      return result;
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
      const postStatus = await postPrepareDraftStatus({
        thread,
        heading: `🧪 Draft preparation dry-run ready for browser action #${action.id}.`,
        diagnostics,
      });
      countPrepareDraftStatusPost(result, postStatus);
    }
    return result;
  }

  try {
    const { state, snapshot, fields, bodyText, inspectionDiagnostics, extractionBodyText, extractionDiagnostics, applicationSnapshot } = await inspectWithBrowser(action, options, url, plan ?? undefined);

    if (action.actionType === "prepare_application_review") {
      const diagnostics = buildApplyDiagnostics(action, plan, applyPlanResult?.issues ?? [], state, fields);
      saveApplyDiagnostics(options, action, diagnostics);
      if (plan) {
        recordBrowserApplyPlanLearning(plan, state === "apply_page_loaded" ? "browser_apply_prepared" : "browser_apply_attempt");
      }
      const coverLetterVerification = getVerification(fields.fieldVerification ?? [], "coverLetter");
      if (plan && applicationSnapshot && (state === "apply_page_loaded" || state === "connects_not_verified" || state === "field_preparation_incomplete") && coverLetterVerification?.status === "verified") {
        const persisted = persistApplicationSnapshot({
          jobId: action.jobId,
          snapshot: applicationSnapshot,
          plan,
          source: "upwork_inserted",
          note: "Browser worker verified inserted draft text on the Upwork apply page. Final submit was not clicked.",
        });
        if (!persisted.ok) {
          logger.warn(`Verified cover letter could not be persisted for browser action #${action.id}: ${persisted.fallbackReason ?? "unknown readback issue"}`);
        }
      }
      if (state === "field_preparation_incomplete") {
        logger.warn(`Required fields not filled confidently for browser action #${action.id}: ${getRequiredSkippedFields(fields).join(", ")}`);
        recordApplyPreparationFailureLearning({
          jobId: action.jobId,
          state,
          reason: diagnostics.warnings.join("; ") || "Apply preparation paused because one or more fields could not be verified.",
          requiredConnects: diagnostics.requiredConnects,
          unverifiedFields: diagnostics.unverifiedFields,
          channelId: thread?.channelId ?? null,
          threadTs: thread?.threadTs ?? null,
          source: "browser_apply_prep",
        });
      } else if (state === "connects_not_verified") {
        logger.warn(`Connects not verified for browser action #${action.id}; boost skipped and final submit remains manual.`);
        recordApplyPreparationFailureLearning({
          jobId: action.jobId,
          state,
          reason: "Required Connects were not visible on the apply page. This should be described as Connects not verified, not as a generic browser issue.",
          requiredConnects: diagnostics.requiredConnects,
          unverifiedFields: diagnostics.unverifiedFields,
          channelId: thread?.channelId ?? null,
          threadTs: thread?.threadTs ?? null,
          source: "browser_apply_prep",
        });
      }
      updateBrowserActionStatus(action.id, terminalStatusForState(state), stateStatusMessage(state));
      if (["login_required", "two_factor_required", "captcha_or_security_challenge"].includes(state)) {
        await quarantineBrowserChallenge({
          action,
          thread,
          state,
          url: snapshot?.url ?? url,
          title: snapshot?.title ?? null,
        });
      } else if (state === "apply_page_loaded") {
        markBrowserChallengeResolved(action.id);
      }
      if (state === "apply_page_loaded" || state === "connects_not_verified" || state === "field_preparation_incomplete") {
        const qaStatus = state === "apply_page_loaded" ? "prepared_for_qa" : "needs_review";
        const holdApplyUrl = snapshot?.url ?? diagnostics.applyUrl ?? url;
        updateApplicationStatus(
          action.jobId,
          qaStatus,
          state === "apply_page_loaded"
            ? "Browser draft prepared in remote Chrome for final human QA. Final submit was not clicked."
            : "Browser draft preparation needs human review in remote Chrome. Final submit was not clicked."
        );
        mergeBrowserActionPayload(action.id, {
          qaHold: {
            protected: true,
            jobId: action.jobId,
            applyUrl: holdApplyUrl,
            status: qaStatus,
            state,
            reason: state === "apply_page_loaded"
              ? "awaiting_human_qa"
              : state === "connects_not_verified"
                ? "connects_not_verified"
                : "needs_review",
            doNotReuse: true,
            do_not_reuse: true,
            createdAt: new Date().toISOString(),
          },
        });
      }
      if (state === "apply_page_loaded") {
        if (thread) {
          updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "prepared_draft", { jobId: action.jobId });
        }
      }
      const postStatus = await postPrepareDraftStatus({
        thread,
        heading: state === "apply_page_loaded" ? `✅ Upwork application page prepared for final manual submit for browser action #${action.id}.` : `⚠️ Draft preparation paused for browser action #${action.id}.`,
        diagnostics,
        nextCommand: state === "apply_page_loaded" ? "status" : `retry ${action.id}`,
      });
      countPrepareDraftStatusPost(result, postStatus);
      logger.info(`Browser action #${action.id} detected state: ${state}`);
      return result;
    }

    if (action.actionType === "capture_application_snapshot") {
      const source = proposalVersionSourceFromPayload(action.payload.proposalVersionSource);
      const payloadPlan = action.payload.applyPlan as BrowserApplyFillPlan | undefined;
      const snapshotInput = applicationSnapshot ?? null;
      if (!snapshotInput) {
        const reason = "Application snapshot could not read visible remote Chrome fields; final version is the last captured QA/readback version if available.";
        const fallback = action.payload.markSubmittedAfterCapture === true
          ? recordLatestVerifiedProposalFallback({
            jobId: action.jobId,
            reason,
            note: "Steve said submitted, but no visible application tab was available for read-only capture.",
          })
          : null;
        if (action.payload.markSubmittedAfterCapture === true) {
          updateApplicationStatus(
            action.jobId,
            "submitted",
            fallback
              ? `Steve said submitted, but no visible application tab was available. Preserved ${fallback.label} as a lower-confidence latest verified fallback.`
              : "Steve said submitted, but no visible application tab was available. Final version is the last captured QA/readback version if available."
          );
        }
        const message = fallback
          ? `No visible application tab was available; preserved ${fallback.label} as a lower-confidence latest verified fallback.`
          : "Application snapshot could not read remote Chrome fields before the browser session closed.";
        updateBrowserActionStatus(action.id, fallback ? "completed" : "failed", message);
        if (thread) {
          await postSoulAwareBrowserThreadMessage({
            thread,
            intent: "application_snapshot_failed",
            deterministicText: fallback
              ? `${message} I will not claim final submitted text beyond that fallback.`
              : `${message} Final version is the last captured QA/readback version if available.`,
            preservePhrases: fallback
              ? ["I will not claim final submitted text beyond that fallback."]
              : ["Final version is the last captured QA/readback version if available."],
          });
        }
        return result;
      }
      const persisted = persistApplicationSnapshot({
        jobId: action.jobId,
        snapshot: snapshotInput,
        plan: payloadPlan ?? buildBrowserApplyPlan(action.jobId).plan,
        source,
        note: typeof action.payload.notes === "string" ? action.payload.notes : null,
        markSubmittedAfterCapture: action.payload.markSubmittedAfterCapture === true,
      });
      updateBrowserActionStatus(
        action.id,
        "completed",
        persisted.ok
          ? `Captured application text as ${persisted.label}. Final submit was not clicked by the agent.`
          : persisted.fallbackReason ?? "Application text unavailable; used last captured QA version if available."
      );
      if (thread) {
        await postSoulAwareBrowserThreadMessage({
          thread,
          intent: "application_snapshot_saved",
          deterministicText: persisted.ok
            ? `Saved current remote Chrome application text as ${persisted.label}. Final submit remains manual on my side.`
            : `${persisted.fallbackReason ?? "Remote Chrome text was unavailable."} I will not claim final submitted text beyond the last captured QA/readback version.`,
          preservePhrases: persisted.ok ? ["Final submit remains manual"] : ["I will not claim final submitted text beyond the last captured QA/readback version."],
        });
      }
      return result;
    }

    if (action.actionType === "capture_job_from_url") {
      if (state === "source_context_unavailable" || state === "no_url") {
        saveTextArtifact(options, action, "capture-unavailable.json", JSON.stringify({
          actionId: action.id,
          jobId: action.jobId,
          url: snapshot?.url ?? url,
          title: snapshot?.title ?? null,
          state,
          inspectionDiagnostics,
          extractionDiagnostics,
        }, null, 2));
        updateCaptureThreadStates(action, "capture_failed", { jobId: action.jobId, upworkUrl: snapshot?.url ?? url });
        const blockerResult = await postCaptureBlockerNotificationsForAction({
          action,
          reason: state === "source_context_unavailable"
            ? "I could not read enough job content to score or draft safely."
            : "I could not find a usable Upwork URL for capture.",
          stateKeyPart: state,
        });
        result.slackPostsSucceeded += blockerResult.posted;
        result.slackPostFailures += blockerResult.failed;
        updateBrowserActionStatus(action.id, "failed", stateStatusMessage(state));
        logger.warn(`Browser action #${action.id} capture unavailable; marked failed without manual attention: url=${snapshot?.url ?? url} title=${snapshot?.title ?? "n/a"} detector=${inspectionDiagnostics?.finalDetection.source ?? "n/a"}`);
        return result;
      }

      if (isCaptureManualAttentionState(state)) {
        const threadStatus = String(state);
        if (["login_required", "two_factor_required", "captcha_or_security_challenge"].includes(threadStatus)) {
          markBrowserManualAttentionThreadAlert({
            actionId: action.id,
            jobId: action.jobId,
            applicationId: typeof action.payload.applicationId === "string" ? action.payload.applicationId : null,
            url: snapshot?.url ?? url,
            title: snapshot?.title ?? null,
            reason: threadStatus,
          });
        }
        for (const targetThread of captureThreads) {
          const alreadyManual = getSlackThreadStateByThreadTs(targetThread.channelId, targetThread.threadTs)?.status === "manual_attention_required";
          updateSlackThreadStateStatus(targetThread.channelId, targetThread.threadTs, "manual_attention_required");
          if (!alreadyManual) {
            await postSoulAwareBrowserThreadMessage({
              thread: targetThread,
              intent: "browser_capture_blocked",
              context: { browserState: threadStatus, pageTitle: snapshot?.title ?? null },
              deterministicText: [
                "⚠️ Browser capture is blocked.",
                threadStatus === "browser_profile_in_use"
                  ? "Remote Chrome is already using the shared profile, so I paused this capture safely."
                  : threadStatus === "cdp_unavailable"
                    ? "Remote Chrome is not reachable right now, so I paused this capture safely."
                    : "Upwork is asking for a browser check. I paused safely and did not submit anything.",
                snapshot?.title ? `Page: ${snapshot.title}` : null,
                "Next: clear the visible remote Chrome issue, then reply “retry” in this Slack thread.",
                "Ask for debug details if you need the raw browser state.",
              ].filter((line): line is string => Boolean(line)).join("\n"),
              preservePhrases: ["reply “retry”"],
            });
          }
          if (["login_required", "two_factor_required", "captcha_or_security_challenge"].includes(threadStatus)) {
            await quarantineBrowserChallenge({
              action,
              thread: targetThread,
              state: threadStatus,
              url: snapshot?.url ?? url,
              title: snapshot?.title ?? null,
            });
          }
        }
        updateBrowserActionStatus(action.id, "paused", stateStatusMessage(state));
        logger.warn(`Browser action #${action.id} blocked: ${threadStatus} url=${snapshot?.url ?? url} title=${snapshot?.title ?? "n/a"} detector=${inspectionDiagnostics?.finalDetection.source ?? "n/a"}`);
        return result;
      }

      if (extractionDiagnostics && (extractionDiagnostics as { lowConfidence?: boolean }).lowConfidence) {
        saveTextArtifact(options, action, "capture-low-confidence.json", JSON.stringify({
          actionId: action.id,
          jobId: action.jobId,
          url: snapshot?.url ?? url,
          title: snapshot?.title ?? null,
          extractionDiagnostics,
        }, null, 2));
        for (const targetThread of captureThreads) {
          updateSlackThreadStateStatus(targetThread.channelId, targetThread.threadTs, "capture_failed", { jobId: action.jobId });
          const alreadyManual = getSlackThreadStateByThreadTs(targetThread.channelId, targetThread.threadTs)?.status === "manual_attention_required";
          if (!alreadyManual) {
            await postSoulAwareBrowserThreadMessage({
              thread: targetThread,
              intent: "browser_capture_low_confidence",
              context: { currentUrl: snapshot?.url ?? url, currentTitle: snapshot?.title ?? null },
              deterministicText: [
                "⚠️ Browser capture failed for this job.",
                "I could not read enough job content to score or draft safely. The browser session was not marked blocked.",
                `Current URL: ${snapshot?.url ?? url}`,
                `Current title: ${snapshot?.title ?? "n/a"}`,
                "Next: reply “retry” in this Slack thread after the page is readable. Ask for debug details if you need raw extraction diagnostics.",
              ].join("\n"),
              preservePhrases: [snapshot?.url ?? url, "reply “retry”"],
            });
          }
        }
        updateBrowserActionStatus(action.id, "failed", "Capture extraction was low-confidence; lead message not posted.");
        logger.warn(`Browser action #${action.id} low-confidence capture failed lead message posting without manual attention.`);
        return result;
      }

      const normalized = buildDeterministicOpportunityPacket(extractionBodyText ?? bodyText, {
        url: snapshot?.url ?? url,
        source: "deterministic",
        capturedAt: new Date(),
      });
      const job = normalizedPacketToJobPosting(normalized);
      let intelligenceResult: Awaited<ReturnType<typeof parseJobIntelligence>> | null = null;
      let jobIntelligence: Awaited<ReturnType<typeof parseJobIntelligence>>["intelligence"] = null;
      try {
        intelligenceResult = await parseJobIntelligence({ job });
        jobIntelligence = intelligenceResult.intelligence;
        if (!intelligenceResult.ok) {
          logger.info(`Job intelligence unavailable for browser action #${action.id}: ${intelligenceResult.unavailableReason ?? intelligenceResult.error ?? "unknown"}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Job intelligence failed safely for browser action #${action.id}: ${message}`);
      }
      const scored = scoreJob(job, jobIntelligence);
      scored.applicationDraft = await buildApplicationDraftWithResearch(scored);
      if (jobIntelligence) {
        const platformMismatchWarnings = detectPlatformMismatchWarnings(jobIntelligence.primaryPlatform, jobIntelligence.platformsMentioned, scored.applicationDraft.proposalText);
        if (platformMismatchWarnings.length > 0) {
          jobIntelligence.platformMismatchWarnings = Array.from(new Set([...jobIntelligence.platformMismatchWarnings, ...platformMismatchWarnings]));
          jobIntelligence.needsManualReview = true;
          scored.applicationDraft.redFlags = Array.from(new Set([...scored.applicationDraft.redFlags, ...platformMismatchWarnings]));
          scored.scoreBreakdown.risks = Array.from(new Set([...scored.scoreBreakdown.risks, ...platformMismatchWarnings]));
          scored.scoreBreakdown.redFlagScore.risks = Array.from(new Set([...scored.scoreBreakdown.redFlagScore.risks, ...platformMismatchWarnings]));
        }
        scored.applicationDraft.jobIntelligence = jobIntelligence;
      }
      saveTextArtifact(options, action, "job-intelligence.json", JSON.stringify(intelligenceResult ?? { ok: false, unavailableReason: "not_run" }, null, 2));

      const mergedQuestions = normalizeCaptureQuestions(extractionBodyText ?? bodyText);
      const applicationQuestions = mergedQuestions.length > 0 ? mergedQuestions : normalized.applicationQuestions.slice(0, 6);
      const questionAnswers = buildQuestionAnswers(applicationQuestions, {
        bid: scored.applicationDraft?.suggestedBid ?? "standard",
        profileSummary: scored.title,
      });

      markJobSeen(scored, false);
      recordPlannedScreeningCoverage(scored.id, applicationQuestions, questionAnswers, {
        jobContext: screeningJobContext({ jobId: scored.id, plan: null }),
        confidence: applicationQuestions.length > 0 ? "medium" : "low",
      });
      let packetPosted = false;
      let autoPrepareDecision: AutoPrepareDraftDecision = {
        shouldQueue: false,
        category: "blocked_no_manual_override",
        reason: "auto-prepare not evaluated",
        note: "Not auto-preparing because browser draft preparation was not evaluated.",
      };
      let discoverySlackStatus: DiscoverySlackNotificationStatus | undefined;
      autoPrepareDecision = autoQueuePrepareDraft(scored, {}, thread);
      if (captureThreads.length > 0) {
        const threadPostResult = await postV3CapturePacketToThreads({
          action,
          job: scored,
          context: {
          upworkUrl: url,
          captureStatus: "packet_sent",
          browserCaptureActionId: action.id,
          browserDraftStatus: autoPrepareDecision.actionId ? (autoPrepareDecision.duplicate ? autoPrepareDecision.duplicateStatus ?? "queued" : "queued") : undefined,
          browserDraftActionId: autoPrepareDecision.actionId,
          requiredConnects: requiredConnectsForSlack(scored),
          suggestedBoostConnects: boostConnectsForSlack(scored),
          suggestedBid: scored.applicationDraft?.suggestedBid ?? "n/a",
          applicationQuestions,
          questionAnswers,
          proofRecommendations: extractProofRecommendations(scored.applicationDraft),
          autoPrepareNote: autoPrepareDecision.note,
          },
        });
        packetPosted = threadPostResult.posted > 0;
        result.slackPostsSucceeded += threadPostResult.posted;
        result.slackPostFailures += threadPostResult.failed;
        if (packetPosted) {
          updateCaptureThreadStates(action, autoPrepareDecision.actionId && !autoPrepareDecision.duplicate ? "prepare_draft_requested" : "packet_sent", { jobId: scored.id, upworkUrl: url });
        } else {
          logger.info(`Slack thread lead message was not posted for jobId=${scored.id}; skipped=${threadPostResult.skipped} failed=${threadPostResult.failed}`);
        }
      } else {
        const discoveryNotification = await postDiscoveryCapturePacket({
          action,
          scored,
          upworkUrl: url,
          applicationQuestions,
          questionAnswers,
          autoPrepareDecision,
        });
        discoverySlackStatus = discoveryNotification.status === "not_discovery" ? undefined : discoveryNotification.status;
        packetPosted = discoveryNotification.outcome === "posted";
        if (discoveryNotification.outcome === "posted") {
          result.slackPostsSucceeded += 1;
        } else if (discoveryNotification.outcome === "failed") {
          result.slackPostFailures += 1;
        }
      }
      updateBrowserActionStatus(action.id, "completed", buildCaptureCompletionStatus({ hasThreadContext: Boolean(thread), packetPosted, discoverySlackStatus }));
      return result;
    }

    updateBrowserActionStatus(action.id, terminalStatusForState(state), stateStatusMessage(state));
    logger.info(`Browser action #${action.id} detected state: ${state}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateBrowserActionStatus(action.id, "failed", message);
    if (action.actionType === "capture_job_from_url") {
      updateCaptureThreadStates(action, "capture_failed", { jobId: action.jobId });
      const blockerResult = await postCaptureBlockerNotificationsForAction({
        action,
        reason: message,
        stateKeyPart: "exception",
      });
      result.slackPostsSucceeded += blockerResult.posted;
      result.slackPostFailures += blockerResult.failed;
    } else if (thread) {
      updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "capture_failed");
    }
    logger.error(`Browser action #${action.id} failed: ${message}`);
  }
  return result;
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

  const active = listBrowserActions("in_progress", 1);
  if (active.length > 0) {
    logger.warn(`Browser worker found active browser action #${active[0]!.id}; leaving pending queue untouched to keep browser work serialized.`);
    return;
  }
  const actionLimit = options.dryRun ? options.limit : 1;
  const pending = listBrowserActions("pending", actionLimit);
  if (!options.dryRun) {
    logger.info("Live browser mode serialization enforced: processing at most 1 pending action this run.");
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

export async function runControlledWorkerLoop(input: ControlledWorkerRunOptions = {}): Promise<ControlledWorkerRunSummary> {
  const maxActions = Math.max(1, input.maxActions ?? 2);
  const allowedActionTypes = new Set(input.allowedActionTypes ?? ["capture_job_from_url"]);
  const summary: ControlledWorkerRunSummary = {
    actionsProcessed: 0,
    actionsCompleted: 0,
    actionsPaused: 0,
    actionsSkipped: 0,
    slackPostsSucceeded: 0,
    slackPostFailures: 0,
    stoppedReason: "unknown",
    remainingPendingCount: 0,
  };

  const session = getBrowserSessionStatus();
  if (session.blocked) {
    summary.stoppedReason = "browser_session_blocked";
    summary.remainingPendingCount = listBrowserActions("pending", 500).length;
    return summary;
  }

  const options = loadOptions();
  const workerOptions = { ...options, dryRun: input.dryRun ?? options.dryRun, limit: 1 };
  const active = listBrowserActions("in_progress", 1);
  if (active.length > 0) {
    summary.stoppedReason = "browser_action_in_progress";
    summary.remainingPendingCount = listBrowserActions("pending", 500).length;
    return summary;
  }
  const pending = listBrowserActions("pending", 500);
  if (pending.length === 0) {
    summary.stoppedReason = "queue_empty";
    summary.remainingPendingCount = 0;
    return summary;
  }

  for (const action of pending) {
    if (summary.actionsProcessed >= maxActions) {
      summary.stoppedReason = "max_actions_reached";
      break;
    }
    if (!allowedActionTypes.has(action.actionType)) {
      summary.actionsSkipped += 1;
      continue;
    }
    summary.actionsProcessed += 1;
    const actionResult = input.processActionOverride
      ? await input.processActionOverride(action)
      : await processAction(action, workerOptions);
    summary.slackPostsSucceeded += actionResult.slackPostsSucceeded;
    summary.slackPostFailures += actionResult.slackPostFailures;
    const refreshed = getBrowserActionById(action.id);
    if (refreshed?.status === "completed") summary.actionsCompleted += 1;
    if (refreshed?.status === "paused") {
      summary.actionsPaused += 1;
      summary.stoppedReason = "manual_attention_required";
      break;
    }
  }

  if (summary.stoppedReason === "unknown") summary.stoppedReason = "completed_batch";
  summary.remainingPendingCount = listBrowserActions("pending", 500).length;
  return summary;
}

if (require.main === module) {
  const options = loadOptions();
  const command = process.argv[2];
  const run = command === "--readiness"
    ? logReadiness(options)
    : command === "--controlled"
      ? runControlledWorkerLoop({
        maxActions: Number.parseInt(process.argv[3] ?? "2", 10),
        dryRun: process.argv.includes("--live") ? false : true,
      }).then((summary) => {
        process.stdout.write(`${JSON.stringify(summary)}\n`);
      })
      : runBrowserWorker(options);
  run
    .catch((error: unknown) => {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
