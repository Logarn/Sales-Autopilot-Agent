import {
  addApplicationNote,
  closeDb,
  getApplicationAnalytics,
  getApplicationNotes,
  getApplicationSummary,
  listRecentApplications,
  recordApplicationSubmission,
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
  npm run app:apply -- --job-id <id> --required-connects 10 --boost-connects 35 --rank 1 --client-spend 393 --rate 35 --profile "Email Marketing" --attachments "Truly Beauty - Case Study.pdf,Portfolio.pdf"
  npm run app:analytics

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
    if (row.actual_total_connects !== null) {
      console.log(`  actual connects: ${row.actual_total_connects} total (${row.actual_boost_connects ?? 0} boost) | rank: ${row.boost_rank ?? "n/a"} | client spend: $${row.actual_client_spend ?? 0}`);
    }
    if (row.url) console.log(`  url: ${row.url}`);
  }
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function printAnalytics(): void {
  const analytics = getApplicationAnalytics();
  console.log("\nApplication Analytics");
  console.log("=====================");
  console.log(`Tracked opportunities: ${analytics.total}`);
  console.log(`Applied: ${analytics.applied}`);
  console.log(`Replies: ${analytics.replied} (${formatPercent(analytics.replyRate)})`);
  console.log(`Interviews: ${analytics.interviews} (${formatPercent(analytics.interviewRate)})`);
  console.log(`Hires: ${analytics.hired} (${formatPercent(analytics.hireRate)})`);
  console.log(`Lost: ${analytics.lost}`);
  console.log(`Total Connects spent: ${analytics.totalConnectsSpent}`);
  console.log(`Avg Connects / applied: ${analytics.averageConnectsPerApplied.toFixed(1)}`);
  console.log(`Connects / reply: ${analytics.connectsPerReply === null ? "n/a" : analytics.connectsPerReply.toFixed(1)}`);

  console.log("\nTop Attachments");
  console.log("===============");
  if (analytics.topAttachments.length === 0) console.log("No attachment data yet.");
  for (const item of analytics.topAttachments) console.log(`- ${item.name}: ${item.count}`);

  console.log("\nTop Profile Highlights");
  console.log("======================");
  if (analytics.topHighlights.length === 0) console.log("No profile highlight data yet.");
  for (const item of analytics.topHighlights) console.log(`- ${item.name}: ${item.count}`);
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

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function recordSubmission(): void {
  const jobId = argValue("--job-id");
  const requiredConnects = parseNumber(argValue("--required-connects"));
  const boostConnects = parseNumber(argValue("--boost-connects")) ?? 0;
  const boostRank = parseNumber(argValue("--rank"));
  const clientSpend = parseNumber(argValue("--client-spend"));
  const rate = parseNumber(argValue("--rate"));
  const profileUsed = argValue("--profile") ?? "";
  const attachmentsUsed = parseList(argValue("--attachments"));
  const profileHighlightsUsed = parseList(argValue("--highlights"));
  const submittedProposalText = argValue("--proposal-text");
  const note = argValue("--note");

  if (!jobId || requiredConnects === null) {
    usage();
    process.exitCode = 1;
    return;
  }

  const recorded = recordApplicationSubmission({
    jobId,
    requiredConnects,
    boostConnects,
    boostRank,
    clientSpend,
    rate,
    profileUsed,
    attachmentsUsed,
    profileHighlightsUsed,
    submittedProposalText,
    note,
  });

  if (!recorded) {
    logger.error(`No application found for job_id=${jobId}`);
    process.exitCode = 1;
    return;
  }
  logger.info(`Recorded application submission for ${jobId}`);
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
    if (hasFlag("--record-submission")) {
      recordSubmission();
      return;
    }
    if (hasFlag("--analytics")) {
      printAnalytics();
      return;
    }
    printReport();
  } finally {
    closeDb();
  }
}

main();
