import assert from "node:assert/strict";
import { classifySlackThreadWithLlm, type SlackThreadBrainDecision } from "./slackThreadBrain";
import type { LlmJsonRequest, LlmJsonResult } from "./llm/provider";

class FakeProvider {
  request: LlmJsonRequest | null = null;
  constructor(private readonly decision: Partial<SlackThreadBrainDecision> | null, private readonly available = true) {}

  isAvailable(): boolean {
    return this.available;
  }

  async completeJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>> {
    this.request = request;
    return { ok: true, data: this.decision as T };
  }
}

async function runTests(): Promise<void> {
  const approveProvider = new FakeProvider({
    intent: "approve_prepare",
    confidence: "high",
    replyText: "Got it - I’ll prep this now and come back here when it’s ready for QA.",
  });
  const approve = await classifySlackThreadWithLlm({
    text: "yeah, prep drafts and send link to listing <@UAGENT>",
    botMentioned: true,
    threadMapped: true,
    jobId: "job-1",
    upworkUrl: "https://www.upwork.com/jobs/~job1",
    threadStatus: "packet_sent",
  }, approveProvider);
  assert.equal(approve.ok, true);
  assert.equal(approve.ok && approve.decision.intent, "approve_prepare");
  assert.equal(approve.ok && approve.decision.confidence, "high");
  assert.match(approve.ok ? approve.decision.replyText ?? "" : "", /ready for QA/);
  const prompt = JSON.stringify(approveProvider.request);
  assert.match(prompt, /must never mean final submit/i, "LLM router prompt should preserve the final-submit boundary");
  assert.match(prompt, /yeah, prep drafts/i, "LLM router prompt should include the live failing phrase");

  const statusProvider = new FakeProvider({
    intent: "status",
    confidence: "high",
    replyText: "Here’s what I know.",
  });
  const status = await classifySlackThreadWithLlm({
    text: "What are the red flags?",
    botMentioned: false,
    threadMapped: true,
  }, statusProvider);
  assert.equal(status.ok && status.decision.intent, "status");

  const reviseProvider = new FakeProvider({
    intent: "revise",
    confidence: "high",
    instruction: "Use the Truly Beauty proof instead.",
  });
  const revise = await classifySlackThreadWithLlm({
    text: "Use the Truly Beauty proof instead.",
    botMentioned: false,
    threadMapped: true,
  }, reviseProvider);
  assert.equal(revise.ok && revise.decision.intent, "revise");
  assert.equal(revise.ok && revise.decision.instruction, "Use the Truly Beauty proof instead.");

  const outcomeProvider = new FakeProvider({
    intent: "record_outcome",
    confidence: "high",
    outcomeStatus: "interview",
    replyText: "Got it - I marked this as interview booked.",
  });
  const outcome = await classifySlackThreadWithLlm({
    text: "interview booked",
    botMentioned: false,
    threadMapped: true,
    jobId: "job-1",
  }, outcomeProvider);
  assert.equal(outcome.ok && outcome.decision.intent, "record_outcome");
  assert.equal(outcome.ok && outcome.decision.outcomeStatus, "interview");

  const sanitizedProvider = new FakeProvider({
    intent: "approve_prepare",
    confidence: "high",
    replyText: "I’ll click submit now.",
  });
  const sanitized = await classifySlackThreadWithLlm({
    text: "apply",
    botMentioned: false,
    threadMapped: true,
  }, sanitizedProvider);
  assert.equal(sanitized.ok, true);
  assert.doesNotMatch(sanitized.ok ? sanitized.decision.replyText ?? "" : "", /click submit/i, "LLM reply text should be sanitized against final-submit wording");

  const unavailable = await classifySlackThreadWithLlm({
    text: "prep it",
    botMentioned: false,
    threadMapped: true,
  }, new FakeProvider(null, false));
  assert.equal(unavailable.ok, false, "Unavailable LLM should return a safe non-throwing result");

  console.log("slack thread brain tests passed");
}

runTests().catch((error) => {
  console.error(`slack thread brain tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
