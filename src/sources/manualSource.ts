import * as fs from "node:fs";
import * as path from "node:path";
import { MANUAL_JOBS_CONFIG_PATH } from "../config";
import { JobPosting } from "../types";
import { failedSourceResult, JobSource, JobSourceFetchResult } from "./types";

interface ManualJobInput {
  id?: string;
  title: string;
  url: string;
  description?: string;
  postedAt?: string;
  budget?: string;
  clientCountry?: string;
  clientRating?: number;
  clientSpend?: number;
  clientHireRate?: number;
  clientTotalHires?: number;
  clientFeedbackCount?: number;
  category?: string;
  experienceLevel?: string;
  connectsCost?: number;
  skills?: string[];
  sourceQuery?: string;
}

interface ManualJobsFile {
  jobs?: ManualJobInput[];
}

function stableManualId(job: ManualJobInput): string {
  if (job.id?.trim()) return job.id.trim();
  const source = job.url.trim() || `${job.title}:${job.description ?? ""}`;
  return `manual:${Buffer.from(source).toString("base64url").slice(0, 32)}`;
}

function normalizeManualJob(job: ManualJobInput): JobPosting | null {
  if (!job.title?.trim() || !job.url?.trim()) return null;
  const postedAt = job.postedAt && !Number.isNaN(new Date(job.postedAt).getTime())
    ? new Date(job.postedAt).toISOString()
    : new Date().toISOString();

  return {
    id: stableManualId(job),
    title: job.title.trim(),
    url: job.url.trim(),
    description: job.description?.trim() || "Manual job import. Add the full Upwork description for stronger scoring and proposals.",
    postedAt,
    budget: job.budget ?? "Not specified",
    clientCountry: job.clientCountry ?? "Not specified",
    clientRating: job.clientRating ?? 0,
    clientSpend: job.clientSpend ?? 0,
    clientHireRate: job.clientHireRate ?? 0,
    clientTotalHires: job.clientTotalHires ?? 0,
    clientFeedbackCount: job.clientFeedbackCount ?? 0,
    category: job.category ?? "Manual Import",
    experienceLevel: job.experienceLevel ?? "Not specified",
    connectsCost: job.connectsCost ?? 0,
    skills: Array.isArray(job.skills) ? job.skills : [],
    sourceQuery: job.sourceQuery ?? "manual-import",
  };
}

export class ManualJobSource implements JobSource {
  name = "manual-jobs";
  kind = "manual" as const;

  async fetchJobs(): Promise<JobSourceFetchResult> {
    try {
      const resolved = path.resolve(process.cwd(), MANUAL_JOBS_CONFIG_PATH);
      if (!fs.existsSync(resolved)) {
        return { sourceName: this.name, sourceKind: this.kind, jobs: [], failed: false };
      }

      const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as ManualJobsFile;
      const jobs = (parsed.jobs ?? [])
        .map(normalizeManualJob)
        .filter((job): job is JobPosting => Boolean(job));

      return { sourceName: this.name, sourceKind: this.kind, jobs, failed: false };
    } catch (error) {
      return failedSourceResult(this.name, this.kind, error);
    }
  }
}
