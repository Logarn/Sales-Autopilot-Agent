import {
  addApplicationNote,
  closeDb,
  getApplicationNotes,
  getApplicationSummary,
  listRecentApplications,
  updateApplicationStatus,
} from "./db";
import { logger } from "./logger";
import { ApplicationStatus } from "./types";

const VALID_STATUSES: ApplicationStatus[] = [
  "found",
  "draft",
  "sent_to_slack",
  "approved",
  "rejected",
  "applied",
  "replied",
  "interview",
  "hired",
  "lost",
  "submitted",
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
  npm run app:status -- --job-id <id> --status <status> [--note <text>]
  npm run app:note -- --job-id <id> --note <text>
  npm run app:report -- [--limit 20]
  npm run app:notes -- --job-id <id>

Statuses:
  ${VALID_STATUSES.join(", ")}`);
}

function printReport(): void {
  const limit = Number.parseInt(argValue("--limit") ?? "20", 10) || 20;
  const summary = getApplicationSummary();
  const recent = listRecentApplications(limit);

  console.log("\nApplication Summary");
  console.log("===================");
  if (summary.length === 0) {
    console.log("No applications tracked yet.");
  } else {
    for (const row of summary) {
      console.log(`${row.status.padEnd(14)} ${row.count}`);
    }
  }

  console.log(`\nRecent Applications (latest ${limit})`);
  console.log("================================");
  for (const row of recent) {
    console.log(`- [${row.status}] ${row.title ?? row.job_id}`);
    console.log(`  job_id: ${row.job_id}`);
    console.log(`  score: ${row.fit_score}/100 | bid: ${row.suggested_bid ?? "n/a"} | connects: ${row.suggested_connects}`);
    if (row.url) console.log(`  url: ${row.url}`);
  }
}

function setStatus(): void {
  const jobId = argValue("--job-id");
  const status = argValue("--status") as ApplicationStatus | undefined;
  const note = argValue("--note");

  if (!jobId || !status || !VALID_STATUSES.includes(status)) {
    usage();
    process.exitCode = 1;
    return;
  }

  const updated = updateApplicationStatus(jobId, status, note);
  if (!updated) {
    logger.error(`No application found for job_id=${jobId}`);
    process.exitCode = 1;
    return;
  }
  logger.info(`Updated ${jobId} -> ${status}`);
}

function addNote(): void {
  const jobId = argValue("--job-id");
  const note = argValue("--note");
  if (!jobId || !note) {
    usage();
    process.exitCode = 1;
    return;
  }

  const added = addApplicationNote(jobId, note);
  if (!added) {
    logger.error(`No application found for job_id=${jobId}`);
    process.exitCode = 1;
    return;
  }
  logger.info(`Added note for ${jobId}`);
}

function printNotes(): void {
  const jobId = argValue("--job-id");
  if (!jobId) {
    usage();
    process.exitCode = 1;
    return;
  }
  const notes = getApplicationNotes(jobId);
  console.log(`\nNotes for ${jobId}`);
  console.log("====================");
  if (notes.length === 0) {
    console.log("No notes yet.");
    return;
  }
  for (const note of notes) {
    console.log(`- ${note.created_at}: ${note.note}`);
  }
}

function main(): void {
  try {
    if (hasFlag("--set-status")) {
      setStatus();
      return;
    }
    if (hasFlag("--add-note")) {
      addNote();
      return;
    }
    if (hasFlag("--notes")) {
      printNotes();
      return;
    }
    printReport();
  } finally {
    closeDb();
  }
}

main();
