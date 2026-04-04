import cron from "node-cron";
import {
  CRON_SCHEDULE,
  DAILY_SUMMARY_CRON,
  ENABLE_LOW_MATCH_DIGEST,
  SEARCH_QUERIES,
  TIMEZONE,
} from "./config";
import {
  cleanupOldSeenJobs,
  closeDb,
  getDailySummary,
  getDbStats,
  isFirstRun,
  isJobSeen,
  markJobSeen,
} from "./db";
import { fetchAllFeeds } from "./fetcher";
import { scoreJob, shouldNotify } from "./filter";
import { logger } from "./logger";
import {
  flushSlackQueue,
  sendDailySummary,
  sendFeedFailureAlert,
  sendJobNotifications,
  sendStartupMessage,
  testSlackWebhook,
} from "./slack";
import { RunStats, ScoredJob } from "./types";

let shuttingDown = false;

function emptyStats(): RunStats {
  return {
    fetched: 0,
    newJobs: 0,
    high: 0,
    medium: 0,
    low: 0,
    skipped: 0,
    filteredOut: 0,
    failedFeeds: 0,
  };
}

async function runPipeline(reason: string): Promise<RunStats> {
  if (shuttingDown) {
    logger.warn("Skipping run because shutdown is in progress.");
    return emptyStats();
  }

  logger.info(`Starting pipeline run (${reason}).`);
  const removed = cleanupOldSeenJobs();
  if (removed > 0) {
    logger.info(`Cleaned ${removed} old seen_jobs rows (>30 days).`);
  }

  await flushSlackQueue();

  const feedResult = await fetchAllFeeds();
  const stats = emptyStats();
  stats.fetched = feedResult.jobs.length;
  stats.failedFeeds = feedResult.failedFeeds.length;

  if (feedResult.jobs.length === 0 && feedResult.failedFeeds.length === SEARCH_QUERIES.length) {
    logger.error("All configured feeds failed in this cycle.");
    await sendFeedFailureAlert();
    return stats;
  }

  const dedupMap = new Map<string, ScoredJob>();
  for (const rawJob of feedResult.jobs) {
    if (isJobSeen(rawJob.id)) {
      continue;
    }
    if (!dedupMap.has(rawJob.id)) {
      dedupMap.set(rawJob.id, scoreJob(rawJob));
    }
  }
  const newScoredJobs = [...dedupMap.values()];
  stats.newJobs = newScoredJobs.length;

  if (newScoredJobs.length === 0) {
    logger.info(
      `[${reason}] No unseen jobs found. fetched=${stats.fetched} failed_feeds=${stats.failedFeeds}`
    );
    return stats;
  }

  const notifyCandidates: ScoredJob[] = [];
  for (const job of newScoredJobs) {
    if (job.matchLevel === "high") {
      stats.high += 1;
    } else if (job.matchLevel === "medium") {
      stats.medium += 1;
    } else if (job.matchLevel === "low") {
      stats.low += 1;
    } else {
      stats.skipped += 1;
      stats.filteredOut += 1;
    }

    const notify = shouldNotify(job);
    if (notify) {
      notifyCandidates.push(job);
    }
  }

  const firstRun = isFirstRun();
  if (firstRun) {
    for (const job of newScoredJobs) {
      markJobSeen(job, false);
    }
    logger.info(
      `[${reason}] First run detected. Seeded ${newScoredJobs.length} jobs without notifications.`
    );
    return stats;
  }

  const notifiedIds = await sendJobNotifications(notifyCandidates);

  for (const job of newScoredJobs) {
    const notified = notifiedIds.has(job.id);
    markJobSeen(job, notified);
  }

  logger.info(
    `[${reason}] fetched=${stats.fetched} new=${stats.newJobs} high=${stats.high} medium=${stats.medium} low=${stats.low} skipped=${stats.skipped} failed_feeds=${stats.failedFeeds}`
  );
  return stats;
}

async function startupHealthCheck(): Promise<void> {
  logger.info("Running startup health checks...");
  const slackOk = await testSlackWebhook();
  if (!slackOk) {
    logger.warn("Slack webhook health check failed; messages will be queued.");
  }

  const feedResult = await fetchAllFeeds();
  logger.info(
    `Feed reachability: ${SEARCH_QUERIES.length - feedResult.failedFeeds.length}/${SEARCH_QUERIES.length} reachable.`
  );
  if (feedResult.failedFeeds.length > 0) {
    logger.warn(`Failed feed queries: ${feedResult.failedFeeds.join(", ")}`);
  }

  const dbStats = getDbStats();
  logger.info(
    `DB stats: total=${dbStats.total}, high=${dbStats.high}, medium=${dbStats.medium}, low=${dbStats.low}, skip=${dbStats.skip}`
  );

  await sendStartupMessage(SEARCH_QUERIES.length);
}

function setupGracefulShutdown(): void {
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    closeDb();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function main(): Promise<void> {
  setupGracefulShutdown();

  await startupHealthCheck();

  const runOnce = process.argv.includes("--run-once");
  if (runOnce) {
    await runPipeline("manual-run-once");
    closeDb();
    return;
  }

  cron.schedule(
    CRON_SCHEDULE,
    async () => {
      await runPipeline("cron");
    },
    { timezone: TIMEZONE }
  );
  logger.info(`Scheduled polling job: "${CRON_SCHEDULE}" (${TIMEZONE}).`);

  cron.schedule(
    DAILY_SUMMARY_CRON,
    async () => {
      const summary = getDailySummary(new Date());
      if (ENABLE_LOW_MATCH_DIGEST || summary.high > 0 || summary.medium > 0) {
        await sendDailySummary(summary);
        logger.info("Daily summary sent.");
      } else {
        logger.info("Daily summary skipped (low-match digest disabled and no high/medium jobs).");
      }
    },
    { timezone: TIMEZONE }
  );
  logger.info(`Scheduled daily summary job: "${DAILY_SUMMARY_CRON}" (${TIMEZONE}).`);

  await runPipeline("startup-immediate");
}

main().catch((error) => {
  logger.error(`Fatal error: ${String(error)}`);
  closeDb();
  process.exitCode = 1;
});
