import { createHash } from "node:crypto";

import { extractConnectsFromVisibleText, normalizeLlmConnectsExtraction } from "./connectsExtraction";
import { parseJobDetailCapture } from "./jobCapture";
import { OpenAiCompatibleProvider } from "./llm/provider";
import {
  JobPosting,
  NormalizedClientPacket,
  NormalizedConnectsPacket,
  NormalizedJobPacket,
  NormalizedOpportunityPacket,
  NormalizedOpportunityRepair,
  NormalizedProposalInstructions,
  NormalizedRequirementsPacket,
  NormalizationSource,
  SourceBackedConnects,
} from "./types";

const MISSING = "Not specified";
const SAFE_UPWORK_JOB_URL = /^https:\/\/(?:www\.)?upwork\.com\/jobs\/[^\s?#]*~[A-Za-z0-9_-]{8,}(?:[/?#][^\s]*)?$/i;

export interface NormalizeOpportunityOptions {
  url?: string;
  capturedAt?: Date;
  useLlm?: boolean;
  provider?: OpenAiCompatibleProvider;
}

export interface NormalizeOpportunityResult extends NormalizedOpportunityRepair {
  usedLlm: boolean;
  fallbackReason?: string;
}

function sanitizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = sanitizeString(item);
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function sanitizeNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value.replace(/[$,%+,]/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  const parsed = sanitizeNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalizeUrl(url: string): string {
  return url.trim().replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
}

export function hasSafeDirectJobLink(url: string): boolean {
  return SAFE_UPWORK_JOB_URL.test(url.trim());
}

function hashRawText(rawText: string): string {
  return createHash("sha256").update(rawText).digest("hex");
}

function buildConnectsPacket(connects: SourceBackedConnects, suggestedBoost = 0, notes: string[] = []): NormalizedConnectsPacket {
  return {
    ...connects,
    required: connects.requiredConnects,
    deterministicRequired: connects.extractionMethod === "deterministic_visible_text" ? connects.requiredConnects : null,
    suggestedBoost,
    notes,
  };
}

export function buildDeterministicOpportunityPacket(rawText: string, options: { url?: string; capturedAt?: Date; source?: NormalizationSource } = {}): NormalizedOpportunityPacket {
  const capture = parseJobDetailCapture(rawText, { url: options.url, capturedAt: options.capturedAt });
  const source = options.source ?? "deterministic";
  const sourceBackedConnects = extractConnectsFromVisibleText(rawText);

  const deterministicJob: JobPosting = {
    ...capture.manualJob,
    id: capture.manualJob.id ?? (capture.jobId ? `manual:upwork-${capture.jobId}` : `manual:${Date.now()}`),
    connectsCost: sourceBackedConnects.requiredConnects ?? 0,
    connects: sourceBackedConnects,
  };

  return {
    schemaVersion: "1.0",
    source,
    normalizedAt: (options.capturedAt ?? new Date()).toISOString(),
    rawTextHash: hashRawText(rawText),
    job: {
      id: deterministicJob.id,
      title: capture.title,
      url: capture.url,
      description: capture.description,
      postedAt: capture.postedAt,
      budget: capture.budget,
      budgetType: capture.budgetType,
      category: capture.manualJob.category,
      experienceLevel: capture.experienceLevel,
      duration: capture.duration,
      sourceQuery: capture.manualJob.sourceQuery,
    },
    client: {
      country: capture.client.location,
      rating: capture.client.rating,
      spend: capture.client.spend,
      hireRate: capture.client.hireRate,
      totalHires: capture.client.hires,
      feedbackCount: capture.client.reviews,
      jobsPosted: capture.client.jobsPosted,
    },
    requirements: {
      skills: capture.skills,
      requiredSkills: capture.skills,
      preferredSkills: [],
      qualifications: [],
      deliverables: [],
      timeline: capture.duration === MISSING ? "" : capture.duration,
    },
    applicationQuestions: [],
    connects: buildConnectsPacket(
      sourceBackedConnects,
      0,
      sourceBackedConnects.requiredConnects == null ? ["Required Connects not found in visible capture"] : [],
    ),
    risks: capture.url && !hasSafeDirectJobLink(capture.url) ? ["Capture URL is not a safe direct Upwork job link"] : [],
    proofHints: [],
    proposalInstructions: {
      tone: "Use Steve's approved concise, practical voice.",
      mustAddress: [],
      avoid: ["Do not invent client facts", "Do not claim unavailable proof", "Do not auto-submit"],
      attachments: [],
      notes: [],
    },
    deterministicJob,
  };
}

function normalizeJob(input: Partial<NormalizedJobPacket> | undefined, fallback: NormalizedJobPacket): NormalizedJobPacket {
  return {
    id: sanitizeString(input?.id, fallback.id),
    title: sanitizeString(input?.title, fallback.title),
    url: sanitizeString(input?.url, fallback.url),
    description: sanitizeString(input?.description, fallback.description),
    postedAt: sanitizeString(input?.postedAt, fallback.postedAt),
    budget: sanitizeString(input?.budget, fallback.budget),
    budgetType: sanitizeString(input?.budgetType, fallback.budgetType),
    category: sanitizeString(input?.category, fallback.category),
    experienceLevel: sanitizeString(input?.experienceLevel, fallback.experienceLevel),
    duration: sanitizeString(input?.duration, fallback.duration),
    sourceQuery: sanitizeString(input?.sourceQuery, fallback.sourceQuery),
  };
}

function normalizeClient(input: Partial<NormalizedClientPacket> | undefined, fallback: NormalizedClientPacket): NormalizedClientPacket {
  return {
    country: sanitizeString(input?.country, fallback.country),
    rating: nullableNumber(input?.rating) ?? fallback.rating,
    spend: nullableNumber(input?.spend) ?? fallback.spend,
    hireRate: nullableNumber(input?.hireRate) ?? fallback.hireRate,
    totalHires: nullableNumber(input?.totalHires) ?? fallback.totalHires,
    feedbackCount: nullableNumber(input?.feedbackCount) ?? fallback.feedbackCount,
    jobsPosted: nullableNumber(input?.jobsPosted) ?? fallback.jobsPosted,
  };
}

function normalizeRequirements(input: Partial<NormalizedRequirementsPacket> | undefined, fallback: NormalizedRequirementsPacket): NormalizedRequirementsPacket {
  const skills = sanitizeStringArray(input?.skills).length ? sanitizeStringArray(input?.skills) : fallback.skills;
  return {
    skills,
    requiredSkills: sanitizeStringArray(input?.requiredSkills).length ? sanitizeStringArray(input?.requiredSkills) : fallback.requiredSkills,
    preferredSkills: sanitizeStringArray(input?.preferredSkills),
    qualifications: sanitizeStringArray(input?.qualifications),
    deliverables: sanitizeStringArray(input?.deliverables),
    timeline: sanitizeString(input?.timeline, fallback.timeline),
  };
}

function normalizeProposalInstructions(input: Partial<NormalizedProposalInstructions> | undefined, fallback: NormalizedProposalInstructions): NormalizedProposalInstructions {
  return {
    tone: sanitizeString(input?.tone, fallback.tone),
    mustAddress: sanitizeStringArray(input?.mustAddress),
    avoid: [...new Set([...fallback.avoid, ...sanitizeStringArray(input?.avoid)])],
    attachments: sanitizeStringArray(input?.attachments),
    notes: sanitizeStringArray(input?.notes),
  };
}

export function repairNormalizedOpportunityPacket(
  candidate: Partial<NormalizedOpportunityPacket> | null | undefined,
  fallback: NormalizedOpportunityPacket,
  visibleText = "",
): NormalizedOpportunityRepair {
  const warnings: string[] = [];
  const errors: string[] = [];
  const input = candidate ?? {};
  const candidateUrl = sanitizeString(input.job?.url);
  const job = normalizeJob(input.job, fallback.job);

  if (candidateUrl && canonicalizeUrl(candidateUrl) !== canonicalizeUrl(fallback.job.url)) {
    warnings.push("LLM-provided job URL differed from deterministic capture and was ignored.");
  }
  job.url = fallback.job.url;

  if (!hasSafeDirectJobLink(job.url)) {
    errors.push("Missing or unsafe deterministic Upwork job link; packet is unsafe for downstream application preparation.");
  }

  const fallbackConnects = fallback.connects;
  const llmConnects = normalizeLlmConnectsExtraction(input.connects, visibleText);
  const sourceBackedConnects = fallbackConnects.requiredConnects === null && llmConnects.requiredConnects !== null
    ? llmConnects
    : fallbackConnects;
  const candidateRequired = nullableNumber(input.connects?.requiredConnects ?? input.connects?.required);
  if (
    fallbackConnects.requiredConnects !== null &&
    candidateRequired !== null &&
    candidateRequired !== fallbackConnects.requiredConnects
  ) {
    warnings.push("LLM connects value ignored; deterministic visible-text connects guardrail retained.");
  }
  if (
    fallbackConnects.requiredConnects === null &&
    candidateRequired !== null &&
    sourceBackedConnects.requiredConnects === null
  ) {
    warnings.push("LLM connects value ignored because it lacked visible source text.");
  }
  const repairedConnects = buildConnectsPacket(
    sourceBackedConnects,
    Math.max(0, sanitizeNumber(input.connects?.suggestedBoost, fallback.connects.suggestedBoost)),
    [...new Set([...(fallback.connects.notes ?? []), ...sanitizeStringArray(input.connects?.notes)])],
  );

  const packet: NormalizedOpportunityPacket = {
    schemaVersion: "1.0",
    source: input.source === "llm" ? "llm" : fallback.source,
    normalizedAt: sanitizeString(input.normalizedAt, new Date().toISOString()),
    rawTextHash: fallback.rawTextHash,
    job,
    client: normalizeClient(input.client, fallback.client),
    requirements: normalizeRequirements(input.requirements, fallback.requirements),
    applicationQuestions: sanitizeStringArray(input.applicationQuestions),
    connects: {
      ...repairedConnects,
    },
    risks: [...new Set([...fallback.risks, ...sanitizeStringArray(input.risks), ...errors])],
    proofHints: sanitizeStringArray(input.proofHints),
    proposalInstructions: normalizeProposalInstructions(input.proposalInstructions, fallback.proposalInstructions),
    deterministicJob: fallback.deterministicJob,
  };

  if (!packet.job.title || !packet.job.description) {
    errors.push("Missing required title or description after repair.");
  }
  if (!hasSafeDirectJobLink(packet.job.url)) {
    errors.push("Packet does not contain a safe direct Upwork job URL.");
  }

  return { packet, valid: errors.length === 0, warnings, errors };
}

export function normalizedPacketToJobPosting(packet: NormalizedOpportunityPacket): JobPosting {
  return {
    id: packet.deterministicJob.id ?? packet.job.id,
    title: packet.job.title,
    url: packet.job.url,
    description: packet.job.description,
    postedAt: packet.job.postedAt,
    budget: packet.job.budget,
    clientCountry: packet.client.country,
    clientRating: packet.client.rating ?? 0,
    clientSpend: packet.client.spend ?? 0,
    clientHireRate: packet.client.hireRate ?? 0,
    clientTotalHires: packet.client.totalHires ?? 0,
    clientFeedbackCount: packet.client.feedbackCount ?? 0,
    category: packet.job.category,
    experienceLevel: packet.job.experienceLevel,
    connectsCost: packet.connects.requiredConnects ?? 0,
    connects: {
      requiredConnects: packet.connects.requiredConnects,
      boostConnects: packet.connects.boostConnects,
      totalConnects: packet.connects.totalConnects,
      confidence: packet.connects.confidence,
      sourceText: packet.connects.sourceText,
      sourceLocation: packet.connects.sourceLocation,
      extractionMethod: packet.connects.extractionMethod,
    },
    skills: packet.requirements.skills,
    sourceQuery: packet.job.sourceQuery,
  };
}

function buildNormalizationMessages(rawText: string, fallback: NormalizedOpportunityPacket) {
  return [
    {
      role: "system" as const,
      content:
        "You normalize Upwork capture text into JSON only. Preserve facts, use null/empty arrays for unknowns, never invent direct links, Connects, client metrics, or proof. Connects must cite exact visible sourceText from rawCaptureText; if rawCaptureText lacks required Connects, return requiredConnects/sourceText/sourceLocation as null and confidence unknown. Return fields matching the provided packet shape.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        fallbackPacket: fallback,
        rawCaptureText: rawText,
        instructions: [
          "Improve title, description, requirements, applicationQuestions, risks, proofHints, and proposalInstructions from raw text.",
          "Do not change deterministic job URL or id.",
          "For connects, only normalize captured visible text into source-backed JSON. Never infer or default missing Connects to 0.",
          "Return a JSON object shaped like NormalizedOpportunityPacket.",
        ],
      }),
    },
  ];
}

export async function normalizeOpportunity(rawText: string, options: NormalizeOpportunityOptions = {}): Promise<NormalizeOpportunityResult> {
  const fallback = buildDeterministicOpportunityPacket(rawText, { url: options.url, capturedAt: options.capturedAt });
  const provider = options.provider ?? new OpenAiCompatibleProvider();

  if (options.useLlm === false || !provider.isAvailable()) {
    const repaired = repairNormalizedOpportunityPacket(fallback, fallback, rawText);
    return { ...repaired, usedLlm: false, fallbackReason: options.useLlm === false ? "LLM disabled by caller" : "LLM provider unavailable" };
  }

  const result = await provider.completeJson<Partial<NormalizedOpportunityPacket>>({
    messages: buildNormalizationMessages(rawText, fallback),
    temperature: 0.1,
    maxTokens: 2200,
  });

  if (!result.ok || !result.data) {
    const repaired = repairNormalizedOpportunityPacket(fallback, fallback, rawText);
    return { ...repaired, usedLlm: false, fallbackReason: result.skippedReason ?? result.error ?? "LLM normalization failed" };
  }

  const repaired = repairNormalizedOpportunityPacket({ ...result.data, source: "llm" }, fallback, rawText);
  if (!repaired.valid) {
    const deterministic = repairNormalizedOpportunityPacket(fallback, fallback, rawText);
    return { ...deterministic, usedLlm: false, fallbackReason: `LLM packet failed repair: ${repaired.errors.join("; ")}` };
  }

  return { ...repaired, usedLlm: true };
}
