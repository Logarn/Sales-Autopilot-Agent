import assert from "node:assert/strict";
import {
  planSlackConversationWithLlm,
  SLACK_CONVERSATION_ALLOWED_ACTIONS,
  SLACK_CONVERSATION_HARD_SAFETY_RULES,
  type SlackConversationBrainDecision,
  type SlackConversationBrainInput,
} from "./slackConversationBrain";
import type { LlmJsonRequest, LlmJsonResult } from "./llm/provider";

class FakeProvider {
  request: LlmJsonRequest | null = null;
  constructor(private readonly decision: Partial<SlackConversationBrainDecision> | null, private readonly available = true) {}

  isAvailable(): boolean {
    return this.available;
  }

  async completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>> {
    this.request = request;
    return { ok: true, data: this.decision as T };
  }
}

const baseInput: SlackConversationBrainInput = {
  latestUserMessage: "Wtf? I just need the CV you used.",
  threadHistory: [{ role: "user", text: "Show me the cover letter you used here." }],
  thread: {
    channelId: "C123",
    threadTs: "111.222",
    status: "packet_sent",
    jobId: "job-1",
    upworkUrl: "https://www.upwork.com/jobs/~job1",
  },
  job: {
    id: "job-1",
    title: "Klaviyo lifecycle work",
    url: "https://www.upwork.com/jobs/~job1",
    score: 88,
    matchLevel: "high",
    reasons: ["Strong Klaviyo fit"],
    risks: ["Browser check may block verification"],
  },
  application: { status: "draft" },
  draft: {
    exists: true,
    status: "draft",
    proposalText: "Stored proposal draft",
    proposalVersion: 1,
  },
  proof: {
    files: ["profile/attachments/fly-boutique-case-study.pdf"],
    portfolioHighlights: ["The Fly Boutique"],
    certificates: [],
    mentionOnly: [],
    verified: false,
    missingFiles: [],
  },
  connects: { required: 8, boost: 18, total: 26 },
  browserAction: {
    actionType: "prepare_application_review",
    status: "paused",
    retryable: true,
    lastError: "captcha_or_security_challenge",
  },
  qaQueue: [{
    index: 1,
    title: "Klaviyo lifecycle work",
    state: "blocked",
    proof: "The Fly Boutique",
    files: "fly-boutique-case-study.pdf",
    connects: "8",
    boost: "18",
    nextAction: "clear Chrome, then reply \"retry\"",
  }],
  behaviorMemories: [{
    type: "operator_preference",
    rule: "CV means cover letter/proposal draft.",
    scope: "global",
    confidence: "high",
  }],
  allowedActions: SLACK_CONVERSATION_ALLOWED_ACTIONS,
  hardSafetyRules: SLACK_CONVERSATION_HARD_SAFETY_RULES,
};

async function runTests(): Promise<void> {
  const provider = new FakeProvider({
    intent: "show_cover_letter",
    confidence: "high",
    reply: "You’re right — I should have shown the draft. Here it is.",
    actions: ["none"],
    memoryUpdate: {
      type: "operator_preference",
      rule: "When Steve says CV in an Upwork thread, show the cover letter/proposal draft.",
      scope: "global",
      confidence: "high",
    },
    failureReflection: {
      whatHappened: "Steve corrected an unhelpful command-router response.",
      whyItFailed: "The bot treated CV as unknown instead of the proposal draft.",
      nextBehavior: "Show the draft or explain no draft exists.",
      fixType: "memory",
    },
    needsHumanClarification: false,
    codeImprovementNeeded: false,
  });
  const result = await planSlackConversationWithLlm(baseInput, provider);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.decision.intent, "show_cover_letter");
  assert.equal(result.ok && result.decision.actions[0], "none");
  assert.equal(result.ok && result.decision.memoryUpdate?.type, "operator_preference");
  assert.equal(result.ok && result.decision.failureReflection?.fixType, "memory");
  assert.equal(result.ok && result.decision.safety.finalSubmit, "manual_only");
  const prompt = JSON.stringify(provider.request);
  assert.match(prompt, /latestUserMessage/i, "Brain prompt should include the latest message.");
  assert.match(prompt, /Stored proposal draft/i, "Brain prompt should include draft state.");
  assert.match(prompt, /CV in an Upwork thread/i, "Brain prompt should include behavior memories.");
  assert.match(prompt, /Final submit remains manual/i, "Brain prompt should include hard safety rules.");
  assert.match(prompt, /Return JSON only/i, "Brain prompt should require structured JSON.");

  const unsafeProvider = new FakeProvider({
    intent: "full_safe_prep",
    confidence: "high",
    reply: "I can help with the draft, files, proof, boost, or status. Browser action 123 will click submit.",
    actions: ["queue_prepare_application", "click_submit" as any],
  });
  const unsafe = await planSlackConversationWithLlm(baseInput, unsafeProvider);
  assert.equal(unsafe.ok, true);
  assert.equal(unsafe.ok && unsafe.decision.reply, null, "Unsafe/menu/raw-id copy should be discarded.");
  assert.deepEqual(unsafe.ok && unsafe.decision.actions, ["queue_prepare_application"], "Unknown unsafe actions should be filtered.");
  assert.equal(unsafe.ok && unsafe.decision.safety.browserChecksBypassAllowed, false);

  const unavailable = await planSlackConversationWithLlm(baseInput, new FakeProvider(null, false));
  assert.equal(unavailable.ok, false, "Unavailable provider should fall back cleanly.");

  console.log("slack conversation brain tests passed");
}

runTests().catch((error) => {
  console.error(`slack conversation brain tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
