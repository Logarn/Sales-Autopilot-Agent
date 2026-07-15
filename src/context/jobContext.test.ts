import assert from "node:assert/strict";
import { deriveCaptureThreadJobId } from "../browserCapture";
import { JobContextManager } from "./jobContext";

const upworkUrl = "https://www.upwork.com/jobs/~022054888888888888888";
const captureJobId = deriveCaptureThreadJobId(upworkUrl, "022054888888888888888");

function makeDeps(overrides: Record<string, unknown> = {}) {
  const defaults = {
    getApplicationDraft: () => null,
    getApplicationJobLink: () => null,
    getApplicationProofPlanOverrides: () => null,
    getBrowserActionById: () => null,
    getScoredJobForSlackPreview: () => null,
    getSlackThreadStateByJobId: () => null,
    getSlackThreadStateByThreadTs: () => null,
    listBrowserActions: () => [],
    buildBrowserApplyPlan: () => ({
      plan: null,
      valid: false,
      issues: [{
        severity: "error",
        code: "application_draft_missing",
        message: "No draft exists yet.",
      }],
    }),
    buildSalesLearningPromptContext: () => ({
      relevantMemories: [],
      guidance: ["Use memories as hypotheses."],
    }),
  };
  return { ...defaults, ...overrides } as any;
}

const pendingCaptureAction = {
  id: 77,
  jobId: captureJobId,
  actionType: "capture_job_from_url",
  status: "pending",
  payload: {
    url: upworkUrl,
    canonicalJobUrl: upworkUrl,
    capturedConnects: {
      requiredConnects: 12,
      boostConnects: null,
      totalConnects: 12,
      confidence: "high",
      sourceText: "12 Connects required",
      sourceLocation: "job_page_visible_text",
      extractionMethod: "visible_text",
    },
  },
  attempts: 0,
  lastError: null,
  createdAt: "2026-06-13T00:00:00.000Z",
  updatedAt: "2026-06-13T00:00:00.000Z",
};

const managerForPendingCapture = new JobContextManager(makeDeps({
  getSlackThreadStateByThreadTs: () => ({
    channelId: "C123",
    messageTs: "111.000",
    threadTs: "111.000",
    upworkUrl,
    jobId: null,
    status: "capture_pending",
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
  }),
  listBrowserActions: () => [pendingCaptureAction],
}));

const pendingCaptureContext = managerForPendingCapture.buildForThread("C123", "111.000");
assert.equal(pendingCaptureContext.buildSource, "slack_thread");
assert.equal(pendingCaptureContext.jobId, captureJobId);
assert.equal(pendingCaptureContext.upworkUrl, upworkUrl);
assert.equal(pendingCaptureContext.latestBrowserAction?.id, 77);
assert.equal(pendingCaptureContext.conversationState.activeTask, "awaiting_capture");
assert.equal(pendingCaptureContext.connectsStatus.known, true);
assert.equal(pendingCaptureContext.connectsStatus.level, "browser_action_payload");
assert.equal(pendingCaptureContext.connectsStatus.required, 12);
assert.equal(pendingCaptureContext.connectsStatus.confidence, "high");
assert(!pendingCaptureContext.conversationState.informationGaps.includes("connects"));
assert(pendingCaptureContext.conversationState.informationGaps.includes("draft"));

const job = {
  id: "job-123",
  title: "Klaviyo lifecycle audit for beauty brand",
  url: upworkUrl,
  description: "We sell skincare and need Klaviyo flows fixed before our next product launch.",
  score: 88,
  matchLevel: "high",
  matchedKeywords: ["klaviyo", "beauty"],
  negativeKeywords: [],
  scoreBreakdown: {
    reasons: ["Strong DTC lifecycle fit."],
    risks: [],
    connectsStrategy: {
      decision: "safe_apply",
      requiredConnects: 10,
      suggestedBoostConnects: 0,
      totalConnects: 10,
      expectedValueScore: 80,
      reasons: ["Estimated from job card."],
      risks: [],
    },
  },
  budget: "$1,000",
  clientCountry: "United States",
  clientRating: 5,
  clientSpend: 20000,
  clientHireRate: 80,
  skills: ["Klaviyo", "Shopify"],
  experienceLevel: "Expert",
  connectsCost: 10,
  sourceQuery: "manual-slack",
};

const draft = {
  jobId: "job-123",
  status: "draft",
  proposalText: "Your skincare buyers are not just buying a product; they are trying to trust a routine.",
  selectedPortfolioItems: [{ name: "Beauty lifecycle retention case study" }],
  jobIntelligence: { primaryPlatform: "Klaviyo", confidence: "high" },
  jobUnderstanding: {
    jobTitle: job.title,
    fullJobDescription: job.description,
    actualJobRequest: "Fix Klaviyo lifecycle flows.",
    clientBusiness: "Skincare brand",
    customerType: "Beauty shoppers",
    commercialPain: "Lifecycle leaks before launch.",
    emotionalPain: "Buyers need trust before replenishing.",
    likelyLifecycleOrConversionLeak: "Routine education and replenishment timing.",
    desiredOutcome: "More repeat purchases.",
    requestedTools: ["Klaviyo"],
    requestedDeliverables: ["Audit", "Flows"],
    unknowns: [],
  },
  copyStrategy: {
    one_sentence_sales_argument: "Tighten trust and replenishment logic before talking tools.",
  },
  proofStrategy: {
    selectedProofNames: ["Beauty lifecycle retention case study"],
    selectedAttachmentPaths: [],
    selectedPortfolioHighlights: ["Beauty lifecycle retention case study"],
    proofVerificationState: "verified",
    summary: "Use beauty lifecycle proof only.",
    warnings: [],
  },
  draftQualityGate: {
    ready: true,
    skillLoaded: true,
    fullJobDescriptionRead: true,
    copyStrategyCreated: true,
    finalSubmitManual: true,
    issues: [],
  },
  skillUseTrace: {
    jobId: "job-123",
    selectedSkills: [{ name: "proposal-copywriting" }],
    missingRequiredSkills: [],
    jobDescriptionLength: job.description.length,
    captureConfidence: "high",
    invocationOrder: ["job_understanding", "proposal-copywriting"],
    brandFactPackSummary: "Category-only beauty context.",
    copyStrategySummary: "Trust and replenishment logic.",
    proofStrategySummary: "Beauty lifecycle proof.",
    brandResearchProvider: "disabled",
    brandResearchSourceCount: 0,
    qualityGateReady: true,
    browserFillAllowed: true,
    createdAt: "2026-06-13T00:00:00.000Z",
  },
  connectsStrategy: {
    decision: "safe_apply",
    requiredConnects: 16,
    suggestedBoostConnects: 0,
    totalConnects: 16,
    expectedValueScore: 82,
    sourceBackedConnects: {
      requiredConnects: 16,
      boostConnects: null,
      totalConnects: 16,
      confidence: "medium",
      sourceText: "16 Connects required",
      sourceLocation: "captured_job_description",
      extractionMethod: "visible_text",
    },
    reasons: ["Source-backed Connects captured."],
    risks: [],
  },
};

const plan = {
  jobId: "job-123",
  highlights: ["Beauty lifecycle retention case study"],
  mentionOnlyProof: ["Klaviyo certification"],
  missingLocalAssets: [],
  connects: {
    required: 16,
    boost: 0,
    total: 16,
    approvalRequired: false,
    notes: ["Source-backed Connects captured."],
  },
  connectsStrategy: draft.connectsStrategy,
  connectsEvidence: ["16 Connects required"],
};

const managerForDraftedJob = new JobContextManager(makeDeps({
  getScoredJobForSlackPreview: () => job,
  getApplicationDraft: () => draft,
  getApplicationJobLink: () => ({ jobId: "job-123", url: upworkUrl, createdAt: "2026-06-13T00:00:00.000Z" }),
  getSlackThreadStateByJobId: () => ({
    channelId: "C123",
    messageTs: "222.000",
    threadTs: "222.000",
    upworkUrl,
    jobId: "job-123",
    status: "draft_preview_sent",
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
  }),
  buildBrowserApplyPlan: () => ({ plan, valid: true, issues: [] }),
  buildSalesLearningPromptContext: (input: any) => ({
    relevantMemories: [{
      type: "proposal_style",
      scope: "global",
      subject: input.jobId,
      hypothesis: input.text.includes("Lifecycle leaks") ? "Lead with lifecycle leak." : "No context.",
      confidence: "medium",
      evidenceCount: 2,
      status: "active",
      updatedAt: "2026-06-13T00:00:00.000Z",
    }],
    guidance: ["Use memories as hypotheses."],
  }),
}));

const draftedContext = managerForDraftedJob.buildForJob("job-123");
assert.equal(draftedContext.buildSource, "job_id");
assert.equal(draftedContext.jobId, "job-123");
assert.equal(draftedContext.conversationState.activeTask, "awaiting_prep_decision");
assert.equal(draftedContext.connectsStatus.known, true);
assert.equal(draftedContext.connectsStatus.level, "source_backed_draft");
assert.equal(draftedContext.connectsStatus.required, 16);
assert.equal(draftedContext.proofState.selectedPortfolioItems[0], "Beauty lifecycle retention case study");
assert.equal(draftedContext.proofState.proofStrategySummary, "Use beauty lifecycle proof only.");
assert.equal(draftedContext.proofState.browserHighlights[0], "Beauty lifecycle retention case study");
assert.equal(draftedContext.skillUseTrace?.invocationOrder[1], "proposal-copywriting");
assert.equal(draftedContext.qualityGate?.ready, true);
assert(!draftedContext.conversationState.informationGaps.includes("draft"));
assert(!draftedContext.conversationState.informationGaps.includes("connects"));
assert(!draftedContext.conversationState.informationGaps.includes("copy_strategy"));
assert.equal(draftedContext.salesLearning.relevantMemories[0]?.hypothesis, "Lead with lifecycle leak.");

console.log("job context tests passed");
