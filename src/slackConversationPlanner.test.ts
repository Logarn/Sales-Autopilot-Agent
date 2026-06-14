import assert from "node:assert/strict";
import { planSlackConversation } from "./slackConversationPlanner";
import { buildUnifiedSlackJobContext } from "./slackWorkflowContext";

const baseInput = {
  latestMessage: "",
  threadHistory: [],
  job: {
    id: "job-1",
    title: "Klaviyo lifecycle work for beauty brand",
    score: 88,
    matchLevel: "high",
    scoreBreakdown: { risks: ["Budget is a little unclear"], reasons: [] },
  } as any,
  draft: { proposalText: "Draft text", connectsStrategy: { requiredConnects: 8, suggestedBoostConnects: 0, totalConnects: 8 }, redFlags: [] } as any,
  currentBrowserAction: null,
  missingFiles: ["profile/attachments/design-case-studies-steve-logarn.pdf"],
  proofPlan: {
    files: ["profile/attachments/design-case-studies-steve-logarn.pdf"],
    portfolioHighlights: ["Email design systems"],
    certificates: ["Klaviyo certificate"],
    mentionOnly: ["Dr. Rachael Institute"],
    unavailableOnPage: true,
  },
  connects: { required: 8, boost: 0, total: 8, boostReason: "No boost set." },
  hasSlackFiles: false,
};

function workflow(overrides: Partial<Parameters<typeof buildUnifiedSlackJobContext>[0]> = {}) {
  return buildUnifiedSlackJobContext({
    channelId: "C123",
    threadTs: "111.222",
    latestUserMessage: null,
    threadState: {
      channelId: "C123",
      messageTs: "111.222",
      threadTs: "111.222",
      upworkUrl: "https://www.upwork.com/jobs/~0123456789abcdef",
      jobId: "job-1",
      status: "capture_pending",
    },
    workflowStateRecord: {
      channelId: "C123",
      threadTs: "111.222",
      workflowState: "capture_queued",
      draftRequested: true,
      prepRequested: false,
      latestAgentPromise: {
        type: "capture_draft_proof_plan",
        status: "pending",
        text: "I’ll capture it and come back with the draft/proof plan.",
        createdAt: new Date(0).toISOString(),
      },
      lastUserMessage: "Prep an application for this role: https://www.upwork.com/jobs/~0123456789abcdef",
      lastAgentReply: "Capture is queued.",
    },
    explicitUpworkUrl: "https://www.upwork.com/jobs/~0123456789abcdef",
    job: baseInput.job,
    draft: null,
    proofPlan: baseInput.proofPlan,
    connects: baseInput.connects,
    captureAction: {
      id: 1,
      jobId: "job-1",
      actionType: "capture_job_from_url",
      status: "pending",
      payload: {},
      attempts: 0,
      lastError: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
    prepAction: null,
    latestBrowserAction: null,
    applicationStatus: null,
    ...overrides,
  });
}

const fileQuestion = planSlackConversation({
  ...baseInput,
  latestMessage: "Can you upload the files from here? If you had access?",
});
assert.equal(fileQuestion.intent, "answer_file_capability_question");
assert.equal(fileQuestion.clarificationNeeded, false);
assert(fileQuestion.reply.includes("For reusable proof"));
assert(fileQuestion.reply.includes("attach them in this Slack thread"));
assert(fileQuestion.reply.includes("design-case-studies-steve-logarn.pdf"));
assert(!fileQuestion.reply.includes("Want me to prep it"));

const coverLetter = planSlackConversation({ ...baseInput, latestMessage: "Show me the cover letter you used here." });
assert.equal(coverLetter.intent, "show_cover_letter");
assert(coverLetter.reply.includes("Here’s the cover letter I drafted."));
assert(coverLetter.reply.includes("Draft text"));

const noDraftCoverLetter = planSlackConversation({ ...baseInput, draft: null, latestMessage: "Show me the cover letter you used here." });
assert.equal(noDraftCoverLetter.intent, "show_cover_letter");
assert(noDraftCoverLetter.reply.includes("do not have the generated draft") || noDraftCoverLetter.reply.includes("haven’t generated the cover letter/CV draft yet"));

const frustratedCv = planSlackConversation({ ...baseInput, latestMessage: "Wtf? I just need the CV you used." });
assert.equal(frustratedCv.intent, "show_cover_letter");
assert(frustratedCv.reply.includes("You’re right"));
assert(frustratedCv.reply.includes("Draft text"));
assert(!frustratedCv.reply.includes("I can help with the draft, files, proof, boost, or status."));

const status = planSlackConversation({ ...baseInput, latestMessage: "status" });
assert.equal(status.intent, "status_summary");
assert(status.reply.length < 280, "Default status should be concise.");
assert(!status.reply.includes("Channel message"));
assert(!status.reply.includes("Browser actions:"));

const debug = planSlackConversation({ ...baseInput, latestMessage: "show debug details" });
assert.equal(debug.intent, "debug_details");
assert.equal(debug.debugRequested, true);

const proof = planSlackConversation({ ...baseInput, latestMessage: "what proof are you using?" });
assert.equal(proof.intent, "explain_proof");
assert(proof.reply.includes("Files:"));
assert(proof.reply.includes("Portfolio/profile:"));
assert(proof.reply.includes("Certificates:"));
assert(proof.reply.includes("Mention-only:"));

const boost = planSlackConversation({ ...baseInput, latestMessage: "what about boost?" });
assert.equal(boost.intent, "explain_boost");
assert(boost.reply.includes("No boost"));

const draftPreview = planSlackConversation({ ...baseInput, latestMessage: "show me the draft here first" });
assert.equal(draftPreview.intent, "draft_preview_first");
assert.deepEqual(draftPreview.actions, ["send_draft_preview"]);

const bareDraftReady = planSlackConversation({ ...baseInput, latestMessage: "draft" });
assert.equal(bareDraftReady.intent, "draft_preview_first");
assert.deepEqual(bareDraftReady.actions, ["send_draft_preview"]);

const proposalQuestionReady = planSlackConversation({ ...baseInput, latestMessage: "proposal?" });
assert.equal(proposalQuestionReady.intent, "draft_preview_first");
assert.deepEqual(proposalQuestionReady.actions, ["send_draft_preview"]);

const noTargetDraft = planSlackConversation({ ...baseInput, job: null, draft: null, latestMessage: "can I see the draft?" });
assert.equal(noTargetDraft.intent, "unknown_clarify");
assert.match(noTargetDraft.reply, /job URL/i);

const pendingDraftRequest = planSlackConversation({
  ...baseInput,
  draft: null,
  currentBrowserAction: {
    actionType: "capture_job_from_url",
    status: "pending",
  } as any,
  workflowContext: workflow(),
  latestMessage: "Send me the draft here too once ready.",
});
assert.equal(pendingDraftRequest.intent, "status_summary");
assert.deepEqual(pendingDraftRequest.actions, ["none"]);
assert.match(pendingDraftRequest.reply, /draft is still being generated/i);
assert.doesNotMatch(pendingDraftRequest.reply, /what part/i);

const sendItOnceReady = planSlackConversation({
  ...baseInput,
  draft: null,
  currentBrowserAction: {
    actionType: "capture_job_from_url",
    status: "pending",
  } as any,
  workflowContext: workflow(),
  latestMessage: "Send it once ready.",
});
assert.equal(sendItOnceReady.intent, "status_summary");
assert.doesNotMatch(sendItOnceReady.reply, /final submit stays manual.*not click/i);
assert.doesNotMatch(sendItOnceReady.reply, /what part/i);

const proofRevision = planSlackConversation({ ...baseInput, latestMessage: "Use Truly instead of Fly and add the intro PDF." });
assert.equal(proofRevision.intent, "revise_proof_plan");
assert.deepEqual(proofRevision.actions, ["queue_proof_recheck"]);
assert(!proofRevision.clarificationNeeded);

const everything = planSlackConversation({ ...baseInput, latestMessage: "Everything that needs to be done." });
assert.equal(everything.intent, "prepare_application");
assert.deepEqual(everything.actions, ["queue_prepare_application"]);
assert(everything.reply.includes("all safe prep steps"));
assert(everything.reply.includes("stop before submit"));

const ctaAffirmative = planSlackConversation({
  ...baseInput,
  latestMessage: "Yep, go for it",
  activeCta: {
    action: "prep_application",
    source: "latest_bot_cta",
    text: "Reply prep it if you want me to handle the draft and proof.",
  },
});
assert.equal(ctaAffirmative.intent, "prepare_application");
assert.deepEqual(ctaAffirmative.actions, ["queue_prepare_application"]);
assert(ctaAffirmative.reply.includes("stop before submit"));

const ctaSoundsGood = planSlackConversation({
  ...baseInput,
  latestMessage: "sounds good",
  activeCta: {
    action: "prep_application",
    source: "latest_bot_cta",
    text: "Reply prep it if you want me to handle the draft and proof.",
  },
});
assert.equal(ctaSoundsGood.intent, "prepare_application");

const ctaProceedApplications = planSlackConversation({
  ...baseInput,
  latestMessage: "please proceed with applications",
  activeCta: {
    action: "prep_application",
    source: "latest_bot_cta",
    text: "Reply prep it if you want me to handle the draft and proof.",
  },
});
assert.equal(ctaProceedApplications.intent, "prepare_application");
assert.deepEqual(ctaProceedApplications.actions, ["queue_prepare_application"]);
assert.match(ctaProceedApplications.reply, /stop before submit/i);

const noDraftPrepCapturePending = planSlackConversation({
  ...baseInput,
  latestMessage: "prep it",
  draft: null,
  currentBrowserAction: {
    actionType: "capture_job_from_url",
    status: "pending",
  } as any,
});
assert.equal(noDraftPrepCapturePending.intent, "status_summary");
assert.deepEqual(noDraftPrepCapturePending.actions, ["none"]);
assert.match(noDraftPrepCapturePending.reply, /capture is still running/i);
assert.doesNotMatch(noDraftPrepCapturePending.reply, /stop before submit/i);

const noDraftPrepCaptureFailed = planSlackConversation({
  ...baseInput,
  latestMessage: "prep it",
  draft: null,
  currentBrowserAction: {
    actionType: "capture_job_from_url",
    status: "failed",
  } as any,
});
assert.equal(noDraftPrepCaptureFailed.intent, "status_summary");
assert.deepEqual(noDraftPrepCaptureFailed.actions, ["none"]);
assert.match(noDraftPrepCaptureFailed.reply, /retry capture|send the listing link/i);

const noDraftEverything = planSlackConversation({
  ...baseInput,
  latestMessage: "Everything that needs to be done.",
  draft: null,
  currentBrowserAction: {
    actionType: "capture_job_from_url",
    status: "pending",
  } as any,
});
assert.equal(noDraftEverything.intent, "status_summary");
assert.deepEqual(noDraftEverything.actions, ["none"]);

const threadSpecificStatus = planSlackConversation({
  ...baseInput,
  latestMessage: "Where are we with it?",
  draft: null,
  currentBrowserAction: {
    actionType: "capture_job_from_url",
    status: "pending",
  } as any,
  workflowContext: workflow(),
});
assert.equal(threadSpecificStatus.intent, "status_summary");
assert.match(threadSpecificStatus.reply, /Capture: queued/i);
assert.match(threadSpecificStatus.reply, /Draft: being generated/i);
assert.match(threadSpecificStatus.reply, /Proof plan:/i);
assert.match(threadSpecificStatus.reply, /Next safe action:/i);

const reusedCaptureStatus = planSlackConversation({
  ...baseInput,
  latestMessage: "Where are we with it?",
  workflowContext: workflow({
    draft: baseInput.draft,
    captureAction: {
      id: 44,
      jobId: "job-1",
      actionType: "capture_job_from_url",
      status: "cancelled",
      payload: {},
      attempts: 0,
      lastError: "Stale duplicate capture replaced by Slack thread ownership reconciliation.",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    } as any,
    latestBrowserAction: {
      id: 44,
      jobId: "job-1",
      actionType: "capture_job_from_url",
      status: "cancelled",
      payload: {},
      attempts: 0,
      lastError: "Stale duplicate capture replaced by Slack thread ownership reconciliation.",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    } as any,
  }),
});
assert.equal(reusedCaptureStatus.intent, "status_summary");
assert.match(reusedCaptureStatus.reply, /Capture: done from existing capture/i);
assert.doesNotMatch(reusedCaptureStatus.reply, /Capture: failed/i);
assert.doesNotMatch(reusedCaptureStatus.reply, /Stale duplicate capture|ownership reconciliation/i);

const retryCapture = planSlackConversation({ ...baseInput, draft: null, latestMessage: "retry capture" });
assert.equal(retryCapture.intent, "retry_capture");
assert.deepEqual(retryCapture.actions, ["retry_capture"]);

const noTargetAffirmative = planSlackConversation({ ...baseInput, job: null, draft: null, activeCta: null, latestMessage: "go for it" });
assert.equal(noTargetAffirmative.intent, "unknown_clarify");
assert.equal(noTargetAffirmative.clarificationNeeded, true);
assert.deepEqual(noTargetAffirmative.actions, ["none"]);

const dangerousSubmit = planSlackConversation({ ...baseInput, latestMessage: "send it" });
assert.equal(dangerousSubmit.intent, "status_summary");
assert.deepEqual(dangerousSubmit.actions, ["none"]);
assert.match(dangerousSubmit.reply, /final submit stays manual/i);

const negativeDraftFeedback = planSlackConversation({ ...baseInput, latestMessage: "I don't like the draft" });
assert.equal(negativeDraftFeedback.intent, "revise_draft");
assert.deepEqual(negativeDraftFeedback.actions, ["mark_draft_rejected"]);
assert.match(negativeDraftFeedback.reply, /won.t prep this version/i);

const genericCvFeedback = planSlackConversation({ ...baseInput, latestMessage: "The CV is generic, does not sound researched, and is not in my voice" });
assert.equal(genericCvFeedback.intent, "revise_draft");
assert.deepEqual(genericCvFeedback.actions, ["mark_draft_rejected"]);

const makeItBetterFeedback = planSlackConversation({ ...baseInput, latestMessage: "Make it better, this sounds weak" });
assert.equal(makeItBetterFeedback.intent, "revise_draft");
assert.deepEqual(makeItBetterFeedback.actions, ["mark_draft_rejected"]);

const badAngleFeedback = planSlackConversation({ ...baseInput, latestMessage: "I don't like this angle" });
assert.equal(badAngleFeedback.intent, "revise_draft");
assert.deepEqual(badAngleFeedback.actions, ["mark_draft_rejected"]);

const doNotPrepFeedback = planSlackConversation({
  ...baseInput,
  latestMessage: "Stop. Do not prep this draft. I do not approve this version. Wait.",
  activeCta: {
    action: "prep_application",
    source: "latest_bot_cta",
    text: "Reply \"use this\", \"looks good\", or \"put it in Upwork\" when you want me to fill the remote Chrome apply page.",
  },
});
assert.equal(doNotPrepFeedback.intent, "revise_draft");
assert.deepEqual(doNotPrepFeedback.actions, ["mark_draft_rejected"]);

const rejectedWorkflow = workflow({
  draft: baseInput.draft,
  workflowStateRecord: {
    channelId: "C123",
    threadTs: "111.222",
    workflowState: "draft_ready",
    draftRequested: true,
    prepRequested: false,
    latestAgentPromise: {
      type: "draft_preview",
      status: "blocked",
      text: "Draft preview rejected; waiting for rewrite direction.",
      createdAt: new Date(0).toISOString(),
      blocker: "draft_rejected: operator did not approve this draft.",
    },
    lastUserMessage: "I don't like the draft",
    lastAgentReply: "Got it — I won’t prep this version.",
  },
});
const prepRejectedDraft = planSlackConversation({
  ...baseInput,
  latestMessage: "prep it",
  workflowContext: rejectedWorkflow,
});
assert.equal(prepRejectedDraft.intent, "status_summary");
assert.deepEqual(prepRejectedDraft.actions, ["none"]);
assert.match(prepRejectedDraft.reply, /not approved/i);

const revision = planSlackConversation({ ...baseInput, latestMessage: "change the opener" });
assert.equal(revision.intent, "revise_draft");
assert.deepEqual(revision.actions, ["mark_draft_rejected"]);

const naturalStatus = planSlackConversation({ ...baseInput, latestMessage: "what the fuck are you up to?" });
assert.equal(naturalStatus.intent, "status_summary");

const ambiguous = planSlackConversation({ ...baseInput, latestMessage: "Something else." });
assert.equal(ambiguous.intent, "unknown_clarify");
assert(!ambiguous.reply.includes("I can help with the draft, files, proof, boost, or status."));
assert(!ambiguous.reply.includes("which part you want changed"));

console.log("slack conversation planner tests passed");
