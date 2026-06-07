import assert from "node:assert/strict";
import { rewriteSlackCopyWithKimi, type SlackCopyProvider } from "./slackCopywriter";
import type { LlmJsonRequest } from "./llm/provider";

function fakeProvider(text: string): { provider: SlackCopyProvider; requests: LlmJsonRequest[] } {
  const requests: LlmJsonRequest[] = [];
  return {
    requests,
    provider: {
      isAvailable: () => true,
      completeJson: async <T>(request: LlmJsonRequest) => {
        requests.push(request);
        return { ok: true, data: { text } as T };
      },
    },
  };
}

async function run(): Promise<void> {
  const kimi = fakeProvider("Yes — I can use reusable proof assets, ingest Slack uploads when files access is enabled, and then stop before submit.");
  const rewritten = await rewriteSlackCopyWithKimi({
    path: "conversation_reply",
    deterministicText: "Yes. For reusable proof, I can use files already in my proof-assets folder. For one-off files, attach them in this Slack thread and I can ingest them when Slack files access is enabled. Next, I can attach the available proof in remote Chrome and stop before submit.",
    userMessage: "Can you upload the files from here? If you had access?",
    intent: "answer_file_capability_question",
  }, kimi.provider);
  assert.equal(rewritten.usedLlm, true);
  assert.equal(rewritten.provider, "kimi");
  assert(kimi.requests[0]?.messages.some((message) => message.content.includes("Return JSON only")), "Kimi copywriter prompt should require structured JSON.");
  assert(kimi.requests[0]?.messages.some((message) => message.content.includes("Operating constitution from soul.md")), "Kimi copywriter prompt should include soul.md.");
  assert(kimi.requests[0]?.messages.some((message) => message.content.includes("Fucking Lead Closer")), "Kimi copywriter prompt should include the soul.md identity.");

  const leadPacket = fakeProvider("🚀 This one is worth a real shot. I’ll prep it and stop before submit. Final submit remains manual.");
  const leadPacketCopy = await rewriteSlackCopyWithKimi({
    path: "lead_packet",
    deterministicText: "New lead: Klaviyo Shopify work. Final submit remains manual.",
    intent: "new_lead_packet",
    preservePhrases: ["Final submit remains manual"],
  }, leadPacket.provider);
  assert.equal(leadPacketCopy.usedLlm, true);
  assert(leadPacket.requests[0]?.messages.some((message) => message.content.includes("slack_copy:lead_packet")), "Lead packet copy prompt should include soul.md lead-packet context.");

  const rawId = fakeProvider("Retry browser action #123 in thread 111.222.");
  const rawFallback = await rewriteSlackCopyWithKimi({
    path: "conversation_reply",
    deterministicText: "Retry queued — I’ll re-check the remote Chrome page and stop before submit.",
    userMessage: "Retry.",
    intent: "retry_action",
  }, rawId.provider);
  assert.equal(rawFallback.usedLlm, false);
  assert.equal(rawFallback.text, "Retry queued — I’ll re-check the remote Chrome page and stop before submit.");

  const proofDrift = fakeProvider("Proof I used: Fly Boutique.");
  const proofFallback = await rewriteSlackCopyWithKimi({
    path: "qa_handoff",
    deterministicText: "• *Proof planned:* Portfolio: Fly Boutique\n• *Submit:* untouched",
    intent: "prepare_application_review_status",
    preservePhrases: ["Proof planned", "• *Submit:* untouched"],
  }, proofDrift.provider);
  assert.equal(proofFallback.usedLlm, false);
  assert.equal(proofFallback.text.includes("Proof planned"), true);
  assert.equal(proofFallback.text.includes("Proof I used"), false);

  const missingDraft = fakeProvider("Here is the summary, but not the exact draft.");
  const draftFallback = await rewriteSlackCopyWithKimi({
    path: "conversation_reply",
    deterministicText: "Here’s the cover letter I drafted.\n\nExact draft text.",
    userMessage: "Show me the cover letter you used here.",
    intent: "show_cover_letter",
    preservePhrases: ["Exact draft text."],
  }, missingDraft.provider);
  assert.equal(draftFallback.usedLlm, false);
  assert.equal(draftFallback.text.includes("Exact draft text."), true);

  console.log("slack copywriter tests passed");
}

run().catch((error) => {
  console.error(`slack copywriter tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
