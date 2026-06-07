import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

function cleanupPath(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-proposal-versioning/jobs.db");
  cleanupPath(dirname(tempDb));
  process.env.DB_PATH = tempDb;

  const {
    closeDb,
    getApplicationStatus,
    listProposalVersions,
    listScreeningCoverage,
    markJobSeen,
    recordProposalVersion,
    saveApplicationDraft,
  } = require("./db") as {
    closeDb: () => void;
    getApplicationStatus: (jobId: string) => string | null;
    listProposalVersions: (jobId: string) => Array<{ source: string; label: string; proposalText: string; screeningAnswers: string[] }>;
    listScreeningCoverage: (jobId: string) => Array<{ questionIndex: number; filledAnswer: string | null; verifiedAnswer: string | null; humanEditedAnswer: string | null; finalAnswer: string | null; status: string }>;
    markJobSeen: (job: any, notified: boolean) => void;
    recordProposalVersion: (input: { jobId: string; source: string; proposalText: string; screeningAnswers?: string[]; note?: string | null }) => unknown;
    saveApplicationDraft: (draft: any) => void;
  };
  const { persistApplicationSnapshot } = require("./browserWorker") as {
    persistApplicationSnapshot: (input: { jobId: string; snapshot: any; plan: any; source: string; note?: string | null; markSubmittedAfterCapture?: boolean }) => { ok: boolean; label?: string; fallbackReason?: string };
  };

  const jobId = "proposal-versioning-test";
  const generatedDraft = "Original generated cover letter.\n\nKeep this exact.";
  const plannedAnswer = "I would audit the flow and fix the revenue leak first.";
  const plan = {
    schemaVersion: "1.0",
    jobId,
    jobTitle: "Klaviyo lifecycle cleanup",
    sourceUrl: "https://www.upwork.com/jobs/~versioning",
    applyUrl: "https://www.upwork.com/jobs/~versioning",
    status: "draft",
    profile: "Steve",
    rate: "$75",
    coverLetter: generatedDraft,
    screeningAnswers: [plannedAnswer],
    attachments: [],
    skippedAttachments: [],
    manualReviewAssets: [],
    mentionOnlyProof: [],
    proofAvailability: [],
    figmaRecommendations: [],
    videoRecommendations: [],
    manualReviewWarnings: [],
    missingLocalAssets: [],
    highlights: [],
    connects: { required: 8, boost: 0, total: 8, approvalRequired: false, notes: [] },
    connectsStrategy: {
      requiredConnects: 8,
      suggestedBoostConnects: 0,
      totalConnects: 8,
      expectedValueScore: 80,
      decision: "safe_apply",
      reasons: [],
      warnings: [],
    },
    stopBeforeSubmit: true,
    dryRunSafe: true,
    validationIssues: [],
    createdAt: new Date(0).toISOString(),
  };

  try {
    markJobSeen({
      id: jobId,
      title: "Klaviyo lifecycle cleanup",
      url: plan.applyUrl,
      description: "Clean up Klaviyo lifecycle flows.",
      postedAt: new Date(0).toISOString(),
      budget: "$75/hr",
      clientCountry: "US",
      clientRating: 5,
      clientSpend: 10000,
      clientHireRate: 90,
      clientTotalHires: 10,
      clientFeedbackCount: 5,
      category: "Email Marketing",
      experienceLevel: "Expert",
      connectsCost: 8,
      skills: ["Klaviyo"],
      sourceQuery: "test",
      score: 90,
      matchLevel: "high",
      matchedKeywords: ["Klaviyo"],
      negativeKeywords: [],
      scoreBreakdown: {
        fitScore: { score: 90, max: 100, reasons: ["Klaviyo fit"], risks: [] },
        clientQualityScore: { score: 90, max: 100, reasons: [], risks: [] },
        opportunityScore: { score: 90, max: 100, reasons: [], risks: [] },
        redFlagScore: { score: 100, max: 100, reasons: [], risks: [] },
        connectsRiskScore: { score: 90, max: 100, reasons: [], risks: [] },
        finalScore: 90,
        reasons: ["Klaviyo fit"],
        risks: [],
      },
    }, false);

    saveApplicationDraft({
      jobId,
      status: "draft",
      fitScore: 90,
      fitReasons: ["Klaviyo fit"],
      redFlags: [],
      suggestedBid: "$75",
      suggestedConnects: 8,
      suggestedBoostConnects: 0,
      connectsWarnings: [],
      selectedPortfolioItems: [],
      proposalQuality: { score: 90, issues: [], positiveSignals: [], wordCount: 8 },
      proposalText: generatedDraft,
      structuredProposal: {
        opening: "Original generated cover letter.",
        diagnosis: "Revenue leak.",
        proof: "Fly Boutique.",
        clientRequestAnswers: [plannedAnswer],
        rateRetainerAnswer: "$75",
        cta: "I can start this week.",
        suggestedAttachments: [],
        suggestedHighlights: [],
        browserFillNotes: {
          approvedText: generatedDraft,
          profileNotes: [],
          rate: "$75",
          attachments: [],
          highlights: [],
          connectsPlan: "8 required, no boost.",
        },
      },
      generatedAt: new Date(0).toISOString(),
    });

    const initial = listProposalVersions(jobId);
    assert.equal(initial.length, 1, "Draft save should persist draft_v1.");
    assert.equal(initial[0]?.source, "draft_generated");

    const slackPreviewText = "  Slack preview keeps exact whitespace.\n\nDo not trim me.  ";
    recordProposalVersion({ jobId, source: "slack_preview", proposalText: slackPreviewText, screeningAnswers: [plannedAnswer], note: "Slack preview shown before filling Upwork." });
    const preview = listProposalVersions(jobId).find((version) => version.source === "slack_preview");
    assert.equal(preview?.proposalText, slackPreviewText, "Slack preview version should preserve exact draft text.");

    const insertedSnapshot = {
      url: plan.applyUrl,
      visibleText: "Apply page",
      inputValues: [generatedDraft, plannedAnswer],
      fieldValues: [
        { kind: "textarea", label: "Cover Letter", name: "cover", ariaLabel: "Cover Letter", placeholder: "Cover letter", value: generatedDraft },
        { kind: "textarea", label: "Question 1", name: "question-1", ariaLabel: "Question 1", placeholder: "Answer", value: plannedAnswer },
      ],
      checkedLabels: [],
      fileNames: [],
    };
    const inserted = persistApplicationSnapshot({ jobId, snapshot: insertedSnapshot, plan, source: "upwork_inserted", note: "Verified Upwork inserted text." });
    assert(inserted.ok, `Expected upwork_inserted snapshot to persist: ${inserted.fallbackReason ?? ""}`);
    assert(listProposalVersions(jobId).some((version) => version.source === "upwork_inserted" && version.proposalText === generatedDraft), "Inserted Upwork draft should create an upwork_inserted version.");
    assert.equal(listScreeningCoverage(jobId)[0]?.filledAnswer, plannedAnswer, "Upwork inserted snapshot should track filled screening answer.");
    assert.equal(listScreeningCoverage(jobId)[0]?.status, "filled", "Upwork inserted snapshot should mark screening answer filled.");

    const wrongLongestValue = "This screening answer is intentionally much longer than the cover letter and must not be captured as the CV used.";
    const editedCover = "Steve edited exact cover.\n\nThis is the version from the remote Chrome cover letter field.";
    const editedAnswer = "Steve edited answer.";
    const humanEdit = persistApplicationSnapshot({
      jobId,
      plan,
      source: "human_edit_reread",
      note: "Steve edited it; re-read the draft.",
      snapshot: {
        url: plan.applyUrl,
        visibleText: "Apply page after edit",
        inputValues: [wrongLongestValue, editedCover, editedAnswer],
        fieldValues: [
          { kind: "textarea", label: "Screening question", name: "question-1", ariaLabel: "Question 1", placeholder: "Answer", value: wrongLongestValue },
          { kind: "textarea", label: "Cover Letter", name: "cover", ariaLabel: "Cover Letter", placeholder: "Cover letter", value: editedCover },
          { kind: "textarea", label: "Question 1", name: "question-1", ariaLabel: "Question 1", placeholder: "Answer", value: editedAnswer },
        ],
        checkedLabels: [],
        fileNames: [],
      },
    });
    assert(humanEdit.ok, `Expected human edit readback to persist: ${humanEdit.fallbackReason ?? ""}`);
    const humanEditVersion = listProposalVersions(jobId).find((version) => version.source === "human_edit_reread");
    assert.equal(humanEditVersion?.proposalText, editedCover, "Human edit readback should capture the cover letter field, not the longest input.");
    assert.equal(listScreeningCoverage(jobId)[0]?.humanEditedAnswer, editedAnswer, "Human-edited screening answer should be stored.");
    assert.equal(listScreeningCoverage(jobId)[0]?.status, "edited", "Human edit readback should mark screening answer edited.");

    const final = persistApplicationSnapshot({
      jobId,
      plan,
      source: "final_submitted",
      markSubmittedAfterCapture: true,
      note: "Steve said submitted; capture final text.",
      snapshot: {
        url: plan.applyUrl,
        visibleText: "Submitted page",
        inputValues: [editedCover, editedAnswer],
        fieldValues: [
          { kind: "textarea", label: "Cover Letter", name: "cover", ariaLabel: "Cover Letter", placeholder: "Cover letter", value: editedCover },
          { kind: "textarea", label: "Question 1", name: "question-1", ariaLabel: "Question 1", placeholder: "Answer", value: editedAnswer },
        ],
        checkedLabels: [],
        fileNames: [],
      },
    });
    assert(final.ok, `Expected final submitted capture to persist: ${final.fallbackReason ?? ""}`);
    assert.equal(getApplicationStatus(jobId), "submitted", "Submitted capture should mark local application status submitted after Steve manually sent it.");
    assert.equal(listScreeningCoverage(jobId)[0]?.finalAnswer, editedAnswer, "Final submitted capture should store final screening answer.");
    assert.equal(listScreeningCoverage(jobId)[0]?.status, "verified", "Final submitted capture should mark screening coverage verified.");
  } finally {
    closeDb();
    cleanupPath(dirname(tempDb));
  }
}

run()
  .then(() => {
    console.log("proposal versioning tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
