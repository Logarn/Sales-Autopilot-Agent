import {
  listHistoricalProposalCalibrationCandidates,
  type HistoricalProposalCalibrationCandidateRow,
} from "./db";
import type { ApplicationStatus, ProposalVersionSource } from "./types";

const POSITIVE_STATUSES = new Set<ApplicationStatus>(["approved", "applied", "submitted", "replied", "interview", "hired"]);
const NEGATIVE_STATUSES = new Set<ApplicationStatus>(["rejected", "lost"]);
const STRONG_POSITIVE_STATUSES = new Set<ApplicationStatus>(["replied", "interview", "hired"]);
const STOPWORDS = new Set([
  "and", "the", "for", "with", "that", "this", "from", "your", "you", "our", "are", "can", "will", "need", "needs",
  "job", "work", "help", "looking", "expert", "specialist", "project", "upwork", "client", "about", "into", "have", "has",
]);

export interface ProposalMemoryCalibrationInput {
  title: string;
  description: string;
  skills?: string[];
  platform?: string | null;
  excludeJobId?: string | null;
  limitPerPolarity?: number;
  candidateLimit?: number;
}

export interface ProposalCalibrationExample {
  polarity: "positive" | "negative";
  jobId: string;
  proposalVersionId: number;
  versionNumber: number;
  source: ProposalVersionSource;
  status: ApplicationStatus;
  title: string;
  similarityScore: number;
  matchedSignals: string[];
  excerpt: string;
  guidance: string;
}

export interface ProposalMemoryCalibrationContext {
  positiveExamples: ProposalCalibrationExample[];
  negativeExamples: ProposalCalibrationExample[];
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: string | null | undefined, max = 360): string {
  const cleaned = clean(value);
  if (cleaned.length <= max) return cleaned;
  const boundary = cleaned.lastIndexOf(" ", max - 1);
  return `${cleaned.slice(0, boundary > 220 ? boundary : max - 1).trim()}…`;
}

function parseSkills(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    // Fall through to loose parsing for legacy rows.
  }
  return value.split(/[,|]/).map(clean).filter(Boolean);
}

function tokensFrom(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9+#.-]{2,}/g) ?? [];
  return new Set(tokens.filter((token) => !STOPWORDS.has(token)));
}

function intersect(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((item) => right.has(item));
}

function sourceWeight(source: ProposalVersionSource): number {
  if (source === "final_submitted") return 18;
  if (source === "human_edit_reread") return 15;
  if (source === "remote_chrome_qa" || source === "upwork_inserted") return 10;
  if (source === "latest_verified_fallback") return -8;
  if (source === "slack_revision") return 4;
  return 0;
}

function statusWeight(status: ApplicationStatus): number {
  if (status === "hired") return 28;
  if (status === "interview") return 24;
  if (status === "replied") return 20;
  if (status === "submitted" || status === "applied") return 12;
  if (status === "approved") return 10;
  if (status === "rejected") return 14;
  if (status === "lost") return 8;
  return 0;
}

function classify(row: HistoricalProposalCalibrationCandidateRow): "positive" | "negative" | null {
  if (NEGATIVE_STATUSES.has(row.status)) return "negative";
  if (POSITIVE_STATUSES.has(row.status)) return "positive";
  return null;
}

function scoreRow(row: HistoricalProposalCalibrationCandidateRow, input: ProposalMemoryCalibrationInput): { score: number; signals: string[] } {
  const inputSkills = (input.skills ?? []).map((skill) => skill.toLowerCase().trim()).filter(Boolean);
  const platform = clean(input.platform).toLowerCase();
  const inputTokens = tokensFrom([input.title, input.description, inputSkills.join(" "), platform].join(" "));
  const rowSkills = parseSkills(row.skills);
  const rowText = [row.title, row.description, rowSkills.join(" "), row.source_query].map(clean).join(" ");
  const rowTokens = tokensFrom(rowText);
  const matches = intersect(inputTokens, rowTokens).slice(0, 8);
  const skillMatches = inputSkills.filter((skill) => rowSkills.some((rowSkill) => rowSkill.toLowerCase() === skill)).slice(0, 4);
  const platformMatch = platform && tokensFrom(rowText).has(platform) ? [platform] : [];
  const titleOverlap = intersect(tokensFrom(input.title), tokensFrom(clean(row.title))).length;
  const descriptionOverlap = intersect(tokensFrom(input.description), tokensFrom(clean(row.description))).length;
  const score = matches.length * 7
    + skillMatches.length * 10
    + platformMatch.length * 12
    + titleOverlap * 5
    + Math.min(12, descriptionOverlap * 2)
    + statusWeight(row.status)
    + sourceWeight(row.source)
    - (row.is_fallback === 1 ? 8 : 0);
  const signals = [
    ...platformMatch.map((item) => `platform:${item}`),
    ...skillMatches.map((item) => `skill:${item}`),
    ...matches.filter((item) => !platformMatch.includes(item) && !skillMatches.includes(item)).slice(0, 5),
  ];
  return { score, signals: Array.from(new Set(signals)) };
}

function rowToExample(
  row: HistoricalProposalCalibrationCandidateRow,
  polarity: "positive" | "negative",
  similarityScore: number,
  matchedSignals: string[],
): ProposalCalibrationExample {
  const outcome = STRONG_POSITIVE_STATUSES.has(row.status) ? `strong outcome: ${row.status}` : `status: ${row.status}`;
  return {
    polarity,
    jobId: row.job_id,
    proposalVersionId: row.proposal_version_id,
    versionNumber: row.version_number,
    source: row.source,
    status: row.status,
    title: clean(row.title) || row.job_id,
    similarityScore,
    matchedSignals,
    excerpt: compact(row.proposal_text),
    guidance: polarity === "positive"
      ? `Use as a positive calibration example (${outcome}, source ${row.source}, v${row.version_number}); borrow the diagnostic shape, not the exact wording.`
      : `Use as an anti-example (${outcome}, source ${row.source}, v${row.version_number}); avoid repeating this opener/positioning unless the current job explicitly warrants it.`,
  };
}

function dedupeByJob(rows: Array<{ row: HistoricalProposalCalibrationCandidateRow; polarity: "positive" | "negative"; score: number; signals: string[] }>) {
  const byJob = new Map<string, { row: HistoricalProposalCalibrationCandidateRow; polarity: "positive" | "negative"; score: number; signals: string[] }>();
  for (const item of rows) {
    const existing = byJob.get(item.row.job_id);
    if (!existing || item.score > existing.score || (item.score === existing.score && item.row.version_number > existing.row.version_number)) {
      byJob.set(item.row.job_id, item);
    }
  }
  return [...byJob.values()];
}

export function buildProposalMemoryCalibrationContext(input: ProposalMemoryCalibrationInput): ProposalMemoryCalibrationContext {
  const limitPerPolarity = Math.max(1, Math.min(5, Math.round(input.limitPerPolarity ?? 2)));
  const rows = listHistoricalProposalCalibrationCandidates({
    excludeJobId: input.excludeJobId ?? null,
    limit: input.candidateLimit ?? 120,
  });
  const scored = rows
    .map((row) => {
      const polarity = classify(row);
      if (!polarity) return null;
      const scoredRow = scoreRow(row, input);
      if (scoredRow.signals.length === 0) return null;
      return { row, polarity, score: scoredRow.score, signals: scoredRow.signals };
    })
    .filter((item): item is { row: HistoricalProposalCalibrationCandidateRow; polarity: "positive" | "negative"; score: number; signals: string[] } => Boolean(item));

  const byPolarity = (polarity: "positive" | "negative") => dedupeByJob(scored.filter((item) => item.polarity === polarity))
    .sort((left, right) => right.score - left.score || right.row.version_number - left.row.version_number)
    .slice(0, limitPerPolarity)
    .map((item) => rowToExample(item.row, polarity, item.score, item.signals));

  return {
    positiveExamples: byPolarity("positive"),
    negativeExamples: byPolarity("negative"),
  };
}
