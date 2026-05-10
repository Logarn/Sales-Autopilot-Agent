import { JobPosting } from "../types";

export type JobSourceKind = "apify" | "rss" | "manual" | "email" | "browser";

export interface JobSourceFetchResult {
  sourceName: string;
  sourceKind: JobSourceKind;
  jobs: JobPosting[];
  failed: boolean;
  error?: string;
}

export interface JobSource {
  name: string;
  kind: JobSourceKind;
  fetchJobs(): Promise<JobSourceFetchResult>;
}

export function failedSourceResult(
  sourceName: string,
  sourceKind: JobSourceKind,
  error: unknown
): JobSourceFetchResult {
  return {
    sourceName,
    sourceKind,
    jobs: [],
    failed: true,
    error: String(error),
  };
}
