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
  npm run browser:list -- [--status pending] [--limit 25]
  npm run browser:update -- --id <action-id> --status <pending|in_progress|completed|failed|paused|cancelled> [--error <text>]

Examples:
  npm run browser:enqueue -- --job-id job-123 --action open_job --url https://www.upwork.com/jobs/~0123
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

function enqueue(): void {
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
