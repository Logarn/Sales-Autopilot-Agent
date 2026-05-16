import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import {
  assessCaptureQuality,
  buildCaptureActionPayload,
  buildDryRunCaptureInput,
  canonicalizeUpworkJobUrl,
  deriveCaptureThreadJobId,
  extractUpworkJobContent,
  parseCaptureQuestions,
  stripCaptureNoise,
} from "./browserCapture";

interface TestCase {
  name: string;
  got: unknown;
  want: unknown;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function runTests(): Promise<void> {
  const url = "https://www.upwork.com/jobs/~0123456789abcdef";
  const actionPayload = buildCaptureActionPayload(url, "C123", "M456", "T789", {
    originalUrl: "https://www.upwork.com/nx/find-work/best-matches/details/~0123456789abcdef?pageTitle=Job%20Details",
    canonicalJobUrl: url,
  });
  assert(actionPayload.source === "slack_url", "capture payload should include slack source");
  assert(actionPayload.channelId === "C123", "capture payload should keep channelId");
  assert(actionPayload.messageTs === "M456", "capture payload should keep messageTs");
  assert(actionPayload.threadTs === "T789", "capture payload should keep threadTs");
  assert(Boolean(actionPayload.originalUrl?.includes("/nx/find-work/best-matches/details/")), "capture payload should keep original URL for audit");
  assert(actionPayload.canonicalJobUrl === url, "capture payload should store canonical job URL");

  const jobIdFromUrl = deriveCaptureThreadJobId(url, "0123456789abcdef");
  const jobIdFallback = deriveCaptureThreadJobId(url, null);
  assert(jobIdFromUrl === "manual:upwork-0123456789abcdef", "deriveCaptureThreadJobId should prefer parsed job id");
  assert(jobIdFallback.startsWith("manual:url-"), "fallback with missing id should be deterministic hash style");

  const dryRun = buildDryRunCaptureInput(url);
  assert(canonicalizeUpworkJobUrl("https://www.upwork.com/jobs/~022053866890130225260") === "https://www.upwork.com/jobs/~022053866890130225260", "canonical URL should remain canonical");
  assert(canonicalizeUpworkJobUrl("https://www.upwork.com/jobs/Some-Title_~022053866890130225260/") === "https://www.upwork.com/jobs/~022053866890130225260", "slug job URL should normalize to canonical job URL");
  assert(canonicalizeUpworkJobUrl("https://www.upwork.com/nx/find-work/best-matches/details/~022053866890130225260?pageTitle=Job%20Details") === "https://www.upwork.com/jobs/~022053866890130225260", "best matches modal URL should normalize to canonical job URL");
  assert(canonicalizeUpworkJobUrl("https://www.upwork.com/nx/proposals/job/~022053795172113889247/apply/") === "https://www.upwork.com/jobs/~022053795172113889247", "nx apply URL should normalize to canonical job URL");
  assert(canonicalizeUpworkJobUrl("https://www.upwork.com/ab/proposals/job/~022053795172113889247/apply/") === "https://www.upwork.com/jobs/~022053795172113889247", "ab apply URL should normalize to canonical job URL");
  const urlTests: TestCase[] = [
    {
      name: "capture dry run should include url in parsed input",
      got: dryRun.parsed.url,
      want: url,
    },
    {
      name: "capture dry run should include dry-run marker in raw source text",
      got: dryRun.rawText.includes("dry-run"),
      want: true,
    },
  ];
  for (const t of urlTests) {
    assert(JSON.stringify(t.got) === JSON.stringify(t.want), `${t.name}: expected ${JSON.stringify(t.want)}, got ${JSON.stringify(t.got)}`);
  }

  const parsedQuestions = parseCaptureQuestions(`
Screening Questions:
1. What is your estimated hourly budget?
2. Do you need experience with React?
`);
  assert(parsedQuestions.length === 2, `expected two parsed questions, got ${JSON.stringify(parsedQuestions)}`);

  const noisy = stripCaptureNoise(`window.TOP_NAV_USER_CONFIG = {\"serviceName\":\"upwork\",\"visitorGqlTokenUrl\":\"/token\"};\nSkip to main content\nMailchimp E-commerce Automation Expert for Premium Skincare Webshop\nNeed help with lifecycle flows and revenue attribution.`);
  assert(!noisy.cleaned.includes("window.TOP_NAV_USER_CONFIG"), "config noise should be stripped from capture text");
  assert(noisy.rawConfigNoiseDetected === true, "config noise detection should be flagged");

  const mockPage = {
    url: () => "https://www.upwork.com/jobs/Mailchimp-E-commerce-Automation-Expert_~0123456789abcdef",
    title: async () => "Mailchimp E-commerce Automation Expert for Premium Skincare Webshop - Upwork",
    locator: (selector: string) => ({
      count: async () => (["h1", "[data-test='job-description-text']", "main", "body"].includes(selector) ? 1 : 0),
      first: () => ({
        count: async () => 1,
        first: () => ({ textContent: async () => "" }),
        textContent: async () => {
          if (selector === "h1") return "Mailchimp E-commerce Automation Expert for Premium Skincare Webshop";
          if (selector === "[data-test='job-description-text']") return "window.TOP_NAV_USER_CONFIG = { serviceName: 'upwork' }; Need a Mailchimp automation strategist for a premium skincare ecommerce brand. Build flows, segmentation, and attribution.";
          if (selector === "main") return "Main content";
          return "Body fallback";
        },
      }),
      textContent: async () => "",
    }),
  };
  const extracted = await extractUpworkJobContent(mockPage as any);
  assert(extracted.title === "Mailchimp E-commerce Automation Expert for Premium Skincare Webshop", "structured capture should prefer clean h1 title");
  assert(!extracted.description.includes("window.TOP_NAV_USER_CONFIG"), "structured capture should strip config text from description");
  assert(extracted.diagnostics.titleSource === "selector", "structured capture should report title source");

  const fallbackPage = {
    url: () => "https://www.upwork.com/jobs/Mailchimp-E-commerce-Automation-Expert_~0123456789abcdef",
    title: async () => "Mailchimp E-commerce Automation Expert for Premium Skincare Webshop - Upwork",
    locator: (_selector: string) => ({
      count: async () => 0,
      first: () => ({ count: async () => 0, first: () => ({ textContent: async () => "" }), textContent: async () => "" }),
      textContent: async () => "",
    }),
  };
  const fallbackExtracted = await extractUpworkJobContent(fallbackPage as any);
  assert(fallbackExtracted.title.includes("Mailchimp E-commerce Automation Expert for Premium Skincare Webshop"), `page title fallback should yield clean job title, got ${fallbackExtracted.title}`);

  const quality = assessCaptureQuality({
    title: "window.TOP_NAV_USER_CONFIG = { serviceName: 'upwork' }",
    description: "serviceName visitorGqlTokenUrl",
    rawText: "window.TOP_NAV_USER_CONFIG = { serviceName: 'upwork' } visitorGqlTokenUrl",
    rawConfigNoiseDetected: true,
  });
  assert(quality.lowConfidence, "dirty capture should be flagged low-confidence");

  // Status transition smoke test using an isolated DB file.
  const tempDb = resolve(process.cwd(), "data/.tmp-feature2-thread-state.db");
  process.env.DB_PATH = tempDb;
  const {
    closeDb,
    getSlackThreadStateByThreadTs,
    upsertSlackThreadState,
    updateSlackThreadStateStatus,
  } = require("./db") as {
    closeDb: () => void;
    upsertSlackThreadState: (input: {
      channelId: string;
      messageTs: string;
      threadTs: string;
      upworkUrl: string;
      jobId?: string | null;
      status: string;
    }) => { status: string; channelId: string; threadTs: string; jobId?: string };
    updateSlackThreadStateStatus: (
      channelId: string,
      threadTs: string,
      status: string,
      options?: { jobId?: string | null; upworkUrl?: string }
    ) => { status: string; channelId: string; threadTs: string; jobId?: string };
    getSlackThreadStateByThreadTs: (channelId: string, threadTs: string) => { status: string; channelId: string; threadTs: string; jobId?: string } | null;
  };

  try {
    upsertSlackThreadState({
      channelId: "C123",
      messageTs: "M456",
      threadTs: "T789",
      upworkUrl: url,
      status: "capture_pending",
    });
    let state = getSlackThreadStateByThreadTs("C123", "T789");
    assert(state?.status === "capture_pending", "status should initialize as capture_pending");

    updateSlackThreadStateStatus("C123", "T789", "captured", { jobId: "job-1" });
    state = getSlackThreadStateByThreadTs("C123", "T789");
    assert(state?.status === "captured", "status should transition to captured");
    assert(state?.jobId === "job-1", "status transition should persist job id");

    updateSlackThreadStateStatus("C123", "T789", "scored", { jobId: "job-1" });
    state = getSlackThreadStateByThreadTs("C123", "T789");
    assert(state?.status === "scored", "status should transition to scored");

    updateSlackThreadStateStatus("C123", "T789", "packet_sent", { jobId: "job-1" });
    state = getSlackThreadStateByThreadTs("C123", "T789");
    assert(state?.status === "packet_sent", "status should transition to packet_sent");
  } finally {
    closeDb();
    if (existsSync(tempDb)) {
      unlinkSync(tempDb);
    }
  }

  console.log("browser capture tests passed");
}

if (require.main === module) {
  runTests().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`browser capture tests failed: ${message}`);
    process.exitCode = 1;
  });
}
