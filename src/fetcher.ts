import { SEARCH_QUERIES } from "./config";
import { dedupeJobsBySimilarity } from "./dedupe";
import { logger } from "./logger";
import { getEnabledJobSources } from "./sources";
import { FeedJobResult, JobPosting } from "./types";

export async function fetchAllFeeds(): Promise<FeedJobResult> {
  const sources = getEnabledJobSources();
  const failedFeeds: string[] = [];
  const jobs: JobPosting[] = [];

  const results = await Promise.all(sources.map((source) => source.fetchJobs()));
  for (const result of results) {
    if (result.failed) {
      logger.error(`Failed source ${result.sourceName}: ${result.error ?? "unknown error"}`);
      failedFeeds.push(result.sourceName);
      continue;
    }
    logger.info(`Source ${result.sourceName} returned ${result.jobs.length} job(s).`);
    jobs.push(...result.jobs);
  }

  if (sources.length === 1 && failedFeeds.length === 1) {
    failedFeeds.splice(0, failedFeeds.length, ...SEARCH_QUERIES);
  }

  const deduped = dedupeJobsBySimilarity(jobs);
  if (deduped.exactDuplicates > 0 || deduped.nearDuplicates > 0) {
    logger.info(
      `Dedupe collapsed ${deduped.exactDuplicates} exact and ${deduped.nearDuplicates} near-duplicate job(s) across sources.`
    );
    const bySource = new Map<string, number>();
    for (const job of jobs) {
      bySource.set(job.sourceQuery, (bySource.get(job.sourceQuery) ?? 0) + 1);
    }
    const sourceCounts = [...bySource.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([source, count]) => `${source}=${count}`)
      .join(" ");
    logger.info(`Dedupe input counts by source: ${sourceCounts}`);
  }

  return { jobs: deduped.jobs, failedFeeds };
}

if (require.main === module) {
  (async () => {
    const result = await fetchAllFeeds();
    logger.info(
      `Fetched ${result.jobs.length} jobs from enabled sources. Failed source count: ${result.failedFeeds.length}`
    );
    const preview = result.jobs.slice(0, 5).map((job) => ({
      id: job.id,
      title: job.title,
      url: job.url,
      postedAt: job.postedAt,
      budget: job.budget,
      clientCountry: job.clientCountry,
      sourceQuery: job.sourceQuery,
    }));
    console.log(preview);
  })().catch((error) => {
    logger.error(`test:fetch failed: ${String(error)}`);
    process.exitCode = 1;
  });
}
