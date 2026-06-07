import { buildV3CapturePacket, shouldPostLeadPacket, writeV3CapturePacketWithLlm } from "./slackPacketV3";
import { JobIntelligence, ScoredJob } from "./types";
import type { LlmJsonRequest } from "./llm/provider";

function createScoredJob(overrides: Partial<ScoredJob> = {}): ScoredJob {
  return {
    id: "manual:upwork-1234567890",
    title: "Email Marketing Specialist Needed",
    url: "https://www.upwork.com/jobs/~1234567890",
    description: "Klaviyo email role for an ecommerce brand. Need retention, email flows, and campaign support.",
    postedAt: "2026-05-11T09:00:00.000Z",
    budget: "$12-$35/hr",
    clientCountry: "United States",
    clientRating: 4.8,
    clientSpend: 1200,
    clientHireRate: 92,
    clientTotalHires: 47,
    clientFeedbackCount: 29,
    category: "Digital Marketing",
    experienceLevel: "Expert",
    connectsCost: 4,
    skills: ["Klaviyo", "Shopify", "Email Marketing"],
    sourceQuery: "manual",
    score: 84,
    matchLevel: "medium",
    matchedKeywords: ["Klaviyo", "retention"],
    negativeKeywords: [],
    scoreBreakdown: {
      fitScore: { score: 70, reasons: ["Matches retention/email work"], risks: [] },
      clientQualityScore: { score: 48, reasons: [], risks: ["Client has weak spend history"] },
      opportunityScore: { score: 66, reasons: ["Clear email scope"], risks: ["Budget looks low"] },
      redFlagScore: { score: 90, reasons: ["No serious red flags"], risks: [] },
      connectsRiskScore: { score: 70, reasons: ["Connects budget is reasonable"], risks: [] },
      finalScore: 84,
      reasons: ["Matches retention/email work"],
      risks: ["Client has weak spend history and budget looks low"],
    },
    applicationDraft: {
      jobId: "manual:upwork-1234567890",
      status: "draft",
      fitScore: 68,
      fitReasons: ["Email retention match"],
      redFlags: ["Client has weak spend history"],
      suggestedBid: "$35/hr",
      suggestedConnects: 4,
      suggestedBoostConnects: 0,
      connectsWarnings: [],
      connectsStrategy: {
        decision: "safe_apply",
        requiredConnects: 4,
        suggestedBoostConnects: 0,
        totalConnects: 4,
        expectedValueScore: 72,
        reasons: ["Required Connects are reasonable."],
        risks: [],
      },
      selectedPortfolioItems: [],
      proposalQuality: {
        score: 88,
        issues: [],
        positiveSignals: ["Clear positioning"],
        wordCount: 180,
      },
      proposalText: "Long internal proposal preview that should not be in the initial lead alert.",
      generatedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertIncludes(haystack: string, needle: string, label: string): void {
  assert(haystack.includes(needle), `${label}: expected ${JSON.stringify(needle)} in output:\n${haystack}`);
}

function assertNotIncludes(haystack: string, needle: string, label: string): void {
  assert(!haystack.toLowerCase().includes(needle.toLowerCase()), `${label}: unexpected ${JSON.stringify(needle)} in output:\n${haystack}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label}: expected ${JSON.stringify(expected)} but received ${JSON.stringify(actual)}`);
}

function fakeLeadProvider(): { requests: LlmJsonRequest[]; provider: { isAvailable: () => boolean; completeJson: <T>(request: LlmJsonRequest) => Promise<{ ok: true; data: T }> } } {
  const requests: LlmJsonRequest[] = [];
  return {
    requests,
    provider: {
      isAvailable: () => true,
      completeJson: async <T>(request: LlmJsonRequest) => {
        requests.push(request);
        const payload = JSON.parse(request.messages[1].content) as { recentOpenings?: string[]; context?: { upworkUrl?: string } };
        const url = payload.context?.upworkUrl ?? "https://www.upwork.com/jobs/~1234567890";
        const repeated = (payload.recentOpenings ?? []).some((opening) => opening.includes("this deserves a serious look"));
        const text = repeated
          ? `I’d move this one into prep. The fit is strong enough to spend the time, and I’ll stop before submit.\n\nNext: review it in VNC when I post the QA handoff.\n${url}`
          : `This deserves a serious look. The fit is strong enough to spend the time, and I’ll stop before submit.\n\nNext: review it in VNC when I post the QA handoff.\n${url}`;
        return { ok: true, data: { text } as T };
      },
    },
  };
}

function unavailableLeadProvider(): { isAvailable: () => boolean; completeJson: <T>(request: LlmJsonRequest) => Promise<{ ok: false; skippedReason: string }> } {
  return {
    isAvailable: () => false,
    completeJson: async () => ({ ok: false, skippedReason: "disabled" }),
  };
}

async function runTests(): Promise<void> {
  const intelligence: JobIntelligence = {
    schemaVersion: "1.0",
    primaryPlatform: "Klaviyo",
    platformsMentioned: ["Klaviyo", "Shopify"],
    platformCategory: "ESP",
    platformPreferenceTier: "core",
    platformFitReason: "Klaviyo is a core platform and the scope is ecommerce email retention.",
    shouldSkipForPlatform: false,
    skipReason: "",
    businessType: "DTC ecommerce",
    ecommerceVertical: "beauty",
    jobCategory: "Email marketing",
    taskType: "Email flows and campaign support",
    requiredSkills: ["Klaviyo", "Email Marketing"],
    clientGoal: "Improve retention email performance.",
    redFlags: [],
    fitScoreReasoning: "matches retention/email work",
    proposalAngle: "Lead with lifecycle email improvements.",
    proofRecommendations: ["Truly Beauty case study"],
    draftConstraints: [],
    platformMismatchWarnings: [],
    needsManualReview: false,
    confidence: "high",
  };
  const job = createScoredJob();
  const packet = buildV3CapturePacket(job, {
    upworkUrl: job.url,
    captureStatus: "packet_sent",
    browserCaptureActionId: 11,
    autoPrepareNote: "Strong fit. I’m preparing the Upwork draft now. Final submit remains manual.",
    requiredConnects: 4,
    suggestedBoostConnects: 0,
    suggestedBid: "$35/hr",
    applicationQuestions: ["How would you improve Klaviyo revenue mix?"],
    questionAnswers: ["I would start with flow gaps and segmentation quality."],
    jobIntelligence: intelligence,
  });
  const text = packet.text;

  assert(text.length < 900, "lead alert should stay short enough for a fast scan");
  assertIncludes(text, "🚀 *New lead: Email Marketing Specialist Needed*", "lead heading");
  assertIncludes(text, "<@U0A2X5BCNKC> <@U0AHJFYV42K>", "lead alert should tag Steve/Natalie");
  assert(
    /This is worth prepping|I’d move this into prep|This one has enough signal to stage/.test(text),
    "human lead sentence should vary while preserving prep intent",
  );
  assertIncludes(text, "Klaviyo email flows and campaign support", "human lead sentence");
  assertIncludes(text, "• *Fit:* Medium", "fit summary");
  assertIncludes(text, "• *Platform:* Klaviyo", "platform summary");
  assertIncludes(text, "• *Connects:* 4", "connects summary");
  assertIncludes(text, "• *Budget:* $12-$35/hr", "budget summary");
  assertIncludes(text, "• *Risk:* Client has weak spend history and budget looks low", "single risk");
  assertIncludes(text, "*Next:* I’m preparing this now; review it in VNC when I say it’s ready.", "autonomous next action");
  assertIncludes(text, "stop before submit", "manual submit boundary");
  assertIncludes(text, job.url, "job url");

  for (const noisy of [
    "Debug:",
    "action #",
    "packet_sent",
    "Available replies",
    "Manual overrides",
    "prepare draft",
    "Proposal preview",
    "Screening answers",
    "How would you improve",
    "Suggested proof",
    "Truly Beauty",
    "figma.com",
    "profile/attachments",
    "Client quality signals",
    "Touchpoint 1",
    "manual review",
    "platformEligibility",
    "lead decision",
    "source context",
    "action id",
  ]) {
    assertNotIncludes(text, noisy, `default lead alert should hide ${noisy}`);
  }

  assert(packet.blocks.length === 1, "compact lead alert should use one block");
  assertEqual(
    shouldPostLeadPacket(job, { upworkUrl: job.url, captureStatus: "packet_sent", jobIntelligence: intelligence }),
    true,
    "eligible lead should post",
  );

  const llm = fakeLeadProvider();
  const llmPacket = await writeV3CapturePacketWithLlm(job, {
    upworkUrl: job.url,
    captureStatus: "packet_sent",
    autoPrepareNote: "Strong fit. I’m preparing the Upwork draft now. Final submit remains manual.",
    requiredConnects: 4,
    suggestedBoostConnects: 0,
    suggestedBid: "$35/hr",
    jobIntelligence: intelligence,
  }, llm.provider);
  assertEqual(llm.requests.length, 1, "lead packet should invoke LLM writer when available");
  assert(llmPacket.text.includes(job.url), "LLM lead packet must include the Upwork link");
  assert(llmPacket.text.includes("Next:"), "LLM lead packet must include one clear CTA");
  assert(llmPacket.text.includes("stop before submit"), "LLM lead packet must preserve final-submit boundary");
  for (const noisy of ["packet_sent", "action #", "platformEligibility", "source_context_unavailable", "Job ID:"]) {
    assertNotIncludes(llmPacket.text, noisy, `LLM lead packet should hide ${noisy}`);
  }
  assert(llm.requests[0]?.messages.some((message) => message.content.includes("Operating constitution from soul.md")), "lead writer prompt should include soul.md");
  assert(llm.requests[0]?.messages.some((message) => message.content.includes("salesLearning")), "lead writer prompt should include long-term memory context");

  const similarJob = createScoredJob({
    id: "manual:upwork-1234567891",
    url: "https://www.upwork.com/jobs/~1234567891",
    title: "Email Marketing Specialist Needed For Shopify",
    description: "Klaviyo email role for an ecommerce brand. Need retention, email flows, and campaign support.",
  });
  similarJob.applicationDraft = {
    ...job.applicationDraft!,
    jobId: similarJob.id,
  };
  const similarPacket = await writeV3CapturePacketWithLlm(similarJob, {
    upworkUrl: similarJob.url,
    captureStatus: "packet_sent",
    autoPrepareNote: "Strong fit. I’m preparing the Upwork draft now. Final submit remains manual.",
    requiredConnects: 4,
    suggestedBoostConnects: 0,
    suggestedBid: "$35/hr",
    jobIntelligence: intelligence,
  }, llm.provider);
  const firstOpening = llmPacket.text.split(/\n/)[0];
  const secondOpening = similarPacket.text.split(/\n/)[0];
  assert(firstOpening !== secondOpening, `two similar LLM-written leads should avoid identical openings: ${firstOpening}`);

  const fallbackPacket = await writeV3CapturePacketWithLlm(job, {
    upworkUrl: job.url,
    captureStatus: "packet_sent",
    autoPrepareNote: "Strong fit. I’m preparing the Upwork draft now. Final submit remains manual.",
    requiredConnects: 4,
    suggestedBoostConnects: 0,
    suggestedBid: "$35/hr",
    jobIntelligence: intelligence,
  }, unavailableLeadProvider());
  assert(fallbackPacket.text.includes(job.url), "lead fallback should include the Upwork link");
  assert(fallbackPacket.text.includes("stop before submit"), "lead fallback should keep final submit manual");
  assert(!fallbackPacket.text.includes("I can help with the draft, files, proof, boost, or status"), "lead fallback must not dump command-menu copy");

  const unknownConnectsJob = createScoredJob({
    connectsCost: 0,
    connects: {
      requiredConnects: null,
      boostConnects: null,
      totalConnects: null,
      confidence: "unknown",
      sourceText: null,
      sourceLocation: null,
      extractionMethod: "not_found",
    },
  });
  unknownConnectsJob.applicationDraft = {
    ...unknownConnectsJob.applicationDraft!,
    suggestedConnects: 0,
    suggestedBoostConnects: 0,
    connectsStrategy: {
      ...unknownConnectsJob.applicationDraft!.connectsStrategy!,
      decision: "manual_review",
      requiredConnects: null,
      suggestedBoostConnects: 0,
      totalConnects: null,
      sourceBackedConnects: unknownConnectsJob.connects,
      risks: ["Required Connects are unknown from visible source text."],
    },
  };
  const unknownText = buildV3CapturePacket(unknownConnectsJob, {
    upworkUrl: unknownConnectsJob.url,
    captureStatus: "packet_sent",
    jobIntelligence: intelligence,
    autoPrepareNote: "Not auto-preparing because Connects spend needs manual review.",
  }).text;
  assertIncludes(unknownText, "• *Connects:* unknown for now", "missing Connects should render unknown");
  assert(
    /This is relevant|Worth a look|This could be useful/.test(unknownText),
    "borderline lead should sound conversational without fixed boilerplate",
  );
  assertIncludes(unknownText, "*Next:* Reply *“prep it”* if you want me to prepare the draft.", "borderline lead should ask for a clear next action");
  assertNotIncludes(unknownText, "Connects: 0", "missing Connects must not render as zero");
  for (const noisy of ["manual review", "platformEligibility", "lead decision", "packet", "source context", "action id"]) {
    assertNotIncludes(unknownText, noisy, `borderline lead should hide ${noisy}`);
  }

  const badLead = createScoredJob({
    title: "Cheap generic email cleanup",
    budget: "$75 fixed",
    clientSpend: 0,
    clientHireRate: 0,
    clientTotalHires: 0,
    clientFeedbackCount: 0,
    score: 42,
    matchLevel: "skip",
    scoreBreakdown: {
      fitScore: { score: 42, reasons: [], risks: ["Generic scope"] },
      clientQualityScore: { score: 20, reasons: [], risks: ["No client history"] },
      opportunityScore: { score: 25, reasons: [], risks: ["Budget too low"] },
      redFlagScore: { score: 80, reasons: [], risks: [] },
      connectsRiskScore: { score: 30, reasons: [], risks: ["Not worth Connects spend"] },
      finalScore: 42,
      reasons: [],
      risks: ["Low score", "No client spend", "Budget too low"],
    },
  });
  assertEqual(
    shouldPostLeadPacket(badLead, { upworkUrl: badLead.url, captureStatus: "packet_sent", jobIntelligence: intelligence }),
    false,
    "bad lead should stay silent",
  );

  const ineligibleText = buildV3CapturePacket(createScoredJob({
    applicationDraft: {
      ...job.applicationDraft!,
      jobIntelligence: {
        ...intelligence,
        primaryPlatform: "HubSpot",
        platformsMentioned: ["HubSpot"],
        platformPreferenceTier: "non_core_review",
      },
    },
  }), {
    upworkUrl: job.url,
    captureStatus: "packet_sent",
  }).text;
  assertNotIncludes(ineligibleText, "Platform skipped", "no per-job skip Slack packet");

  console.log("slack lead message V3 tests passed");
}

if (require.main === module) {
  runTests().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`slack lead message V3 tests failed: ${message}`);
    process.exitCode = 1;
  });
}
