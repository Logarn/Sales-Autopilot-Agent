import * as fs from "node:fs";
import { normalizeOpportunity, normalizedPacketToJobPosting } from "./normalization";
import { scoreJob } from "./filter";
import { buildApplicationDraftWithResearch } from "./agent";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const filePath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : argValue("--file");
  if (!filePath) {
    throw new Error("Usage: npm run normalize:capture -- <capture-file> [--url https://www.upwork.com/jobs/...~jobid] [--with-draft]");
  }

  const rawText = fs.readFileSync(filePath, "utf8");
  const result = await normalizeOpportunity(rawText, { url: argValue("--url") });
  const job = normalizedPacketToJobPosting(result.packet);
  const scoredJob = scoreJob(job);
  const includeDraft = process.argv.includes("--with-draft");

  console.log(JSON.stringify({
    usedLlm: result.usedLlm,
    fallbackReason: result.fallbackReason,
    valid: result.valid,
    warnings: result.warnings,
    errors: result.errors,
    packet: result.packet,
    job,
    score: {
      value: scoredJob.score,
      matchLevel: scoredJob.matchLevel,
      matchedKeywords: scoredJob.matchedKeywords,
      negativeKeywords: scoredJob.negativeKeywords,
      breakdown: scoredJob.scoreBreakdown,
    },
    applicationDraft: includeDraft ? await buildApplicationDraftWithResearch(scoredJob) : undefined,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
