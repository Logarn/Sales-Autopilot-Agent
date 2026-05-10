import { buildBrowserApplyPlan } from "./browserApply";
import {
  closeDb,
  enqueueBrowserAction,
  listBrowserActions,
  updateBrowserActionStatus,
} from "./db";
import { logger } from "./logger";
import { BrowserActionPayload, BrowserActionStatus, BrowserActionType } from "./types";

const VALID_ACTION_TYPES: BrowserActionType[] = [
  "open_job",
  "open_apply_page",
  "prepare_application_review",
];

const VALID_STATUSES: BrowserActionStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "paused",
  "cancelled",
];

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function usage(): void {
  console.log(`Usage:
  npm run browser:enqueue -- --job-id <id> --action <open_job|open_apply_page|prepare_application_review> [--url <url>] [--payload '{"key":"value"}'] [--notes <text>]
  npm run browser:enqueue -- --apply-preview --job-id <id>
  npm run browser:enqueue -- --apply-prepare --job-id <id> [--notes <text>]
  npm run browser:list -- [--status pending] [--limit 25]
  npm run browser:update -- --id <action-id> --status <pending|in_progress|completed|failed|paused|cancelled> [--error <text>]

Examples:
  npm run browser:enqueue -- --job-id job-123 --action open_job --url https://www.upwork.com/jobs/~0123
  npm run browser:enqueue -- --apply-preview --job-id manual:upwork-0123456789abcdef
  npm run browser:enqueue -- --apply-prepare --job-id manual:upwork-0123456789abcdef
  npm run browser:list -- --status pending
  npm run browser:update -- --id 1 --status paused --error "Login required"`);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePayload(): BrowserActionPayload {
  const rawPayload = argValue("--payload");
  let payload: BrowserActionPayload = {};

  if (rawPayload) {
    try {
      const parsed = JSON.parse(rawPayload) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Payload must be a JSON object.");
      }
      payload = parsed as BrowserActionPayload;
    } catch (error) {
      throw new Error(`Invalid --payload JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const url = argValue("--url");
  const notes = argValue("--notes");
  if (url) payload.url = url;
  if (notes) payload.notes = notes;
  return payload;
}

function printApplyPreview(jobId: string): boolean {
  const result = buildBrowserApplyPlan(jobId);
  console.log("\nBrowser Apply Preparation Preview");
  console.log("=================================");
  console.log(`job_id: ${jobId}`);
  console.log(`valid: ${result.valid}`);
  if (result.issues.length > 0) {
    console.log("validation_issues:");
    for (const issue of result.issues) console.log(`  - [${issue.severity}] ${issue.code}: ${issue.message}`);
  }
  if (!result.plan) return false;

  const plan = result.plan;
  console.log(`source_url: ${plan.sourceUrl}`);
  console.log(`apply_url: ${plan.applyUrl}`);
  console.log(`profile: ${plan.profile}`);
  console.log(`rate: ${plan.rate}`);
  console.log(`stop_before_submit: ${plan.stopBeforeSubmit}`);
  console.log("connects:");
  console.log(`  required: ${plan.connects.required}`);
  console.log(`  boost: ${plan.connects.boost}`);
  console.log(`  total: ${plan.connects.total}`);
  console.log(`  approval_required: ${plan.connects.approvalRequired}`);
  if (plan.connects.notes.length > 0) {
    console.log("  notes:");
    for (const note of plan.connects.notes) console.log(`    - ${note}`);
  }
  console.log("attachments:");
  if (plan.attachments.length === 0) console.log("  - none");
  for (const attachment of plan.attachments) console.log(`  - ${attachment.name} (${attachment.filePath})`);
  if (plan.skippedAttachments.length > 0) {
    console.log("skipped_attachments:");
    for (const attachment of plan.skippedAttachments) console.log(`  - ${attachment.name}: ${attachment.reason}`);
  }
  console.log("highlights:");
  if (plan.highlights.length === 0) console.log("  - none");
  for (const highlight of plan.highlights) console.log(`  - ${highlight}`);
  console.log("cover_letter:");
  console.log(plan.coverLetter);
  return result.valid;
}

function enqueueApplyPrepare(): void {
  const jobId = argValue("--job-id");
  if (!jobId) {
    usage();
    process.exitCode = 1;
    return;
  }
  const result = buildBrowserApplyPlan(jobId);
  if (!result.valid || !result.plan) {
    printApplyPreview(jobId);
    process.exitCode = 1;
    return;
  }
  const id = enqueueBrowserAction({
    jobId,
    actionType: "prepare_application_review",
    payload: {
      url: result.plan.applyUrl,
      notes: argValue("--notes"),
      applyPlan: result.plan,
    },
  });
  logger.info(`Queued browser apply preparation #${id} for job_id=${jobId}; final submit remains disabled.`);
}

function enqueue(): void {
  if (hasFlag("--apply-preview")) {
    const jobId = argValue("--job-id");
    if (!jobId) {
      usage();
      process.exitCode = 1;
      return;
    }
    process.exitCode = printApplyPreview(jobId) ? 0 : 1;
    return;
  }
  if (hasFlag("--apply-prepare")) {
    enqueueApplyPrepare();
    return;
  }

  const jobId = argValue("--job-id");
  const actionType = argValue("--action") as BrowserActionType | undefined;

  if (!jobId || !actionType || !VALID_ACTION_TYPES.includes(actionType)) {
    usage();
    process.exitCode = 1;
    return;
  }

  const id = enqueueBrowserAction({
    jobId,
    actionType,
    payload: parsePayload(),
  });
  logger.info(`Queued browser action #${id}: ${actionType} for job_id=${jobId}`);
}

function list(): void {
  const status = argValue("--status") as BrowserActionStatus | undefined;
  if (status && !VALID_STATUSES.includes(status)) {
    usage();
    process.exitCode = 1;
    return;
  }
  const limit = parsePositiveInteger(argValue("--limit"), 25);
  const actions = listBrowserActions(status ?? null, limit);

  console.log(`\nBrowser Actions (latest ${actions.length})`);
  console.log("===============================");
  if (actions.length === 0) {
    console.log("No browser actions found.");
    return;
  }

  for (const action of actions) {
    console.log(`#${action.id} [${action.status}] ${action.actionType} job_id=${action.jobId}`);
    console.log(`  attempts: ${action.attempts} | updated: ${action.updatedAt}`);
    if (action.payload.url) console.log(`  url: ${action.payload.url}`);
    if (action.payload.notes) console.log(`  notes: ${action.payload.notes}`);
    if (action.lastError) console.log(`  last_error: ${action.lastError}`);
  }
}

function update(): void {
  const id = Number.parseInt(argValue("--id") ?? "", 10);
  const status = argValue("--status") as BrowserActionStatus | undefined;
  const lastError = argValue("--error");

  if (!Number.isFinite(id) || id <= 0 || !status || !VALID_STATUSES.includes(status)) {
    usage();
    process.exitCode = 1;
    return;
  }

  const updated = updateBrowserActionStatus(id, status, lastError);
  if (!updated) {
    logger.error(`No browser action found for id=${id}`);
    process.exitCode = 1;
    return;
  }
  logger.info(`Updated browser action #${id} -> ${status}`);
}

function main(): void {
  try {
    if (hasFlag("--enqueue")) {
      enqueue();
      return;
    }
    if (hasFlag("--list")) {
      list();
      return;
    }
    if (hasFlag("--update")) {
      update();
      return;
    }
    usage();
    process.exitCode = 1;
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

main();
