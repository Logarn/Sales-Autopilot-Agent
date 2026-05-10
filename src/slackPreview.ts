import { APP_NAME, SLACK_CHANNEL_WEBHOOK_URL } from "./config";
import { getScoredJobForSlackPreview } from "./db";
import { logger } from "./logger";
import { buildJobBlocks, sendSlackPreviewMessage } from "./slack";
import { ScoredJob } from "./types";

function readFlagValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  return args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : null;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function buildSampleJob(): ScoredJob {
  return {
    id: "slack-preview-sample",
    title: "Klaviyo + Shopify lifecycle email flow build",
    url: "https://www.upwork.com/jobs/~sample-slack-preview",
    description:
      "We need an expert to audit and rebuild our Shopify/Klaviyo lifecycle flows: welcome, abandoned cart, post-purchase, and winback. Please include examples of similar ecommerce retention work.",
    postedAt: new Date().toISOString(),
    budget: "$750 fixed",
    clientCountry: "United States",
    clientRating: 4.9,
    clientSpend: 18500,
    clientHireRate: 82,
    clientTotalHires: 14,
    clientFeedbackCount: 11,
    category: "Email Marketing",
    experienceLevel: "EXPERT",
    connectsCost: 12,
    skills: ["Klaviyo", "Shopify", "Email Marketing", "Lifecycle Marketing"],
    sourceQuery: "slack-preview",
    score: 94,
    matchLevel: "high",
    matchedKeywords: ["Klaviyo", "Shopify", "lifecycle"],
    negativeKeywords: [],
    scoreBreakdown: {
      fitScore: { score: 96, reasons: ["Direct Klaviyo + Shopify fit"], risks: [] },
      clientQualityScore: { score: 90, reasons: ["Strong spend and hire history"], risks: [] },
      opportunityScore: { score: 93, reasons: ["Clear lifecycle scope"], risks: [] },
      redFlagScore: { score: 88, reasons: [], risks: ["Confirm access and timeline before applying"] },
      connectsRiskScore: { score: 85, reasons: ["Connects are reasonable for expected value"], risks: [] },
      finalScore: 94,
      reasons: ["Direct Klaviyo + Shopify fit", "Clear deliverables", "Strong client history"],
      risks: ["Confirm timeline and account access"],
    },
    applicationDraft: {
      jobId: "slack-preview-sample",
      status: "draft",
      fitScore: 96,
      fitReasons: ["Lifecycle email scope matches Steve's strongest proof points", "Client asks for platform-specific examples"],
      redFlags: ["Need to confirm whether creative/copy assets are ready"],
      suggestedBid: "$850 fixed or hourly discovery first",
      suggestedConnects: 12,
      suggestedBoostConnects: 18,
      connectsWarnings: ["Boost is optional; stay below max guardrail unless client budget increases"],
      selectedPortfolioItems: [
        {
          id: "sample-proof-1",
          name: "Shopify retention flow rebuild",
          description: "Lifecycle audit and Klaviyo flow rebuild for ecommerce retention.",
          industries: ["ecommerce"],
          platforms: ["Shopify", "Klaviyo"],
          bestFitJobTypes: ["email lifecycle", "retention"],
          result: "Improved abandoned-cart and post-purchase revenue contribution",
          sensitivity: "safe",
          allowedUsage: "always_include_when_relevant",
          filePath: "profile/portfolio.json",
          neverUseWhen: [],
        },
      ],
      proposalQuality: {
        score: 91,
        issues: [{ category: "cta", severity: "info", message: "CTA asks for a concrete next step", suggestion: "Keep this specific." }],
        positiveSignals: ["Mentions exact lifecycle flows", "Uses relevant Shopify/Klaviyo proof"],
        wordCount: 143,
      },
      proposalText:
        "Hi — I can audit and rebuild your Klaviyo lifecycle flows for Shopify.\n\nI would start by mapping revenue impact across welcome, abandoned cart, post-purchase, and winback, then prioritize the highest-leverage fixes first. I have handled similar ecommerce retention work and can keep the first pass practical: flow logic, segmentation, copy direction, and measurement notes.\n\nIf helpful, I can begin with a short audit and a prioritized rebuild plan before implementation.",
      generatedAt: new Date().toISOString(),
    },
  };
}

function usage(): string {
  return `Usage: npm run slack:preview -- --job-id <job-id>\n       npm run slack:preview -- --sample\n\nSends a V0 one-way Slack webhook proposal packet. Requires SLACK_CHANNEL_WEBHOOK_URL.`;
}

export async function runSlackPreview(args = process.argv.slice(2)): Promise<boolean> {
  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log(usage());
    return true;
  }

  if (!SLACK_CHANNEL_WEBHOOK_URL.trim()) {
    console.error("SLACK_CHANNEL_WEBHOOK_URL is not configured; Slack preview was not sent.");
    console.error("Set the webhook env var or use this failure as a no-webhook dry-run check. The secret value is never logged.");
    return false;
  }

  const jobId = readFlagValue(args, "--job-id");
  const sampleMode = hasFlag(args, "--sample") || !jobId;
  const job = sampleMode ? buildSampleJob() : getScoredJobForSlackPreview(jobId);

  if (!job) {
    console.error(`No stored job/application found for --job-id ${jobId}. Run with --sample to send a synthetic V0 packet.`);
    return false;
  }

  try {
    await sendSlackPreviewMessage({
      text: `${APP_NAME}: Slack V0 proposal packet preview — ${job.title}`,
      blocks: buildJobBlocks(job),
    });
    logger.info(`Slack proposal packet preview sent for ${sampleMode ? "synthetic sample" : `job ${job.id}`}.`);
    return true;
  } catch (error) {
    console.error(`Slack preview send failed and was not queued: ${String(error)}`);
    return false;
  }
}

if (require.main === module) {
  runSlackPreview().then((sent) => {
    if (!sent) {
      process.exitCode = 1;
    }
  }).catch((error) => {
    logger.error(`slack:preview failed: ${String(error)}`);
    process.exitCode = 1;
  });
}
