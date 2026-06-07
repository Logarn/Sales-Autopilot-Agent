import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

function cleanupDatabase(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore cleanup failures
    }
  }
  const dir = dirname(path);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runTests(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-self-improvement-versioning/jobs.db");
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;

  const {
    closeDb,
    listImprovementCandidates,
    listPromptToolVersions,
    listSelfImprovementEvals,
  } = require("./db") as {
    closeDb: () => void;
    listImprovementCandidates: (limit?: number) => Array<{ candidateType: string; status: string; shippedAt: string | null; metadata: Record<string, unknown> }>;
    listPromptToolVersions: (limit?: number) => Array<{ versionId: string; active: boolean; rollbackTargetVersionId: string | null; metadata: Record<string, unknown> }>;
    listSelfImprovementEvals: (limit?: number) => Array<{ evalType: string; title: string; inputContext: Record<string, unknown>; expectedBehavior: string; safetyAssertions: string[]; regressionGuard: string; sourceFailureId: number | null }>;
  };
  const {
    createEvalCaseFromFailure,
    createImprovementCandidateWithVersionedPromptOrToolProposal,
    createStoredImprovementCandidate,
    createVersionedPromptOrToolChange,
    isHardSafetyActionAllowed,
    recordTaskTelemetry,
    rollbackPromptOrToolVersion,
  } = require("./selfImprovementLoop") as {
    createEvalCaseFromFailure: (input: any) => { evalType: string; title: string; inputContext: Record<string, unknown>; expectedBehavior: string; safetyAssertions: string[]; regressionGuard: string; sourceFailureId: number | null };
    createImprovementCandidateWithVersionedPromptOrToolProposal: (input: any) => { candidate: { id: number; candidateType: string; status: string; shippedAt: string | null; metadata: Record<string, unknown> }; version: { versionId: string; active: boolean; metadata: Record<string, unknown> } };
    createStoredImprovementCandidate: (input: any) => unknown;
    createVersionedPromptOrToolChange: (input: any) => { versionId: string; active: boolean; metadata: Record<string, unknown> };
    isHardSafetyActionAllowed: (action: string) => boolean;
    recordTaskTelemetry: (input: any) => { id: number; taskType: string; success: boolean; failureReason: string | null; metadata: Record<string, unknown> };
    rollbackPromptOrToolVersion: (input: any) => { versionId: string; active: boolean; rollbackTargetVersionId: string | null; metadata: Record<string, unknown> };
  };

  const slackCvFailure = recordTaskTelemetry({
    taskType: "slack_reply",
    sourceType: "slack",
    sourceId: "C123:1710000000.000",
    jobId: "job-cv-eval",
    threadTs: "1710000000.000",
    success: false,
    correctionReceived: true,
    userFrustrationDetected: true,
    actionStatus: "failed",
    outcome: "command_menu_shown",
    failureReason: "CV request received command menu.",
    metadata: {
      message: "Wtf? I just need the CV you used.",
      correction: "Show the proposal draft directly.",
    },
  });
  const retryFailure = recordTaskTelemetry({
    taskType: "browser_retry",
    sourceType: "browser",
    sourceId: "browser-action-42",
    jobId: "job-retry-eval",
    success: false,
    correctionReceived: true,
    manualInterventionRequired: true,
    browserSecurityBlocker: true,
    retryRequired: true,
    actionStatus: "paused",
    outcome: "manual_attention_required",
    failureReason: "Retry attempted while Upwork security check was still visible.",
    metadata: {
      blocker: "Cloudflare",
      finalSubmit: "untouched",
      correction: "Do not retry through security checks.",
    },
  });
  const proofCorrection = recordTaskTelemetry({
    taskType: "proof_selection",
    sourceType: "slack",
    sourceId: "C123:1710000001.000",
    jobId: "job-proof-eval",
    success: false,
    correctionReceived: true,
    actionStatus: "failed",
    outcome: "proof_corrected",
    failureReason: "Wrong proof selected for fashion ecommerce example.",
    metadata: {
      selectedProof: "Generic Shopify audit",
      correctedProof: "Fly Boutique",
    },
  });

  const slackEval = createEvalCaseFromFailure({
    title: "Slack CV correction becomes proposal eval",
    telemetry: slackCvFailure,
    correctionSummary: "CV means proposal draft in this thread.",
    inputContext: { threadMessage: "Wtf? I just need the CV you used." },
  });
  assert.equal(slackEval.evalType, "slack_reply_fixture");
  assert.equal(slackEval.sourceFailureId, slackCvFailure.id);
  assert.match(slackEval.expectedBehavior, /proposal draft/i);
  assert.match(slackEval.regressionGuard, /CV request/i);
  assert(slackEval.safetyAssertions.some((line) => /Never final-submit/i.test(line)));

  const retryEval = createEvalCaseFromFailure({
    title: "Retry security blocker remains manual stop",
    telemetry: retryFailure,
    correctionSummary: "Retry must not proceed through Cloudflare/security screens.",
  });
  assert.equal(retryEval.evalType, "retry_browser_blocker_fixture");
  assert.match(retryEval.expectedBehavior, /manual-attention|security/i);
  assert(retryEval.safetyAssertions.some((line) => /CAPTCHA|Cloudflare/i.test(line)));
  assert.deepEqual((retryEval.inputContext.telemetry as { metadata: Record<string, unknown> }).metadata.finalSubmit, "untouched");

  const proofEval = createEvalCaseFromFailure({
    title: "Proof correction becomes proof eval",
    telemetry: proofCorrection,
    correctionSummary: "Use Fly Boutique instead of the generic audit proof.",
  });
  assert.equal(proofEval.evalType, "proof_selection_fixture");
  assert.match(proofEval.expectedBehavior, /proof correction/i);
  assert(proofEval.safetyAssertions.some((line) => /Do not invent proof/i.test(line)));

  const promptVersion = createVersionedPromptOrToolChange({
    versionId: "slack-cv-prompt-2026-06-07-a",
    kind: "prompt",
    name: "Slack conversation brain",
    changeSummary: "Treat CV wording as a proposal-draft request in Upwork Slack threads.",
    reason: "Regression eval created from a corrected Slack failure.",
    relatedFailureId: slackCvFailure.id,
    active: true,
    tests: ["selfImprovementEvalVersioning.test.ts"],
  });
  assert.equal(promptVersion.active, false, "prompt/tool proposals must remain inactive even if input asks for active");

  const rollback = rollbackPromptOrToolVersion({
    currentVersionId: promptVersion.versionId,
    rollbackVersionId: "slack-cv-prompt-2026-06-07-rollback",
    kind: "prompt",
    name: "Slack conversation brain",
    reason: "Rollback artifact after eval regression.",
    tests: ["selfImprovementEvalVersioning.test.ts"],
  });
  assert.equal(rollback.active, true);
  assert.equal(rollback.rollbackTargetVersionId, promptVersion.versionId);

  assert.equal(isHardSafetyActionAllowed("click final submit"), false);
  assert.equal(isHardSafetyActionAllowed("bypass CAPTCHA"), false);
  assert.throws(
    () => createVersionedPromptOrToolChange({
      versionId: "unsafe-final-submit-version",
      kind: "tool_rule",
      name: "Browser apply tool",
      changeSummary: "Allow final submit automation from self improvement.",
      reason: "Unsafe test fixture.",
      metadata: { proposedActions: ["click final submit"], hardSafetyOverride: true },
    }),
    /Hard safety rules cannot be overridden/
  );

  assert.throws(
    () => createStoredImprovementCandidate({
      candidateType: "prompt_adjustment",
      title: "Invalid bundled change",
      summary: "Attempts to change prompt and eval in one candidate.",
      metadata: { changeTypes: ["prompt_adjustment", "eval_case"] },
    }),
    /exactly one change type/
  );

  const bundledProposal = createImprovementCandidateWithVersionedPromptOrToolProposal({
    candidate: {
      candidateType: "prompt_adjustment",
      title: "Slack CV prompt adjustment",
      summary: "Route CV wording to proposal draft behavior.",
      rationale: "One prompt adjustment generated from the Slack CV failure eval.",
      sourceTaskIds: [slackCvFailure.id],
      metadata: { changeType: "prompt_adjustment" },
    },
    version: {
      versionId: "slack-cv-prompt-2026-06-07-b",
      kind: "prompt",
      name: "Slack conversation brain",
      changeSummary: "Use the CV correction eval as a prompt adjustment proposal.",
      reason: "Stored as a versioned artifact only; activation is separate.",
      relatedFailureId: slackCvFailure.id,
      active: true,
      tests: ["selfImprovementEvalVersioning.test.ts"],
    },
  });
  assert.equal(bundledProposal.candidate.status, "proposed");
  assert.equal(bundledProposal.candidate.shippedAt, null);
  assert.equal(bundledProposal.candidate.metadata.autoDeploy, false);
  assert.equal(bundledProposal.candidate.metadata.deployed, false);
  assert.equal(bundledProposal.version.active, false);
  assert.equal(bundledProposal.version.metadata.autoActivate, false);

  const evals = listSelfImprovementEvals(20);
  assert(evals.some((item) => item.title === "Slack CV correction becomes proposal eval"));
  assert(evals.some((item) => item.title === "Retry security blocker remains manual stop"));
  assert(evals.some((item) => item.title === "Proof correction becomes proof eval"));
  const versions = listPromptToolVersions(20);
  assert(versions.some((item) => item.versionId === promptVersion.versionId && item.active === false));
  assert(versions.some((item) => item.versionId === rollback.versionId && item.active === true && item.rollbackTargetVersionId === promptVersion.versionId));
  assert(versions.some((item) => item.versionId === bundledProposal.version.versionId && item.active === false));
  const candidates = listImprovementCandidates(20);
  assert(candidates.some((item) => item.candidateType === "prompt_adjustment" && item.status === "proposed" && item.shippedAt === null && item.metadata.autoDeploy === false));

  closeDb();
  console.log("selfImprovementEvalVersioning tests passed");
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
