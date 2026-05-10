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

export interface ScoreComponent {
  score: number;
  reasons: string[];
  risks: string[];
}

export interface ScoreBreakdown {
  fitScore: ScoreComponent;
  clientQualityScore: ScoreComponent;
  opportunityScore: ScoreComponent;
  redFlagScore: ScoreComponent;
  connectsRiskScore: ScoreComponent;
  finalScore: number;
  reasons: string[];
  risks: string[];
}

export interface ScoredJob extends JobPosting {
  score: number;
  matchLevel: MatchLevel;
  matchedKeywords: string[];
  negativeKeywords: string[];
  scoreBreakdown: ScoreBreakdown;
  applicationDraft?: ApplicationDraft;
}

export type ApplicationStatus =
  | "found"
  | "draft"
  | "sent_to_slack"
  | "approved"
  | "rejected"
  | "applied"
  | "replied"
  | "interview"
  | "hired"
  | "lost"
  | "submitted";

export interface VoiceRules {
  tone: string[];
  openingStyle: string;
  ctaStyle: string;
  lengthPreference: string;
  bannedPhrases: string[];
  preferredPhrases: string[];
}

export interface FreelancerProfile {
  name: string;
  title: string;
  niche: string;
  hourlyRate: number;
  location: string;
  summary: string;
  skills: string[];
  preferredIndustries: string[];
  avoidIndustries: string[];
  preferredJobTypes: string[];
  avoidJobTypes: string[];
  proofPoints: string[];
  voice: VoiceRules;
}

export interface PortfolioItem {
  id: string;
  name: string;
  description: string;
  industries: string[];
  platforms: string[];
  bestFitJobTypes: string[];
  result: string;
  sensitivity: "safe" | "approved_external" | "private";
  allowedUsage: "always_include_when_relevant" | "include_only_when_relevant" | "never";
  filePath: string;
  neverUseWhen: string[];
}

export interface PortfolioLibrary {
  items: PortfolioItem[];
}

export interface ConnectsRules {
  maxRequiredPerJob: number;
  idealBoostMin: number;
  idealBoostMax: number;
  maxBoost: number;
  dailyCap: number;
  weeklyCap: number;
  neverBidMax: boolean;
  requireApprovalAbove: number;
  targetBoostRank: number;
  skipIfTopBidAbove: number;
}

export type ProposalQualitySeverity = "info" | "warning" | "critical";

export type ProposalQualityCategory =
  | "banned_phrase"
  | "weak_opening"
  | "generic_claim"
  | "length"
  | "cta"
  | "proof_relevance"
  | "voice";

export interface ProposalQualityIssue {
  category: ProposalQualityCategory;
  severity: ProposalQualitySeverity;
  message: string;
  evidence?: string;
  suggestion: string;
}

export interface ProposalQualityResult {
  score: number;
  issues: ProposalQualityIssue[];
  positiveSignals: string[];
  wordCount: number;
}

export interface ApplicationDraft {
  jobId: string;
  status: ApplicationStatus;
  fitScore: number;
  fitReasons: string[];
  redFlags: string[];
  suggestedBid: string;
  suggestedConnects: number;
  suggestedBoostConnects: number;
  connectsWarnings: string[];
  selectedPortfolioItems: PortfolioItem[];
  proposalQuality: ProposalQualityResult;
  proposalText: string;
  generatedAt: string;
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
