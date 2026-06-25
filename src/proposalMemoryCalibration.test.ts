import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

function cleanupPath(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

function scoreBreakdown(finalScore = 90): any {
  return {
    fitScore: { score: finalScore, reasons: ["Klaviyo fit"], risks: [] },
    clientQualityScore: { score: finalScore, reasons: [], risks: [] },
    opportunityScore: { score: finalScore, reasons: [], risks: [] },
    redFlagScore: { score: finalScore, reasons: [], risks: [] },
    connectsRiskScore: { score: finalScore, reasons: [], risks: [] },
    finalScore,
    reasons: ["Klaviyo fit"],
    risks: [],
  };
}

function jobFixture(input: { id: string; title: string; description: string; skills: string[]; sourceQuery?: string }): any {
  return {
    id: input.id,
    title: input.title,
    url: `https://www.upwork.com/jobs/~${input.id}`,
    description: input.description,
    postedAt: new Date(0).toISOString(),
    budget: "$75/hr",
    clientCountry: "US",
    clientRating: 5,
    clientSpend: 25000,
    clientHireRate: 90,
    clientTotalHires: 12,
    clientFeedbackCount: 8,
    category: "Email Marketing",
    experienceLevel: "Expert",
    connectsCost: 8,
    skills: input.skills,
    sourceQuery: input.sourceQuery ?? "klaviyo shopify",
    proposalCount: 10,
    competitionLevel: "medium",
    score: 92,
    matchLevel: "high",
    matchedKeywords: input.skills,
    negativeKeywords: [],
    scoreBreakdown: scoreBreakdown(92),
  };
}

function draftFixture(job: any, proposalText: string): any {
  return {
    jobId: job.id,
    status: "draft",
    fitScore: 92,
    fitReasons: ["Klaviyo fit"],
    redFlags: [],
    suggestedBid: "$75/hr",
    suggestedConnects: 8,
    suggestedBoostConnects: 0,
    connectsWarnings: [],
    selectedPortfolioItems: [],
    proposalQuality: { score: 90, issues: [], positiveSignals: [], wordCount: proposalText.split(/\s+/).length },
    proposalText,
    generatedAt: new Date(0).toISOString(),
  };
}

async function run(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-proposal-memory-calibration/jobs.db");
  cleanupPath(dirname(tempDb));
  process.env.DB_PATH = tempDb;

  const {
    closeDb,
    markJobSeen,
    recordProposalVersion,
    saveApplicationDraft,
    updateApplicationStatus,
  } = require("./db") as {
    closeDb: () => void;
    markJobSeen: (job: any, notified: boolean) => void;
    recordProposalVersion: (input: any) => unknown;
    saveApplicationDraft: (draft: any) => void;
    updateApplicationStatus: (jobId: string, status: string, note?: string) => boolean;
  };
  const { buildProposalMemoryCalibrationContext } = require("./proposalMemoryCalibration") as {
    buildProposalMemoryCalibrationContext: (input: any) => any;
  };

  try {
    const positiveJob = jobFixture({
      id: "hist-positive-klaviyo",
      title: "Klaviyo post-purchase flow cleanup for Shopify skincare brand",
      description: "We need Klaviyo post-purchase and replenishment flows audited for a Shopify skincare store.",
      skills: ["Klaviyo", "Shopify", "Email Marketing"],
    });
    const negativeJob = jobFixture({
      id: "hist-negative-klaviyo",
      title: "Klaviyo welcome flow rewrite for Shopify supplement brand",
      description: "Rewrite Klaviyo welcome and abandoned checkout emails for Shopify supplements.",
      skills: ["Klaviyo", "Shopify", "Copywriting"],
    });
    const unrelatedJob = jobFixture({
      id: "hist-unrelated-mailchimp",
      title: "Mailchimp newsletter for local nonprofit",
      description: "Create a Mailchimp newsletter calendar for a nonprofit membership drive.",
      skills: ["Mailchimp", "Newsletter"],
      sourceQuery: "mailchimp newsletter",
    });

    for (const job of [positiveJob, negativeJob, unrelatedJob]) {
      markJobSeen(job, false);
    }
    saveApplicationDraft(draftFixture(positiveJob, "Draft that opened on the post-purchase revenue leak and named Klaviyo/Shopify."));
    recordProposalVersion({
      jobId: positiveJob.id,
      source: "final_submitted",
      proposalText: "Your post-purchase flow is probably leaking second orders before the replenishment moment arrives. I’d start by mapping the Shopify purchase path into Klaviyo, then tighten the first 3-day diagnostic around the highest-intent buyers instead of rewriting every email at once. This keeps the scope small while proving where the repeat-purchase lift is likely to come from.",
      note: "Approved by operator and submitted.",
    });
    updateApplicationStatus(positiveJob.id, "replied", "Client replied after submitted proposal.");

    saveApplicationDraft(draftFixture(negativeJob, "Rejected draft that sounded generic despite mentioning Klaviyo."));
    recordProposalVersion({
      jobId: negativeJob.id,
      source: "slack_revision",
      proposalText: "Hi there, I am a perfect fit for your Klaviyo project and have a proven track record. I can help with all of your Shopify emails and tailor everything to your needs. Let me know when you are free to chat about the work.",
      note: "Operator rejected as generic canned Upwork positioning.",
    });
    updateApplicationStatus(negativeJob.id, "rejected", "Operator rejected the draft revision.");

    saveApplicationDraft(draftFixture(unrelatedJob, "Mailchimp newsletter calendar draft."));
    recordProposalVersion({
      jobId: unrelatedJob.id,
      source: "final_submitted",
      proposalText: "The membership calendar needs a clean monthly rhythm in Mailchimp.",
    });
    updateApplicationStatus(unrelatedJob.id, "hired", "Successful but unrelated historical proposal.");

    const calibration = buildProposalMemoryCalibrationContext({
      title: "Klaviyo retention flow audit for Shopify skincare store",
      description: "Need post-purchase and replenishment flow improvements in Klaviyo for Shopify.",
      skills: ["Klaviyo", "Shopify"],
      platform: "Klaviyo",
      excludeJobId: "current-job",
      limitPerPolarity: 2,
    });

    assert.equal(calibration.positiveExamples.length, 1, "should return one similar positive example and ignore unrelated wins");
    assert.equal(calibration.positiveExamples[0].jobId, positiveJob.id);
    assert.equal(calibration.positiveExamples[0].status, "replied");
    assert.equal(calibration.positiveExamples[0].source, "final_submitted");
    assert(calibration.positiveExamples[0].excerpt.length <= 360, "positive excerpt should be compact, not raw full text");
    assert(calibration.positiveExamples[0].matchedSignals.some((signal: string) => /klaviyo|shopify/i.test(signal)), "positive match should expose matched signals");

    assert.equal(calibration.negativeExamples.length, 1, "should return rejected similar proposal as anti-example");
    assert.equal(calibration.negativeExamples[0].jobId, negativeJob.id);
    assert.equal(calibration.negativeExamples[0].status, "rejected");
    assert.match(calibration.negativeExamples[0].guidance, /anti-example/i);
    assert(!JSON.stringify(calibration).includes(unrelatedJob.id), "unrelated historical wins should not be included just because outcome was strong");
  } finally {
    closeDb();
    cleanupPath(dirname(tempDb));
  }

  console.log("proposal memory calibration tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
