import { buildV3CapturePacket } from "./slackPacketV3";
import { ScoredJob } from "./types";

interface TestCase {
  name: string;
  got: unknown;
  want: unknown;
}

function createScoredJob(overrides: Partial<ScoredJob> = {}): ScoredJob {
  return {
    id: "manual:upwork-1234567890",
    title: "Need Senior Data Automation Specialist",
    url: "https://www.upwork.com/jobs/~1234567890",
    description: "Build a data automation workflow in Node and integrate APIs.",
    postedAt: "2026-05-11T09:00:00.000Z",
    budget: "$60-$80 /hr",
    clientCountry: "United States",
    clientRating: 4.8,
    clientSpend: 120000,
    clientHireRate: 92,
    clientTotalHires: 47,
    clientFeedbackCount: 29,
    category: "Automation",
    experienceLevel: "Expert",
    connectsCost: 4,
    skills: ["Node.js", "TypeScript", "API integration"],
    sourceQuery: "manual",
    score: 89,
    matchLevel: "high",
    matchedKeywords: ["automation", "Node.js", "API"],
    negativeKeywords: [],
    scoreBreakdown: {
      fitScore: {
        score: 88,
        reasons: ["Exact platform match", "Clear automation brief"],
        risks: [],
      },
      clientQualityScore: {
        score: 92,
        reasons: ["Strong client history"],
        risks: [],
      },
      opportunityScore: {
        score: 83,
        reasons: ["Good hourly band"],
        risks: [],
      },
      redFlagScore: {
        score: 95,
        reasons: ["No risky flags"],
        risks: [],
      },
      connectsRiskScore: {
        score: 90,
        reasons: ["Connects budget is clear"],
        risks: [],
      },
      finalScore: 89,
      reasons: ["Platform fit strong", "Clear deliverables"],
      risks: ["Long engagement window"],
    },
    applicationDraft: {
      jobId: "manual:upwork-1234567890",
      status: "draft",
      fitScore: 89,
      fitReasons: ["Expert automation experience", "Good API knowledge fit"],
      redFlags: ["Tight first-day response window"],
      suggestedBid: "$72/hr",
      suggestedConnects: 4,
      suggestedBoostConnects: 8,
      connectsWarnings: ["Boost only if budget allows"],
      selectedPortfolioItems: [
        {
          id: "pf-1",
          name: "Upwork Automation Case Study",
          description: "Case study for workflow automation.",
          industries: ["SaaS"],
          platforms: ["Upwork"],
          bestFitJobTypes: ["Automation"],
          result: "Selected for similar scope",
          sensitivity: "safe",
          allowedUsage: "include_only_when_relevant",
          filePath: "profile/portfolio/Lifely.pdf",
          neverUseWhen: [],
        },
      ],
      proposalQuality: {
        score: 92,
        issues: [],
        positiveSignals: ["Clear positioning"],
        wordCount: 560,
      },
      proposalText:
        "Thanks for the posting. I’ve built production data automations in Node and can stand this engagement quickly.",
      generatedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(got: string, needle: string, message: string): void {
  assert(got.includes(needle), `${message}: expected to include ${JSON.stringify(needle)} but got: ${got}`);
}

function assertNotIncludes(got: string, needle: string, message: string): void {
  assert(!got.toLowerCase().includes(needle.toLowerCase()), `${message}: expected not to include ${JSON.stringify(needle)} but got: ${got}`);
}

function runTests(): void {
  const baseJob = createScoredJob();

  const packetText = buildV3CapturePacket(baseJob, {
    upworkUrl: baseJob.url,
    captureStatus: "packet_sent",
    browserCaptureActionId: 11,
    applicationQuestions: [
      "What is your project approach?",
      "Can you start within 48 hours?",
    ],
    questionAnswers: [
      "I propose a discovery-first architecture and milestones.",
      "Yes, I can start within 24 hours.",
    ],
    proofRecommendations: ["Upwork Automation Case Study", "Workflow benchmark document"],
  }).text;

  const cases: TestCase[] = [
    {
      name: "captured/scored packet includes title and url",
      got: packetText,
      want: "Need Senior Data Automation Specialist",
    },
    {
      name: "captured/scored packet includes score components",
      got: packetText,
      want: "📊 Match Score",
    },
    {
      name: "captured/scored packet includes reasons and risks",
      got: packetText,
      want: "Reasons",
    },
    {
      name: "captured/scored packet includes connects and bid",
      got: packetText,
      want: "suggested boost",
    },
    {
      name: "packet includes proposal preview",
      got: packetText,
      want: "Proposal preview",
    },
  ];

  for (const test of cases) {
    assertIncludes(String(test.got), String(test.want), test.name);
  }

  assertIncludes(
    packetText,
    "Q: What is your project approach?",
    "Q&A should render question labels",
  );
  assertIncludes(
    packetText,
    "A: I propose a discovery-first architecture and milestones.",
    "Q&A should render answers",
  );

  assertIncludes(
    packetText,
    "Upwork Automation Case Study",
    "Proof recommendations should render portfolio names",
  );

  assertIncludes(
    packetText,
    "prepare draft",
    "Packet should include prepare draft command",
  );

  const defaultCommandLine = packetText;
  for (const cmd of ["status", "approve", "reject", "revise: <instruction>", "prepare draft", "retry <action-id>", "mark submitted"]) {
    assertIncludes(defaultCommandLine, cmd, `Missing command hint: ${cmd}`);
  }

  const missingDraftJob = createScoredJob({
    applicationDraft: undefined,
    score: 72,
    matchLevel: "medium",
    scoreBreakdown: {
      ...baseJob.scoreBreakdown,
      finalScore: 72,
      fitScore: { ...baseJob.scoreBreakdown.fitScore, score: 72 },
    },
  });

  const missingText = buildV3CapturePacket(missingDraftJob, {
    upworkUrl: missingDraftJob.url,
    captureStatus: "captured",
    applicationQuestions: [],
  }).text;

  assertIncludes(
    missingText,
    "Proposal draft is not yet available",
    "Missing draft fallback should show draft unavailable text",
  );
  assertIncludes(
    missingText,
    "No explicit screening questions detected on capture",
    "Missing Q&A should use fallback text",
  );

  assertNotIncludes(
    missingText,
    "copy proposal",
    "V3 packet should not ask users to copy proposals",
  );

  const commandOnlyText = buildV3CapturePacket(baseJob, {
    upworkUrl: baseJob.url,
    captureStatus: "captured",
    commandHints: ["status", "prepare draft", "approve"],
    applicationQuestions: [],
  }).text;
  assertIncludes(commandOnlyText, "status", "Custom command hints should be applied");
  assertIncludes(commandOnlyText, "prepare draft", "Custom command hints should be applied");
  assertIncludes(commandOnlyText, "approve", "Custom command hints should be applied");

  const noPasteDepsText = buildV3CapturePacket(baseJob, {
    upworkUrl: baseJob.url,
    captureStatus: "captured",
    applicationQuestions: ["Do you have experience with this stack?"],
    questionAnswers: ["Yes, and more."],
    proofRecommendations: ["Case study"],
  }).text;

  assertNotIncludes(noPasteDepsText, "paste job description", "Packet must not instruct pasted job descriptions");

  console.log("slack packet V3 tests passed");
}

if (require.main === module) {
  try {
    runTests();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`slack packet V3 tests failed: ${message}`);
    process.exitCode = 1;
  }
}
