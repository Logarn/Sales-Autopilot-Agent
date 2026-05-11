import { createHash } from "node:crypto";
import { parseJobDetailCapture } from "./jobCapture";
import { JobDetailCaptureResult } from "./jobCapture";

const UPWORK_HOSTS = new Set(["upwork.com", "www.upwork.com"]);
const UPWORK_JOB_ID_PATTERN = /~([A-Za-z0-9_-]{8,})/;

function isUpworkHost(hostname: string): boolean {
  return UPWORK_HOSTS.has(hostname.toLowerCase().replace(/^www\./, ""));
}

function normalizeUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

export function isSafeUpworkJobUrl(value: string): boolean {
  const parsed = normalizeUrl(value);
  return Boolean(parsed && parsed.protocol === "https:" && isUpworkHost(parsed.hostname) && parsed.pathname.startsWith("/jobs/"));
}

export function extractUpworkJobIdFromUrl(value: string): string | null {
  const parsed = normalizeUrl(value);
  if (!parsed || parsed.protocol !== "https:" || !isUpworkHost(parsed.hostname)) {
    return null;
  }
  if (!parsed.pathname.startsWith("/jobs/")) {
    return null;
  }
  return parsed.pathname.match(UPWORK_JOB_ID_PATTERN)?.[1] ?? null;
}

export function deriveCaptureThreadJobId(value: string, parsedJobId: string | null): string {
  const jobId = parsedJobId?.trim() ? `manual:upwork-${parsedJobId.trim()}` : null;
  if (jobId) {
    return jobId;
  }
  const normalized = normalizeUrl(value)?.toString() ?? value.trim();
  const suffix = createHash("sha1").update(normalized).digest("hex").slice(0, 14);
  return `manual:url-${suffix}`;
}

export interface BrowserCaptureActionPayload {
  source: "slack_url";
  url: string;
  channelId: string;
  messageTs: string;
  threadTs: string;
}

export function buildCaptureActionPayload(
  upworkUrl: string,
  channelId: string,
  messageTs: string,
  threadTs: string,
): BrowserCaptureActionPayload {
  return {
    source: "slack_url",
    url: upworkUrl,
    channelId,
    messageTs,
    threadTs,
  };
}

export function parseCaptureQuestions(rawText: string, limit = 6): string[] {
  const text = rawText.replace(/\r/g, "");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const questions: string[] = [];

  const startIndex = lines.findIndex((line) => /screening questions|application questions|to apply|interview questions/i.test(line));
  const scanFrom = startIndex >= 0 ? startIndex + 1 : 0;

  const sectionStopPatterns = [
    /proposal|proposals?/i,
    /activity on this job/i,
    /about the client/i,
    /client history/i,
    /upwork/i,
  ];

  for (let i = scanFrom; i < lines.length; i += 1) {
    const line = lines[i];
    if (startIndex === -1 && i > 0 && i > 60) break;
    if (sectionStopPatterns.some((pattern) => pattern.test(line))) {
      if (questions.length > 0) {
        break;
      }
      if (i > scanFrom + 3) {
        break;
      }
      continue;
    }
    if (line.length < 8) {
      continue;
    }
    if (!/[?]/.test(line) && !/^(\d+\.|-|•|\*)/.test(line)) {
      continue;
    }
    const normalized = line.replace(/^(\d+\.|-|•|\*)\s*/, "");
    if (!normalized || normalized.length < 8) {
      continue;
    }
    const dedup = normalized.toLowerCase();
    if (questions.some((existing) => existing.toLowerCase() === dedup)) {
      continue;
    }
    questions.push(normalized);
    if (questions.length >= limit) {
      break;
    }
  }

  return questions;
}

export function buildQuestionAnswers(questions: string[], context: { bid: string; profileSummary: string }): string[] {
  if (questions.length === 0) return [];
  return questions.map((question) => {
    const lower = question.toLowerCase();
    if (/rate|budget|rate|hour|price|pay/.test(lower)) {
      return `Proposed rate: ${context.bid}. I will keep this aligned to job scope and keep any changes visible before submission.`;
    }
    if (/timeline|deadline|duration|eta|start|available/.test(lower)) {
      return "I can start quickly with a short diagnostic pass and keep execution milestones explicit to reduce risk.";
    }
    if (/proof|example|portfolio|case|case study|experience/.test(lower)) {
      return `Relevant proof: ${context.profileSummary}.`;
    }
    return `Based on the role ${context.profileSummary}, I can address this directly and propose a practical plan before implementation.`;
  });
}

export function buildDryRunCaptureInput(upworkUrl: string, capturedAt = new Date()): {
  parsed: JobDetailCaptureResult;
  rawText: string;
} {
  const normalizedUrl = upworkUrl.trim();
  const fallbackText = `Upwork job capture (dry-run preview).\nURL: ${normalizedUrl}`;
  const parsed = parseJobDetailCapture(fallbackText, { url: normalizedUrl, capturedAt });
  return { parsed, rawText: fallbackText };
}
