export type MatchLevel = "high" | "medium" | "low" | "skip";

export interface JobPosting {
  id: string;
  title: string;
  url: string;
  description: string;
  postedAt: string;
  budget: string;
  clientCountry: string;
  clientRating: number;
  clientSpend: number;
  clientHireRate: number;
  clientTotalHires: number;
  clientFeedbackCount: number;
  category: string;
  experienceLevel: string;
  connectsCost: number;
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
