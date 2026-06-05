import assert from "node:assert/strict";
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
assert(fileQuestion.reply.includes("Attach the PDFs/images in this thread"));
assert(fileQuestion.reply.includes("design-case-studies-steve-logarn.pdf"));
assert(!fileQuestion.reply.includes("Want me to prep it"));

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

console.log("slack conversation planner tests passed");
