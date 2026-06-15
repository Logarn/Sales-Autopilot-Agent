import assert from "node:assert/strict";

import { analyzeApplyPageSnapshot, type ApplyPageSnapshot } from "./browser/applyPageAnalyzer";
import type { BrowserApplyFillPlan } from "./types";

function snapshot(overrides: Partial<ApplyPageSnapshot> = {}): ApplyPageSnapshot {
  return {
    url: "https://www.upwork.com/ab/proposals/job/~0123456789abcdef/apply/",
    title: "Submit a proposal - Upwork",
    visibleText: "",
    inputValues: [],
    fieldValues: [],
    checkedLabels: [],
    fileNames: [],
    actionLabels: [],
    ...overrides,
  };
}

function plan(overrides: Partial<BrowserApplyFillPlan> = {}): BrowserApplyFillPlan {
  return {
    schemaVersion: "1.0",
    jobId: "job-1",
    jobTitle: "Klaviyo lifecycle help",
    sourceUrl: "https://www.upwork.com/jobs/~0123456789abcdef",
    applyUrl: "https://www.upwork.com/ab/proposals/job/~0123456789abcdef/apply/",
    status: "approved",
    profile: "Default Upwork profile",
    rate: "$80/hr",
    coverLetter: "I can help rebuild the Klaviyo lifecycle flow map and prioritize the highest revenue leaks first.",
    screeningAnswers: ["I would start with an audit and then sequence the fixes by revenue impact."],
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
    connects: {
      required: 8,
      boost: 0,
      total: 8,
      approvalRequired: false,
      notes: [],
    },
    connectsStrategy: {
      decision: "safe_apply",
      requiredConnects: 8,
      suggestedBoostConnects: 0,
      totalConnects: 8,
      expectedValueScore: 82,
      reasons: [],
      risks: [],
    },
    stopBeforeSubmit: true,
    dryRunSafe: true,
    validationIssues: [],
    createdAt: new Date("2026-06-14T00:00:00.000Z").toISOString(),
    ...overrides,
  };
}

const filledPlan = plan();
const visibleReady = analyzeApplyPageSnapshot(snapshot({
  visibleText: [
    "Proposal settings",
    "Required for proposal: 8 Connects",
    "Boost your proposal",
    "#1 bid 30 Connects",
    "#2 bid 18 Connects",
    "Cover letter",
    "Screening questions",
    "Hourly rate",
    "Send for 8 Connects",
  ].join("\n"),
  fieldValues: [
    {
      kind: "textarea",
      inputType: null,
      label: "Cover letter",
      id: "cover",
      name: "coverLetter",
      ariaLabel: "Cover letter",
      placeholder: null,
      dataTest: null,
      value: filledPlan.coverLetter,
    },
    {
      kind: "textarea",
      inputType: null,
      label: "Question 1",
      id: "question-1",
      name: "question-1",
      ariaLabel: "Question 1 answer",
      placeholder: null,
      dataTest: null,
      value: filledPlan.screeningAnswers[0],
    },
    {
      kind: "input",
      inputType: "text",
      label: "Hourly rate",
      id: "rate",
      name: "hourlyRate",
      ariaLabel: "Hourly rate",
      placeholder: null,
      dataTest: "currency-input",
      value: "80",
    },
  ],
  actionLabels: ["Send for 8 Connects"],
}), filledPlan);

assert.equal(visibleReady.pageKind, "apply");
assert.equal(visibleReady.ready, true);
assert.equal(visibleReady.connects.value, 8, "visible required Connects should be recorded");
assert.equal(visibleReady.boost.visible, true, "visible boost table should be recorded");
assert.equal(visibleReady.boost.state, "visible_table_only", "boost table visibility must not imply a selected boost");
assert.equal(visibleReady.coverLetter.state, "visible_filled");
assert.equal(visibleReady.screening.answeredCount, 1);
assert.equal(visibleReady.rate.state, "visible_filled");
assert.equal(visibleReady.finalSubmit.visible, true, "final submit should be detected without clicking");
assert.equal(visibleReady.finalSubmit.clicked, false);

const unreadableConnects = analyzeApplyPageSnapshot(snapshot({
  visibleText: "Cover letter\nHourly rate\nSend proposal",
  fieldValues: [
    { kind: "textarea", inputType: null, label: "Cover letter", id: null, name: null, ariaLabel: null, placeholder: null, dataTest: null, value: filledPlan.coverLetter },
    { kind: "input", inputType: "text", label: "Hourly rate", id: null, name: null, ariaLabel: "Hourly rate", placeholder: null, dataTest: null, value: "80" },
  ],
  actionLabels: ["Send proposal"],
}), filledPlan);
assert.equal(unreadableConnects.pageKind, "apply");
assert.equal(unreadableConnects.connects.visible, false);
assert(unreadableConnects.blockers.includes("required_connects_unreadable"), "unreadable Connects must block ready status");
assert.equal(unreadableConnects.ready, false);

const selectedBoost = analyzeApplyPageSnapshot(snapshot({
  visibleText: "Required for proposal: 8 Connects\nBoost your proposal\nSend for 8 Connects",
  fieldValues: [
    { kind: "textarea", inputType: null, label: "Cover letter", id: null, name: null, ariaLabel: null, placeholder: null, dataTest: null, value: filledPlan.coverLetter },
    { kind: "input", inputType: "text", label: "Hourly rate", id: null, name: null, ariaLabel: "Hourly rate", placeholder: null, dataTest: null, value: "80" },
    { kind: "input", inputType: "number", label: "Bid to boost", id: null, name: "boost", ariaLabel: "Bid to boost", placeholder: null, dataTest: null, value: "12" },
  ],
  actionLabels: ["Send for 8 Connects"],
}), plan({ connects: { ...filledPlan.connects, boost: 12, total: 20 } }));
assert.equal(selectedBoost.boost.state, "visible_set");
assert.equal(selectedBoost.boost.selectedValue, 12);

const unknownPage = analyzeApplyPageSnapshot(snapshot({
  url: "https://www.upwork.com/nx/find-work/best-matches",
  title: "Best Matches",
  visibleText: "Find work feed",
}), filledPlan);
assert.equal(unknownPage.pageKind, "unknown");
assert.equal(unknownPage.ready, false);
assert(unknownPage.blockers.includes("unknown_apply_page_structure"), "unknown page structure must fail closed");

const challengePage = analyzeApplyPageSnapshot(snapshot({
  title: "Just a moment...",
  visibleText: "Checking if the site connection is secure",
}), filledPlan);
assert.equal(challengePage.pageKind, "security_challenge");
assert.equal(challengePage.ready, false);
assert(challengePage.blockers.includes("browser_security_challenge"), "security/challenge page must block prep");

const noSubmit = analyzeApplyPageSnapshot(snapshot({
  visibleText: "Required for proposal: 8 Connects\nCover letter\nHourly rate",
  fieldValues: [
    { kind: "textarea", inputType: null, label: "Cover letter", id: null, name: null, ariaLabel: null, placeholder: null, dataTest: null, value: filledPlan.coverLetter },
    { kind: "input", inputType: "text", label: "Hourly rate", id: null, name: null, ariaLabel: "Hourly rate", placeholder: null, dataTest: null, value: "80" },
  ],
}), plan({ screeningAnswers: [] }));
assert.equal(noSubmit.finalSubmit.visible, false);
assert(noSubmit.blockers.includes("final_submit_control_not_detected"), "missing final submit control must block ready status");

console.log("browser apply page analyzer tests passed");
