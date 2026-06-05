import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ApplicationDraft, ApplicationStatus, MatchLevel, ScoredJob, ScoreBreakdown } from "./types";

function cleanup(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore cleanup races with SQLite sidecar files
    }
  }
  const dir = dirname(path);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

const scoreBreakdown: ScoreBreakdown = {
  fitScore: { score: 80, reasons: ["Klaviyo lifecycle fit"], risks: [] },
  clientQualityScore: { score: 75, reasons: ["Client has spend history"], risks: [] },
  opportunityScore: { score: 70, reasons: ["Clear project scope"], risks: [] },
  redFlagScore: { score: 90, reasons: [], risks: [] },
  connectsRiskScore: { score: 85, reasons: [], risks: [] },
  finalScore: 80,
  reasons: ["Klaviyo lifecycle fit"],
  risks: [],
};

function draft(jobId: string, status: ApplicationStatus): ApplicationDraft {
  return {
    jobId,
    status,
    fitScore: 80,
    fitReasons: ["Klaviyo lifecycle fit"],
    redFlags: [],
    suggestedBid: "$75/hr",
    suggestedConnects: 8,
    suggestedBoostConnects: 4,
    connectsWarnings: [],
    selectedPortfolioItems: [],
    proposalQuality: {
      score: 88,
      issues: [],
      positiveSignals: ["Specific proof"],
      wordCount: 170,
    },
    proposalText: "Short proposal draft.",
    generatedAt: new Date().toISOString(),
  };
}

function job(id: string, matchLevel: MatchLevel, score: number, status?: ApplicationStatus): ScoredJob {
  return {
    id,
    title: `${id} title`,
    url: `https://www.upwork.com/jobs/~${id}`,
    description: "Lifecycle marketing work for an ecommerce brand.",
    postedAt: new Date().toISOString(),
    budget: score >= 80 ? "$1,500 fixed" : "$500 fixed",
    clientCountry: "US",
    clientRating: 4.9,
    clientSpend: score >= 80 ? 25000 : 2500,
    clientHireRate: 90,
    clientTotalHires: 12,
    clientFeedbackCount: 20,
    category: "Digital Marketing",
    experienceLevel: "EXPERT",
    connectsCost: 8,
    skills: ["Klaviyo", "Shopify"],
    sourceQuery: score >= 80 ? "klaviyo" : "email marketing",
    score,
    matchLevel,
    matchedKeywords: ["klaviyo"],
    negativeKeywords: [],
    scoreBreakdown: { ...scoreBreakdown, finalScore: score },
    applicationDraft: status ? draft(id, status) : undefined,
  };
}

async function runTests(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-daily-summary/jobs.db");
  cleanup(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;
  process.env.SLACK_CHANNEL_WEBHOOK_URL = "";

  const {
    closeDb,
    enqueueBrowserAction,
    getDailySummary,
    getQueuedSlackMessages,
    markJobSeen,
    recordHeartbeat,
    updateBrowserActionStatus,
  } = require("./db") as typeof import("./db");
  const { sendDailySummary } = require("./slack") as typeof import("./slack");

  try {
    markJobSeen(job("job-high", "high", 92, "draft_prepared"), true);
    markJobSeen(job("job-medium", "medium", 78, "prepared_for_qa"), true);
    markJobSeen(job("job-low-interview", "low", 58, "interview"), false);
    markJobSeen(job("job-low-lost", "low", 50, "lost"), false);
    markJobSeen(job("job-skip", "skip", 20), false);

    const pausedAction = enqueueBrowserAction({ jobId: "job-high", actionType: "prepare_application_review", payload: { url: "https://www.upwork.com/jobs/~job-high" } });
    updateBrowserActionStatus(pausedAction, "paused", "captcha_or_security_challenge");
    const failedAction = enqueueBrowserAction({ jobId: "job-medium", actionType: "capture_job_from_url", payload: { url: "https://www.upwork.com/jobs/~job-medium" } });
    updateBrowserActionStatus(failedAction, "failed", "source_context_unavailable: failed without blocking the browser session");

    recordHeartbeat({
      worker: "browser-search",
      status: "success",
      metadata: {
        jobsFound: 11,
        jobsCaptured: 8,
        jobsQueued: 3,
        duplicatesSkipped: 5,
        alreadyHandledSkipped: 2,
        invalidSkipped: 1,
        slackPostFailures: 0,
      },
    });

    const summary = getDailySummary(new Date());
    assert.equal(summary.trackedJobs, 5);
    assert.equal(summary.realCandidates, 4);
    assert.equal(summary.slackWorthyLeads, 2);
    assert.equal(summary.high, 1);
    assert.equal(summary.medium, 1);
    assert.equal(summary.low, 2);
    assert.equal(summary.filteredOut, 1);
    assert.equal(summary.preparedDrafts, 1);
    assert.equal(summary.qaWaiting, 1);
    assert.equal(summary.browserBlockers, 1);
    assert.equal(summary.browserNonBlockingFailures, 1);
    assert.equal(summary.recentBrowserIssues.length, 2);
    assert.equal(summary.morningQueue.length, 2);
    assert.equal(summary.morningQueue[0]?.jobId, "job-high");
    assert.equal(summary.automation?.jobsFound, 11);
    assert.equal(summary.automation?.duplicatesSkipped, 5);
    assert.equal(summary.outcomeLearning?.totalTracked, 4);
    assert.equal(summary.outcomeLearning?.bySourceQuery.find((segment) => segment.name === "email marketing")?.lost, 1);

    await sendDailySummary(summary);
    const queued = getQueuedSlackMessages();
    assert.equal(queued.length, 1);
    const payloadText = queued[0].payload;
    assert.match(payloadText, /Daily Upwork Operator Handoff/);
    assert.match(payloadText, /Scanned\/tracked/);
    assert.match(payloadText, /Duplicates\/suppressed/);
    assert.match(payloadText, /Morning queue/);
    assert.match(payloadText, /job-high title/);
    assert.match(payloadText, /source_context_unavailable/);
    assert.match(payloadText, /Outcome memory/);
  } finally {
    closeDb();
    cleanup(tempDb);
  }
}

runTests()
  .then(() => {
    console.log("daily summary tests passed");
  })
  .catch((error: unknown) => {
    console.error(`daily summary tests failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
