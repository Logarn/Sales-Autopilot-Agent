import assert from "node:assert/strict";
import { rewriteSlackCopyWithKimi, type SlackCopyProvider } from "./slackCopywriter";
import type { LlmJsonRequest } from "./llm/provider";

function withEnv<T>(values: Record<string, string | undefined>, fn: () => T | Promise<T>): T | Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = fn();
    if (result && typeof (result as Promise<T>).then === "function") {
      return (result as Promise<T>).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

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
  assert(kimi.requests[0]?.messages.some((message) => message.content.includes("Say \"I.\"")), "Kimi copywriter prompt should include first-person teammate guidance.");
  assert(kimi.requests[0]?.messages.some((message) => message.content.includes("sharp senior SDR/operator teammate")), "Kimi copywriter prompt should force teammate-style Slack copy.");

  const leadPacket = fakeProvider("🚀 This one is worth a real shot. Review it in VNC when ready; I’ll stop before submit.\nhttps://www.upwork.com/jobs/~1234567890");
  const leadPacketCopy = await rewriteSlackCopyWithKimi({
    path: "lead_packet",
    deterministicText: "New lead: Klaviyo Shopify work. Next: review it. I’ll stop before submit.\nhttps://www.upwork.com/jobs/~1234567890",
    intent: "new_lead_packet",
    context: { upworkUrl: "https://www.upwork.com/jobs/~1234567890" },
    preservePhrases: ["stop before submit", "https://www.upwork.com/jobs/~1234567890"],
  }, leadPacket.provider);
  assert.equal(leadPacketCopy.usedLlm, true);
  assert(leadPacket.requests[0]?.messages.some((message) => message.content.includes("slack_copy:lead_packet")), "Lead packet copy prompt should include soul.md lead-packet context.");
  assert(leadPacket.requests[0]?.messages.some((message) => message.content.includes("sales memories")), "Lead packet copy prompt should include memory guidance.");

  const missingLeadLink = fakeProvider("🚀 This one is worth a real shot. Reply “prep it” and I’ll stop before submit.");
  const linkFallback = await rewriteSlackCopyWithKimi({
    path: "lead_packet",
    deterministicText: "New lead: Klaviyo Shopify work. Next: reply prep it. I’ll stop before submit.\nhttps://www.upwork.com/jobs/~1234567890",
    intent: "new_lead_packet",
    context: { title: "Klaviyo Shopify work", matchLevel: "high", upworkUrl: "https://www.upwork.com/jobs/~1234567890" },
    preservePhrases: ["stop before submit", "https://www.upwork.com/jobs/~1234567890"],
  }, missingLeadLink.provider);
  assert.equal(linkFallback.usedLlm, false);
  assert(linkFallback.text.includes("https://www.upwork.com/jobs/~1234567890"), "Lead fallback should keep the Upwork link.");
  assert(linkFallback.text.includes("stop before submit"), "Lead fallback should keep the submit boundary.");
  assert(!linkFallback.text.includes("packet_sent"), "Lead fallback must not expose raw packet fields.");

  const repeatedOpening = fakeProvider("This is worth prepping. Reply “prep it” and I’ll stop before submit.\nhttps://www.upwork.com/jobs/~1234567890");
  const repeatedOpeningFallback = await rewriteSlackCopyWithKimi({
    path: "lead_packet",
    deterministicText: "New lead: Klaviyo Shopify work. Next: reply prep it. I’ll stop before submit.\nhttps://www.upwork.com/jobs/~1234567890",
    intent: "new_lead_packet",
    context: { title: "Klaviyo Shopify work", matchLevel: "high", upworkUrl: "https://www.upwork.com/jobs/~1234567890" },
    recentPhrases: ["This is worth prepping."],
    preservePhrases: ["stop before submit", "https://www.upwork.com/jobs/~1234567890"],
  }, repeatedOpening.provider);
  assert.equal(repeatedOpeningFallback.usedLlm, false, "Lead copy should reject identical recent openings.");

  const rawId = fakeProvider("Retry browser action #123 in thread 111.222.");
  const rawFallback = await rewriteSlackCopyWithKimi({
    path: "conversation_reply",
    deterministicText: "Retry queued — I’ll re-check the remote Chrome page and stop before submit.",
    userMessage: "Retry.",
    intent: "retry_action",
  }, rawId.provider);
  assert.equal(rawFallback.usedLlm, false);
  assert.equal(rawFallback.text, "Retry queued — I’ll re-check the remote Chrome page and stop before submit.");

  const rawInternal = fakeProvider("Upwork needs manual browser attention. Job: manual:upwork-123. Reason: field_preparation_incomplete.");
  const rawInternalFallback = await rewriteSlackCopyWithKimi({
    path: "qa_handoff",
    deterministicText: "⚠️ *I couldn’t verify the Connects cost yet.*\n\n• *Connects:* not verified\n• *Boost:* not set yet\n• *Submit:* untouched",
    intent: "prepare_application_review_status",
    preservePhrases: ["• *Submit:* untouched"],
  }, rawInternal.provider);
  assert.equal(rawInternalFallback.usedLlm, false);
  assert(!/manual:upwork|field_preparation_incomplete|manual_attention_required/i.test(rawInternalFallback.text), "Fallback should hide raw internal apply-prep states.");

  const dashboardDump = fakeProvider("Overall health: not healthy\nWorkers: 0 active heartbeats, 1 stale\nbrowser_challenge_action_paused");
  const dashboardFallback = await rewriteSlackCopyWithKimi({
    path: "conversation_reply",
    deterministicText: "Yeah — I’m up. Slack is live and Chrome is connected.\nI’m paused because 4 old apply items are still sitting from the earlier Upwork check. Browser itself looks clean now.\nBest move: skip the stale blocked applications, then I’ll restart hunting if the next check is clean.",
    userMessage: "are you running?",
    intent: "answer_health",
  }, dashboardDump.provider);
  assert.equal(dashboardFallback.usedLlm, false, "Dashboard-style Kimi output should be rejected for normal Slack copy.");
  assert(!/Overall health|Workers|browser_challenge_action_paused/i.test(dashboardFallback.text), "Fallback should not expose dashboard/internal wording.");
  assert(dashboardFallback.text.includes("Best move"), "Fallback should keep the practical teammate recommendation.");

  const connectsDrift = fakeProvider("Connects verified: 12 required. Boost: 18 selected. Submit untouched.");
  const connectsFallback = await rewriteSlackCopyWithKimi({
    path: "qa_handoff",
    deterministicText: "⚠️ *I couldn’t verify the Connects cost yet.*\n\nI can see the proposal page, but the Connects section isn’t readable right now. I left submit untouched and skipped boost for now.\n\n• *Connects:* not verified\n• *Boost:* not set yet\n• *Submit:* untouched",
    intent: "prepare_application_review_status",
    preservePhrases: ["• *Submit:* untouched"],
  }, connectsDrift.provider);
  assert.equal(connectsFallback.usedLlm, false, "LLM copy must not upgrade unknown Connects or boost into verified facts.");
  assert(connectsFallback.text.includes("Connects:* not verified"), "Fallback should keep Connects not verified.");
  assert(connectsFallback.text.includes("Boost:* not set yet"), "Fallback should keep boost unset.");

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

  const thirdPerson = fakeProvider("The agent can handle that and stop before submit.");
  const thirdPersonFallback = await rewriteSlackCopyWithKimi({
    path: "conversation_reply",
    deterministicText: "I can handle that and stop before submit.",
    userMessage: "Can you handle it?",
    intent: "status_summary",
  }, thirdPerson.provider);
  assert.equal(thirdPersonFallback.usedLlm, false);
  assert.equal(thirdPersonFallback.text.includes("The agent"), false);

  const originalFetch = globalThis.fetch;
  try {
    await withEnv({
      SLACK_COPY_LLM_ENABLED: "true",
      SLACK_COPY_PROVIDER: "kimi",
      SLACK_COPY_MODEL: "kimi-k2.6",
      MOONSHOT_API_KEY: "moonshot-test-key",
      MOONSHOT_BASE_URL: "https://api.moonshot.ai/v1",
      XAI_API_KEY: "xai-test-key",
      XAI_BASE_URL: "https://api.x.ai/v1",
      XAI_MODEL: "grok-4.3",
    }, async () => {
      const calledUrls: string[] = [];
      globalThis.fetch = async (input, init) => {
        calledUrls.push(String(input));
        const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
        if (body.model === "kimi-k2.6") {
          return new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ text: "Overall health: not healthy\nWorkers: 0 active heartbeats" }) } }],
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ text: "Yeah — I’m up. Chrome is clean, but the old blocked apply items need cleanup first. Best move: skip the stale ones, then I’ll restart hunting." }) } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      };

      const fallbackToGrok = await rewriteSlackCopyWithKimi({
        path: "conversation_reply",
        deterministicText: "Yeah — I’m up. Slack is live and Chrome is connected. Best move: skip stale blockers.",
        userMessage: "are you running?",
        intent: "answer_health",
      });
      assert.equal(fallbackToGrok.usedLlm, true);
      assert.equal(fallbackToGrok.provider, "grok");
      assert(!/Overall health|Workers/i.test(fallbackToGrok.text), "Kimi dashboard output should be rejected before Grok copy is used.");
      assert.equal(calledUrls.some((url) => url.includes("moonshot")), true, "Slack copy should try Kimi first.");
      assert.equal(calledUrls.some((url) => url.includes("api.x.ai")), true, "Slack copy should fall back to Grok.");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("slack copywriter tests passed");
}

run().catch((error) => {
  console.error(`slack copywriter tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
