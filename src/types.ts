export type MatchLevel = "high" | "medium" | "low" | "skip";

export type ConnectsExtractionConfidence = "high" | "medium" | "low" | "unknown";

export type ConnectsExtractionMethod =
  | "deterministic_visible_text"
  | "llm_visible_text"
  | "legacy_field"
  | "not_found";

export interface SourceBackedConnects {
  requiredConnects: number | null;
  boostConnects: number | null;
  totalConnects: number | null;
  confidence: ConnectsExtractionConfidence;
  sourceText: string | null;
  sourceLocation: string | null;
  extractionMethod: ConnectsExtractionMethod;
}

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
  connects?: SourceBackedConnects;
  skills: string[];
  sourceQuery: string;
  proposalCount?: number | null;
  competitionLevel?: "low" | "medium" | "high" | "unknown";
}

export type NormalizationSource = "deterministic" | "llm";

export interface NormalizedJobPacket {
  id: string;
  title: string;
  url: string;
  description: string;
  postedAt: string;
  budget: string;
  budgetType: string;
  category: string;
  experienceLevel: string;
  duration: string;
  sourceQuery: string;
}

export interface NormalizedClientPacket {
  country: string;
  rating: number | null;
  spend: number | null;
  hireRate: number | null;
  totalHires: number | null;
  feedbackCount: number | null;
  jobsPosted: number | null;
}

export interface NormalizedRequirementsPacket {
  skills: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  qualifications: string[];
  deliverables: string[];
  timeline: string;
}

export interface NormalizedConnectsPacket extends SourceBackedConnects {
  required: number | null;
  deterministicRequired: number | null;
  suggestedBoost: number;
  notes: string[];
}

export interface NormalizedProposalInstructions {
  tone: string;
  mustAddress: string[];
  avoid: string[];
  attachments: string[];
  notes: string[];
}

export interface NormalizedOpportunityPacket {
  schemaVersion: "1.0";
  source: NormalizationSource;
  normalizedAt: string;
  rawTextHash: string;
  job: NormalizedJobPacket;
  client: NormalizedClientPacket;
  requirements: NormalizedRequirementsPacket;
  applicationQuestions: string[];
  connects: NormalizedConnectsPacket;
  risks: string[];
  proofHints: string[];
  proposalInstructions: NormalizedProposalInstructions;
  deterministicJob: JobPosting;
}

export interface NormalizedOpportunityRepair {
  packet: NormalizedOpportunityPacket;
  valid: boolean;
  warnings: string[];
  errors: string[];
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
  connectsStrategy?: ConnectsStrategySnapshot;
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
  | "draft_prepared"
  | "prepared_for_qa"
  | "needs_review"
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
  upwork?: {
    profileUrl?: string;
    videoIntroUrl?: string;
    totalEarnings?: string | number;
    totalJobs?: number;
    connectsAvailable?: number;
    availability?: string;
    contractToHire?: boolean;
    averageResponseTime?: string;
    languages?: string[];
    verified?: boolean;
    militaryVeteran?: boolean;
    associatedWith?: string;
  };
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

export type KnowledgeArtifactType = "voice" | "proof" | "portfolio" | "video" | "bid_rules" | "general";

export interface KnowledgeArtifactMetadata {
  title?: string;
  type?: KnowledgeArtifactType;
  tags?: string[];
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface KnowledgeArtifact {
  id: string;
  type: KnowledgeArtifactType;
  title: string;
  tags: string[];
  sourcePath: string;
  format: "markdown" | "json";
  content: string;
  summary: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface KnowledgeLoadWarning {
  filePath: string;
  message: string;
}

export interface ProfileKnowledge {
  artifacts: KnowledgeArtifact[];
  byType: Record<KnowledgeArtifactType, KnowledgeArtifact[]>;
  contextSections: string[];
  warnings: KnowledgeLoadWarning[];
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

export type ConnectsStrategyDecision = "safe_apply" | "manual_review" | "skip";

export interface ConnectsStrategySnapshot {
  decision: ConnectsStrategyDecision;
  requiredConnects: number | null;
  suggestedBoostConnects: number;
  totalConnects: number | null;
  expectedValueScore: number;
  sourceBackedConnects?: SourceBackedConnects;
  reasons: string[];
  risks: string[];
}

export type ProposalQualitySeverity = "info" | "warning" | "critical";

export type ProposalQualityCategory =
  | "banned_phrase"
  | "weak_opening"
  | "generic_claim"
  | "platform_mismatch"
  | "vague_claim"
  | "fluff"
  | "over_explaining"
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

export type ProofVerificationState = "verified" | "planned" | "unavailable" | "do_not_claim";
export type CopyTone = "casual" | "direct" | "sharp" | "warm" | "witty";

export interface JobUnderstanding {
  jobTitle: string;
  fullJobDescription: string;
  actualJobRequest: string;
  clientBusiness: string;
  customerType: string;
  commercialPain: string;
  emotionalPain: string;
  likelyLifecycleOrConversionLeak: string;
  desiredOutcome: string;
  requestedTools: string[];
  requestedDeliverables: string[];
  unknowns: string[];
}

export interface BrandResearchStatus {
  attempted: boolean;
  status: "not_applicable" | "category_only" | "unavailable";
  evidence: string[];
  claims: string[];
  unknowns: string[];
}

export type BrandResearchConfidence = "high" | "medium" | "low" | "unavailable";

export type BrandResearchWebStatus = "not_applicable" | "not_configured" | "skipped" | "succeeded" | "failed";

export interface BrandResearchSourceDetail {
  title: string;
  url: string;
  snippet: string;
  provider: string;
}

export interface BrandFactPack {
  brandName: string;
  websiteUrls: string[];
  whatTheBrandSells: string;
  productCategory: string;
  targetCustomerIcp: string;
  customerBuyingMoment: string;
  repeatPurchaseMoment: string;
  emotionalPainOrDesire: string;
  likelyLifecycleLeak: string;
  likelyConversionLeak: string;
  customerEducationGaps: string[];
  objectionsOrTrustGaps: string[];
  languageOrHooks: string[];
  proofAngle: string;
  assumptions: string[];
  whatNotToClaim: string[];
  confidence: BrandResearchConfidence;
  sources: string[];
  sourceDetails: BrandResearchSourceDetail[];
  researchNeeded: boolean;
  researchAttempted: boolean;
  webResearchProvider: string;
  webResearchStatus: BrandResearchWebStatus;
  webResearchQuery: string;
  researchSummary: string;
}

export interface CopyStrategy {
  job_title: string;
  client_business: string;
  brand_name: string;
  brand_url: string;
  category: string;
  target_customer: string;
  customer_state_of_mind: string;
  customer_pain_or_desire: string;
  client_commercial_pain: string;
  cost_of_inaction: string;
  money_leak: string;
  buying_moment: string;
  repeat_purchase_or_conversion_moment: string;
  likely_lifecycle_gap: string;
  offer_or_project_mechanism: string;
  retention_lane: string;
  proof_angle: string;
  proof_verification_state: ProofVerificationState;
  requested_tools: string[];
  requested_deliverables: string[];
  tone: CopyTone;
  opening_angle: string;
  one_sentence_sales_argument: string;
  cta: string;
  unknowns: string[];
  do_not_claim: string[];
}

export interface ProofStrategy {
  selectedProofNames: string[];
  selectedAttachmentPaths: string[];
  selectedPortfolioHighlights: string[];
  proofVerificationState: ProofVerificationState;
  summary: string;
  warnings: string[];
}

export type SkillWorkflowStage =
  | "lead_discovery"
  | "job_capture"
  | "job_scoring"
  | "job_understanding"
  | "brand_research"
  | "proof_selection"
  | "portfolio_profile_selection"
  | "cover_letter_drafting"
  | "screening_answer_drafting"
  | "slack_draft_preview"
  | "browser_application_prep"
  | "qa_handoff"
  | "outcome_learning";

export interface SelectedSkillTrace {
  name: string;
  path: string;
  title: string;
  stage: SkillWorkflowStage;
  reason: string;
  mandatory: boolean;
  loaded: boolean;
  loadedAt: string;
  contentLength: number;
}

export interface SkillUseTrace {
  jobId: string;
  selectedSkills: SelectedSkillTrace[];
  missingRequiredSkills: string[];
  jobDescriptionLength: number;
  captureConfidence: "high" | "medium" | "low";
  invocationOrder: string[];
  brandFactPackSummary: string;
  copyStrategySummary: string;
  proofStrategySummary: string;
  brandResearchProvider: string;
  brandResearchSourceCount: number;
  qualityGateReady: boolean;
  browserFillAllowed: boolean;
  createdAt: string;
}

export interface DraftQualityGateIssue {
  code: string;
  severity: ProposalQualitySeverity;
  message: string;
  evidence?: string;
}

export interface ProposalScorecardDimension {
  dimension: string;
  weight: number;
  score: number;
  passed: boolean;
  hardFail: boolean;
  message: string;
}

export interface ProposalScorecardResult {
  score: number;
  ready: boolean;
  wordCount: number;
  operatingBand: {
    min: number;
    max: number;
    actual: number;
  };
  dimensions: ProposalScorecardDimension[];
  hardFailures: string[];
  feedbackMessages: string[];
  jobSpecificSignalCount: number;
  proofCount: number;
  screeningAnswerCount: number;
  soulLoaded: boolean;
}

export interface DraftQualityGateResult {
  ready: boolean;
  skillLoaded: boolean;
  soulLoaded?: boolean;
  fullJobDescriptionRead: boolean;
  copyStrategyCreated: boolean;
  finalSubmitManual: boolean;
  issues: DraftQualityGateIssue[];
  scorecard?: ProposalScorecardResult;
}

export interface ProposalBrowserFillNotes {
  approvedText: string;
  profileNotes: string[];
  rate: string;
  attachments: string[];
  highlights: string[];
  connectsPlan: string;
}

export interface StructuredProposalDraft {
  opening: string;
  diagnosis: string;
  proof: string;
  clientRequestAnswers: string[];
  rateRetainerAnswer: string;
  cta: string;
  suggestedAttachments: string[];
  suggestedHighlights: string[];
  browserFillNotes: ProposalBrowserFillNotes;
}

export type ProposalVersionSource =
  | "draft_generated"
  | "slack_preview"
  | "slack_revision"
  | "upwork_inserted"
  | "remote_chrome_qa"
  | "human_edit_reread"
  | "final_submitted"
  | "latest_verified_fallback";

export type ProposalVersionConfidence = "high" | "medium" | "low";

export interface ProposalVersionSnapshot {
  id: number;
  jobId: string;
  versionNumber: number;
  source: ProposalVersionSource;
  label: string;
  proposalText: string;
  screeningAnswers: string[];
  confidence: ProposalVersionConfidence;
  isFallback: boolean;
  fallbackReason: string | null;
  note: string | null;
  createdAt: string;
}

export type ScreeningCoverageStatus = "planned" | "filled" | "verified" | "edited" | "unknown";

export interface ScreeningCoverageItem {
  jobId: string;
  questionIndex: number;
  questionText: string | null;
  questionFingerprint: string | null;
  semanticFamily: string | null;
  plannedAnswer: string | null;
  filledAnswer: string | null;
  verifiedAnswer: string | null;
  humanEditedAnswer: string | null;
  finalAnswer: string | null;
  jobContext: Record<string, unknown> | null;
  confidence: ProposalVersionConfidence;
  status: ScreeningCoverageStatus;
  updatedAt?: string;
}

export type EcommerceVertical = "beauty" | "health" | "supplements" | "fashion" | "food" | "home" | "SaaS" | "unknown";

export type PlatformCategory = "ESP" | "CRM" | "SMS" | "CDP" | "ecommerce platform" | "support" | "subscription" | "analytics" | "unknown";

export type PlatformPreferenceTier = "core" | "secondary" | "non_core_review" | "unknown";

export interface JobIntelligence {
  schemaVersion: "1.0";
  primaryPlatform: string;
  platformsMentioned: string[];
  platformCategory: PlatformCategory;
  platformPreferenceTier: PlatformPreferenceTier;
  platformFitReason: string;
  shouldSkipForPlatform: boolean;
  skipReason: string;
  businessType: string;
  ecommerceVertical: EcommerceVertical;
  jobCategory: string;
  taskType: string;
  requiredSkills: string[];
  clientGoal: string;
  redFlags: string[];
  fitScoreReasoning: string;
  proposalAngle: string;
  proofRecommendations: string[];
  draftConstraints: string[];
  platformMismatchWarnings: string[];
  needsManualReview: boolean;
  confidence: "high" | "medium" | "low";
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
  connectsStrategy?: ConnectsStrategySnapshot;
  selectedPortfolioItems: PortfolioItem[];
  proposalQuality: ProposalQualityResult;
  proposalText: string;
  structuredProposal?: StructuredProposalDraft;
  generatedAt: string;
  jobIntelligence?: JobIntelligence;
  proposalVersion?: number;
  revisionRequests?: string[];
  jobUnderstanding?: JobUnderstanding;
  brandFactPack?: BrandFactPack;
  copyStrategy?: CopyStrategy;
  proofStrategy?: ProofStrategy;
  draftQualityGate?: DraftQualityGateResult;
  skillUseTrace?: SkillUseTrace;
  proposalStyleMemoryIds?: string[];
  brandResearchStatus?: BrandResearchStatus;
  proposalGenerationTrace?: ProposalGenerationTrace;
}

export interface ProposalCandidateTrace {
  angleId: string;
  angleLabel: string;
  openerShape: string;
  score: number;
  valid: boolean;
  issues: string[];
  selected?: boolean;
}

export interface ProposalGenerationTrace {
  mode: "llm_primary" | "deterministic_fallback";
  provider: "kimi" | "fallback";
  candidateCount: number;
  selectedAngleId?: string;
  selectedAngleLabel?: string;
  selectedOpenerShape?: string;
  repairAttempted: boolean;
  fallbackReason?: string;
  candidates?: ProposalCandidateTrace[];
}

export interface ProofPlanOverrideState {
  includeAssetIds: string[];
  excludeAssetIds: string[];
  includeProofIds: string[];
  excludeProofIds: string[];
  includePortfolioItemIds: string[];
  excludePortfolioItemIds: string[];
  portfolioOnly: boolean;
  noFiles: boolean;
  noScreenshots: boolean;
  attachAllRelevantScreenshots: boolean;
  instructionHistory: string[];
  updatedAt?: string;
}

export interface FeedJobResult {
  jobs: JobPosting[];
  failedFeeds: string[];
}

export interface BrowserSearchQuery {
  id: string;
  label: string;
  query: string;
  url: string;
}

export interface BrowserSearchConfig {
  enabled: boolean;
  dryRun: boolean;
  intervalMs: number;
  maxJobsPerQuery: number;
  freshnessWindowMinutes: number;
  queries: BrowserSearchQuery[];
}

export interface BrowserSearchResultLink {
  jobId: string | null;
  title: string;
  url: string;
  sourceQueryId: string;
  sourceQueryLabel: string;
  discoveredAt: string;
}

export interface BrowserCapturedJobPage {
  jobId: string | null;
  url: string;
  title: string;
  text: string;
  sourceQueryId: string;
  sourceQueryLabel: string;
  capturedAt: string;
}

export interface BrowserSearchRunSummary {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  queriesRun: number;
  jobsFound: number;
  jobsCaptured: number;
  jobsQueued: number;
  pausedReason?: string;
  errors: string[];
}

export interface BrowserSearchRunResult {
  summary: BrowserSearchRunSummary;
  links: BrowserSearchResultLink[];
  capturedPages: BrowserCapturedJobPage[];
  normalizedPackets: NormalizedOpportunityPacket[];
}

export interface DedupeResult<TJob extends JobPosting> {
  jobs: TJob[];
  exactDuplicates: number;
  nearDuplicates: number;
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

export type BrowserActionType =
  | "capture_job_from_url"
  | "open_job"
  | "open_apply_page"
  | "prepare_application_review"
  | "capture_application_snapshot";

export type BrowserActionStatus = "pending" | "in_progress" | "completed" | "failed" | "paused" | "cancelled";

export type BrowserApplyValidationSeverity = "warning" | "error";

export interface BrowserApplyValidationIssue {
  severity: BrowserApplyValidationSeverity;
  code: string;
  message: string;
}

export interface BrowserApplyAttachmentInstruction {
  id: string;
  name: string;
  filePath: string;
  sensitivity: PortfolioItem["sensitivity"];
}

export interface BrowserApplySkippedAttachment {
  id: string;
  name: string;
  reason: string;
}

export interface BrowserApplyConnectsPlan {
  required: number | null;
  boost: number | null;
  total: number | null;
  approvalRequired: boolean;
  notes: string[];
}

export interface BrowserApplyFillPlan {
  schemaVersion: "1.0";
  jobId: string;
  jobTitle: string;
  sourceUrl: string;
  applyUrl: string;
  status: ApplicationStatus;
  profile: string;
  rate: string;
  coverLetter: string;
  screeningAnswers: string[];
  attachments: BrowserApplyAttachmentInstruction[];
  skippedAttachments: BrowserApplySkippedAttachment[];
  manualReviewAssets: string[];
  mentionOnlyProof: string[];
  proofAvailability: string[];
  figmaRecommendations: string[];
  videoRecommendations: string[];
  manualReviewWarnings: string[];
  missingLocalAssets: string[];
  highlights: string[];
  connects: BrowserApplyConnectsPlan;
  connectsStrategy: ConnectsStrategySnapshot;
  stopBeforeSubmit: true;
  dryRunSafe: true;
  validationIssues: BrowserApplyValidationIssue[];
  createdAt: string;
}

export interface BrowserActionPayload {
  url?: string;
  notes?: string;
  applicationId?: string;
  applyPlan?: BrowserApplyFillPlan;
  [key: string]: unknown;
}

export interface BrowserAction {
  id: number;
  jobId: string;
  actionType: BrowserActionType;
  status: BrowserActionStatus;
  payload: BrowserActionPayload;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SlackConversationIntentType =
  | "approve"
  | "reject"
  | "revise"
  | "regenerate"
  | "mark_applied"
  | "mark_replied"
  | "enqueue_browser_apply"
  | "unknown";

export interface SlackConversationIntent {
  type: SlackConversationIntentType;
  jobId: string | null;
  instruction: string | null;
  confidence: "high" | "medium" | "low";
  rawText: string;
}

export interface BrowserActionInput {
  jobId: string;
  actionType: BrowserActionType;
  payload?: BrowserActionPayload;
}

export interface BrowserActionEnqueueResult {
  id: number;
  duplicate: boolean;
  duplicateOf?: number;
}

export interface DailySummary {
  high: number;
  medium: number;
  low: number;
  filteredOut: number;
  topJobTitle: string | null;
  topJobScore: number | null;
}
