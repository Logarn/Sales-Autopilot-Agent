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
  const { SLACK_CONVERSATION_ALLOWED_ACTIONS } = require("./slackConversationBrain") as {
    SLACK_CONVERSATION_ALLOWED_ACTIONS: string[];
  };
	  const {
	    enqueueBrowserAction,
	    getBrowserActionById,
	    listActiveSlackBehaviorMemories,
	    listBrowserActions,
	    listRecentSlackFailureReflections,
	    markJobSeen,
	    mergeBrowserActionPayload,
	    saveApplicationDraft,
	    updateBrowserActionStatus,
	    upsertSlackThreadState,
	  } = require("./db") as {
	    enqueueBrowserAction: (input: { jobId: string; actionType: string; payload: Record<string, unknown> }) => number;
	    getBrowserActionById: (id: number) => { status: string; payload: Record<string, unknown> } | null;
	    listActiveSlackBehaviorMemories: (limit?: number) => Array<{ type: string; rule: string }>;
	    listBrowserActions: (status?: string | null, limit?: number) => Array<{ actionType: string; jobId: string; status: string }>;
	    listRecentSlackFailureReflections: (limit?: number) => Array<{ userMessage: string; whatHappened: string }>;
	    markJobSeen: (job: any, notified: boolean) => void;
	    mergeBrowserActionPayload: (id: number, patch: Record<string, unknown>) => unknown;
	    saveApplicationDraft: (draft: any) => void;
	    updateBrowserActionStatus: (id: number, status: string, lastError?: string | null) => void;
	    upsertSlackThreadState: (input: Record<string, unknown>) => unknown;
	  };
	  const {
	    buildManualAttentionSlackText,
	    listUnresolvedBrowserChallengeQuarantines,
	    recordBrowserManualAttention,
	  } = require("./browserSession") as {
	    buildManualAttentionSlackText: (event: {
	      at: string;
	      actionId?: number;
	      jobId?: string;
	      title?: string | null;
	      url?: string | null;
	      reason: string;
	    }) => string;
	    listUnresolvedBrowserChallengeQuarantines: () => Array<{ actionId?: number; status: string }>;
	    recordBrowserManualAttention: (input: {
	      actionId: number;
	      jobId: string;
	      threadChannelId?: string | null;
	      threadTs?: string | null;
	      actionType?: string | null;
	      source?: string | null;
	      reason: string;
	      url?: string | null;
	      title?: string | null;
	    }) => Promise<unknown>;
	  };
  for (const unsupportedAction of ["remember", "forget", "explain_learning", "create_mayor_task"]) {
    assert(!SLACK_CONVERSATION_ALLOWED_ACTIONS.includes(unsupportedAction), `${unsupportedAction} should not be advertised until the gateway executor implements it.`);
  }

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
  assert.doesNotMatch(healthReplies[0], /Overall health|Workers|browserSessionState|browser_challenge_action_paused/i, "Health reply should not sound like a dashboard.");
  assert.match(healthReplies[0], /Yeah|running|Slack|Chrome|Final submit/i, "Health reply should sound like a teammate status with a clear safety state.");
  const healthPrompt = JSON.stringify(healthPlanner.requests[0]);
  assert.match(healthPrompt, /browserSession/i, "Planner prompt should include browser session context.");
  assert.match(healthPrompt, /serviceState/i, "Planner prompt should include service context.");
  assert.match(healthPrompt, /inbound/i, "Planner prompt should include inbound Slack context.");

  const staleBlockedActionId = enqueueBrowserAction({
    jobId: "stale-blocked-job",
    actionType: "prepare_application_review",
    payload: {
      channelId: "C_GATE",
      threadTs: "stale-blocked.001",
    },
  });
  mergeBrowserActionPayload(staleBlockedActionId, {
    channelId: "C_GATE",
    threadTs: "stale-blocked.001",
    challengeQuarantine: {
      status: "paused",
      challengeType: "captcha_or_security_challenge",
    },
  });
  updateBrowserActionStatus(staleBlockedActionId, "paused", "Detected state: captcha_or_security_challenge.");

  const blockedStatusReplies: string[] = [];
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "blocked-status.001",
    messageTs: "blocked-status.001",
    text: "what’s blocked?",
    botMentioned: false,
    client: fakeClient(blockedStatusReplies),
    conversationProvider: new FakeConversationProvider([{ intent: "ignore", confidence: "high", actions: ["none"] }]),
    copyProvider: new FakeCopyProvider(),
  });
  assert.equal(blockedStatusReplies.length, 1, "Blocked status question should get a reply.");
  assert.match(blockedStatusReplies[0], /Nothing is blocking Chrome right now/i, "Blocked status should answer the blocked state first.");
  assert.match(blockedStatusReplies[0], /stale issue|skip the stale blocked applications/i, "Blocked status should recommend the practical cleanup.");
  assert.doesNotMatch(blockedStatusReplies[0], /QA queue|manual_attention_required|captcha_or_security_challenge|browser_challenge_action_paused|action\s*#?\d+/i, "Blocked status must not become a queue dump or expose internals.");

  const attentionReplies: string[] = [];
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "attention.001",
    messageTs: "attention.001",
    text: "what needs attention?",
    botMentioned: false,
    client: fakeClient(attentionReplies),
    conversationProvider: new FakeConversationProvider([{ intent: "ignore", confidence: "high", actions: ["none"] }]),
    copyProvider: new FakeCopyProvider(),
  });
  assert.equal(attentionReplies.length, 1, "Needs-attention question should not be swallowed.");
  assert.match(attentionReplies[0], /stale issue|blocked apply/i, "Needs-attention reply should summarize the actual blocker.");
  assert.doesNotMatch(attentionReplies[0], /manual_attention_required|browser_challenge_action_paused|action\s*#?\d+/i, "Needs-attention reply should hide backend state.");

  const missingTabReplies: string[] = [];
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "missing-tab.001",
    messageTs: "missing-tab.001",
    text: "open blocked application",
    botMentioned: false,
    client: fakeClient(missingTabReplies),
    conversationProvider: new FakeConversationProvider([{
      intent: "open_application_page",
      confidence: "high",
      actions: ["open_application_page"],
      qaQuery: "blocked",
    }]),
    copyProvider: new FakeCopyProvider(),
    focusQaTab: async () => ({
      ok: false,
      text: [
        "I found the protected QA item, but the matching remote Chrome tab is gone.",
        "There is nothing useful to bring forward, and I did not reuse another tab or click submit.",
        "Best move: skip this stale blocked item and rebuild it from the listing if you still want to apply.",
      ].join("\n"),
    }),
  });
  assert.equal(missingTabReplies.length, 1, "Open blocked application should answer even when the tab is gone.");
  assert.match(missingTabReplies[0], /tab is gone|nothing useful to bring forward/i, "Missing-tab copy should explain the practical state.");
  assert.match(missingTabReplies[0], /skip|rebuild|retry|Best move/i, "Missing-tab copy should offer a practical next move.");
  assert.doesNotMatch(missingTabReplies[0], /action\s*#?\d+|manual_attention_required|captcha_or_security_challenge/i, "Missing-tab copy should hide internals.");

  const skipBlockedReplies: string[] = [];
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "skip-blocked.001",
    messageTs: "skip-blocked.001",
    text: "skip all blocked applications",
    botMentioned: false,
    client: fakeClient(skipBlockedReplies),
    conversationProvider: new FakeConversationProvider([{ intent: "ignore", confidence: "high", actions: ["none"] }]),
    copyProvider: new FakeCopyProvider(),
  });
  assert.equal(skipBlockedReplies.length, 1, "Skip-all blocked applications should always acknowledge.");
  assert.equal(getBrowserActionById(staleBlockedActionId)?.status, "cancelled", "Skip-all blocked applications should cancel stale quarantined actions.");
  assert.match(skipBlockedReplies[0], /Done|skipped/i, "Skip-all reply should confirm the cleanup.");
  assert.match(skipBlockedReplies[0], /I did not submit anything/i, "Skip-all reply should preserve final-submit safety.");
  assert.doesNotMatch(skipBlockedReplies[0], /manual_attention_required|captcha_or_security_challenge|browser_challenge_action_paused|action\s*#?\d+/i, "Skip-all reply should hide internals.");

  const separateAttentionReplies: string[] = [];
  const separateOpenReplies: string[] = [];
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "separate.001",
    messageTs: "separate.001",
    text: "what needs attention?",
    botMentioned: false,
    client: fakeClient(separateAttentionReplies),
    conversationProvider: new FakeConversationProvider([{ intent: "ignore", confidence: "high", actions: ["none"] }]),
    copyProvider: new FakeCopyProvider(),
  });
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "separate.001",
    messageTs: "separate.002",
    text: "open blocked application",
    botMentioned: false,
    client: fakeClient(separateOpenReplies),
    conversationProvider: new FakeConversationProvider([{
      intent: "open_application_page",
      confidence: "high",
      actions: ["open_application_page"],
      qaQuery: "blocked",
    }]),
    copyProvider: new FakeCopyProvider(),
    focusQaTab: async () => ({ ok: false, text: "I found the QA item, but the matching remote Chrome tab is gone. I did not reuse another tab or click submit. Best move: skip or rebuild it." }),
  });
  assert.equal(separateAttentionReplies.length, 1, "First distinct Slack message should get its own reply.");
  assert.equal(separateOpenReplies.length, 1, "Second distinct Slack message should not be swallowed by dedupe.");

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

  const unrelatedMemoryCount = listActiveSlackBehaviorMemories(100).length;
  const unrelatedReflectionCount = listRecentSlackFailureReflections(100).length;
  const unrelatedActionReplies: string[] = [];
  let unrelatedHuntingStarted = false;
  let unrelatedFocusAttempted = false;
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "noise-action.001",
    messageTs: "noise-action.001",
    text: "wtf I need cv from the other thing",
    botMentioned: false,
    client: fakeClient(unrelatedActionReplies),
    conversationProvider: new FakeConversationProvider([{
      intent: "start_hunting",
      confidence: "high",
      actions: ["start_hunting", "show_qa_queue", "open_application_page"],
      progressReplyNeeded: true,
      progressReply: "I am starting work.",
    }]),
    copyProvider: new FakeCopyProvider(),
    operatorDeps: {
      setHuntingPaused: () => { unrelatedHuntingStarted = true; },
      runLeadEngineCycle: async () => {
        unrelatedHuntingStarted = true;
        return { status: "ok", jobsQueued: 1, jobsFound: 1 };
      },
    },
    focusQaTab: async () => {
      unrelatedFocusAttempted = true;
      return { ok: true, text: "Focused." };
    },
  });
  assert.equal(unrelatedActionReplies.length, 0, "Unmentioned unrelated chatter must not post progress, show QA queue, or run actions.");
  assert.equal(unrelatedHuntingStarted, false, "Unmentioned unrelated chatter must not start hunting.");
  assert.equal(unrelatedFocusAttempted, false, "Unmentioned unrelated chatter must not open/focus application tabs.");
  assert.equal(listActiveSlackBehaviorMemories(100).length, unrelatedMemoryCount, "Unrelated chatter must not write durable behavior memory.");
  assert.equal(listRecentSlackFailureReflections(100).length, unrelatedReflectionCount, "Unrelated chatter must not write failure reflections.");

  upsertSlackThreadState({
    channelId: "C_GATE",
    messageTs: "tracked.001",
    threadTs: "tracked.001",
    upworkUrl: "https://www.upwork.com/jobs/~055053866890130225261",
    jobId: "tracked-memory-job",
    status: "packet_sent",
  });
  const trackedMemoryBefore = listActiveSlackBehaviorMemories(100).length;
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "tracked.001",
    messageTs: "tracked.002",
    text: "Wtf? I just need the CV you used.",
    botMentioned: false,
    client: fakeClient([]),
    conversationProvider: new FakeConversationProvider([{ intent: "ignore", confidence: "high", actions: ["none"] }]),
    copyProvider: new FakeCopyProvider(),
  });
  assert(listActiveSlackBehaviorMemories(100).length > trackedMemoryBefore, "Tracked thread correction should write behavior memory.");

  const mentionReflectionBefore = listRecentSlackFailureReflections(100).length;
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "mention-memory.001",
    messageTs: "mention-memory.001",
    text: "<@UAGENT> Wtf? I just need the CV you used.",
    botMentioned: true,
    client: fakeClient([]),
    conversationProvider: new FakeConversationProvider([{ intent: "ignore", confidence: "high", actions: ["none"] }]),
    copyProvider: new FakeCopyProvider(),
  });
  assert(listRecentSlackFailureReflections(100).length > mentionReflectionBefore, "Bot mention correction should write a failure reflection.");

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

  const trackedFocusReplies: string[] = [];
  let trackedFocused = false;
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "tracked.001",
    messageTs: "tracked.003",
    text: "open the application",
    botMentioned: false,
    client: fakeClient(trackedFocusReplies),
    conversationProvider: new FakeConversationProvider([{
      intent: "open_application_page",
      confidence: "high",
      actions: ["open_application_page"],
    }]),
    copyProvider: new FakeCopyProvider(),
    focusQaTab: async () => {
      trackedFocused = true;
      return {
        ok: true,
        text: "Done — I brought the remote Chrome application tab to the front. Final submit is still untouched.",
      };
    },
  });
  assert.equal(trackedFocused, true, "Tracked thread should be allowed to execute an open-application action.");
  assert.match(trackedFocusReplies.join("\n"), /remote Chrome application tab/i);

  const mentionedQueueReplies: string[] = [];
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "mentioned-queue.001",
    messageTs: "mentioned-queue.001",
    text: "<@UAGENT> show QA queue",
    botMentioned: true,
    client: fakeClient(mentionedQueueReplies),
    conversationProvider: new FakeConversationProvider([{
      intent: "qa_queue",
      confidence: "high",
      actions: ["show_qa_queue"],
    }]),
    copyProvider: new FakeCopyProvider(),
  });
  assert.equal(mentionedQueueReplies.length, 1, "Bot mention should be allowed to trigger an action.");

  const restartReplies: string[] = [];
  let restarted = false;
  const restartBrain = new FakeConversationProvider([{
    intent: "check_browser",
    confidence: "high",
    actions: ["check_browser"],
  }]);
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "restart.001",
    messageTs: "restart.001",
    text: "restart Chrome",
    botMentioned: false,
    client: fakeClient(restartReplies),
    conversationProvider: restartBrain,
    copyProvider: new FakeCopyProvider(),
    operatorDeps: {
      startBrowserSession: async () => {
        restarted = true;
        return { started: true, message: "started" };
      },
    },
  });
  assert.equal(restarted, true, "Restart Chrome should preserve restart_browser_session operator action.");
  assert.equal(restartBrain.requests.length, 0, "Explicit operator actions should not wait on the LLM planner before execution.");
  assert.match(restartReplies.join("\n"), /visible Chrome session/i);

  const restartIgnoredReplies: string[] = [];
  let restartedAfterIgnore = false;
  const restartIgnoreBrain = new FakeConversationProvider([{
    intent: "ignore",
    confidence: "high",
    actions: ["none"],
  }]);
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "restart-ignore.001",
    messageTs: "restart-ignore.001",
    text: "restart Chrome",
    botMentioned: false,
    client: fakeClient(restartIgnoredReplies),
    conversationProvider: restartIgnoreBrain,
    copyProvider: new FakeCopyProvider(),
    operatorDeps: {
      startBrowserSession: async () => {
        restartedAfterIgnore = true;
        return { started: true, message: "started" };
      },
    },
  });
  assert.equal(restartedAfterIgnore, true, "LLM ignore must not swallow deterministic restart Chrome commands.");
  assert.equal(restartIgnoreBrain.requests.length, 0, "Restart Chrome should be preserved before any LLM ignore/no-reply decision.");
  assert.match(restartIgnoredReplies.join("\n"), /visible Chrome session/i);

  const openChromeReplies: string[] = [];
  let openedUrl: string | null = null;
  const supportedOpenUrl = "https://www.upwork.com/jobs/~0123456789abcdef";
  const openUrlBrain = new FakeConversationProvider([{
    intent: "check_browser",
    confidence: "high",
    actions: ["check_browser"],
  }]);
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "open-url.001",
    messageTs: "open-url.001",
    text: `open ${supportedOpenUrl} in Chrome`,
    botMentioned: false,
    client: fakeClient(openChromeReplies),
    conversationProvider: openUrlBrain,
    copyProvider: new FakeCopyProvider(),
    operatorDeps: {
      openRemoteChromeUrl: async (url: string) => {
        openedUrl = url;
        return { ok: true, text: "I opened that in remote Chrome and brought the tab forward. I did not paste through VNC or click submit." };
      },
    },
  });
  assert.equal(openedUrl, supportedOpenUrl, "Supported Upwork URL in Chrome should preserve open_remote_chrome operator action.");
  assert.equal(openUrlBrain.requests.length, 0, "Open URL in Chrome should not wait on generic browser/status LLM classification.");
  assert.match(openChromeReplies.join("\n"), /remote Chrome/i);

  const unsafeOpenReplies: string[] = [];
  let unsafeOpenedUrl: string | null = null;
  const unsafeOpenBrain = new FakeConversationProvider([{
    intent: "check_browser",
    confidence: "high",
    actions: ["check_browser"],
  }]);
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "unsafe-open-url.001",
    messageTs: "unsafe-open-url.001",
    text: "open https://example.com/test in Chrome",
    botMentioned: true,
    client: fakeClient(unsafeOpenReplies),
    conversationProvider: unsafeOpenBrain,
    copyProvider: new FakeCopyProvider(),
    operatorDeps: {
      openRemoteChromeUrl: async (url: string) => {
        unsafeOpenedUrl = url;
        return { ok: true, text: "should not open" };
      },
    },
  });
  assert.equal(unsafeOpenedUrl, null, "Arbitrary URL must not become a remote Chrome open action.");

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

  upsertSlackThreadState({
    channelId: "C_GATE",
    messageTs: "files.001",
    threadTs: "files.001",
    upworkUrl: "https://www.upwork.com/jobs/~055053866890130225260",
    jobId: "gateway-file-job",
    status: "packet_sent",
  });
  const fileReplies: string[] = [];
  const fileIgnoreBrain = new FakeConversationProvider([{
    intent: "ignore",
    confidence: "high",
    actions: ["none"],
  }]);
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "files.001",
    messageTs: "files.002",
    text: "here",
    botMentioned: false,
    client: fakeClient(fileReplies),
    files: [{ id: "F_GATEWAY_1", name: "case-study.pdf", size: 128, mimetype: "application/pdf" }],
    conversationProvider: fileIgnoreBrain,
    copyProvider: new FakeCopyProvider(),
  });
  assert.equal(fileReplies.length, 1, "File payload should run intake even when LLM says ignore.");
  assert.equal(fileIgnoreBrain.requests.length, 0, "Slack file intake should be preserved before the LLM planner can ignore it.");
  assert.match(fileReplies[0], /could not ingest|downloadable private URL|file/i, "File intake reply should prove the attachment was not dropped.");

  const actionsBeforeUrlIgnore = listBrowserActions(null, 1000).length;
  const urlReplies: string[] = [];
  const urlIgnoreBrain = new FakeConversationProvider([{
    intent: "ignore",
    confidence: "high",
    actions: ["none"],
  }]);
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "url-ignore.001",
    messageTs: "url-ignore.001",
    text: "<@UAGENT> capture https://www.upwork.com/jobs/Klaviyo-Email-Marketing_~066053866890130225260",
    botMentioned: true,
    client: fakeClient(urlReplies),
    conversationProvider: urlIgnoreBrain,
    copyProvider: new FakeCopyProvider(),
  });
  const actionsAfterUrlIgnore = listBrowserActions(null, 1000);
  assert(actionsAfterUrlIgnore.length > actionsBeforeUrlIgnore, "Upwork URL should queue capture even when LLM says ignore.");
  assert(actionsAfterUrlIgnore.some((action) => action.actionType === "capture_job_from_url" && action.jobId.includes("066053866890130225260")), "Ignored Upwork URL should still queue capture.");
  assert.equal(urlIgnoreBrain.requests.length, 0, "Upwork URL capture should be preserved before the LLM planner can ignore it.");
  assert.equal(urlReplies.length, 1, "Ignored Upwork URL should get a capture acknowledgement.");

  const actionsBeforeCaptureReply = listBrowserActions(null, 1000).length;
  const captureReplyReplies: string[] = [];
  const captureReplyBrain = new FakeConversationProvider([{
    intent: "capture_upwork_url",
    confidence: "high",
    actions: ["none"],
    reply: "I’ll capture that listing.",
  }]);
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "url-capture-reply.001",
    messageTs: "url-capture-reply.001",
    text: "<@UAGENT> https://www.upwork.com/jobs/Klaviyo-Flow-Setup_~066053866890130225261",
    botMentioned: true,
    client: fakeClient(captureReplyReplies),
    conversationProvider: captureReplyBrain,
    copyProvider: new FakeCopyProvider(),
  });
  const actionsAfterCaptureReply = listBrowserActions(null, 1000);
  assert(actionsAfterCaptureReply.length > actionsBeforeCaptureReply, "Capture intent with actions none must still queue the URL.");
  assert(actionsAfterCaptureReply.some((action) => action.actionType === "capture_job_from_url" && action.jobId.includes("066053866890130225261")), "Capture intent must not be swallowed as a plain reply.");
  assert.equal(captureReplyBrain.requests.length, 0, "Deterministic URL capture should run before any LLM reply can preempt it.");

  const quietIgnoreReplies: string[] = [];
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "quiet-ignore.001",
    messageTs: "quiet-ignore.001",
    text: "random no-payload chatter",
    botMentioned: false,
    client: fakeClient(quietIgnoreReplies),
    conversationProvider: new FakeConversationProvider([{
      intent: "ignore",
      confidence: "high",
      actions: ["none"],
    }]),
    copyProvider: new FakeCopyProvider(),
  });
  assert.equal(quietIgnoreReplies.length, 0, "No-payload LLM ignore should remain quiet.");

  const fallbackReflectionBefore = listRecentSlackFailureReflections(100).length;
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "tracked.001",
    messageTs: "tracked.004",
    text: "Wtf? I just need the CV you used.",
    botMentioned: false,
    client: fakeClient([]),
    conversationProvider: new FakeConversationProvider([{
      intent: "show_cover_letter",
      confidence: "low",
      actions: ["none"],
    }]),
    copyProvider: new FakeCopyProvider(),
  });
  assert.equal(
    listRecentSlackFailureReflections(100).length - fallbackReflectionBefore,
    1,
    "Fallback after the gateway LLM pass should not learn the same frustrated correction twice."
  );

  const exactDraft = [
    "Exact long draft body starts here.",
    "I would fix the post-purchase leak first, then tighten the winback path.",
    "This paragraph must not be summarized, rewritten, reordered, or omitted by a copywriter.",
    "Final CTA: want me to map the first two lifecycle fixes this week?",
  ].join("\n\n");
  markJobSeen({
    id: "exact-draft-job",
    title: "Exact Draft Klaviyo Job",
    url: "https://www.upwork.com/jobs/~055053866890130225262",
    description: "Klaviyo lifecycle work.",
    budget: "$80/hr",
    postedAt: new Date(0).toISOString(),
    clientCountry: "US",
    clientRating: 5,
    clientSpend: "$10k",
    clientHireRate: 90,
    clientTotalHires: 10,
    clientFeedbackCount: 5,
    category: "Email Marketing",
    experienceLevel: "Expert",
    connectsCost: 8,
    skills: ["Klaviyo"],
    sourceQuery: "test",
    score: 91,
    matchLevel: "high",
    matchedKeywords: ["Klaviyo"],
    negativeKeywords: [],
    scoreBreakdown: {
      fitScore: { score: 91, max: 100, reasons: ["Klaviyo fit"], risks: [] },
      clientQualityScore: { score: 90, max: 100, reasons: [], risks: [] },
      opportunityScore: { score: 90, max: 100, reasons: [], risks: [] },
      redFlagScore: { score: 100, max: 100, reasons: [], risks: [] },
      connectsRiskScore: { score: 90, max: 100, reasons: [], risks: [] },
      finalScore: 91,
      reasons: ["Klaviyo fit"],
      risks: [],
    },
  }, false);
  saveApplicationDraft({
    jobId: "exact-draft-job",
    status: "draft",
    fitScore: 91,
    fitReasons: ["Klaviyo fit"],
    redFlags: [],
    suggestedBid: "$80",
    suggestedConnects: 8,
    suggestedBoostConnects: 0,
    connectsWarnings: [],
    selectedPortfolioItems: [],
    proposalQuality: { score: 91, issues: [], positiveSignals: [], wordCount: 45 },
    proposalText: exactDraft,
    structuredProposal: {
      opening: "Exact long draft body starts here.",
      diagnosis: "Post-purchase leak.",
      proof: "Fly Boutique.",
      clientRequestAnswers: [],
      rateRetainerAnswer: "$80",
      cta: "Map fixes this week.",
      suggestedAttachments: [],
      suggestedHighlights: [],
      browserFillNotes: {
        approvedText: exactDraft,
        profileNotes: [],
        rate: "$80",
        attachments: [],
        highlights: [],
        connectsPlan: "8 required, no boost.",
      },
    },
    generatedAt: new Date(0).toISOString(),
  });
  upsertSlackThreadState({
    channelId: "C_GATE",
    messageTs: "draft.001",
    threadTs: "draft.001",
    upworkUrl: "https://www.upwork.com/jobs/~055053866890130225262",
    jobId: "exact-draft-job",
    status: "packet_sent",
  });
  const destructiveCopyProvider = {
    isAvailable: () => true,
    completeJson: async () => ({ ok: true, data: { text: "Copywriter omitted the proposal body." } }),
  };
  const cvReplies: string[] = [];
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "draft.001",
    messageTs: "draft.002",
    text: "show me the CV you used",
    botMentioned: false,
    client: fakeClient(cvReplies),
    conversationProvider: new FakeConversationProvider([{
      intent: "show_cover_letter",
      confidence: "high",
      actions: ["none"],
    }]),
    copyProvider: destructiveCopyProvider,
  });
  assert.equal(cvReplies.length, 1);
  assert(cvReplies[0].includes(exactDraft), "Show-CV reply must preserve the exact proposal body.");
  assert(!cvReplies[0].includes("Copywriter omitted"), "Show-CV body must not be replaced by copywriter output.");

  const previewReplies: string[] = [];
  await handleSlackReasoningGateway({
    channelId: "C_GATE",
    threadTs: "draft.001",
    messageTs: "draft.003",
    text: "show me the draft here first",
    botMentioned: false,
    client: fakeClient(previewReplies),
    conversationProvider: new FakeConversationProvider([{
      intent: "draft_preview_first",
      confidence: "high",
      actions: ["send_draft_preview"],
    }]),
    copyProvider: destructiveCopyProvider,
  });
	  assert.equal(previewReplies.length, 1);
	  assert(previewReplies[0].includes(exactDraft), "Draft preview must preserve the exact proposal body.");
	  assert.match(previewReplies[0], /Final submit remains manual/i, "Draft preview should keep manual-submit safety.");

	  const blockedCopy = buildManualAttentionSlackText({
	    at: new Date(0).toISOString(),
	    actionId: 210,
	    jobId: "blocked-gateway-job",
	    title: "Just a moment...",
	    url: "https://www.upwork.com/?__cf_chl_tk=test",
	    reason: "captcha_or_security_challenge",
	  });
	  assert.match(blockedCopy, /Upwork checked one application page\. I paused that one safely/i, "Normal blocker copy should use natural recovery language.");
	  assert.match(blockedCopy, /Clear the remote Chrome check, then reply .retry./i, "Normal blocker copy should give Steve the retry path.");
	  assert.doesNotMatch(blockedCopy, /manual_attention_required|browserSessionState|raw action id/i, "Normal blocker copy should hide raw internals.");

	  upsertSlackThreadState({
	    channelId: "C_GATE",
	    messageTs: "blocked.001",
	    threadTs: "blocked.001",
	    upworkUrl: "https://www.upwork.com/jobs/~055053866890130225263",
	    jobId: "blocked-gateway-job",
	    status: "manual_attention_required",
	  });
	  const blockedActionId = enqueueBrowserAction({
	    jobId: "blocked-gateway-job",
	    actionType: "capture_job_from_url",
	    payload: {
	      url: "https://www.upwork.com/jobs/~055053866890130225263",
	      channelId: "C_GATE",
	      threadTs: "blocked.001",
	    },
	  });
	  updateBrowserActionStatus(blockedActionId, "paused", "Detected state: captcha_or_security_challenge.");
	  await recordBrowserManualAttention({
	    actionId: blockedActionId,
	    jobId: "blocked-gateway-job",
	    threadChannelId: "C_GATE",
	    threadTs: "blocked.001",
	    actionType: "capture_job_from_url",
	    source: "slack_url",
	    reason: "captcha_or_security_challenge",
	    url: "https://www.upwork.com/?__cf_chl_tk=test",
	    title: "Just a moment...",
	  });

	  const debugReplies: string[] = [];
	  await handleSlackReasoningGateway({
	    channelId: "C_GATE",
	    threadTs: "blocked.001",
	    messageTs: "blocked.002",
	    text: "debug blocker",
	    botMentioned: false,
	    client: fakeClient(debugReplies),
	  });
	  assert(debugReplies.some((reply) => reply.includes(String(blockedActionId)) && /captcha_or_security_challenge/i.test(reply)), "Debug blocker copy should expose raw action details.");

	  const retryReplies: string[] = [];
	  await handleSlackReasoningGateway({
	    channelId: "C_GATE",
	    threadTs: "blocked.001",
	    messageTs: "blocked.003",
	    text: "retry",
	    botMentioned: false,
	    client: fakeClient(retryReplies),
	    copyProvider: new FakeCopyProvider(),
	  });
	  assert.equal(getBrowserActionById(blockedActionId)?.status, "pending", "Retry should requeue the quarantined action.");
	  assert.equal(listUnresolvedBrowserChallengeQuarantines().some((item) => item.actionId === blockedActionId), false, "Retry should clear unresolved quarantine blocker.");
	  assert(retryReplies.some((reply) => /Retry queued/i.test(reply) && /stop before submit/i.test(reply)), "Retry reply should be natural and preserve final-submit safety.");
	  assert(!retryReplies.join("\n").includes(String(blockedActionId)), "Normal retry copy should hide raw action id.");

	  const skippedActionId = enqueueBrowserAction({
	    jobId: "blocked-gateway-job",
	    actionType: "capture_job_from_url",
	    payload: {
	      url: "https://www.upwork.com/jobs/~055053866890130225263",
	      channelId: "C_GATE",
	      threadTs: "blocked.001",
	    },
	  });
	  updateBrowserActionStatus(skippedActionId, "paused", "Detected state: captcha_or_security_challenge.");
	  await recordBrowserManualAttention({
	    actionId: skippedActionId,
	    jobId: "blocked-gateway-job",
	    threadChannelId: "C_GATE",
	    threadTs: "blocked.001",
	    actionType: "capture_job_from_url",
	    source: "slack_url",
	    reason: "captcha_or_security_challenge",
	    url: "https://www.upwork.com/?__cf_chl_tk=test",
	    title: "Just a moment...",
	  });
	  const skipReplies: string[] = [];
	  await handleSlackReasoningGateway({
	    channelId: "C_GATE",
	    threadTs: "blocked.001",
	    messageTs: "blocked.004",
	    text: "skip this one",
	    botMentioned: false,
	    client: fakeClient(skipReplies),
	    copyProvider: new FakeCopyProvider(),
	  });
	  assert.equal(getBrowserActionById(skippedActionId)?.status, "cancelled", "Skip should cancel the paused quarantined action.");
	  assert.equal(listUnresolvedBrowserChallengeQuarantines().some((item) => item.actionId === skippedActionId), false, "Skip should clear unresolved quarantine blocker.");

	  console.log("slack reasoning gateway tests passed");
	}

runTests().catch((error) => {
  console.error(`slack reasoning gateway tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
