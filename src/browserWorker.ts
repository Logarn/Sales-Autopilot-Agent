import * as fs from "node:fs";
import * as path from "node:path";
import {
  BROWSER_ACTION_LIMIT,
  BROWSER_ARTIFACT_DIR,
  BROWSER_CHROME_EXECUTABLE_PATH,
  BROWSER_DRY_RUN,
  BROWSER_HEADLESS,
  BROWSER_LIVE_ACTION_LIMIT,
  BROWSER_USER_DATA_DIR,
  BROWSER_WORKER_ENABLED,
} from "./config";
import { buildBrowserApplyPlan } from "./browserApply";
import {
  closeDb,
  incrementBrowserActionAttempts,
  listBrowserActions,
  updateBrowserActionStatus,
} from "./db";
import { logger } from "./logger";
import { BrowserAction, BrowserApplyFillPlan, BrowserApplyValidationIssue } from "./types";

type DetectedBrowserState =
  | "dry_run"
  | "browser_unavailable"
  | "login_required"
  | "two_factor_required"
  | "captcha_or_security_challenge"
  | "job_page_loaded"
  | "apply_page_loaded"
  | "page_loaded"
  | "field_preparation_incomplete"
  | "submit_guard_failed"
  | "no_url";

interface BrowserWorkerOptions {
  dryRun: boolean;
  headless: boolean;
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
  skippedAttachments: Array<{ name: string; reason: string }>;
  selectedHighlights: string[];
  warnings: string[];
  attemptedFields: string[];
  skippedFields: string[];
  manualFields: string[];
}

interface PlaywrightContextLike {
  newPage(): Promise<PlaywrightPageLike>;
  close(): Promise<unknown>;
}

interface PlaywrightChromiumLike {
  launchPersistentContext(
    userDataDir: string,
    options: { headless: boolean; executablePath?: string }
  ): Promise<PlaywrightContextLike>;
}

function findChromeExecutable(): string | null {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function loadOptions(): BrowserWorkerOptions {
  return {
    dryRun: BROWSER_DRY_RUN,
    headless: BROWSER_HEADLESS,
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
  return null;
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
    haystack.includes("security check") ||
    haystack.includes("verify you are human")
  ) {
    return "captcha_or_security_challenge";
  }
  if (haystack.includes("log in") || haystack.includes("login") || haystack.includes("sign in")) {
    return "login_required";
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
    `  source_url: ${diagnostics.sourceUrl ?? "n/a"}`,
    `  apply_url: ${diagnostics.applyUrl ?? "n/a"}`,
    `  intended_action: ${diagnostics.intendedAction}`,
    `  cover_letter: present=${diagnostics.coverLetterPresent} length=${diagnostics.coverLetterLength}`,
    `  screening_answers_count: ${diagnostics.screeningAnswersCount}`,
    `  rate_bid_amount: ${diagnostics.rate ?? "n/a"}`,
    `  connects: required=${diagnostics.requiredConnects ?? "n/a"} boost=${diagnostics.boostConnects ?? "n/a"} total=${diagnostics.totalConnects ?? "n/a"}`,
    `  selected_attachments: ${diagnostics.selectedAttachments.length > 0 ? diagnostics.selectedAttachments.join(", ") : "none"}`,
    `  skipped_attachments: ${diagnostics.skippedAttachments.length > 0 ? diagnostics.skippedAttachments.map((item) => `${item.name} (${item.reason})`).join("; ") : "none"}`,
    `  selected_highlights: ${diagnostics.selectedHighlights.length > 0 ? diagnostics.selectedHighlights.join("; ") : "none"}`,
    `  stop_before_submit: ${diagnostics.stopBeforeSubmit}`,
    `  warnings: ${diagnostics.warnings.length > 0 ? diagnostics.warnings.join("; ") : "none"}`,
  ].join("\n");
}

function boundedExcerpt(value: string, maxLength = 2000): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
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
  userDataDir: string;
  dryRun: boolean;
  workerEnabled: boolean;
  submitGuardEnabled: true;
  liveActionLimit: number;
}> {
  return {
    playwrightAvailable: Boolean(await loadChromium()),
    chromeExecutableFound: Boolean(options.chromeExecutablePath),
    chromeExecutablePath: options.chromeExecutablePath,
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
      `chromeExecutablePath=${readiness.chromeExecutablePath ?? "n/a"} userDataDir=${readiness.userDataDir} ` +
      `dryRun=${readiness.dryRun} workerEnabled=${readiness.workerEnabled} submitGuardEnabled=${readiness.submitGuardEnabled} ` +
      `liveActionLimit=${readiness.liveActionLimit}`
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
): Promise<{ state: DetectedBrowserState; fields: Pick<ApplyPreparationDiagnostics, "attemptedFields" | "skippedFields" | "manualFields"> }> {
  const chromium = await loadChromium();
  if (!chromium) {
    saveTextArtifact(options, action, "browser-unavailable.json", JSON.stringify({ actionId: action.id, jobId: action.jobId, actionType: action.actionType, url }, null, 2));
    return { state: "browser_unavailable", fields: { attemptedFields: [], skippedFields: [], manualFields: [] } };
  }

  let context: PlaywrightContextLike | null = null;
  try {
    context = await chromium.launchPersistentContext(options.userDataDir, {
      headless: options.headless,
      ...(options.chromeExecutablePath ? { executablePath: options.chromeExecutablePath } : {}),
    });
    const page = await context.newPage();
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
      JSON.stringify({ state, url: snapshot.url, title: snapshot.title, textLength: bodyText.length, artifactPolicy: "minimized-no-html-no-screenshot" }, null, 2)
    );
    return { state, fields };
  } finally {
    await context?.close();
  }
}

function terminalStatusForState(state: DetectedBrowserState): "completed" | "paused" {
  if (["login_required", "two_factor_required", "captcha_or_security_challenge", "browser_unavailable", "field_preparation_incomplete", "submit_guard_failed"].includes(state)) {
    return "paused";
  }
  return "completed";
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

  if (action.actionType === "prepare_application_review" && (!applyPlanResult?.valid || stalePayloadErrors.length > 0)) {
    const issues = [...(applyPlanResult?.issues ?? []), ...stalePayloadErrors];
    saveApplyDiagnostics(options, action, buildApplyDiagnostics(action, plan, issues, "validation_failed"));
    updateBrowserActionStatus(action.id, "paused", `Apply preparation validation failed: ${issues.map((item) => item.code).join(", ")}`);
    return;
  }

  if (!url) {
    updateBrowserActionStatus(action.id, "paused", "No URL available for browser action.");
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
    if (action.actionType === "prepare_application_review") {
      const diagnostics = buildApplyDiagnostics(action, plan, applyPlanResult?.issues ?? [], state);
      logger.info(`[dry-run]\n${formatApplyDiagnostics(diagnostics)}`);
      saveApplyDiagnostics(options, action, diagnostics);
    } else {
      logger.info(`[dry-run] Would process browser action #${action.id} ${action.actionType}: ${url}`);
      saveTextArtifact(options, action, "dry-run.json", JSON.stringify({ actionId: action.id, jobId: action.jobId, actionType: action.actionType, url, state }, null, 2));
    }
    updateBrowserActionStatus(action.id, "paused", "Dry run: browser action not opened. Set BROWSER_DRY_RUN=false to inspect pages.");
    return;
  }

  try {
    const { state, fields } = await inspectWithBrowser(action, options, url, plan ?? undefined);
    if (action.actionType === "prepare_application_review") {
      const diagnostics = buildApplyDiagnostics(action, plan, applyPlanResult?.issues ?? [], state, fields);
      saveApplyDiagnostics(options, action, diagnostics);
      if (state === "field_preparation_incomplete") {
        logger.warn(`Required fields not filled confidently for browser action #${action.id}: ${getRequiredSkippedFields(fields).join(", ")}`);
      }
    }
    updateBrowserActionStatus(action.id, terminalStatusForState(state), `Detected state: ${state}; stop-before-submit enforced.`);
    logger.info(`Browser action #${action.id} detected state: ${state}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateBrowserActionStatus(action.id, "failed", message);
    logger.error(`Browser action #${action.id} failed: ${message}`);
  }
}

export async function runBrowserWorker(options = loadOptions()): Promise<void> {
  await logReadiness(options);
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
