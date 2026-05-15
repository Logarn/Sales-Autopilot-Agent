import * as fs from "node:fs";
import * as path from "node:path";
import { MANUAL_JOBS_CONFIG_PATH } from "./config";
import { parseJobDetailCapture } from "./jobCapture";
import { logger } from "./logger";

interface ManualJobsFile {
  jobs?: Array<Record<string, unknown>>;
}

function usage(): void {
  console.log(`Usage:
  npm run add:manual-job -- --url <upwork-url> --title <title> [--description <text>] [--budget <text>] [--connects <number>] [--skills "Klaviyo,Shopify"]
  npm run capture:job -- --file <capture.txt> [--url <upwork-url>]

Examples:
  npm run add:manual-job -- --url https://www.upwork.com/jobs/~abc --title "Klaviyo flow audit for Shopify brand" --description "Need audit and optimization" --skills "Klaviyo,Shopify,Email Marketing"
  npm run capture:job -- --file captures/job-detail-sample.txt --url https://www.upwork.com/jobs/Email-Marketing_~0123456789abcdef/`);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function readManualJobsFile(filePath: string): ManualJobsFile {
  if (!fs.existsSync(filePath)) return { jobs: [] };
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as ManualJobsFile;
}

function sameManualJob(existing: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  const existingId = typeof existing.id === "string" ? existing.id : "";
  const incomingId = typeof incoming.id === "string" ? incoming.id : "";
  const existingUrl = typeof existing.url === "string" ? existing.url : "";
  const incomingUrl = typeof incoming.url === "string" ? incoming.url : "";
  return Boolean((existingId && incomingId && existingId === incomingId) || (existingUrl && incomingUrl && existingUrl === incomingUrl));
}

function upsertManualJob(jobs: Array<Record<string, unknown>>, incoming: Record<string, unknown>): "created" | "updated" {
  const index = jobs.findIndex((job) => sameManualJob(job, incoming));
  if (index === -1) {
    jobs.push(incoming);
    return "created";
  }
  jobs[index] = { ...jobs[index], ...incoming, updatedAt: new Date().toISOString() };
  return "updated";
}

function writeManualJobs(filePath: string, jobs: Array<Record<string, unknown>>): void {
  fs.writeFileSync(filePath, `${JSON.stringify({ jobs }, null, 2)}\n`);
}

function printCaptureSummary(status: "created" | "updated", parsed: ReturnType<typeof parseJobDetailCapture>): void {
  console.log("\nJob Detail Capture");
  console.log("==================");
  console.log(`Status: ${status}`);
  console.log(`Title: ${parsed.title}`);
  console.log(`URL: ${parsed.url || "missing"}`);
  console.log(`Job ID: ${parsed.jobId ?? "missing"}`);
  console.log(`Budget: ${parsed.budget} (${parsed.budgetType})`);
  console.log(`Experience: ${parsed.experienceLevel}`);
  console.log(`Duration: ${parsed.duration}`);
  console.log(`Connects: ${parsed.connectsCost ?? "missing"}`);
  console.log(`Client: ${parsed.client.location}; spend ${parsed.client.spend ?? "missing"}; rating ${parsed.client.rating ?? "missing"}`);
  console.log(`Skills: ${parsed.skills.length ? parsed.skills.join(", ") : "missing"}`);
  console.log("\nNext: npm run test:run-once");
}

function captureJob(filePath: string, url?: string): void {
  const resolvedCapture = path.resolve(process.cwd(), filePath);
  const text = fs.readFileSync(resolvedCapture, "utf8");
  const parsed = parseJobDetailCapture(text, { url });
  if (!parsed.manualJob.url) {
    logger.error("Capture did not include a URL. Rerun with --url <upwork-url> so the manual job has a direct application link.");
    process.exitCode = 1;
    return;
  }

  const resolved = path.resolve(process.cwd(), MANUAL_JOBS_CONFIG_PATH);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const file = readManualJobsFile(resolved);
  const jobs = file.jobs ?? [];
  const status = upsertManualJob(jobs, parsed.manualJob as unknown as Record<string, unknown>);
  writeManualJobs(resolved, jobs);
  printCaptureSummary(status, parsed);
}

function addManualJob(url: string, title: string): void {
  const resolved = path.resolve(process.cwd(), MANUAL_JOBS_CONFIG_PATH);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const file = readManualJobsFile(resolved);
  const jobs = file.jobs ?? [];
  if (jobs.some((job) => job.url === url)) {
    logger.info(`Manual job already exists: ${url}`);
    return;
  }

  jobs.push({
    title,
    url,
    description: argValue("--description") ?? "",
    budget: argValue("--budget") ?? "Not specified",
    connectsCost: Number.parseInt(argValue("--connects") ?? "0", 10) || 0,
    skills: (argValue("--skills") ?? "")
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean),
    sourceQuery: "manual-cli",
    postedAt: new Date().toISOString(),
  });

  writeManualJobs(resolved, jobs);
  logger.info(`Added manual job: ${title}`);
}

function main(): void {
  const file = argValue("--file");
  if (file) {
    captureJob(file, argValue("--url"));
    return;
  }

  const url = argValue("--url");
  const title = argValue("--title");
  if (!url || !title) {
    usage();
    process.exitCode = 1;
    return;
  }

  addManualJob(url, title);
}

main();
