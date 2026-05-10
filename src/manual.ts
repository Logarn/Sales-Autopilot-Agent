import * as fs from "node:fs";
import * as path from "node:path";
import { MANUAL_JOBS_CONFIG_PATH } from "./config";
import { logger } from "./logger";

interface ManualJobsFile {
  jobs?: Array<Record<string, unknown>>;
}

function usage(): void {
  console.log(`Usage:
  npm run add:manual-job -- --url <upwork-url> --title <title> [--description <text>] [--budget <text>] [--connects <number>] [--skills "Klaviyo,Shopify"]

Example:
  npm run add:manual-job -- --url https://www.upwork.com/jobs/~abc --title "Klaviyo flow audit for Shopify brand" --description "Need audit and optimization" --skills "Klaviyo,Shopify,Email Marketing"`);
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

function main(): void {
  const url = argValue("--url");
  const title = argValue("--title");
  if (!url || !title) {
    usage();
    process.exitCode = 1;
    return;
  }

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

  fs.writeFileSync(resolved, `${JSON.stringify({ jobs }, null, 2)}\n`);
  logger.info(`Added manual job: ${title}`);
}

main();
