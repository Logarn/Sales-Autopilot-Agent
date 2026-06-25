import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

function cleanupPath(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

function runTests(): void {
  const tempDir = resolve(process.cwd(), "data/.tmp-pending-human-requests");
  const tempDb = resolve(tempDir, "jobs.db");
  cleanupPath(tempDir);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;
  process.env.MEMORI_ENABLED = "false";

  const {
    cancelPendingHumanRequest,
    closeDb,
    createPendingHumanRequest,
    getPendingHumanRequestByKey,
    listPendingHumanRequests,
    resolvePendingHumanRequest,
  } = require("./db") as typeof import("./db");

  try {
    const first = createPendingHumanRequest({
      requestKey: "screening:job-1:q1",
      jobId: "job-1",
      channelId: "C123",
      threadTs: "1700000000.000100",
      requestType: "screening_answer",
      questionText: "Can we answer no to agency experience?",
      risk: "Wrong answer may misrepresent experience.",
      confidence: "low",
    });

    assert.equal(first.requestKey, "screening:job-1:q1");
    assert.equal(first.status, "pending");
    assert.equal(first.jobId, "job-1");
    assert.equal(first.channelId, "C123");
    assert.equal(first.threadTs, "1700000000.000100");
    assert.equal(first.requestType, "screening_answer");
    assert.equal(first.resolutionText, null);

    const second = createPendingHumanRequest({
      requestKey: "rate:job-2",
      jobId: "job-2",
      channelId: "C123",
      threadTs: "1700000000.000200",
      requestType: "bid_rate",
      questionText: "What hourly rate should I use?",
      confidence: "medium",
    });

    const sameThread = listPendingHumanRequests({ channelId: "C123", threadTs: "1700000000.000100", status: "pending" });
    assert.deepEqual(sameThread.map((request) => request.requestKey), [first.requestKey]);

    const sameJob = listPendingHumanRequests({ jobId: "job-2", status: "pending" });
    assert.deepEqual(sameJob.map((request) => request.requestKey), [second.requestKey]);

    const resolved = resolvePendingHumanRequest(first.requestKey, "Answer no; do not claim agency experience.");
    assert.equal(resolved?.status, "resolved");
    assert.equal(resolved?.resolutionText, "Answer no; do not claim agency experience.");
    assert.ok(resolved?.resolvedAt, "resolvedAt should be recorded");

    assert.deepEqual(
      listPendingHumanRequests({ channelId: "C123", threadTs: "1700000000.000100", status: "pending" }).map((request) => request.requestKey),
      [],
      "resolved requests should not appear when filtering status=pending"
    );
    assert.deepEqual(
      listPendingHumanRequests({ channelId: "C123", threadTs: "1700000000.000100", status: "resolved" }).map((request) => request.requestKey),
      [first.requestKey]
    );

    const cancelled = cancelPendingHumanRequest(second.requestKey, "Operator skipped the job.");
    assert.equal(cancelled?.status, "cancelled");
    assert.equal(cancelled?.resolutionText, "Operator skipped the job.");
    assert.equal(getPendingHumanRequestByKey("missing"), null);

    console.log("pendingHumanRequests tests passed");
  } finally {
    closeDb();
    cleanupPath(tempDir);
  }
}

runTests();
