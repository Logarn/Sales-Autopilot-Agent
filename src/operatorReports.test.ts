import assert from "node:assert/strict";
import {
  answerMonthlyOperatorQuestion,
  buildFridayOperatorHandoff,
  buildMonthlyOperatorReview,
  buildScheduledFridayOperatorHandoff,
  shouldSendFridayHandoff,
  type OperatorReportSnapshot,
} from "./operatorReports";

const snapshot: OperatorReportSnapshot = {
  generatedAt: "2026-06-12T09:00:00.000Z",
  period: {
    label: "Week ending 2026-06-12",
    startIso: "2026-06-06T00:00:00.000Z",
    endIso: "2026-06-13T00:00:00.000Z",
  },
  leadsFound: { value: 42, evidence: "seen_jobs.seen_at" },
  qualifiedLeads: { value: 12, evidence: "seen_jobs.match_level in high/medium" },
  applicationsPrepared: { value: 5, evidence: "applications.generated_at" },
  applicationsSubmitted: { value: 3, evidence: "applications.submitted_at" },
  replies: { value: 1, evidence: "application_events.to_status=replied" },
  interviews: { value: 1, evidence: "application_events.to_status=interview" },
  wins: { value: 0, evidence: "application_events.to_status=hired" },
  losses: { value: 1, evidence: "application_events.to_status=lost" },
  connectsUsed: { value: 54, evidence: "applications.actual_total_connects for submitted_at period" },
  bestSource: {
    label: "Best Matches",
    evidence: "seen_jobs.source_query joined to applications.status",
    detail: "leads=20; qualified=8; positive_outcomes=2",
  },
  bestProof: {
    label: "Fly Boutique retention proof",
    evidence: "application_assets and applications proof/highlight fields",
    detail: "uses=2",
  },
  blockedItems: [
    {
      label: "Klaviyo audit lead",
      evidence: "browser_actions.status=paused",
      detail: "job_id=job-1; updated_at=2026-06-10 09:00:00",
    },
  ],
  lessons: [
    {
      label: "proof_preference: Fly Boutique",
      evidence: "sales_learning_memories evidence_count=4; confidence=high",
      detail: "Use Fly Boutique proof for retention-heavy Klaviyo work.",
    },
  ],
  steveActionItems: [
    {
      label: "Lifecycle email role",
      evidence: "applications.status=approved",
      detail: "manual final submit or outcome marking; job_id=job-2; updated_at=2026-06-11 15:00:00",
    },
  ],
};

assert.equal(shouldSendFridayHandoff(new Date("2026-06-12T09:00:00Z"), "UTC"), true);
assert.equal(shouldSendFridayHandoff(new Date("2026-06-11T09:00:00Z"), "UTC"), false);

const fridayReport = buildScheduledFridayOperatorHandoff(snapshot, new Date("2026-06-12T09:00:00Z"), "UTC");
assert(fridayReport, "Friday schedule should produce a handoff");
assert(fridayReport.includes("Friday Operator Handoff"), "Friday report should identify the handoff");
assert(fridayReport.includes("Leads found: 42 (seen_jobs.seen_at)"), "Friday report should show DB evidence labels");
assert(fridayReport.includes("Final submit remains manual"), "Friday report must preserve final-submit safety");

const thursdayReport = buildScheduledFridayOperatorHandoff(snapshot, new Date("2026-06-11T09:00:00Z"), "UTC");
assert.equal(thursdayReport, null, "Non-Friday schedule should not create daily spam");

const monthly = buildMonthlyOperatorReview(snapshot);
assert(monthly.includes("Monthly Operator Review"), "Monthly review should render");
assert(monthly.includes("Fly Boutique retention proof"), "Monthly review should include proof evidence");

const connects = answerMonthlyOperatorQuestion(snapshot, "How many Connects did we use and waste?");
assert.equal(connects.topic, "connects");
assert(connects.text.includes("54"), "Connects Q&A should use DB-backed metric");

const proof = answerMonthlyOperatorQuestion(snapshot, "What proof is working?");
assert.equal(proof.topic, "proof");
assert(proof.text.includes("Fly Boutique"), "Proof Q&A should answer from best proof evidence");

const source = answerMonthlyOperatorQuestion(snapshot, "Which source was best?");
assert.equal(source.topic, "source");
assert(source.text.includes("Best Matches"), "Source Q&A should answer from best source evidence");

const blocked = answerMonthlyOperatorQuestion(snapshot, "What does Steve need to review?");
assert.equal(blocked.topic, "blocked");
assert(blocked.text.includes("manual final submit"), "Blocked Q&A should include Steve action items");

const emptySnapshot: OperatorReportSnapshot = {
  ...snapshot,
  leadsFound: { value: 0, evidence: "seen_jobs.seen_at" },
  qualifiedLeads: { value: 0, evidence: "seen_jobs.match_level in high/medium" },
  applicationsPrepared: { value: 0, evidence: "applications.generated_at" },
  applicationsSubmitted: { value: 0, evidence: "applications.submitted_at" },
  replies: { value: 0, evidence: "application_events.to_status=replied" },
  interviews: { value: 0, evidence: "application_events.to_status=interview" },
  wins: { value: 0, evidence: "application_events.to_status=hired" },
  losses: { value: 0, evidence: "application_events.to_status=lost" },
  connectsUsed: { value: 0, evidence: "applications.actual_total_connects for submitted_at period" },
  bestSource: null,
  bestProof: null,
  blockedItems: [],
  lessons: [],
  steveActionItems: [],
};
const emptyReport = buildFridayOperatorHandoff(emptySnapshot);
assert(emptyReport.includes("Leads found: 0"), "Missing lead data should be shown as 0");
assert(emptyReport.includes("Unavailable: no source-backed leads"), "Missing source data should be labeled unavailable");
assert(emptyReport.includes("Unavailable: no submitted proof"), "Missing proof data should be labeled unavailable");

console.log("operator reports tests passed");
