import { JobPosting, DedupeResult } from "./types";

const VOLATILE_PATTERNS = [
  /\b(posted|updated|reposted|renewed)\s+(today|yesterday|\d+\s+(minute|hour|day|week|month)s?\s+ago)\b/gi,
  /\bjob\s*id\s*[:#-]?\s*[a-z0-9_-]+\b/gi,
  /https?:\/\/\S+/gi,
  /\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi,
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "the",
  "to",
  "with",
  "you",
  "your",
]);

export function normalizeText(value: string | undefined | null): string {
  let normalized = (value ?? "").toLowerCase();
  for (const pattern of VOLATILE_PATTERNS) {
    normalized = normalized.replace(pattern, " ");
  }
  return normalized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string | undefined | null): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function normalizeBudget(budget: string | undefined | null): string {
  const normalized = normalizeText(budget);
  const numbers = normalized.match(/\d+/g) ?? [];
  if (numbers.length === 0) return normalized;
  return numbers.slice(0, 2).join("-");
}

function stableTokens(tokens: string[], max = 24): string[] {
  return [...new Set(tokens)].sort().slice(0, max);
}

export function buildJobFingerprint(job: JobPosting): string {
  const titleTokens = stableTokens(tokenize(job.title), 10);
  const descriptionTokens = stableTokens(tokenize(job.description), 24);
  const skillTokens = stableTokens(job.skills.flatMap((skill) => tokenize(skill)), 12);
  const parts = [
    `title:${titleTokens.join("-")}`,
    `desc:${descriptionTokens.join("-")}`,
    `budget:${normalizeBudget(job.budget)}`,
    `country:${normalizeText(job.clientCountry)}`,
    `skills:${skillTokens.join("-")}`,
    `source:${normalizeText(job.sourceQuery)}`,
  ];
  return parts.join("|");
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

export function jobSimilarity(left: JobPosting, right: JobPosting): number {
  const titleScore = jaccard(new Set(tokenize(left.title)), new Set(tokenize(right.title)));
  const descriptionScore = jaccard(
    new Set(stableTokens(tokenize(left.description), 40)),
    new Set(stableTokens(tokenize(right.description), 40))
  );
  const skillScore = jaccard(
    new Set(left.skills.flatMap((skill) => tokenize(skill))),
    new Set(right.skills.flatMap((skill) => tokenize(skill)))
  );
  const budgetScore = normalizeBudget(left.budget) === normalizeBudget(right.budget) ? 1 : 0;
  const countryScore = normalizeText(left.clientCountry) === normalizeText(right.clientCountry) ? 1 : 0;
  const sourceScore = normalizeText(left.sourceQuery) === normalizeText(right.sourceQuery) ? 1 : 0;

  return (
    titleScore * 0.3 +
    descriptionScore * 0.25 +
    skillScore * 0.15 +
    budgetScore * 0.1 +
    countryScore * 0.1 +
    sourceScore * 0.1
  );
}

export function areNearDuplicateJobs(left: JobPosting, right: JobPosting): boolean {
  if (buildJobFingerprint(left) === buildJobFingerprint(right)) return true;
  const titleScore = jaccard(new Set(tokenize(left.title)), new Set(tokenize(right.title)));
  if (titleScore < 0.65) return false;
  return jobSimilarity(left, right) >= 0.78;
}

export function dedupeJobsBySimilarity(jobs: JobPosting[]): DedupeResult<JobPosting> {
  const kept: JobPosting[] = [];
  let exactDuplicates = 0;
  let nearDuplicates = 0;
  const byId = new Map<string, JobPosting>();

  for (const job of jobs) {
    const existing = byId.get(job.id);
    if (existing) {
      exactDuplicates += 1;
      byId.set(job.id, chooseStrongerJob(existing, job));
      continue;
    }
    byId.set(job.id, job);
  }

  for (const job of byId.values()) {
    const duplicateIndex = kept.findIndex((candidate) => areNearDuplicateJobs(candidate, job));
    if (duplicateIndex === -1) {
      kept.push(job);
      continue;
    }

    nearDuplicates += 1;
    kept[duplicateIndex] = chooseStrongerJob(kept[duplicateIndex], job);
  }

  return { jobs: kept, exactDuplicates, nearDuplicates };
}

export function chooseStrongerJob<T extends JobPosting>(left: T, right: T): T {
  const leftScore = jobStrength(left);
  const rightScore = jobStrength(right);
  if (rightScore !== leftScore) return rightScore > leftScore ? right : left;

  const leftTime = Date.parse(left.postedAt) || 0;
  const rightTime = Date.parse(right.postedAt) || 0;
  if (rightTime !== leftTime) return rightTime > leftTime ? right : left;

  return right.id.localeCompare(left.id) < 0 ? right : left;
}

function jobStrength(job: JobPosting): number {
  return (
    nonEmpty(job.description) * 3 +
    nonEmpty(job.budget) * 2 +
    nonEmpty(job.clientCountry) +
    Math.min(job.skills.length, 10) +
    (job.clientRating > 0 ? 2 : 0) +
    (job.clientSpend > 0 ? 2 : 0)
  );
}

function nonEmpty(value: string | undefined | null): number {
  return normalizeText(value).length > 0 ? 1 : 0;
}
