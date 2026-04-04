export type MatchLevel = "high" | "medium" | "low" | "skip";

export interface JobPosting {
  id: string;
  title: string;
  url: string;
  description: string;
  postedAt: string;
  budget: string;
  clientLocation: string;
  clientRating: string;
  clientSpend: string;
  clientHireRate: string;
  category: string;
  duration: string;
  skills: string[];
  sourceQuery: string;
}

export interface ScoredJob extends JobPosting {
  score: number;
  matchLevel: MatchLevel;
  matchedKeywords: string[];
  negativeKeywords: string[];
}

export interface FeedJobResult {
  jobs: JobPosting[];
  failedFeeds: string[];
}

export interface RunStats {
  fetched: number;
  newJobs: number;
  high: number;
  medium: number;
  low: number;
  skipped: number;
  filteredOut: number;
  failedFeeds: number;
}

export interface DailySummary {
  high: number;
  medium: number;
  low: number;
  filteredOut: number;
  topJobTitle: string | null;
  topJobScore: number | null;
}
