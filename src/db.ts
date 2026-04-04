import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH, TIMEZONE } from "./config";
import { DailySummary, MatchLevel, ScoredJob } from "./types";

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

export interface SlackQueueItem {
  id: number;
  payload: string;
  attempts: number;
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
  score INTEGER DEFAULT 0,
  match_level TEXT,
  posted_at TEXT,
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
`);

const countStmt = db.prepare<[], CountRow>("SELECT COUNT(*) as count FROM seen_jobs");
const isSeenStmt = db.prepare<[string], SeenRow>(
  "SELECT 1 as found FROM seen_jobs WHERE id = ? LIMIT 1"
);
const insertSeenStmt = db.prepare(
  `INSERT OR IGNORE INTO seen_jobs (id, title, url, score, match_level, posted_at, notified)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
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

export function closeDb(): void {
  db.close();
}

export function isFirstRun(): boolean {
  return (countStmt.get()?.count ?? 0) === 0;
}

export function isJobSeen(id: string): boolean {
  return Boolean(isSeenStmt.get(id));
}

export function markJobSeen(job: ScoredJob, notified: boolean): void {
  insertSeenStmt.run(
    job.id,
    job.title,
    job.url,
    job.score,
    job.matchLevel,
    job.postedAt,
    notified ? 1 : 0
  );
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
