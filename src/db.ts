import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH, TIMEZONE } from "./config";
import { areNearDuplicateJobs, buildJobFingerprint } from "./dedupe";
import {
  ApplicationDraft,
  ApplicationStatus,
  BrowserAction,
  BrowserActionInput,
  BrowserActionPayload,
  BrowserActionStatus,
  BrowserActionType,
  DailySummary,
  JobPosting,
  MatchLevel,
  PortfolioItem,
  ScoredJob,
} from "./types";

interface SeenStats {
  total: number;
  high: number;
  medium: number;
  low: number;
  skip: number;
}

interface CountRow {
  count: number;
}

interface SeenRow {
  found: number;
}

interface SeenFingerprintRow {
  id: string;
  title: string;
  url: string;
  description: string | null;
  posted_at: string | null;
  budget: string | null;
  client_country: string | null;
  client_rating: number | null;
  client_spend: number | null;
  client_hire_rate: number | null;
  skills: string | null;
  experience_level: string | null;
  connects_cost: number | null;
  fingerprint: string | null;
}

interface MatchCountRow {
  match_level: MatchLevel;
  count: number;
}

interface DailyRow {
  title: string;
  score: number;
  match_level: MatchLevel;
  seen_at: string;
}

interface SlackPreviewJobRow {
  id: string;
  title: string;
  url: string;
  description: string | null;
  score: number | null;
  match_level: MatchLevel | null;
  budget: string | null;
  client_country: string | null;
  client_rating: number | null;
  client_spend: number | null;
  client_hire_rate: number | null;
  skills: string | null;
  experience_level: string | null;
  connects_cost: number | null;
  posted_at: string | null;
  status: ApplicationStatus | null;
  fit_score: number | null;
  fit_reasons: string | null;
  red_flags: string | null;
  suggested_bid: string | null;
  suggested_connects: number | null;
  suggested_boost_connects: number | null;
  connects_warnings: string | null;
  selected_portfolio_items: string | null;
  proposal_text: string | null;
  generated_at: string | null;
}

export interface ApplicationSummaryRow {
  status: ApplicationStatus;
  count: number;
}

export interface ApplicationListRow {
  job_id: string;
  status: ApplicationStatus;
  fit_score: number;
  title: string | null;
  url: string | null;
  suggested_bid: string | null;
  suggested_connects: number;
  actual_total_connects: number | null;
  actual_boost_connects: number | null;
  boost_rank: number | null;
  actual_client_spend: number | null;
  attachments_used: string | null;
  profile_highlights_used: string | null;
  updated_at: string;
}

export interface ApplicationAnalytics {
  total: number;
  applied: number;
  replied: number;
  interviews: number;
  hired: number;
  lost: number;
  totalConnectsSpent: number;
  averageConnectsPerApplied: number;
  connectsPerReply: number | null;
  replyRate: number;
  interviewRate: number;
  hireRate: number;
  topAttachments: Array<{ name: string; count: number }>;
  topHighlights: Array<{ name: string; count: number }>;
}

export interface ApplicationNoteRow {
  id: number;
  job_id: string;
  note: string;
  created_at: string;
}

export interface ApplicationSubmissionInput {
  jobId: string;
  requiredConnects: number;
  boostConnects: number;
  boostRank: number | null;
  clientSpend: number | null;
  rate: number | null;
  profileUsed: string;
  attachmentsUsed: string[];
  profileHighlightsUsed: string[];
  submittedProposalText?: string;
  note?: string;
}

export type HeartbeatStatus = "starting" | "running" | "success" | "error" | "stale";

export interface HeartbeatRecord {
  worker: string;
  status: HeartbeatStatus;
  lastRunAt: string;
  lastSuccessAt: string | null;
  runCount: number;
  successCount: number;
  errorCount: number;
  lastError: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

interface HeartbeatRow {
  worker: string;
  status: HeartbeatStatus;
  last_run_at: string;
  last_success_at: string | null;
  run_count: number;
  success_count: number;
  error_count: number;
  last_error: string | null;
  metadata: string | null;
  updated_at: string;
}

export interface HeartbeatWriteInput {
  worker: string;
  status: Exclude<HeartbeatStatus, "stale">;
  error?: string | null;
  metadata?: Record<string, unknown>;
  at?: Date;
}

export interface SlackQueueItem {
  id: number;
  payload: string;
  attempts: number;
}

interface BrowserActionRow {
  id: number;
  job_id: string;
  action_type: BrowserActionType;
  status: BrowserActionStatus;
  payload: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const dbDirectory = path.dirname(DB_PATH);
if (!fs.existsSync(dbDirectory)) {
  fs.mkdirSync(dbDirectory, { recursive: true });
}

const db = new Database(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS seen_jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  score INTEGER DEFAULT 0,
  match_level TEXT,
  budget TEXT,
  client_country TEXT,
  client_rating REAL,
  client_spend REAL,
  client_hire_rate REAL,
  skills TEXT,
  experience_level TEXT,
  connects_cost INTEGER,
  posted_at TEXT,
  fingerprint TEXT,
  seen_at TEXT DEFAULT (datetime('now')),
  notified BOOLEAN DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_seen_at ON seen_jobs(seen_at);
CREATE INDEX IF NOT EXISTS idx_match_level ON seen_jobs(match_level);

CREATE TABLE IF NOT EXISTS slack_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  fit_score INTEGER NOT NULL DEFAULT 0,
  fit_reasons TEXT NOT NULL DEFAULT '[]',
  red_flags TEXT NOT NULL DEFAULT '[]',
  suggested_bid TEXT,
  suggested_connects INTEGER DEFAULT 0,
  suggested_boost_connects INTEGER DEFAULT 0,
  connects_warnings TEXT NOT NULL DEFAULT '[]',
  selected_portfolio_items TEXT NOT NULL DEFAULT '[]',
  proposal_text TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  reviewed_at TEXT,
  submitted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(job_id) REFERENCES seen_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

CREATE TABLE IF NOT EXISTS application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_application_events_job_id ON application_events(job_id);
CREATE INDEX IF NOT EXISTS idx_application_events_type ON application_events(event_type);

CREATE TABLE IF NOT EXISTS browser_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_browser_actions_status ON browser_actions(status);
CREATE INDEX IF NOT EXISTS idx_browser_actions_job_id ON browser_actions(job_id);
CREATE INDEX IF NOT EXISTS idx_browser_actions_created_at ON browser_actions(created_at);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_run_at TEXT NOT NULL,
  last_success_at TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS health_alerts (
  alert_key TEXT PRIMARY KEY,
  last_sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_updated_at ON worker_heartbeats(updated_at);
CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_status ON worker_heartbeats(status);
`);

function ensureSeenJobsColumn(name: string, definition: string): void {
  const columns = db.prepare<[], { name: string }>("PRAGMA table_info(seen_jobs)").all();
  const exists = columns.some((column) => column.name === name);
  if (!exists) {
    db.exec(`ALTER TABLE seen_jobs ADD COLUMN ${name} ${definition}`);
  }
}

ensureSeenJobsColumn("description", "TEXT");
ensureSeenJobsColumn("budget", "TEXT");
ensureSeenJobsColumn("client_country", "TEXT");
ensureSeenJobsColumn("client_rating", "REAL");
ensureSeenJobsColumn("client_spend", "REAL");
ensureSeenJobsColumn("client_hire_rate", "REAL");
ensureSeenJobsColumn("skills", "TEXT");
ensureSeenJobsColumn("experience_level", "TEXT");
ensureSeenJobsColumn("connects_cost", "INTEGER");

function ensureApplicationsColumn(name: string, definition: string): void {
  const columns = db.prepare<[], { name: string }>("PRAGMA table_info(applications)").all();
  const exists = columns.some((column) => column.name === name);
  if (!exists) {
    db.exec(`ALTER TABLE applications ADD COLUMN ${name} ${definition}`);
  }
}

ensureApplicationsColumn("actual_required_connects", "INTEGER");
ensureApplicationsColumn("actual_boost_connects", "INTEGER");
ensureApplicationsColumn("actual_total_connects", "INTEGER");
ensureApplicationsColumn("boost_rank", "INTEGER");
ensureApplicationsColumn("actual_client_spend", "REAL");
ensureApplicationsColumn("actual_rate", "REAL");
ensureApplicationsColumn("profile_used", "TEXT");
ensureApplicationsColumn("attachments_used", "TEXT DEFAULT '[]'");
ensureApplicationsColumn("profile_highlights_used", "TEXT DEFAULT '[]'");
ensureApplicationsColumn("submitted_proposal_text", "TEXT");
ensureSeenJobsColumn("fingerprint", "TEXT");
db.exec("CREATE INDEX IF NOT EXISTS idx_seen_jobs_fingerprint ON seen_jobs(fingerprint)");

const countStmt = db.prepare<[], CountRow>("SELECT COUNT(*) as count FROM seen_jobs");
const isSeenStmt = db.prepare<[string], SeenRow>(
  "SELECT 1 as found FROM seen_jobs WHERE id = ? LIMIT 1"
);
const insertSeenStmt = db.prepare(
  `INSERT OR IGNORE INTO seen_jobs (
    id,
    title,
    url,
    description,
    score,
    match_level,
    budget,
    client_country,
    client_rating,
    client_spend,
    client_hire_rate,
    skills,
    experience_level,
    connects_cost,
    posted_at,
    fingerprint,
    notified
  )
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const seenFingerprintStmt = db.prepare<[string], SeenRow>(
  "SELECT 1 as found FROM seen_jobs WHERE fingerprint = ? LIMIT 1"
);
const recentSeenFingerprintsStmt = db.prepare<[], SeenFingerprintRow>(
  `SELECT id, title, url, description, posted_at, budget, client_country, client_rating, client_spend,
          client_hire_rate, skills, experience_level, connects_cost, fingerprint
   FROM seen_jobs
   WHERE fingerprint IS NOT NULL
   ORDER BY seen_at DESC
   LIMIT 500`
);
const cleanupStmt = db.prepare("DELETE FROM seen_jobs WHERE seen_at < datetime('now', '-30 days')");
const queueInsertStmt = db.prepare("INSERT INTO slack_queue (payload, attempts) VALUES (?, 0)");
const queueSelectStmt = db.prepare<[], SlackQueueItem>(
  "SELECT id, payload, attempts FROM slack_queue ORDER BY id ASC LIMIT 25"
);
const queueDeleteStmt = db.prepare("DELETE FROM slack_queue WHERE id = ?");
const queueAttemptStmt = db.prepare(
  "UPDATE slack_queue SET attempts = attempts + 1 WHERE id = ?"
);
const insertBrowserActionStmt = db.prepare(
  `INSERT INTO browser_actions (job_id, action_type, status, payload, attempts, last_error, updated_at)
   VALUES (?, ?, 'pending', ?, 0, NULL, datetime('now'))`
);
const listBrowserActionsStmt = db.prepare<[BrowserActionStatus | null, BrowserActionStatus | null, number], BrowserActionRow>(
  `SELECT id, job_id, action_type, status, payload, attempts, last_error, created_at, updated_at
   FROM browser_actions
   WHERE (? IS NULL OR status = ?)
   ORDER BY created_at ASC, id ASC
   LIMIT ?`
);
const updateBrowserActionStatusStmt = db.prepare(
  `UPDATE browser_actions
   SET status = ?, last_error = ?, updated_at = datetime('now')
   WHERE id = ?`
);
const incrementBrowserActionAttemptStmt = db.prepare(
  `UPDATE browser_actions
   SET attempts = attempts + 1, last_error = ?, updated_at = datetime('now')
   WHERE id = ?`
);
const upsertHeartbeatStmt = db.prepare(
  `INSERT INTO worker_heartbeats (
    worker,
    status,
    last_run_at,
    last_success_at,
    run_count,
    success_count,
    error_count,
    last_error,
    metadata,
    updated_at
  ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  ON CONFLICT(worker) DO UPDATE SET
    status = excluded.status,
    last_run_at = excluded.last_run_at,
    last_success_at = COALESCE(excluded.last_success_at, worker_heartbeats.last_success_at),
    run_count = worker_heartbeats.run_count + 1,
    success_count = worker_heartbeats.success_count + excluded.success_count,
    error_count = worker_heartbeats.error_count + excluded.error_count,
    last_error = excluded.last_error,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at`
);
const getHeartbeatStmt = db.prepare<[string], HeartbeatRow>(
  `SELECT worker, status, last_run_at, last_success_at, run_count, success_count, error_count,
          last_error, metadata, updated_at
   FROM worker_heartbeats
   WHERE worker = ?`
);
const listHeartbeatsStmt = db.prepare<[], HeartbeatRow>(
  `SELECT worker, status, last_run_at, last_success_at, run_count, success_count, error_count,
          last_error, metadata, updated_at
   FROM worker_heartbeats
   ORDER BY worker ASC`
);
const staleHeartbeatsStmt = db.prepare<[string], HeartbeatRow>(
  `SELECT worker, status, last_run_at, last_success_at, run_count, success_count, error_count,
          last_error, metadata, updated_at
   FROM worker_heartbeats
   WHERE datetime(updated_at) < datetime(?)
   ORDER BY updated_at ASC`
);
const getHealthAlertStmt = db.prepare<[string], { last_sent_at: string }>(
  "SELECT last_sent_at FROM health_alerts WHERE alert_key = ?"
);
const upsertHealthAlertStmt = db.prepare(
  `INSERT INTO health_alerts (alert_key, last_sent_at) VALUES (?, ?)
   ON CONFLICT(alert_key) DO UPDATE SET last_sent_at = excluded.last_sent_at`
);

function formatHeartbeatTimestamp(date: Date): string {
  return date.toISOString();
}

function parseHeartbeatMetadata(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function rowToHeartbeat(row: HeartbeatRow): HeartbeatRecord {
  return {
    worker: row.worker,
    status: row.status,
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    runCount: row.run_count,
    successCount: row.success_count,
    errorCount: row.error_count,
    lastError: row.last_error,
    metadata: parseHeartbeatMetadata(row.metadata),
    updatedAt: row.updated_at,
  };
}
const upsertApplicationStmt = db.prepare(
  `INSERT INTO applications (
    job_id,
    status,
    fit_score,
    fit_reasons,
    red_flags,
    suggested_bid,
    suggested_connects,
    suggested_boost_connects,
    connects_warnings,
    selected_portfolio_items,
    proposal_text,
    generated_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(job_id) DO UPDATE SET
    status = excluded.status,
    fit_score = excluded.fit_score,
    fit_reasons = excluded.fit_reasons,
    red_flags = excluded.red_flags,
    suggested_bid = excluded.suggested_bid,
    suggested_connects = excluded.suggested_connects,
    suggested_boost_connects = excluded.suggested_boost_connects,
    connects_warnings = excluded.connects_warnings,
    selected_portfolio_items = excluded.selected_portfolio_items,
    proposal_text = excluded.proposal_text,
    generated_at = excluded.generated_at,
    updated_at = datetime('now')`
);
const getApplicationStatusStmt = db.prepare<[string], { status: ApplicationStatus }>(
  "SELECT status FROM applications WHERE job_id = ? LIMIT 1"
);
const updateApplicationStatusStmt = db.prepare<[ApplicationStatus, string | null, string | null, string]>(
  `UPDATE applications
   SET status = ?, reviewed_at = COALESCE(?, reviewed_at), submitted_at = COALESCE(?, submitted_at), updated_at = datetime('now')
   WHERE job_id = ?`
);
const insertApplicationEventStmt = db.prepare(
  "INSERT INTO application_events (job_id, event_type, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)"
);
const applicationSummaryStmt = db.prepare<[], ApplicationSummaryRow>(
  "SELECT status, COUNT(*) as count FROM applications GROUP BY status ORDER BY count DESC"
);
const applicationListStmt = db.prepare<[number], ApplicationListRow>(
  `SELECT a.job_id, a.status, a.fit_score, s.title, s.url, a.suggested_bid, a.suggested_connects,
          a.actual_total_connects, a.actual_boost_connects, a.boost_rank, a.actual_client_spend,
          a.attachments_used, a.profile_highlights_used, a.updated_at
   FROM applications a
   LEFT JOIN seen_jobs s ON s.id = a.job_id
   ORDER BY a.updated_at DESC
   LIMIT ?`
);
const applicationNotesStmt = db.prepare<[string], ApplicationNoteRow>(
  "SELECT id, job_id, note, created_at FROM application_events WHERE job_id = ? AND event_type = 'note' ORDER BY id DESC"
);
const slackPreviewJobStmt = db.prepare<[string], SlackPreviewJobRow>(
  `SELECT s.id, s.title, s.url, s.description, s.score, s.match_level, s.budget, s.client_country,
          s.client_rating, s.client_spend, s.client_hire_rate, s.skills, s.experience_level,
          s.connects_cost, s.posted_at, a.status, a.fit_score, a.fit_reasons, a.red_flags,
          a.suggested_bid, a.suggested_connects, a.suggested_boost_connects, a.connects_warnings,
          a.selected_portfolio_items, a.proposal_text, a.generated_at
   FROM seen_jobs s
   LEFT JOIN applications a ON a.job_id = s.id
   WHERE s.id = ?
   LIMIT 1`
);
const recordApplicationSubmissionStmt = db.prepare(
  `UPDATE applications
   SET status = 'applied',
       actual_required_connects = ?,
       actual_boost_connects = ?,
       actual_total_connects = ?,
       boost_rank = ?,
       actual_client_spend = ?,
       actual_rate = ?,
       profile_used = ?,
       attachments_used = ?,
       profile_highlights_used = ?,
       submitted_proposal_text = COALESCE(?, submitted_proposal_text),
       submitted_at = COALESCE(submitted_at, ?),
       updated_at = datetime('now')
   WHERE job_id = ?`
);

export function closeDb(): void {
  db.close();
}

export function isFirstRun(): boolean {
  return (countStmt.get()?.count ?? 0) === 0;
}

export function isJobSeen(id: string): boolean {
  return Boolean(isSeenStmt.get(id));
}

export function isJobFingerprintSeen(job: JobPosting): boolean {
  const fingerprint = buildJobFingerprint(job);
  if (seenFingerprintStmt.get(fingerprint)) {
    return true;
  }

  return recentSeenFingerprintsStmt.all().some((row) => {
    if (!row.fingerprint) return false;
    return areNearDuplicateJobs(rowToJobPosting(row), job);
  });
}

function rowToJobPosting(row: SeenFingerprintRow): JobPosting {
  let skills: string[] = [];
  if (row.skills) {
    try {
      const parsed = JSON.parse(row.skills);
      if (Array.isArray(parsed)) {
        skills = parsed.filter((skill): skill is string => typeof skill === "string");
      }
    } catch {
      skills = [];
    }
  }

  return {
    id: row.id,
    title: row.title,
    url: row.url,
    description: row.description ?? "",
    postedAt: row.posted_at ?? "",
    budget: row.budget ?? "",
    clientCountry: row.client_country ?? "",
    clientRating: row.client_rating ?? 0,
    clientSpend: row.client_spend ?? 0,
    clientHireRate: row.client_hire_rate ?? 0,
    clientTotalHires: 0,
    clientFeedbackCount: 0,
    category: "",
    experienceLevel: row.experience_level ?? "",
    connectsCost: row.connects_cost ?? 0,
    skills,
    sourceQuery: "seen_jobs",
  };
}

export function markJobSeen(job: ScoredJob, notified: boolean): void {
  insertSeenStmt.run(
    job.id,
    job.title,
    job.url,
    job.description,
    job.score,
    job.matchLevel,
    job.budget,
    job.clientCountry,
    job.clientRating,
    job.clientSpend,
    job.clientHireRate,
    JSON.stringify(job.skills),
    job.experienceLevel,
    job.connectsCost,
    job.postedAt,
    buildJobFingerprint(job),
    notified ? 1 : 0
  );
  if (job.applicationDraft) {
    saveApplicationDraft(job.applicationDraft);
  }
}

export function saveApplicationDraft(draft: ApplicationDraft): void {
  const previousStatus = getApplicationStatus(draft.jobId);
  upsertApplicationStmt.run(
    draft.jobId,
    draft.status,
    draft.fitScore,
    JSON.stringify(draft.fitReasons),
    JSON.stringify(draft.redFlags),
    draft.suggestedBid,
    draft.suggestedConnects,
    draft.suggestedBoostConnects,
    JSON.stringify(draft.connectsWarnings),
    JSON.stringify(draft.selectedPortfolioItems),
    draft.proposalText,
    draft.generatedAt
  );
  if (!previousStatus) {
    insertApplicationEventStmt.run(draft.jobId, "created", null, draft.status, "Application draft created.");
  }
}

export function getApplicationStatus(jobId: string): ApplicationStatus | null {
  return getApplicationStatusStmt.get(jobId)?.status ?? null;
}

export function updateApplicationStatus(
  jobId: string,
  status: ApplicationStatus,
  note?: string
): boolean {
  const previousStatus = getApplicationStatus(jobId);
  if (!previousStatus) {
    return false;
  }
  const now = new Date().toISOString();
  const reviewedAt = ["approved", "rejected", "lost"].includes(status) ? now : null;
  const submittedAt = ["applied", "submitted"].includes(status) ? now : null;
  const result = updateApplicationStatusStmt.run(status, reviewedAt, submittedAt, jobId);
  insertApplicationEventStmt.run(jobId, "status_changed", previousStatus, status, note ?? null);
  return result.changes > 0;
}

export function addApplicationNote(jobId: string, note: string): boolean {
  const currentStatus = getApplicationStatus(jobId);
  if (!currentStatus) {
    return false;
  }
  insertApplicationEventStmt.run(jobId, "note", currentStatus, currentStatus, note);
  return true;
}

export function getApplicationSummary(): ApplicationSummaryRow[] {
  return applicationSummaryStmt.all();
}

export function listRecentApplications(limit = 20): ApplicationListRow[] {
  return applicationListStmt.all(limit);
}

export function getApplicationNotes(jobId: string): ApplicationNoteRow[] {
  return applicationNotesStmt.all(jobId);
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function getScoredJobForSlackPreview(jobId: string): ScoredJob | null {
  const row = slackPreviewJobStmt.get(jobId);
  if (!row) {
    return null;
  }

  const fitReasons = parseJsonStringArray(row.fit_reasons);
  const redFlags = parseJsonStringArray(row.red_flags);
  const connectsWarnings = parseJsonStringArray(row.connects_warnings);
  const applicationDraft: ApplicationDraft | undefined = row.proposal_text
    ? {
        jobId: row.id,
        status: row.status ?? "draft",
        fitScore: row.fit_score ?? row.score ?? 0,
        fitReasons,
        redFlags,
        suggestedBid: row.suggested_bid ?? "Not specified",
        suggestedConnects: row.suggested_connects ?? row.connects_cost ?? 0,
        suggestedBoostConnects: row.suggested_boost_connects ?? 0,
        connectsWarnings,
        selectedPortfolioItems: parseJsonArray<PortfolioItem>(row.selected_portfolio_items),
        proposalQuality: {
          score: 0,
          issues: [
            {
              category: "voice",
              severity: "info",
              message: "Proposal quality was not persisted with this stored draft.",
              suggestion: "Regenerate the draft before final approval if quality scoring is required.",
            },
          ],
          positiveSignals: [],
          wordCount: row.proposal_text.trim().split(/\s+/).filter(Boolean).length,
        },
        proposalText: row.proposal_text,
        generatedAt: row.generated_at ?? new Date().toISOString(),
      }
    : undefined;

  return {
    id: row.id,
    title: row.title,
    url: row.url,
    description: row.description ?? "",
    postedAt: row.posted_at ?? new Date().toISOString(),
    budget: row.budget ?? "",
    clientCountry: row.client_country ?? "",
    clientRating: row.client_rating ?? 0,
    clientSpend: row.client_spend ?? 0,
    clientHireRate: row.client_hire_rate ?? 0,
    clientTotalHires: 0,
    clientFeedbackCount: 0,
    category: "stored",
    experienceLevel: row.experience_level ?? "",
    connectsCost: row.connects_cost ?? 0,
    skills: parseJsonStringArray(row.skills),
    sourceQuery: "stored-preview",
    score: row.score ?? row.fit_score ?? 0,
    matchLevel: row.match_level ?? "medium",
    matchedKeywords: [],
    negativeKeywords: [],
    scoreBreakdown: {
      fitScore: { score: row.fit_score ?? row.score ?? 0, reasons: fitReasons, risks: redFlags },
      clientQualityScore: { score: 0, reasons: [], risks: [] },
      opportunityScore: { score: 0, reasons: [], risks: [] },
      redFlagScore: { score: redFlags.length ? 50 : 100, reasons: [], risks: redFlags },
      connectsRiskScore: { score: 0, reasons: [], risks: connectsWarnings },
      finalScore: row.score ?? row.fit_score ?? 0,
      reasons: fitReasons,
      risks: redFlags,
    },
    applicationDraft,
  };
}

function topCounts(values: string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 10);
}

export function getApplicationAnalytics(): ApplicationAnalytics {
  const rows = db
    .prepare<[], ApplicationListRow>(
      `SELECT a.job_id, a.status, a.fit_score, s.title, s.url, a.suggested_bid, a.suggested_connects,
              a.actual_total_connects, a.actual_boost_connects, a.boost_rank, a.actual_client_spend,
              a.attachments_used, a.profile_highlights_used, a.updated_at
       FROM applications a
       LEFT JOIN seen_jobs s ON s.id = a.job_id`
    )
    .all();
  const total = rows.length;
  const appliedStatuses: ApplicationStatus[] = ["applied", "submitted", "replied", "interview", "hired", "lost"];
  const appliedRows = rows.filter((row) => appliedStatuses.includes(row.status));
  const repliedRows = rows.filter((row) => ["replied", "interview", "hired"].includes(row.status));
  const interviewRows = rows.filter((row) => ["interview", "hired"].includes(row.status));
  const hiredRows = rows.filter((row) => row.status === "hired");
  const lostRows = rows.filter((row) => row.status === "lost");
  const totalConnectsSpent = appliedRows.reduce((sum, row) => sum + (row.actual_total_connects ?? 0), 0);
  const attachments = appliedRows.flatMap((row) => parseJsonStringArray(row.attachments_used));
  const highlights = appliedRows.flatMap((row) => parseJsonStringArray(row.profile_highlights_used));

  return {
    total,
    applied: appliedRows.length,
    replied: repliedRows.length,
    interviews: interviewRows.length,
    hired: hiredRows.length,
    lost: lostRows.length,
    totalConnectsSpent,
    averageConnectsPerApplied: appliedRows.length ? totalConnectsSpent / appliedRows.length : 0,
    connectsPerReply: repliedRows.length ? totalConnectsSpent / repliedRows.length : null,
    replyRate: appliedRows.length ? repliedRows.length / appliedRows.length : 0,
    interviewRate: appliedRows.length ? interviewRows.length / appliedRows.length : 0,
    hireRate: appliedRows.length ? hiredRows.length / appliedRows.length : 0,
    topAttachments: topCounts(attachments),
    topHighlights: topCounts(highlights),
  };
}

export function recordApplicationSubmission(input: ApplicationSubmissionInput): boolean {
  const previousStatus = getApplicationStatus(input.jobId);
  if (!previousStatus) {
    return false;
  }
  const totalConnects = input.requiredConnects + input.boostConnects;
  const submittedAt = new Date().toISOString();
  const result = recordApplicationSubmissionStmt.run(
    input.requiredConnects,
    input.boostConnects,
    totalConnects,
    input.boostRank,
    input.clientSpend,
    input.rate,
    input.profileUsed,
    JSON.stringify(input.attachmentsUsed),
    JSON.stringify(input.profileHighlightsUsed),
    input.submittedProposalText ?? null,
    submittedAt,
    input.jobId
  );
  insertApplicationEventStmt.run(
    input.jobId,
    "submission_recorded",
    previousStatus,
    "applied",
    input.note ??
      `Applied: required=${input.requiredConnects}, boost=${input.boostConnects}, total=${totalConnects}, rank=${input.boostRank ?? "n/a"}`
  );
  return result.changes > 0;
}

function parseBrowserActionPayload(value: string): BrowserActionPayload {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as BrowserActionPayload)
      : {};
  } catch {
    return {};
  }
}

function rowToBrowserAction(row: BrowserActionRow): BrowserAction {
  return {
    id: row.id,
    jobId: row.job_id,
    actionType: row.action_type,
    status: row.status,
    payload: parseBrowserActionPayload(row.payload),
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function enqueueBrowserAction(input: BrowserActionInput): number {
  const result = insertBrowserActionStmt.run(
    input.jobId,
    input.actionType,
    JSON.stringify(input.payload ?? {})
  );
  return Number(result.lastInsertRowid);
}

export function listBrowserActions(status: BrowserActionStatus | null = null, limit = 25): BrowserAction[] {
  return listBrowserActionsStmt.all(status, status, limit).map(rowToBrowserAction);
}

export function updateBrowserActionStatus(id: number, status: BrowserActionStatus, lastError?: string): boolean {
  const result = updateBrowserActionStatusStmt.run(status, lastError ?? null, id);
  return result.changes > 0;
}

export function incrementBrowserActionAttempts(id: number, lastError?: string): boolean {
  const result = incrementBrowserActionAttemptStmt.run(lastError ?? null, id);
  return result.changes > 0;
}

export function recordHeartbeat(input: HeartbeatWriteInput): HeartbeatRecord {
  const timestamp = formatHeartbeatTimestamp(input.at ?? new Date());
  const isSuccess = input.status === "success";
  const isError = input.status === "error";
  upsertHeartbeatStmt.run(
    input.worker,
    input.status,
    timestamp,
    isSuccess ? timestamp : null,
    isSuccess ? 1 : 0,
    isError ? 1 : 0,
    input.error ?? null,
    JSON.stringify(input.metadata ?? {}),
    timestamp
  );

  const heartbeat = getHeartbeat(input.worker);
  if (!heartbeat) {
    throw new Error(`Failed to record heartbeat for ${input.worker}`);
  }
  return heartbeat;
}

export function getHeartbeat(worker: string): HeartbeatRecord | null {
  const row = getHeartbeatStmt.get(worker);
  return row ? rowToHeartbeat(row) : null;
}

export function listHeartbeats(): HeartbeatRecord[] {
  return listHeartbeatsStmt.all().map(rowToHeartbeat);
}

export function listStaleHeartbeats(thresholdMs: number, now = new Date()): HeartbeatRecord[] {
  const staleBefore = new Date(now.getTime() - thresholdMs);
  return staleHeartbeatsStmt.all(formatHeartbeatTimestamp(staleBefore)).map((row) => ({
    ...rowToHeartbeat(row),
    status: "stale",
  }));
}

export function getHealthAlertLastSent(alertKey: string): string | null {
  return getHealthAlertStmt.get(alertKey)?.last_sent_at ?? null;
}

export function recordHealthAlertSent(alertKey: string, sentAt = new Date()): void {
  upsertHealthAlertStmt.run(alertKey, formatHeartbeatTimestamp(sentAt));
}

export function cleanupOldSeenJobs(): number {
  const result = cleanupStmt.run();
  return result.changes;
}

export function queueSlackMessage(payload: string): void {
  queueInsertStmt.run(payload);
}

export function getQueuedSlackMessages(): SlackQueueItem[] {
  return queueSelectStmt.all();
}

export function markQueuedMessageSent(id: number): void {
  queueDeleteStmt.run(id);
}

export function incrementQueuedMessageAttempts(id: number): void {
  queueAttemptStmt.run(id);
}

export function getDbStats(): SeenStats {
  const total = countStmt.get()?.count ?? 0;
  const matchCounts = db
    .prepare<[], MatchCountRow>(
      `SELECT match_level, COUNT(*) as count
       FROM seen_jobs
       GROUP BY match_level`
    )
    .all();

  const stats: SeenStats = {
    total,
    high: 0,
    medium: 0,
    low: 0,
    skip: 0,
  };

  for (const row of matchCounts) {
    if (row.match_level === "high") {
      stats.high = row.count;
    } else if (row.match_level === "medium") {
      stats.medium = row.count;
    } else if (row.match_level === "low") {
      stats.low = row.count;
    } else if (row.match_level === "skip") {
      stats.skip = row.count;
    }
  }

  return stats;
}

function formatDateKeyInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getDailySummary(referenceDate = new Date()): DailySummary {
  const rows = db
    .prepare<[], DailyRow>(
      "SELECT title, score, match_level, seen_at FROM seen_jobs"
    )
    .all();

  const targetDay = formatDateKeyInTimezone(referenceDate, TIMEZONE);
  let high = 0;
  let medium = 0;
  let low = 0;
  let filteredOut = 0;
  let topJobTitle: string | null = null;
  let topJobScore: number | null = null;

  for (const row of rows) {
    const rowDate = new Date(`${row.seen_at}Z`);
    if (Number.isNaN(rowDate.getTime())) {
      continue;
    }
    const rowDay = formatDateKeyInTimezone(rowDate, TIMEZONE);
    if (rowDay !== targetDay) {
      continue;
    }

    if (row.match_level === "high") {
      high += 1;
    } else if (row.match_level === "medium") {
      medium += 1;
    } else if (row.match_level === "low") {
      low += 1;
    } else {
      filteredOut += 1;
    }

    if (topJobScore === null || row.score > topJobScore) {
      topJobTitle = row.title;
      topJobScore = row.score;
    }
  }

  return {
    high,
    medium,
    low,
    filteredOut,
    topJobTitle,
    topJobScore,
  };
}
