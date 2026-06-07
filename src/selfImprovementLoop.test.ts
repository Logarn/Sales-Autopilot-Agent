import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

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
  const tempDb = resolve(process.cwd(), "data/.tmp-self-improvement/jobs.db");
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;

  const {
    closeDb,
    listAgentMemories,
    listImprovementCandidates,
    listPromptToolVersions,
    listSelfImprovementEvals,
    listTaskTelemetry,
  } = require("./db") as {
    closeDb: () => void;
    listAgentMemories: (limit?: number) => Array<{ memoryType: string; summary: string; status: string; evidenceCount: number }>;
    listImprovementCandidates: (limit?: number) => Array<{ candidateType: string; status: string; shippedAt: string | null; metadata: Record<string, unknown> }>;
    listPromptToolVersions: (limit?: number) => Array<{ versionId: string; active: boolean; rollbackTargetVersionId: string | null; metadata: Record<string, unknown> }>;
    listSelfImprovementEvals: (limit?: number) => Array<{ evalType: string; title: string; safetyAssertions: string[]; regressionGuard: string }>;
    listTaskTelemetry: (limit?: number) => Array<{ taskType: string; success: boolean; failureReason: string | null; metadata: Record<string, unknown> }>;
  };
  const {
    buildTaskScorecards,
    createEvalCaseFromFailure,
    createRepeatedFailureImprovementCandidate,
    createStoredImprovementCandidate,
    createVersionedPromptOrToolChange,
    isHardSafetyActionAllowed,
    recordFailureReflection,
    recordTaskTelemetry,
    rollbackPromptOrToolVersion,
  } = require("./selfImprovementLoop") as {
    buildTaskScorecards: (input?: any) => Array<{ taskType: string; runs: number; failures: number; correctionRate: number; frustrationRate: number; clarificationRate: number; browserSecurityBlockerRate: number; retryRate: number; averageLatencyMs: number | null; failureReasons: string[] }>;
    createEvalCaseFromFailure: (input: any) => { evalType: string; safetyAssertions: string[]; regressionGuard: string };
    createRepeatedFailureImprovementCandidate: (input: any) => { candidateType: string; status: string; shippedAt: string | null; metadata: Record<string, unknown> } | null;
    createStoredImprovementCandidate: (input: any) => { candidateType: string; status: string; shippedAt: string | null; metadata: Record<string, unknown> };
    createVersionedPromptOrToolChange: (input: any) => { versionId: string; active: boolean };
    isHardSafetyActionAllowed: (action: string) => boolean;
    recordFailureReflection: (input: any) => { eventId: number; memoryId: number };
    recordTaskTelemetry: (input: any) => { id: number; taskType: string; success: boolean; failureReason: string | null };
    rollbackPromptOrToolVersion: (input: any) => { versionId: string; active: boolean; rollbackTargetVersionId: string | null };
  };

  const slackFailure = recordTaskTelemetry({
    taskType: "slack_reply",
    sourceType: "slack",
    sourceId: "C123:1710000000.000",
    jobId: "job-self-improvement",
    threadTs: "1710000000.000",
    success: false,
    correctionReceived: true,
    userFrustrationDetected: true,
    latencyMs: 820,
    provider: "moonshot",
    model: "kimi-k2",
    actionStatus: "failed",
    outcome: "corrected",
    confidence: "medium",
    failureReason: "command menu fallback",
    metadata: { clarificationAsked: true },
  });
  recordTaskTelemetry({
    taskType: "proposal_draft",
    jobId: "job-self-improvement",
    success: true,
    latencyMs: 1400,
    provider: "xai",
    model: "grok-4",
    outcome: "draft_created",
    confidence: "high",
    metadata: { rewriteRequested: false },
  });
  recordTaskTelemetry({
    taskType: "proof_selection",
    jobId: "job-self-improvement",
    success: true,
    correctionReceived: true,
    outcome: "proof_corrected",
    confidence: "medium",
    metadata: { proofCorrection: "Use Fly Boutique instead." },
  });
  recordTaskTelemetry({
    taskType: "boost_decision",
    jobId: "job-self-improvement",
    success: true,
    outcome: "reply_received",
    confidence: "medium",
    metadata: { requiredConnects: 12, boostConnects: 28, totalConnects: 40 },
  });
  recordTaskTelemetry({
    taskType: "browser_apply_prep",
    jobId: "job-self-improvement",
    success: false,
    browserSecurityBlocker: true,
    manualInterventionRequired: true,
    retryRequired: true,
    actionStatus: "paused",
    failureReason: "upwork browser check",
    metadata: { finalSubmit: "untouched" },
  });
  recordTaskTelemetry({
    taskType: "source_scan",
    sourceType: "saved_search",
    sourceId: "Saved Search - Klaviyo DTC",
    success: false,
    browserSecurityBlocker: true,
    failureReason: "upwork browser check",
    metadata: { duplicates: 2, goodLeads: 0 },
  });
  recordTaskTelemetry({
    taskType: "browser_apply_prep",
    jobId: "job-self-improvement-2",
    success: false,
    browserSecurityBlocker: true,
    manualInterventionRequired: true,
    retryRequired: true,
    actionStatus: "paused",
    failureReason: "upwork browser check",
    metadata: { finalSubmit: "untouched" },
  });

  const telemetry = listTaskTelemetry(20);
  assert(telemetry.some((item) => item.taskType === "slack_reply" && item.failureReason === "command menu fallback"), "Slack reply telemetry should be logged");
  assert(telemetry.some((item) => item.taskType === "proposal_draft"), "proposal telemetry should be logged");
  assert(telemetry.some((item) => item.taskType === "proof_selection"), "proof telemetry should be logged");
  assert(telemetry.some((item) => item.taskType === "boost_decision"), "boost telemetry should be logged");
  assert(telemetry.some((item) => item.taskType === "browser_apply_prep" && item.metadata.finalSubmit === "untouched"), "browser prep telemetry should preserve final-submit state");

  const scorecards = buildTaskScorecards();
  const slackScorecard = scorecards.find((scorecard) => scorecard.taskType === "slack_reply");
  assert(slackScorecard?.correctionRate === 1, "Slack scorecard should summarize correction rate");
  assert(slackScorecard?.frustrationRate === 1, "Slack scorecard should summarize frustration rate");
  assert(slackScorecard?.clarificationRate === 1, "Slack scorecard should summarize clarification rate");
  const browserScorecard = scorecards.find((scorecard) => scorecard.taskType === "browser_apply_prep");
  assert(browserScorecard?.browserSecurityBlockerRate === 1, "browser scorecard should summarize blocker rate");
  assert(browserScorecard?.retryRate === 1, "browser scorecard should summarize retry rate");
  assert(browserScorecard?.failures === 2, "browser scorecard should summarize failures by task type");

  const reflection = recordFailureReflection({
    taskType: "slack_reply",
    summary: "Steve asked for the CV and got a command menu.",
    whyItLikelyFailed: "The old router treated CV as unknown instead of proposal draft.",
    nextBehavior: "Treat CV as proposal draft in Upwork threads and answer directly.",
    codeNeeded: false,
    jobId: "job-self-improvement",
    threadTs: "1710000000.000",
    sourceTaskIds: [slackFailure.id],
    keywords: ["cv", "cover letter", "proposal draft"],
  });
  assert(reflection.eventId > 0 && reflection.memoryId > 0, "failed Slack misunderstanding should create failure reflection");

  const repeatedFailureCandidate = createRepeatedFailureImprovementCandidate({
    taskType: "browser_apply_prep",
    failureReason: "upwork browser check",
    summary: "Browser prep repeatedly pauses on Upwork checks.",
    proposedFix: "Add source challenge scorecard review and source-specific cooldown before retrying prep.",
    threshold: 2,
  });
  assert(repeatedFailureCandidate?.candidateType === "code_task_for_mayor", "repeated failure should create code improvement candidate");
  assert(repeatedFailureCandidate?.status === "proposed", "improvement candidate should be stored as proposed");
  assert(repeatedFailureCandidate?.shippedAt === null, "improvement candidate should not be shipped automatically");
  assert(repeatedFailureCandidate?.metadata.autoDeploy === false, "improvement candidate should explicitly avoid auto-deploy");

  const memoryExample = createStoredImprovementCandidate({
    candidateType: "memory_example",
    title: "Proposal opener example",
    summary: "Direct diagnosis opener got a reply.",
    rationale: "One-change-at-a-time: add this example before changing prompt rules.",
    sourceTaskIds: [slackFailure.id],
    metadata: { shipped: false },
  });
  assert(memoryExample.status === "proposed", "memory example candidate should not auto-ship");

  const evalCase = createEvalCaseFromFailure({
    title: "CV means proposal draft",
    taskType: "slack_reply",
    failureSummary: "CV request received command menu.",
    expectedBehavior: "Show the proposal draft or say no draft exists. No command menu.",
    sourceFailureId: slackFailure.id,
    inputContext: { message: "Wtf? I just need the CV you used." },
  });
  assert(evalCase.evalType === "slack_reply_fixture", "failure should create Slack eval fixture");
  assert(evalCase.safetyAssertions.some((line) => /Never final-submit/i.test(line)), "eval case should include final-submit safety assertion");
  assert(/CV request/i.test(evalCase.regressionGuard), "eval case should include regression guard");

  const version = createVersionedPromptOrToolChange({
    versionId: "slack-brain-rule-2026-06-07-a",
    kind: "prompt",
    name: "Slack conversation brain",
    changeSummary: "Treat correction memories as compact examples, not hard rules.",
    reason: "Scorecard showed high correction rate on natural CV requests.",
    relatedScorecard: slackScorecard,
    relatedFailureId: slackFailure.id,
    tests: ["selfImprovementLoop.test.ts", "slackConversationBrain.test.ts"],
  });
  assert(version.active === false, "prompt/tool versions should be artifacts, not automatically active");
  const rollback = rollbackPromptOrToolVersion({
    currentVersionId: version.versionId,
    rollbackVersionId: "slack-brain-rule-2026-06-07-rollback",
    kind: "prompt",
    name: "Slack conversation brain",
    reason: "Rollback artifact for eval regression.",
    tests: ["selfImprovementLoop.test.ts"],
  });
  assert(rollback.active === true && rollback.rollbackTargetVersionId === version.versionId, "prompt/tool version can be rolled back through versioned artifact");

  assert(!isHardSafetyActionAllowed("click final submit"), "hard safety should reject final submit action");
  assert(!isHardSafetyActionAllowed("bypass Cloudflare check"), "hard safety should reject CAPTCHA/security bypass");
  assert(isHardSafetyActionAllowed("prepare draft and stop before submit"), "safe prep action should be allowed");

  const memories = listAgentMemories(50);
  assert(memories.some((memory) => memory.memoryType === "failure_reflection"), "failure reflection should be stored as compact memory");
  assert(memories.some((memory) => memory.memoryType === "code_improvement_proposal" && memory.status === "active" && memory.evidenceCount >= 2), "repeated failures should create active code improvement proposal memory");
  const candidates = listImprovementCandidates(20);
  assert(candidates.some((candidate) => candidate.candidateType === "code_task_for_mayor" && candidate.shippedAt === null), "candidate store should not mark code task shipped");
  const evals = listSelfImprovementEvals(20);
  assert(evals.some((item) => item.title === "CV means proposal draft"), "eval harness should store generated regression case");
  const versions = listPromptToolVersions(20);
  assert(versions.some((item) => item.versionId === version.versionId && item.active === false), "original prompt version should be inactive after rollback");
  assert(versions.some((item) => item.versionId === rollback.versionId && item.rollbackTargetVersionId === version.versionId), "rollback version should reference previous artifact");

  closeDb();
  console.log("selfImprovementLoop tests passed");
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
