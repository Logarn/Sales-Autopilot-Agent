export interface JobCaptureOptions {
  url?: string;
  capturedAt?: Date;
}

export interface JobActivityCapture {
  proposals: number | null;
  invitesSent: number | null;
  unansweredInvites: number | null;
  interviews: number | null;
  lastViewedByClient: string;
}

export interface ClientCapture {
  location: string;
  rating: number | null;
  reviews: number | null;
  spend: number | null;
  hires: number | null;
  jobsPosted: number | null;
  hireRate: number | null;
}

export interface ManualJobCapture {
  id?: string;
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

export interface JobDetailCaptureResult {
  title: string;
  url: string;
  jobId: string | null;
  description: string;
  postedAt: string;
  postedText: string;
  location: string;
  budget: string;
  budgetType: string;
  duration: string;
  experienceLevel: string;
  skills: string[];
  connectsCost: number | null;
  activity: JobActivityCapture;
  client: ClientCapture;
  manualJob: ManualJobCapture;
}

const MISSING = "Not specified";

function lines(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(/[$,+]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMoneyValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/[$,+]/g, "").trim().toLowerCase();
  const multiplier = normalized.endsWith("k") ? 1000 : normalized.endsWith("m") ? 1_000_000 : 1;
  const parsed = Number.parseFloat(normalized.replace(/[km]$/, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * multiplier) : null;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

function deriveJobId(url: string, text: string): string | null {
  const source = `${url}\n${text}`;
  return firstMatch(source, [
    /upwork\.com\/jobs\/[^\s]*~([A-Za-z0-9_-]+)/i,
    /(?:Job ID|Job Id|ID)\s*:?\s*([A-Za-z0-9_-]{8,})/i,
  ]);
}

function deriveUrl(text: string, options: JobCaptureOptions): string {
  if (options.url?.trim()) return options.url.trim();
  return firstMatch(text, [/(https?:\/\/[^\s]+upwork\.com\/jobs\/[^\s]+)/i]) ?? "";
}

function deriveTitle(allLines: string[], text: string): string {
  const labeled = firstMatch(text, [/^Title\s*:?\s*(.+)$/im, /^Job title\s*:?\s*(.+)$/im]);
  if (labeled) return labeled;
  const ignored = /^(Upwork|Job details|Details|Apply now|Save job|Send a proposal|Posted|Hourly|Fixed-price|Intermediate|Expert|Entry level)$/i;
  return allLines.find((line) => line.length > 8 && !ignored.test(line) && !line.startsWith("http")) ?? "Untitled Upwork job";
}

function deriveDescription(text: string): string {
  const section = text.match(/(?:Description|Job Description|About the job)\s*\n([\s\S]*?)(?:\n(?:Skills and Expertise|Skills|Activity on this job|Project Type|Client's recent history|About the client|Hourly|Fixed-price)\b|$)/i)?.[1]?.trim();
  if (section) return section;
  const fallback = text.match(/Posted[\s\S]*?\n([\s\S]{80,}?)(?:\nSkills\b|\nActivity on this job\b|$)/i)?.[1]?.trim();
  return fallback ?? "Manual job capture. Paste a fuller Upwork job detail page for stronger scoring and proposals.";
}

function derivePosted(text: string, capturedAt: Date): { postedAt: string; postedText: string } {
  const postedText = firstMatch(text, [/(Posted\s+[^\n]+)/i, /(?:^|\n)(\d+\s+(?:minutes?|hours?|days?)\s+ago)/i]) ?? MISSING;
  return { postedAt: capturedAt.toISOString(), postedText };
}

function deriveLocation(text: string): string {
  return firstMatch(text, [/(?:Client's location|Client Location|Location)\s*:?\s*\n?([^\n]+)/i, /(?:^|\n)(United States|Canada|United Kingdom|Australia|[A-Z][A-Za-z ]+),?\s*\n\s*(?:\d{1,2}:\d{2}|\$)/]) ?? MISSING;
}

function deriveBudget(text: string): { budget: string; budgetType: string } {
  const hourlyRange = firstMatch(text, [/(\$[\d,.]+\s*-\s*\$[\d,.]+\s*\/hr)/i, /(\$[\d,.]+\s*\/hr)/i]);
  if (hourlyRange) return { budget: hourlyRange, budgetType: "Hourly" };
  const fixed = firstMatch(text, [/(\$[\d,.]+)\s*(?:Fixed-price|Fixed price|Budget)/i, /(?:Fixed-price|Fixed price|Budget)\s*:?\s*(\$[\d,.]+)/i]);
  if (fixed) return { budget: fixed, budgetType: "Fixed-price" };
  if (/Hourly/i.test(text)) return { budget: "Hourly", budgetType: "Hourly" };
  if (/Fixed-price|Fixed price/i.test(text)) return { budget: "Fixed-price", budgetType: "Fixed-price" };
  return { budget: MISSING, budgetType: MISSING };
}

function deriveExperience(text: string): string {
  return firstMatch(text, [/(Entry level|Intermediate|Expert)/i]) ?? MISSING;
}

function deriveDuration(text: string): string {
  return firstMatch(text, [/((?:Less than|More than)?\s*\d+\s*(?:to\s*\d+\s*)?(?:months?|weeks?))/i, /(Less than a month)/i]) ?? MISSING;
}

function deriveSkills(text: string): string[] {
  const skillSection = text.match(/(?:Skills and Expertise|Skills)\s*\n([\s\S]*?)(?:\n(?:Activity on this job|Proposals|About the client|Client's recent history|Project Type)\b|$)/i)?.[1] ?? "";
  const candidates = skillSection
    .split(/\n|,|•/)
    .map((skill) => skill.trim())
    .filter((skill) => /^[A-Za-z][A-Za-z0-9 &+/#.-]{1,40}$/.test(skill))
    .filter((skill) => !/^(View job posting|Apply now|Save job)$/i.test(skill));
  return unique(candidates).slice(0, 20);
}

function deriveActivity(text: string): JobActivityCapture {
  return {
    proposals: parseNumber(firstMatch(text, [/Proposals\s*:?\s*(?:Less than\s*)?(\d+)/i])),
    invitesSent: parseNumber(firstMatch(text, [/Invites sent\s*:?\s*(\d+)/i])),
    unansweredInvites: parseNumber(firstMatch(text, [/Unanswered invites\s*:?\s*(\d+)/i])),
    interviews: parseNumber(firstMatch(text, [/Interviewing\s*:?\s*(\d+)/i, /Interviews\s*:?\s*(\d+)/i])),
    lastViewedByClient: firstMatch(text, [/Last viewed by client\s*:?\s*([^\n]+)/i]) ?? MISSING,
  };
}

function deriveConnects(text: string): number | null {
  return parseNumber(firstMatch(text, [/requires\s+(\d+)\s+Connects/i, /Connects to apply\s*:?\s*(\d+)/i, /(\d+)\s+Connects/i]));
}

function deriveClient(text: string): ClientCapture {
  const rating = parseNumber(firstMatch(text, [/(\d(?:\.\d+)?)\s*(?:of\s*5|stars?)/i]));
  return {
    location: deriveLocation(text),
    rating,
    reviews: parseNumber(firstMatch(text, [/(\d+)\s+reviews?/i])),
    spend: parseMoneyValue(firstMatch(text, [/\$([\d,.]+\s*[km]?)\+?\s+total spent/i])),
    hires: parseNumber(firstMatch(text, [/(\d+)\s+hires?/i])),
    jobsPosted: parseNumber(firstMatch(text, [/(\d+)\s+jobs posted/i])),
    hireRate: parseNumber(firstMatch(text, [/(\d+)%\s+hire rate/i])),
  };
}

export function parseJobDetailCapture(text: string, options: JobCaptureOptions = {}): JobDetailCaptureResult {
  const capturedAt = options.capturedAt ?? new Date();
  const allLines = lines(text);
  const url = deriveUrl(text, options);
  const jobId = deriveJobId(url, text);
  const title = deriveTitle(allLines, text);
  const description = deriveDescription(text);
  const { postedAt, postedText } = derivePosted(text, capturedAt);
  const { budget, budgetType } = deriveBudget(text);
  const experienceLevel = deriveExperience(text);
  const duration = deriveDuration(text);
  const skills = deriveSkills(text);
  const connectsCost = deriveConnects(text);
  const activity = deriveActivity(text);
  const client = deriveClient(text);

  const manualJob: ManualJobCapture = {
    id: jobId ? `manual:upwork-${jobId}` : undefined,
    title,
    url,
    description,
    postedAt,
    budget,
    clientCountry: client.location,
    clientRating: client.rating ?? 0,
    clientSpend: client.spend ?? 0,
    clientHireRate: client.hireRate ?? 0,
    clientTotalHires: client.hires ?? 0,
    clientFeedbackCount: client.reviews ?? 0,
    category: "Manual Capture",
    experienceLevel,
    connectsCost: connectsCost ?? 0,
    skills,
    sourceQuery: "job-detail-capture",
  };

  return {
    title,
    url,
    jobId,
    description,
    postedAt,
    postedText,
    location: client.location,
    budget,
    budgetType,
    duration,
    experienceLevel,
    skills,
    connectsCost,
    activity,
    client,
    manualJob,
  };
}
