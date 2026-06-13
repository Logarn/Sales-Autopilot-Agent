import assert from "node:assert/strict";
import { IntentParser } from "./conversation/intentParser";
import { ConversationStateManager } from "./conversation/stateMachine";
import { planSlackConversation } from "./slackConversationPlanner";

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
assert(noDraftCoverLetter.reply.includes("I haven’t generated the cover letter/CV draft yet."));

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

const retryCapture = planSlackConversation({ ...baseInput, draft: null, latestMessage: "retry capture" });
assert.equal(retryCapture.intent, "retry_capture");
assert.deepEqual(retryCapture.actions, ["retry_capture"]);

ConversationStateManager.resetAll();
const negatedPrep = planSlackConversation({
  ...baseInput,
  threadTs: "thread-negated-prep",
  latestMessage: "don't prep it",
});
assert.equal(negatedPrep.intent, "banter_no_action");
assert.deepEqual(negatedPrep.actions, ["none"]);
assert.match(negatedPrep.reply, /won't prep/i);
const negatedState = ConversationStateManager.getOrCreate("thread-negated-prep");
assert.equal(negatedState.lastIntent, "banter_no_action");
assert.equal(negatedState.messageCount, 1);

const sequentialState = ConversationStateManager.getOrCreate("thread-sequential-prep");
const parsedSequential = IntentParser.parse("prep it then show me the draft", sequentialState, baseInput.job as any);
assert.equal(parsedSequential.primary, "prep");
assert.equal(parsedSequential.modifiers.then?.[0]?.primary, "show");
assert.equal(parsedSequential.modifiers.then?.[0]?.modifiers.scope, "draft");
const sequentialPrep = planSlackConversation({
  ...baseInput,
  threadTs: "thread-sequential-prep",
  latestMessage: "prep it then show me the draft",
});
assert.equal(sequentialPrep.intent, "prepare_application");
assert.deepEqual(sequentialPrep.actions, ["queue_prepare_application"]);
const sequentialAfterState = ConversationStateManager.getOrCreate("thread-sequential-prep");
assert.equal(sequentialAfterState.activeTask, "in_browser");
assert(sequentialAfterState.pendingDecisions.some((decision) => decision.id === "manual-submit"));

const noTargetAffirmative = planSlackConversation({ ...baseInput, job: null, draft: null, activeCta: null, latestMessage: "go for it" });
assert.equal(noTargetAffirmative.intent, "unknown_clarify");
assert.equal(noTargetAffirmative.clarificationNeeded, true);
assert.deepEqual(noTargetAffirmative.actions, ["none"]);

const dangerousSubmit = planSlackConversation({ ...baseInput, latestMessage: "send it" });
assert.equal(dangerousSubmit.intent, "status_summary");
assert.deepEqual(dangerousSubmit.actions, ["none"]);
assert.match(dangerousSubmit.reply, /final submit stays manual/i);

const naturalStatus = planSlackConversation({ ...baseInput, latestMessage: "what the fuck are you up to?" });
assert.equal(naturalStatus.intent, "status_summary");

const ambiguous = planSlackConversation({ ...baseInput, latestMessage: "Something else." });
assert.equal(ambiguous.intent, "unknown_clarify");
assert(!ambiguous.reply.includes("I can help with the draft, files, proof, boost, or status."));

console.log("slack conversation planner tests passed");
