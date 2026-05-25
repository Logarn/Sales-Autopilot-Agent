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
  SLACK_CHANNEL_WEBHOOK_URL,
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
  updateApplicationStatus,
  updateBrowserActionStatus,
  updateSlackThreadStateStatus,
  upsertSlackThreadState,
} from "./db";
import { buildApplicationDraft } from "./agent";
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
  ScoredJob,
} from "./types";
import { buildV3CapturePacket, shouldPostLeadPacket, SlackPacketV3Context } from "./slackPacketV3";
import { evaluatePlatformEligibility } from "./platformEligibility";
import { decideLeadHandling } from "./leadDecision";
import { sendSlackMessage } from "./slack";
import { postSlackChannelMessage, postSlackThreadMessage } from "./slackThread";
import type { IncomingWebhookSendArguments } from "@slack/webhook";
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
  allowedActionTypes?: Array<"capture_job_from_url" | "open_job" | "open_apply_page" | "prepare_application_review">;
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
  fill(value: string, options?: { timeout?: number }): Promise<unknown>;
  setInputFiles(files: string[], options?: { timeout?: number }): Promise<unknown>;
  check(options?: { timeout?: number }): Promise<unknown>;
}

interface PlaywrightPageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  locator(selector: string): PlaywrightLocatorLike;
  evaluate?<R>(fn: () => R): Promise<R>;
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
  screeningAnswersCount: number;
  rate: string | null;
  requiredConnects: number | null;
  boostConnects: number | null;
  totalConnects: number | null;
  connectsDecision: string | null;
  connectsExpectedValue: number | null;
  selectedAttachments: string[];
  manualReviewAssets: string[];
  mentionOnlyProof: string[];
  proofAvailability: string[];
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
  if (!payload.channelId || !payload.threadTs || !payload.messageTs) {
    return null;
  }
  return {
    channelId: payload.channelId,
    threadTs: payload.threadTs,
    messageTs: payload.messageTs,
  };
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
    { source: "body_text" as const, value: "challenge" },
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
    connectsDecision: plan?.connectsStrategy.decision ?? null,
    connectsExpectedValue: plan?.connectsStrategy.expectedValueScore ?? null,
    selectedAttachments: plan?.attachments.map((attachment) => attachment.name) ?? [],
    manualReviewAssets: plan?.manualReviewAssets ?? [],
    mentionOnlyProof: plan?.mentionOnlyProof ?? [],
    proofAvailability: plan?.proofAvailability ?? [],
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
): Promise<{ page: PlaywrightPageLike; reusedExistingPage: boolean; reason: string }> {
  const pages = context.pages?.() ?? [];
  const exactMatch = pages.find((candidate) => urlsReferToSameUpworkJob(candidate.url(), targetUrl) || candidate.url() === targetUrl);
  if (exactMatch) {
    return { page: exactMatch, reusedExistingPage: true, reason: `Reused existing page matching target URL/job token: ${exactMatch.url()}` };
  }
  return { page: await context.newPage(), reusedExistingPage: false, reason: "Opened a new page because no matching existing Upwork page was found." };
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
  if (!shouldPostLeadPacket(job, context)) {
    const intelligence = context.jobIntelligence ?? job.applicationDraft?.jobIntelligence;
    const eligibility = evaluatePlatformEligibility(intelligence);
    logger.info(
      `Lead skipped for platform eligibility: jobId=${job.id} primaryPlatform=${intelligence?.primaryPlatform ?? "unknown"} ` +
      `platformEligibility=${eligibility.platformEligibility} skippedBecausePlatform=${eligibility.skippedBecausePlatform} ` +
      `eligibilityReason=${eligibility.eligibilityReason}`
    );
    return "skipped";
  }
  const packet = buildV3CapturePacket(job, context);
  const posted = await postThreadMessage({
    channel: thread.channelId,
    threadTs: thread.threadTs,
    text: packet.text,
    blocks: packet.blocks,
  });
  if (posted && job.applicationDraft) {
    updateApplicationStatus(job.id, "sent_to_slack", "Lead packet posted to Slack for review.");
  }
  return posted ? "posted" : "failed";
}

function buildPrepareDraftStatusMessage(input: {
  heading: string;
  diagnostics: ApplyPreparationDiagnostics;
  nextCommand?: string;
}): string {
  const { diagnostics } = input;
  const readyState = diagnostics.state === "apply_page_loaded" || diagnostics.state === "dry_run" || diagnostics.state === "prepared";
  const needsManualReview = diagnostics.validationIssues.some((issue) => issue.severity === "warning" || issue.severity === "error") ||
    diagnostics.missingLocalAssets.length > 0 ||
    diagnostics.manualFields.length > 0 ||
    diagnostics.connectsDecision !== "safe_apply";
  return [
    input.heading,
    `Review state: ${readyState ? "draft prepared for human review" : "paused before final review"}`,
    `Job: ${diagnostics.jobTitle ?? diagnostics.jobId}`,
    `Job ID: ${diagnostics.jobId}`,
    `Apply URL: ${diagnostics.applyUrl ?? diagnostics.sourceUrl ?? "n/a"}`,
    `Cover letter ready: ${diagnostics.coverLetterPresent ? `yes (${diagnostics.coverLetterLength} chars)` : "no"}`,
    `Screening answers ready: ${diagnostics.screeningAnswersCount > 0 ? `yes (${diagnostics.screeningAnswersCount})` : "none detected"}`,
    `Rate/bid: ${diagnostics.rate ?? "n/a"}`,
    `Connects: required=${diagnostics.requiredConnects ?? "n/a"} boost=${diagnostics.boostConnects ?? "n/a"} total=${diagnostics.totalConnects ?? "n/a"}`,
    `Connects decision: ${diagnostics.connectsDecision ?? "n/a"}${diagnostics.connectsExpectedValue !== null ? ` (EV ${diagnostics.connectsExpectedValue}/100)` : ""}`,
    `Auto-attach assets: ${diagnostics.selectedAttachments.length > 0 ? diagnostics.selectedAttachments.join(", ") : "none"}`,
    `Manual-review assets: ${diagnostics.manualReviewAssets.length > 0 ? diagnostics.manualReviewAssets.join("; ") : "none"}`,
    `Mention-only proof: ${diagnostics.mentionOnlyProof.length > 0 ? diagnostics.mentionOnlyProof.join("; ") : "none"}`,
    `Proof availability: ${diagnostics.proofAvailability.length > 0 ? diagnostics.proofAvailability.join("; ") : "none"}`,
    `Missing local assets: ${diagnostics.missingLocalAssets.length > 0 ? diagnostics.missingLocalAssets.join("; ") : "none"}`,
    `Fields filled: ${diagnostics.attemptedFields.length > 0 ? diagnostics.attemptedFields.join(", ") : "none"}`,
    `Fields not filled: ${diagnostics.skippedFields.length > 0 ? diagnostics.skippedFields.join(", ") : "none"}`,
    `Manual review fields: ${diagnostics.manualFields.length > 0 ? diagnostics.manualFields.join(", ") : "none"}`,
    `Needs manual action before submit: ${needsManualReview ? "yes" : "no"}`,
    `Warnings: ${diagnostics.warnings.length > 0 ? diagnostics.warnings.join("; ") : "none"}`,
    `Stop before submit: ${diagnostics.stopBeforeSubmit}`,
    "Final submit remains manual and was not clicked.",
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
  inspectionDiagnostics?: BrowserInspectionDiagnostics;
  extractionBodyText?: string;
  extractionDiagnostics?: unknown;
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
    const selectedPage = sourceContextCapture || !shouldDirectFallback ? null : await selectPageForBrowserAction(sessionHandle.context, url);
    const page = selectedPage?.page;
    if (page && (!selectedPage.reusedExistingPage || !urlsReferToSameUpworkJob(page.url(), url))) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    }
    const unavailableDetection: BrowserStateDetection = { state: "source_context_unavailable", source: "none", summary: "Discovery source context did not contain readable target job content; direct fallback is disabled for discovery-origin captures." };
    const unavailableSnapshot: PageSnapshot = { url: currentPageUrlBeforeCapture, title: currentPageTitleBeforeCapture, textExcerpt: "" };
    const settled = sourceContextCapture
      ? { snapshot: sourceContextCapture.snapshot, bodyText: sourceContextCapture.bodyText, detection: sourceContextCapture.detection, samples: [{ step: 1, url: sourceContextCapture.sourcePageUrl, title: sourceContextCapture.snapshot.title, textExcerpt: sourceContextCapture.snapshot.textExcerpt, detection: sourceContextCapture.detection }] }
      : !shouldDirectFallback
        ? { snapshot: unavailableSnapshot, bodyText: "", detection: unavailableDetection, samples: [{ step: 1, url: currentPageUrlBeforeCapture, title: "", textExcerpt: "", detection: unavailableDetection }] }
        : await settlePageAndDetect(page!, action);
    const { snapshot, bodyText, detection, samples } = settled;
    let state = sourceContextCapture?.state ?? detection.state;
    let extractedRawText = bodyText;
    let extractionDiagnostics: unknown;
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
        state = "captcha_or_security_challenge";
      }
    }
    const fields =
      plan && state === "apply_page_loaded"
        ? await fillApplyFields(page!, plan)
        : { attemptedFields: [], skippedFields: [], manualFields: [] };
    if (plan && state === "apply_page_loaded" && getRequiredSkippedFields(fields).length > 0) {
      state = "field_preparation_incomplete";
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
    return { state, snapshot, fields, bodyText, inspectionDiagnostics, extractionBodyText: extractedRawText, extractionDiagnostics };
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
  if (state === "source_context_unavailable") {
    return "source_context_unavailable: Discovery source context did not contain readable target job content; direct fallback was not attempted.";
  }
  if (state === "captcha_or_security_challenge" || state === "login_required" || state === "two_factor_required") {
    return `Detected state: ${state}. Resolve the browser page in the visible Chrome session, then retry.`;
  }
  return `Detected state: ${state}; stop-before-submit enforced.`;
}

export type DiscoverySlackNotificationStatus = "not_discovery" | "missing_channel" | "post_failed" | "posted";
type DiscoveryLeadPostOutcome = "not_needed" | "posted" | "failed";
interface DiscoveryLeadPostResult {
  status: DiscoverySlackNotificationStatus;
  thread?: SlackThreadContext;
  outcome: DiscoveryLeadPostOutcome;
}

interface ProcessActionResult {
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
  postWebhookMessage?: typeof sendSlackMessage;
} = {}): Promise<DiscoveryLeadPostResult> {
  const postChannelMessage = deps.postChannelMessage ?? postSlackChannelMessage;
  const postWebhookMessage = deps.postWebhookMessage ?? sendSlackMessage;
  const canUseWebhook = Boolean(deps.postWebhookMessage) || Boolean(SLACK_CHANNEL_WEBHOOK_URL.trim());
  const discovery = getDiscoverySourceMetadata(input.action);
  if (!discovery) return { status: "not_discovery", outcome: "not_needed" };
  if (!shouldPostLeadPacket(input.scored, {
    upworkUrl: input.upworkUrl,
    captureStatus: "packet_sent",
    jobIntelligence: input.scored.applicationDraft?.jobIntelligence,
  })) {
    const intelligence = input.scored.applicationDraft?.jobIntelligence;
    const eligibility = evaluatePlatformEligibility(intelligence);
    logger.info(
      `Discovery lead skipped for platform eligibility: jobId=${input.scored.id} primaryPlatform=${intelligence?.primaryPlatform ?? "unknown"} ` +
      `platformEligibility=${eligibility.platformEligibility} skippedBecausePlatform=${eligibility.skippedBecausePlatform} ` +
      `eligibilityReason=${eligibility.eligibilityReason}`
    );
    return { status: "not_discovery", outcome: "not_needed" };
  }

  const packet = buildV3CapturePacket(input.scored, {
    upworkUrl: input.upworkUrl,
    captureStatus: "packet_sent",
    browserCaptureActionId: input.action.id,
    browserDraftStatus: input.autoPrepareDecision.actionId ? (input.autoPrepareDecision.duplicate ? input.autoPrepareDecision.duplicateStatus ?? "queued" : "queued") : undefined,
    browserDraftActionId: input.autoPrepareDecision.actionId,
    requiredConnects: input.scored.applicationDraft?.suggestedConnects ?? 0,
    suggestedBoostConnects: input.scored.applicationDraft?.suggestedBoostConnects ?? 0,
    suggestedBid: input.scored.applicationDraft?.suggestedBid ?? "n/a",
    applicationQuestions: input.applicationQuestions,
    questionAnswers: input.questionAnswers,
    proofRecommendations: extractProofRecommendations(input.scored.applicationDraft),
    autoPrepareNote: input.autoPrepareDecision.note,
    sourceType: discovery.sourceType,
    sourceLabel: discovery.sourceLabel,
    postedAtText: discovery.postedAtText,
  });
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
    return result;
  }

  if (!url) {
    updateBrowserActionStatus(action.id, "paused", "No URL available for browser action.");
    if (thread) {
      updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "capture_failed");
    }
    return result;
  }

  if (action.actionType === "prepare_application_review") {
    try {
      assertSubmitGuard(plan);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      saveApplyDiagnostics(options, action, buildApplyDiagnostics(action, plan, applyPlanResult?.issues ?? [], "submit_guard_failed"));
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
        const threadPostStatus = await postV3CapturePacketToThread(scored, thread, {
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
        if (threadPostStatus === "posted") {
          result.slackPostsSucceeded += 1;
          updateSlackThreadStateStatus(thread.channelId, thread.threadTs, autoPrepareDecision.actionId && !autoPrepareDecision.duplicate ? "prepare_draft_requested" : "packet_sent", { jobId: scored.id });
        } else if (threadPostStatus === "failed") {
          result.slackPostFailures += 1;
        } else {
          logger.info(`Dry-run Slack thread lead message was not posted for jobId=${scored.id}; status=${threadPostStatus}`);
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
      await postPrepareDraftStatusToThread(thread, {
        heading: `🧪 Draft preparation dry-run ready for browser action #${action.id}.`,
        diagnostics,
      });
    }
    return result;
  }

  try {
    const { state, snapshot, fields, bodyText, inspectionDiagnostics, extractionBodyText, extractionDiagnostics } = await inspectWithBrowser(action, options, url, plan ?? undefined);

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
      if (state === "apply_page_loaded") {
        updateApplicationStatus(action.jobId, "draft_prepared", "Browser draft prepared for final human review. Final submit was not clicked.");
        if (thread) {
          updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "prepared_draft", { jobId: action.jobId });
        }
      }
      await postPrepareDraftStatusToThread(thread, {
        heading: state === "apply_page_loaded" ? `✅ Draft preparation ready for review for browser action #${action.id}.` : `⚠️ Draft preparation paused for browser action #${action.id}.`,
        diagnostics,
        nextCommand: state === "apply_page_loaded" ? "status" : `retry ${action.id}`,
      });
      logger.info(`Browser action #${action.id} detected state: ${state}`);
      return result;
    }

    if (action.actionType === "capture_job_from_url") {
      if (isCaptureBlockedState(state)) {
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
                threadStatus === "browser_profile_in_use"
                  ? "Chrome profile is already open. Use CDP mode or close Chrome before retrying."
                  : threadStatus === "cdp_unavailable"
                    ? "Persistent Chrome session is not running. Start it with npm run browser:session."
                    : "I paused because the current page still appears to require manual browser attention.",
                `Current URL: ${snapshot?.url ?? url}`,
                `Current title: ${snapshot?.title ?? "n/a"}`,
                inspectionDiagnostics ? `Detector: ${inspectionDiagnostics.finalDetection.source}${inspectionDiagnostics.finalDetection.matchedText ? ` (${inspectionDiagnostics.finalDetection.matchedText})` : ""}` : "Detector: n/a",
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
        if (thread) {
          updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "capture_failed", { jobId: action.jobId });
          const alreadyManual = getSlackThreadStateByThreadTs(thread.channelId, thread.threadTs)?.status === "manual_attention_required";
          if (!alreadyManual) {
            await postSlackThreadMessage({
              channel: thread.channelId,
              threadTs: thread.threadTs,
              text: [
                "⚠️ Browser capture is paused.",
                "I paused because the current page still appears to require manual browser attention.",
                `Current URL: ${snapshot?.url ?? url}`,
                `Current title: ${snapshot?.title ?? "n/a"}`,
                `Extraction diagnostics: ${JSON.stringify(extractionDiagnostics)}`,
                `Retry command: npm run browser:retry -- --id ${action.id}`,
              ].join("\n"),
            });
          }
        }
        updateBrowserActionStatus(action.id, "failed", "Capture extraction was low-confidence; lead message not posted.");
        logger.warn(`Browser action #${action.id} low-confidence capture blocked lead message posting.`);
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
      scored.applicationDraft = buildApplicationDraft(scored);
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
      let packetPosted = false;
      let autoPrepareDecision: AutoPrepareDraftDecision = {
        shouldQueue: false,
        category: "blocked_no_manual_override",
        reason: "no thread context",
        note: "Not auto-preparing because no Slack thread context was available for browser staging.",
      };
      let discoverySlackStatus: DiscoverySlackNotificationStatus | undefined;
      if (thread) {
        autoPrepareDecision = decideAutoPrepareDraft(scored);
        if (autoPrepareDecision.shouldQueue) {
          autoPrepareDecision = queuePrepareDraftActionForThread(scored, thread);
        }
        updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "captured", { jobId: scored.id });
        updateSlackThreadStateStatus(thread.channelId, thread.threadTs, "scored", { jobId: scored.id });
        const threadPostStatus = await postV3CapturePacketToThread(scored, thread, {
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
        packetPosted = threadPostStatus === "posted";
        if (packetPosted) {
          result.slackPostsSucceeded += 1;
          updateSlackThreadStateStatus(thread.channelId, thread.threadTs, autoPrepareDecision.actionId && !autoPrepareDecision.duplicate ? "prepare_draft_requested" : "packet_sent", { jobId: scored.id });
        } else if (threadPostStatus === "failed") {
          result.slackPostFailures += 1;
        } else {
          logger.info(`Slack thread lead message was not posted for jobId=${scored.id}; status=${threadPostStatus}`);
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
    if (thread) {
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
    const actionResult = await processAction(action, workerOptions);
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
