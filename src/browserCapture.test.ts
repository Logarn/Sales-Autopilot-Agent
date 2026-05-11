import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCaptureActionPayload,
  buildDryRunCaptureInput,
  deriveCaptureThreadJobId,
  parseCaptureQuestions,
} from "./browserCapture";

interface TestCase {
  name: string;
  got: unknown;
  want: unknown;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function runTests(): void {
  const url = "https://www.upwork.com/jobs/~0123456789abcdef";
  const actionPayload = buildCaptureActionPayload(url, "C123", "M456", "T789");
  assert(actionPayload.source === "slack_url", "capture payload should include slack source");
  assert(actionPayload.channelId === "C123", "capture payload should keep channelId");
  assert(actionPayload.messageTs === "M456", "capture payload should keep messageTs");
  assert(actionPayload.threadTs === "T789", "capture payload should keep threadTs");

  const jobIdFromUrl = deriveCaptureThreadJobId(url, "0123456789abcdef");
  const jobIdFallback = deriveCaptureThreadJobId(url, null);
  assert(jobIdFromUrl === "manual:upwork-0123456789abcdef", "deriveCaptureThreadJobId should prefer parsed job id");
  assert(jobIdFallback.startsWith("manual:url-"), "fallback with missing id should be deterministic hash style");

  const dryRun = buildDryRunCaptureInput(url);
  const urlTests: TestCase[] = [
    {
      name: "capture dry run should include url in parsed input",
      got: dryRun.parsed.url,
      want: url,
    },
    {
      name: "capture dry run should include dry-run marker in raw source text",
      got: dryRun.rawText.includes("dry-run"),
      want: true,
    },
  ];
  for (const t of urlTests) {
    assert(JSON.stringify(t.got) === JSON.stringify(t.want), `${t.name}: expected ${JSON.stringify(t.want)}, got ${JSON.stringify(t.got)}`);
  }

  const parsedQuestions = parseCaptureQuestions(`
Screening Questions:
1. What is your estimated hourly budget?
2. Do you need experience with React?
`);
  assert(parsedQuestions.length === 2, `expected two parsed questions, got ${JSON.stringify(parsedQuestions)}`);

  // Status transition smoke test using an isolated DB file.
  const tempDb = resolve(process.cwd(), "data/.tmp-feature2-thread-state.db");
  process.env.DB_PATH = tempDb;
  const {
    closeDb,
    getSlackThreadStateByThreadTs,
    upsertSlackThreadState,
    updateSlackThreadStateStatus,
  } = require("./db") as {
    closeDb: () => void;
    upsertSlackThreadState: (input: {
      channelId: string;
      messageTs: string;
      threadTs: string;
      upworkUrl: string;
      jobId?: string | null;
      status: string;
    }) => { status: string; channelId: string; threadTs: string; jobId?: string };
    updateSlackThreadStateStatus: (
      channelId: string,
      threadTs: string,
      status: string,
      options?: { jobId?: string | null; upworkUrl?: string }
    ) => { status: string; channelId: string; threadTs: string; jobId?: string };
    getSlackThreadStateByThreadTs: (channelId: string, threadTs: string) => { status: string; channelId: string; threadTs: string; jobId?: string } | null;
  };

  try {
    upsertSlackThreadState({
      channelId: "C123",
      messageTs: "M456",
      threadTs: "T789",
      upworkUrl: url,
      status: "capture_pending",
    });
    let state = getSlackThreadStateByThreadTs("C123", "T789");
    assert(state?.status === "capture_pending", "status should initialize as capture_pending");

    updateSlackThreadStateStatus("C123", "T789", "captured", { jobId: "job-1" });
    state = getSlackThreadStateByThreadTs("C123", "T789");
    assert(state?.status === "captured", "status should transition to captured");
    assert(state?.jobId === "job-1", "status transition should persist job id");

    updateSlackThreadStateStatus("C123", "T789", "scored", { jobId: "job-1" });
    state = getSlackThreadStateByThreadTs("C123", "T789");
    assert(state?.status === "scored", "status should transition to scored");

    updateSlackThreadStateStatus("C123", "T789", "packet_sent", { jobId: "job-1" });
    state = getSlackThreadStateByThreadTs("C123", "T789");
    assert(state?.status === "packet_sent", "status should transition to packet_sent");
  } finally {
    closeDb();
    if (existsSync(tempDb)) {
      unlinkSync(tempDb);
    }
  }

  console.log("browser capture tests passed");
}

if (require.main === module) {
  try {
    runTests();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`browser capture tests failed: ${message}`);
    process.exitCode = 1;
  }
}
