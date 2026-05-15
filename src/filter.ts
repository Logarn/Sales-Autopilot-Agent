import { scoreJobStructured, getKeywordConfig as getStructuredKeywordConfig } from "./scoring";
import { JobPosting, ScoredJob } from "./types";

export function scoreJob(job: JobPosting): ScoredJob {
  const scoreResult = scoreJobStructured(job);

  return {
    ...job,
    score: scoreResult.score,
    matchedKeywords: scoreResult.matchedKeywords,
    negativeKeywords: scoreResult.negativeKeywords,
    matchLevel: scoreResult.matchLevel,
    scoreBreakdown: scoreResult.scoreBreakdown,
  };
}

export function shouldNotify(job: ScoredJob): boolean {
  return job.matchLevel === "high" || job.matchLevel === "medium";
}

export function getKeywordConfig(): {
  high: string[];
  medium: string[];
  low: string[];
  negative: string[];
} {
  return getStructuredKeywordConfig();
}
