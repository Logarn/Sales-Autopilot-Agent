import * as fs from "node:fs";
import * as path from "node:path";
import { closeDb, recordApplicationSubmission } from "./db";
import { logger } from "./logger";

interface CaptureResult {
  requiredConnects: number | null;
  boostConnects: number | null;
  totalConnects: number | null;
  boostRank: number | null;
  remainingConnects: number | null;
  clientSpend: number | null;
  profileUsed: string;
  rate: number | null;
  highlights: string[];
  proposalRequirements: string[];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function usage(): void {
  console.log(`Usage:
  npm run app:capture -- --job-id <id> --file <path> [--record]

Example:
  pbpaste > captures/apply-screen.txt
  npm run app:capture -- --job-id manual:upwork-022053519741553119886 --file captures/apply-screen.txt --record`);
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFirstNumber(pattern: RegExp, text: string): number | null {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractProfileUsed(text: string): string {
  const specializedMatch = text.match(/Propose with a Specialized profile\s+([^\n]+)/i);
  if (specializedMatch?.[1]?.trim()) return specializedMatch[1].trim();
  const freelancerMatch = text.match(/As a freelancer[^\n]*/i);
  return freelancerMatch ? "Freelancer" : "";
}

function extractHighlights(text: string): string[] {
  const highlights: string[] = [];
  const patterns = [
    /\n\s*\d+\s*-\s*([^\n]+)\nSkills:/gi,
    /\n([^\n]+)\nPortfolio\n\d+\s*-/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value && value.length > 3 && !highlights.includes(value)) highlights.push(value);
    }
  }
  return highlights.slice(0, 8);
}

function extractProposalRequirements(text: string): string[] {
  const requirements: string[] = [];
  const applySection = text.match(/To Apply([\s\S]*?)(Looking for|Less than|Activity on this job|$)/i)?.[1] ?? "";
  for (const match of applySection.matchAll(/\n?\s*\d+\.\s*([^\n]+)/g)) {
    const value = match[1]?.trim();
    if (value) requirements.push(value);
  }
  return requirements;
}

export function parseApplyScreen(text: string): CaptureResult {
  const requiredConnects = parseFirstNumber(/proposal requires\s+(\d+)\s+Connects/i, text);
  const boostConnects = parseFirstNumber(/Bid to boost:\s*(\d+)\s+Connects/i, text);
  const totalConnects = parseFirstNumber(/Total:\s*(\d+)\s+Connects/i, text);
  const remainingConnects = parseFirstNumber(/Remaining balance:\s*(\d+)\s+Connects/i, text)
    ?? parseFirstNumber(/you'll have\s+(\d+)\s+Connects remaining/i, text);
  const boostRank = parseFirstNumber(/(\d+)(?:st|nd|rd|th)\s+place\s+\(You\)/i, text);
  const clientSpend = parseMoney(text.match(/\$([\d,]+(?:\.\d+)?)\s+total spent/i)?.[1]);
  const rate = parseMoney(text.match(/\$([\d,]+(?:\.\d+)?)\s*\/hr/i)?.[1]);

  return {
    requiredConnects,
    boostConnects,
    totalConnects,
    boostRank,
    remainingConnects,
    clientSpend,
    profileUsed: extractProfileUsed(text),
    rate,
    highlights: extractHighlights(text),
    proposalRequirements: extractProposalRequirements(text),
  };
}

function main(): void {
  const jobId = argValue("--job-id");
  const file = argValue("--file");
  const shouldRecord = process.argv.includes("--record");
  if (!jobId || !file) {
    usage();
    process.exitCode = 1;
    return;
  }

  const resolved = path.resolve(process.cwd(), file);
  const text = fs.readFileSync(resolved, "utf8");
  const parsed = parseApplyScreen(text);

  console.log("\nApply Screen Capture");
  console.log("====================");
  console.log(JSON.stringify(parsed, null, 2));

  const required = parsed.requiredConnects;
  if (shouldRecord) {
    if (required === null) {
      logger.error("Cannot record: required Connects could not be parsed.");
      process.exitCode = 1;
      return;
    }
    const recorded = recordApplicationSubmission({
      jobId,
      requiredConnects: required,
      boostConnects: parsed.boostConnects ?? Math.max(0, (parsed.totalConnects ?? required) - required),
      boostRank: parsed.boostRank,
      clientSpend: parsed.clientSpend,
      rate: parsed.rate,
      profileUsed: parsed.profileUsed,
      attachmentsUsed: [],
      profileHighlightsUsed: parsed.highlights,
      note: `Captured from apply screen. Remaining Connects: ${parsed.remainingConnects ?? "n/a"}.`,
    });
    if (!recorded) {
      logger.error(`No application found for job_id=${jobId}`);
      process.exitCode = 1;
      return;
    }
    logger.info(`Recorded apply-screen capture for ${jobId}`);
  } else {
    console.log("\nTo record this capture, rerun with --record.");
  }
}

try {
  main();
} finally {
  closeDb();
}
