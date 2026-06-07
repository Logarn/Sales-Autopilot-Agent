import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { LlmJsonRequest, LlmJsonResult } from "./llm/provider";

function cleanupDatabase(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore cleanup failures
    }
  }
  const dir = dirname(path);
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

class FakeConversationProvider {
  requests: LlmJsonRequest[] = [];

  constructor(private readonly decisions: Array<Record<string, unknown>>) {}

  isAvailable(): boolean {
    return true;
  }

  async completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>> {
    this.requests.push(request);
    const decision = this.decisions.shift() ?? { intent: "ignore", confidence: "high", actions: ["none"] };
    return { ok: true, data: decision as T };
  }
}

class FakeCopyProvider {
  requests: LlmJsonRequest[] = [];
  private counter = 0;

  isAvailable(): boolean {
    return true;
  }

  async completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>> {
    this.requests.push(request);
    this.counter += 1;
    const payload = JSON.parse(request.messages[1].content) as { deterministicText: string };
    return { ok: true, data: { text: `Copy ${this.counter}: ${payload.deterministicText}` } as T };
  }
}

function fakeClient(replies: string[]) {
  return {
    chat: {
      postMessage: async (payload: { text: string }) => {
        replies.push(payload.text);
      },
    },
  };
}

const bannedNormalCopy = /\b(field_preparation_incomplete|manual_attention_required|browserSessionState|source cooldown|manual:upwork-|action\s*#\d+|queue internals|\{[\s\S]*"[^"]+"[\s\S]*\}|the agent)\b/i;

async function runTests(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-slack-reasoning-gateway/jobs.db");
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  process.env.SLACK_ALLOWED_USER_IDS = "U_ALLOWED";
  process.env.SLACK_COPY_LLM_ENABLED = "false";

  const {
    handleSlackReasoningGateway,
    handleSlackSocketTextEvent,
  } = require("./slackSocket") as {
    handleSlackReasoningGateway: (input: Record<string, unknown>) => Promise<void>;
    handleSlackSocketTextEvent: (event: Record<string, unknown>, client: any) => Promise<void>;
  };

  const healthReplies: string[] = [];
  const healthPlanner = new FakeConversationProvider([{
    intent: "answer_health",
    confidence: "high",
    actions: ["answer_health"],
    progressReplyNeeded: false,
  }]);
  const healthCopy = new FakeCopyProvider();
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "health.001",
    messageTs: "health.001",
    text: "Are you running?",
    botMentioned: true,
    client: fakeClient(healthReplies),
    conversationProvider: healthPlanner,
    copyProvider: healthCopy,
    operatorDeps: {
      buildHealthReport: () => ({
        generatedAt: new Date(0).toISOString(),
        status: "warning",
        heartbeats: [],
        staleHeartbeats: [],
        findings: Array.from({ length: 8 }, (_, index) => ({
          key: `finding-${index + 1}`,
          severity: "warning" as const,
          message: `Finding ${index + 1} needs attention.`,
        })),
      }),
      checkCdpEndpoint: async () => ({ reachable: true }),
      getBrowserSessionStatus: () => ({
        state: "healthy",
        updatedAt: new Date(0).toISOString(),
        challengeEvents: [],
        blocked: false,
        alertCooldownRemainingMs: 0,
      }),
      readHeartbeats: () => [],
      readLeadEngineState: () => ({
        ts: new Date(0).toISOString(),
        cycleId: "cycle-test",
        mode: "run_once",
        dryRun: false,
        status: "paused",
        stoppedReason: "one application needs review",
        browserSessionState: "healthy",
        sessionBlocked: false,
        queuePendingBefore: 0,
        queuePendingAfter: 0,
        queueBackpressure: false,
        discoveryRan: false,
        jobsFound: 0,
        jobsQueued: 0,
        duplicatesSkipped: 0,
        actionsProcessed: 0,
        actionsCompleted: 0,
        actionsPaused: 0,
        actionsSkipped: 0,
        slackPostFailures: 0,
        nextSleepMs: 0,
      }),
    },
  });
  assert.equal(healthReplies.length, 1, "Gateway should post one health reply.");
  assert.match(healthReplies[0], /^Copy \d+:/, "Health reply should be written by the Slack copywriter.");
  assert.doesNotMatch(healthReplies[0], bannedNormalCopy, "Health reply must not expose backend jargon.");
  const healthPrompt = JSON.stringify(healthPlanner.requests[0]);
  assert.match(healthPrompt, /browserSession/i, "Planner prompt should include browser session context.");
  assert.match(healthPrompt, /serviceState/i, "Planner prompt should include service context.");
  assert.match(healthPrompt, /inbound/i, "Planner prompt should include inbound Slack context.");

  const followUpReplies: string[] = [];
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "health.002",
    messageTs: "health.002",
    text: "what are the 8 things?",
    botMentioned: true,
    client: fakeClient(followUpReplies),
    conversationProvider: new FakeConversationProvider([{
      intent: "explain_health_findings",
      confidence: "high",
      actions: ["none"],
      reply: "The 8 things are grouped into needs Steve, I can fix, and stale/noisy findings.",
    }]),
    copyProvider: new FakeCopyProvider(),
  });
  assert.equal(followUpReplies.length, 1, "Follow-up should be answered by the gateway.");
  assert.match(followUpReplies[0], /8 things/i, "Follow-up should expand the previous health finding.");
  assert.doesNotMatch(followUpReplies[0], /I can help with the draft, files, proof, boost, or status/i, "Follow-up must not get a command menu.");

  const focusReplies: string[] = [];
  let focused = false;
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "qa.001",
    messageTs: "qa.001",
    text: "Open the application in the queue.",
    botMentioned: true,
    client: fakeClient(focusReplies),
    conversationProvider: new FakeConversationProvider([{
      intent: "open_application_page",
      confidence: "high",
      actions: ["open_application_page"],
      qaIndex: 1,
    }]),
    copyProvider: new FakeCopyProvider(),
    focusQaTab: async () => {
      focused = true;
      return {
        ok: true,
        text: "Done — I brought the remote Chrome application tab to the front. Final submit is still untouched.",
      };
    },
  });
  assert.equal(focused, true, "Gateway should execute the protected Chrome focus action.");
  assert.match(focusReplies.join("\n"), /brought the remote Chrome application tab/i, "Focus reply should report the tab was brought forward.");
  assert.match(focusReplies.join("\n"), /Final submit is still untouched/i, "Focus reply should preserve submit safety.");

  const progressReplies: string[] = [];
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "progress.001",
    messageTs: "progress.001",
    text: "Everything that needs to be done.",
    botMentioned: true,
    client: fakeClient(progressReplies),
    conversationProvider: new FakeConversationProvider([{
      intent: "full_safe_prep",
      confidence: "high",
      actions: ["none"],
      progressReplyNeeded: true,
      progressReply: "I’m on it — checking the current draft, proof, browser, and QA state now.",
      reply: "I’ll do the safe prep and stop before submit.",
    }]),
    copyProvider: new FakeCopyProvider(),
  });
  assert.equal(progressReplies.length, 2, "Long actions should emit progress and final replies.");
  assert.match(progressReplies[0], /checking the current draft/i, "Progress reply should be sent before the final reply.");
  assert.match(progressReplies[1], /stop before submit/i, "Final reply should preserve final-submit safety.");

  const source = readFileSync(resolve(process.cwd(), "src/slackSocket.ts"), "utf8");
  const eventHandler = source.slice(source.indexOf("export async function handleSlackSocketTextEvent"), source.indexOf("type SlackThreadStateForRetry"));
  assert.match(eventHandler, /handleSlackReasoningGateway/, "Inbound Slack socket messages should route through the reasoning gateway.");
  assert.doesNotMatch(eventHandler, /handleSlackFilesMessage|handleUrlMessage|parseSlackOperatorIntent/, "Inbound socket handler should not branch to deterministic handlers before the gateway.");

  const ignoredReplies: string[] = [];
  await handleSlackSocketTextEvent({
    channel: "C_GATE",
    ts: "noise.001",
    text: "random channel banter",
    user: "U_ALLOWED",
  }, fakeClient(ignoredReplies));
  assert.equal(ignoredReplies.length, 0, "Irrelevant channel noise should not force a deterministic fallback reply.");

  console.log("slack reasoning gateway tests passed");
}

runTests().catch((error) => {
  console.error(`slack reasoning gateway tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
