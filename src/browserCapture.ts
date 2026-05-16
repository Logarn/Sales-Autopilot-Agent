import { createHash } from "node:crypto";
import { parseJobDetailCapture } from "./jobCapture";
import { JobDetailCaptureResult } from "./jobCapture";

export interface BrowserCaptureLocatorLike {
  count(): Promise<number>;
  first(): BrowserCaptureLocatorLike;
  textContent(options?: { timeout?: number }): Promise<string | null>;
}

export interface BrowserCapturePageLike {
  url(): string;
  title(): Promise<string>;
  locator(selector: string): BrowserCaptureLocatorLike;
}

export interface UpworkStructuredExtractionDiagnostics {
  titleSource: "selector" | "page_title" | "card_heading" | "detail_heading" | "description_first_heading" | "fallback";
  descriptionSource: "selector" | "main" | "fallback";
  capturedTitle: string;
  descriptionLength: number;
  descriptionPreview: string;
  removedNoiseMarkers: number;
  rawConfigNoiseDetected: boolean;
  lowConfidence: boolean;
  reasons: string[];
  rejectedGenericTitle?: boolean;
  extractedTitleCandidates?: string[];
}

export interface UpworkStructuredExtractionResult {
  rawText: string;
  title: string;
  description: string;
  skills: string[];
  applicationQuestions: string[];
  diagnostics: UpworkStructuredExtractionDiagnostics;
}

export interface UpworkSourceContextCaptureInput {
  html: string;
  text?: string;
  pageUrl: string;
  pageTitle: string;
  targetJobId: string;
  canonicalJobUrl: string;
}

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

export function extractUpworkJobIdFromUrl(value: string): string | null {
  const parsed = normalizeUrl(value);
  if (!parsed || parsed.protocol !== "https:" || !isUpworkHost(parsed.hostname)) {
    return null;
  }
  return parsed.pathname.match(UPWORK_JOB_ID_PATTERN)?.[1] ?? null;
}

export function canonicalizeUpworkJobUrl(value: string): string | null {
  const parsed = normalizeUrl(value);
  const jobId = extractUpworkJobIdFromUrl(value);
  if (!parsed || parsed.protocol !== "https:" || !isUpworkHost(parsed.hostname) || !jobId) {
    return null;
  }
  return `${parsed.origin}/jobs/~${jobId}`;
}

export function isSupportedUpworkJobUrl(value: string): boolean {
  const parsed = normalizeUrl(value);
  if (!parsed || parsed.protocol !== "https:" || !isUpworkHost(parsed.hostname)) {
    return false;
  }
  return Boolean(
    parsed.pathname.match(/^\/jobs\/(?:[^/?#]+_)?~[A-Za-z0-9_-]{8,}\/?$/i) ||
    parsed.pathname.match(/^\/nx\/find-work\/best-matches\/details\/~[A-Za-z0-9_-]{8,}/i) ||
    parsed.pathname.match(/^\/(?:nx|ab)\/proposals\/job\/~[A-Za-z0-9_-]{8,}\/apply\/?$/i)
  );
}

export function isSafeUpworkJobUrl(value: string): boolean {
  return Boolean(canonicalizeUpworkJobUrl(value));
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
  originalUrl?: string;
  canonicalJobUrl?: string;
  channelId: string;
  messageTs: string;
  threadTs: string;
}

export function buildCaptureActionPayload(
  upworkUrl: string,
  channelId: string,
  messageTs: string,
  threadTs: string,
  metadata: { originalUrl?: string; canonicalJobUrl?: string } = {},
): BrowserCaptureActionPayload {
  return {
    source: "slack_url",
    url: upworkUrl,
    ...(metadata.originalUrl ? { originalUrl: metadata.originalUrl } : {}),
    ...(metadata.canonicalJobUrl ? { canonicalJobUrl: metadata.canonicalJobUrl } : {}),
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function htmlToReadableText(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/section|\/article|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"')
  );
}

function htmlAttribute(value: string, attribute: string): string | null {
  const pattern = new RegExp(`${attribute}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  return value.match(pattern)?.[2] ?? null;
}

function isGenericSourceContextTitle(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return true;
  return /^(jobs you might like|best matches|job details?|upwork|find work|most recent|saved jobs|filters?|job filters?|saved searches?|search jobs|browse jobs|posted|proposals?|payment verified|verified|skills?|close the tooltip|new)$/.test(normalized);
}

function compactTitleCandidate(value: string): string {
  return cleanJobTitle(value).replace(/\s+/g, " ").trim().slice(0, 180);
}

function uniqueCompactCandidates(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map(compactTitleCandidate).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= 8) break;
  }
  return output;
}

function extractSourceContextTitle(chunkHtml: string, chunkText: string, targetJobId: string): { title: string; source: UpworkStructuredExtractionDiagnostics["titleSource"]; rejectedGenericTitle: boolean; candidates: string[] } {
  const rawCandidates: string[] = [];
  let rejectedGenericTitle = false;
  const accept = (value: string, source: UpworkStructuredExtractionDiagnostics["titleSource"]): { title: string; source: UpworkStructuredExtractionDiagnostics["titleSource"]; rejectedGenericTitle: boolean; candidates: string[] } | null => {
    const candidate = compactTitleCandidate(value);
    if (!candidate || candidate.length < 8 || candidate.length > 180) return null;
    rawCandidates.push(candidate);
    if (isGenericSourceContextTitle(candidate)) {
      rejectedGenericTitle = true;
      return null;
    }
    return { title: candidate, source, rejectedGenericTitle, candidates: uniqueCompactCandidates(rawCandidates) };
  };

  const targetAnchorPattern = new RegExp(`<a\\b[^>]*href\\s*=\\s*["'][^"']*~${targetJobId}[^"']*["'][^>]*>([\\s\\S]{1,700}?)<\\/a>`, "gi");
  for (const match of chunkHtml.matchAll(targetAnchorPattern)) {
    const accepted = accept(htmlToReadableText(match[1] ?? ""), "card_heading");
    if (accepted) return accepted;
  }

  const targetIndex = chunkHtml.indexOf(`~${targetJobId}`);
  const localHtml = targetIndex >= 0 ? chunkHtml.slice(Math.max(0, targetIndex - 2500), Math.min(chunkHtml.length, targetIndex + 4500)) : chunkHtml;
  const headingPattern = /<h[1-3][^>]*>([\s\S]{4,500}?)<\/h[1-3]>/gi;
  for (const match of localHtml.matchAll(headingPattern)) {
    const accepted = accept(htmlToReadableText(match[1] ?? ""), "detail_heading");
    if (accepted) return accepted;
  }

  for (const match of chunkHtml.matchAll(headingPattern)) {
    const accepted = accept(htmlToReadableText(match[1] ?? ""), "detail_heading");
    if (accepted) return accepted;
  }

  const aria = htmlAttribute(localHtml, "aria-label") ?? htmlAttribute(chunkHtml, "aria-label");
  if (aria && !/apply|save|more|menu/i.test(aria)) {
    const accepted = accept(aria, "card_heading");
    if (accepted) return accepted;
  }

  for (const line of chunkText.split("\n").map(compactTitleCandidate)) {
    const accepted = accept(line, "description_first_heading");
    if (accepted) return accepted;
  }

  return { title: "", source: "fallback", rejectedGenericTitle, candidates: uniqueCompactCandidates(rawCandidates) };
}

function targetJobIdAppearsInSourceContext(input: UpworkSourceContextCaptureInput): boolean {
  if (!/^\d{12,24}$/.test(input.targetJobId)) return false;
  if (extractUpworkJobIdFromUrl(input.pageUrl) === input.targetJobId) return true;
  return new RegExp(`~${input.targetJobId}(?!\\d)`).test(input.html);
}

function sourceContextLooksRestricted(input: UpworkSourceContextCaptureInput): boolean {
  const urlTitle = `${input.pageUrl}\n${input.pageTitle}`;
  if (/__cf_chl|\/cdn-cgi\/challenge|just\s+a\s+moment|security\s+check|attention\s+required/i.test(urlTitle)) return true;
  const visibleText = input.text ?? "";
  return /verify\s+you\s+are\s+human|checking\s+your\s+browser|checking\s+if\s+the\s+site\s+connection\s+is\s+secure|i['’]m\s+not\s+a\s+robot|security\s+check|unusual\s+traffic/i.test(visibleText);
}

export function extractUpworkSourceContextJobContent(input: UpworkSourceContextCaptureInput): UpworkStructuredExtractionResult | null {
  if (!targetJobIdAppearsInSourceContext(input)) return null;

  const targetIndex = input.html.indexOf(`~${input.targetJobId}`);
  const contextHtml = targetIndex >= 0
    ? input.html.slice(Math.max(0, targetIndex - 8000), Math.min(input.html.length, targetIndex + 12000))
    : input.html;
  const contextText = htmlToReadableText(contextHtml) || normalizeWhitespace(input.text ?? "");
  const cleaned = stripCaptureNoise(contextText, 7000);
  const titleResult = extractSourceContextTitle(contextHtml, cleaned.cleaned, input.targetJobId);
  const fallbackTitle = cleanJobTitle(input.pageTitle);
  const title = titleResult.title || (isGenericSourceContextTitle(fallbackTitle) ? "" : fallbackTitle);
  const description = cleaned.cleaned;
  const restricted = sourceContextLooksRestricted(input);
  const rawText = [
    `Title: ${title}`,
    `URL: ${input.canonicalJobUrl}`,
    `Source: Best Matches source-context capture`,
    description,
  ].filter(Boolean).join("\n\n");
  const quality = assessCaptureQuality({
    title,
    description,
    rawText,
    rawConfigNoiseDetected: cleaned.rawConfigNoiseDetected,
  });
  if (restricted) quality.reasons.unshift("restricted_or_manual_attention_source_context");
  return {
    rawText,
    title,
    description,
    skills: parseSkillsFromText(stripCaptureNoise(contextText, 1200).cleaned),
    applicationQuestions: extractQuestionsFromText(stripCaptureNoise(contextText, 1800).cleaned),
    diagnostics: {
      titleSource: titleResult.title ? titleResult.source : fallbackTitle && title ? "page_title" : "fallback",
      descriptionSource: "main",
      capturedTitle: title,
      descriptionLength: description.length,
      descriptionPreview: description.slice(0, 300),
      removedNoiseMarkers: cleaned.removedNoiseMarkers,
      rawConfigNoiseDetected: cleaned.rawConfigNoiseDetected,
      lowConfidence: restricted || quality.lowConfidence,
      reasons: quality.reasons,
      rejectedGenericTitle: titleResult.rejectedGenericTitle || Boolean(fallbackTitle && !title),
      extractedTitleCandidates: titleResult.candidates,
    },
  };
}

const NOISE_PATTERNS = [
  /window\.TOP_NAV_USER_CONFIG/gi,
  /visitorGqlTokenUrl/gi,
  /serviceName/gi,
  /__APOLLO_STATE__/gi,
  /__NEXT_DATA__/gi,
  /checking if the site connection is secure/gi,
  /skip to main content/gi,
  /search jobs/gi,
  /browse jobs/gi,
  /log in/gi,
  /sign up/gi,
];

function countNoiseMarkers(value: string): number {
  return NOISE_PATTERNS.reduce((count, pattern) => count + ((value.match(pattern) ?? []).length), 0);
}

export function stripCaptureNoise(value: string, maxLength = 6000): { cleaned: string; removedNoiseMarkers: number; rawConfigNoiseDetected: boolean } {
  const rawConfigNoiseDetected = /window\.TOP_NAV_USER_CONFIG|visitorGqlTokenUrl|serviceName|__APOLLO_STATE__|__NEXT_DATA__/i.test(value);
  let cleaned = value
    .replace(/window\.TOP_NAV_USER_CONFIG[\s\S]{0,5000}?;?/gi, " ")
    .replace(/\{\s*"(?:serviceName|visitorGqlTokenUrl|apollo|graphql|navigation)"[\s\S]{0,5000}?\}/gi, " ")
    .replace(/(?:Skip to main content|Search jobs|Browse jobs|Find talent|Why Upwork|Enterprise|Log in|Sign up)\s*/gi, " ")
    .replace(/[\[{][^\n]{120,}[\]}]/g, " ");
  const removedNoiseMarkers = countNoiseMarkers(value) - countNoiseMarkers(cleaned);
  cleaned = normalizeWhitespace(cleaned);
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength).trim();
  }
  return { cleaned, removedNoiseMarkers, rawConfigNoiseDetected };
}

async function getFirstText(page: BrowserCapturePageLike, selectors: string[]): Promise<{ text: string; source: string | null }> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (count > 0) {
      const text = normalizeWhitespace((await locator.first().textContent({ timeout: 2000 })) ?? "");
      if (text) {
        return { text, source: selector };
      }
    }
  }
  return { text: "", source: null };
}

function cleanJobTitle(value: string): string {
  const cleaned = normalizeWhitespace(
    value
      .replace(/\s[-–—|]\s.*upwork.*$/i, "")
      .replace(/^upwork\s*[-–—|]\s*/i, "")
      .replace(/window\.TOP_NAV_USER_CONFIG.*/i, "")
      .replace(/visitorGqlTokenUrl.*/i, "")
      .replace(/serviceName.*/i, "")
  );
  return cleaned.split("\n")[0]?.trim() ?? "";
}

function parseSkillsFromText(value: string): string[] {
  return Array.from(new Set(value.split(/\n|,|•/).map((item) => item.trim()).filter((item) => /^[A-Za-z][A-Za-z0-9 &+/#.-]{1,40}$/.test(item)))).slice(0, 12);
}

function extractQuestionsFromText(value: string): string[] {
  return parseCaptureQuestions(value, 6);
}

export function assessCaptureQuality(input: { title: string; description: string; rawText: string; rawConfigNoiseDetected: boolean }): { lowConfidence: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const combined = `${input.title}\n${input.description}\n${input.rawText}`;
  if (!input.title || input.title.length < 8) reasons.push("missing_or_short_title");
  if (!input.description || input.description.length < 80) reasons.push("missing_or_short_description");
  if (/window\.TOP_NAV_USER_CONFIG|visitorGqlTokenUrl|serviceName|__APOLLO_STATE__|__NEXT_DATA__/i.test(input.title)) reasons.push("dirty_title_config_text");
  if (/window\.TOP_NAV_USER_CONFIG|visitorGqlTokenUrl|serviceName/.test(input.description)) reasons.push("dirty_description_config_text");
  if (/^[\[{].{120,}[\]}]$/s.test(input.title) || /^[\[{].{300,}[\]}]$/s.test(input.description)) reasons.push("json_blob_detected");
  if (input.rawConfigNoiseDetected && input.description.length < 140) reasons.push("config_noise_overwhelmed_content");
  if (/window\.TOP_NAV_USER_CONFIG|visitorGqlTokenUrl|serviceName|graphql|apollo/i.test(combined) && input.description.length < 220) reasons.push("obvious_navigation_or_config_code");
  return { lowConfidence: reasons.length > 0, reasons };
}

export async function extractUpworkJobContent(page: BrowserCapturePageLike): Promise<UpworkStructuredExtractionResult> {
  const pageTitle = cleanJobTitle(await page.title());
  const titleResult = await getFirstText(page, [
    "h1",
    "[data-test='job-title']",
    "[data-qa='job-title']",
    "main h1",
  ]);
  const descriptionResult = await getFirstText(page, [
    "[data-test='job-description-text']",
    "[data-qa='job-description']",
    "section[data-test='job-description']",
    "main [data-test='description']",
    "main",
    "body",
  ]);
  const skillsResult = await getFirstText(page, [
    "[data-test='skills']",
    "[data-qa='skills']",
    "main",
    "body",
  ]);
  const questionsResult = await getFirstText(page, [
    "[data-test='additional-questions']",
    "[data-qa='screening-questions']",
    "main",
    "body",
  ]);

  const cleanedDescription = stripCaptureNoise(descriptionResult.text || skillsResult.text || "");
  const fallbackBody = stripCaptureNoise((await getFirstText(page, ["body"]).then((result) => result.text)) || "");
  const title = cleanJobTitle(titleResult.text) || pageTitle || cleanJobTitle(fallbackBody.cleaned.split("\n").find((line) => line.trim().length > 10) ?? "");
  const description = cleanedDescription.cleaned || fallbackBody.cleaned;
  const rawText = [
    `Title: ${title}`,
    `URL: ${page.url()}`,
    description,
    skillsResult.text ? `Skills\n${stripCaptureNoise(skillsResult.text, 1200).cleaned}` : "",
    questionsResult.text ? `Application Questions\n${stripCaptureNoise(questionsResult.text, 1200).cleaned}` : "",
  ].filter(Boolean).join("\n\n");
  const quality = assessCaptureQuality({ title, description, rawText, rawConfigNoiseDetected: cleanedDescription.rawConfigNoiseDetected || fallbackBody.rawConfigNoiseDetected });
  return {
    rawText,
    title,
    description,
    skills: parseSkillsFromText(stripCaptureNoise(skillsResult.text, 1200).cleaned),
    applicationQuestions: extractQuestionsFromText(stripCaptureNoise(questionsResult.text || description, 1800).cleaned),
    diagnostics: {
      titleSource: titleResult.text ? "selector" : pageTitle ? "page_title" : "fallback",
      descriptionSource: descriptionResult.text ? (descriptionResult.source === "main" ? "main" : "selector") : fallbackBody.cleaned ? "fallback" : "main",
      capturedTitle: title,
      descriptionLength: description.length,
      descriptionPreview: description.slice(0, 300),
      removedNoiseMarkers: cleanedDescription.removedNoiseMarkers + fallbackBody.removedNoiseMarkers,
      rawConfigNoiseDetected: cleanedDescription.rawConfigNoiseDetected || fallbackBody.rawConfigNoiseDetected,
      lowConfidence: quality.lowConfidence,
      reasons: quality.reasons,
    },
  };
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
