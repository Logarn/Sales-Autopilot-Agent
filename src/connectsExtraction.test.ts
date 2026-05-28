import assert from "node:assert/strict";

import { extractConnectsFromVisibleText, extractConnectsWithLlmFallback } from "./connectsExtraction";
import { buildDeterministicOpportunityPacket, normalizedPacketToJobPosting } from "./normalization";
import type { ConnectsExtractionProvider } from "./connectsExtraction";

const noConnectsText = `
Title: Lifecycle marketer for Shopify
Description
We need lifecycle strategy and Klaviyo implementation.
Remaining balance: 84 Connects
Client's location
United States
`;

const missing = extractConnectsFromVisibleText(noConnectsText);
assert.equal(missing.requiredConnects, null);
assert.equal(missing.boostConnects, null);
assert.equal(missing.totalConnects, null);
assert.equal(missing.confidence, "unknown");

const deterministicPacket = buildDeterministicOpportunityPacket(noConnectsText, {
  url: "https://www.upwork.com/jobs/~0123456789abcdef",
  capturedAt: new Date("2026-05-28T00:00:00.000Z"),
});
assert.equal(deterministicPacket.connects.requiredConnects, null);
assert.equal(deterministicPacket.connects.deterministicRequired, null);
assert.equal(normalizedPacketToJobPosting(deterministicPacket).connects?.requiredConnects, null);

const explicit = extractConnectsFromVisibleText(`
Send a proposal
This proposal requires 16 Connects
Bid to boost: 4 Connects
Total: 20 Connects
`);
assert.equal(explicit.requiredConnects, 16);
assert.equal(explicit.boostConnects, 4);
assert.equal(explicit.totalConnects, 20);
assert.equal(explicit.extractionMethod, "deterministic_visible_text");
assert.match(explicit.sourceText ?? "", /proposal requires 16 Connects/i);
assert.equal(explicit.sourceLocation, "line 3, line 4, line 5");

class FakeProvider implements ConnectsExtractionProvider {
  isAvailable(): boolean {
    return true;
  }

  async completeJson<T>(): Promise<{ ok: boolean; data?: T }> {
    return {
      ok: true,
      data: {
        requiredConnects: 12,
        boostConnects: null,
        totalConnects: null,
        confidence: "high",
        sourceText: "This proposal requires 12 Connects",
        sourceLocation: "not visible",
        extractionMethod: "llm_visible_text",
      } as T,
    };
  }
}

async function run(): Promise<void> {
  const llmWithoutSource = await extractConnectsWithLlmFallback(noConnectsText, new FakeProvider());
  assert.equal(llmWithoutSource.requiredConnects, null);
  assert.equal(llmWithoutSource.sourceText, null);
  assert.equal(llmWithoutSource.confidence, "unknown");

  console.log("connects extraction tests passed");
}

run().catch((error) => {
  console.error(`connects extraction tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
