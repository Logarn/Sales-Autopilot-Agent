import { createHash } from "node:crypto";

import { parseJobDetailCapture } from "./jobCapture";
import {
  JobPosting,
  NormalizedClientPacket,
  NormalizedJobPacket,
  NormalizedOpportunityPacket,
  NormalizedOpportunityRepair,
  NormalizedProposalInstructions,
  NormalizedRequirementsPacket,
  NormalizationSource,
} from "./types";

const MISSING = "Not specified";
const SAFE_UPWORK_JOB_URL = /^https:\/\/(?:www\.)?upwork\.com\/jobs\/[A-Za-z0-9/_~?=&%+.-]+$/i;

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

export function hasSafeDirectJobLink(url: string): boolean {
  return SAFE_UPWORK_JOB_URL.test(url.trim());
}

function hashRawText(rawText: string): string {
  return createHash("sha256").update(rawText).digest("hex");
}

export function buildDeterministicOpportunityPacket(rawText: string, options: { url?: string; capturedAt?: Date; source?: NormalizationSource } = {}): NormalizedOpportunityPacket {
  const capture = parseJobDetailCapture(rawText, { url: options.url, capturedAt: options.capturedAt });
  const source = options.source ?? "deterministic";

  const deterministicJob: JobPosting = {
    ...capture.manualJob,
    id: capture.manualJob.id ?? (capture.jobId ? `manual:upwork-${capture.jobId}` : `manual:${Date.now()}`),
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
    connects: {
      required: capture.connectsCost,
      deterministicRequired: capture.manualJob.connectsCost,
      suggestedBoost: 0,
      notes: capture.connectsCost == null ? ["Connects cost not found in capture"] : [],
    },
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
): NormalizedOpportunityRepair {
  const warnings: string[] = [];
  const errors: string[] = [];
  const input = candidate ?? {};
  const job = normalizeJob(input.job, fallback.job);

  if (!hasSafeDirectJobLink(job.url)) {
    errors.push("Missing or unsafe direct Upwork job link; using deterministic URL and marking packet unsafe if unavailable.");
    job.url = fallback.job.url;
  }

  const connectsRequired = nullableNumber(input.connects?.required) ?? fallback.connects.required;
  const deterministicRequired = fallback.connects.deterministicRequired;
  if (connectsRequired !== deterministicRequired) {
    warnings.push("LLM connects value ignored; deterministic connects guardrail retained.");
  }

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
      required: deterministicRequired,
      deterministicRequired,
      suggestedBoost: Math.max(0, sanitizeNumber(input.connects?.suggestedBoost, fallback.connects.suggestedBoost)),
      notes: sanitizeStringArray(input.connects?.notes),
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
    connectsCost: packet.connects.deterministicRequired ?? 0,
    skills: packet.requirements.skills,
    sourceQuery: packet.job.sourceQuery,
  };
}
