import { FreelancerProfile, JobPosting, ProposalQualityIssue, ProposalQualityResult } from "./types";

const DEFAULT_BANNED_PHRASES = [
  "I am excited to apply",
  "I'd love the opportunity",
  "I believe I am the perfect fit",
  "I believe I'm the perfect fit",
  "Dear hiring manager",
  "I can help you achieve your goals",
  "passionate about",
  "leverage my expertise",
  "extensive experience",
];

const GENERIC_CLAIMS = [
  "results-driven",
  "detail-oriented",
  "hard-working",
  "proven track record",
  "high-quality work",
  "exceed your expectations",
  "take your business to the next level",
  "help you grow your business",
];

const WEAK_OPENINGS = [
  "hi there",
  "hello",
  "dear",
  "i saw your job posting",
  "i came across your job",
  "my name is",
  "i am writing",
];

const PAIN_MARKERS = [
  "leak",
  "drop",
  "friction",
  "stale",
  "missing",
  "not working",
  "constraint",
  "problem",
  "hard part",
  "costing",
  "drift",
  "noise",
];

const CTA_MARKERS = ["send me", "share", "store url", "quick sense", "what is working", "what is not working", "where i would start"];

const PROOF_MARKERS = ["relevant background", "proof", "audit", "klaviyo", "email", "sms", "flow", "campaign", "retention", "lifecycle", "dtc"];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[’]/g, "'");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function countWords(text: string): number {
  const words = text.trim().match(/\b[\w'-]+\b/g);
  return words ? words.length : 0;
}

function firstSentence(text: string): string {
  return text.trim().split(/(?<=[.!?])\s+|\n+/)[0] ?? "";
}

function jobTerms(job: JobPosting): string[] {
  return unique([
    ...job.title.toLowerCase().split(/[^a-z0-9]+/),
    ...job.category.toLowerCase().split(/[^a-z0-9]+/),
    ...job.skills.map((skill) => skill.toLowerCase()),
    "klaviyo",
    "email",
    "sms",
    "retention",
    "lifecycle",
    "flow",
    "campaign",
  ]).filter((term) => term.length > 2);
}

function addIssue(issues: ProposalQualityIssue[], issue: ProposalQualityIssue): void {
  issues.push(issue);
}

function bannedPhraseMatches(text: string, phrase: string): boolean {
  const normalizedPhrase = normalize(phrase).trim();
  if (!normalizedPhrase) return false;
  if (!normalizedPhrase.includes("x")) return text.includes(normalizedPhrase);

  const escapedParts = normalizedPhrase.split("x").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = escapedParts.join("[\\w'-]+(?:\\s+[\\w'-]+){0,3}").replace(/\\\s+/g, "\\s+");
  return new RegExp(pattern, "i").test(text);
}

export function critiqueProposal(proposalText: string, job: JobPosting, profile?: Partial<FreelancerProfile>): ProposalQualityResult {
  const text = proposalText.trim();
  const lower = normalize(text);
  const issues: ProposalQualityIssue[] = [];
  const positiveSignals: string[] = [];
  const wordCount = countWords(text);
  const bannedPhrases = unique([...(profile?.voice?.bannedPhrases ?? []), ...DEFAULT_BANNED_PHRASES]);
  const preferredPhrases = profile?.voice?.preferredPhrases ?? [];

  for (const phrase of bannedPhrases) {
    if (bannedPhraseMatches(lower, phrase)) {
      addIssue(issues, {
        category: "banned_phrase",
        severity: "critical",
        message: "Proposal includes a banned or AI-sounding phrase.",
        evidence: phrase,
        suggestion: "Replace generic enthusiasm with a specific diagnosis of the client's problem.",
      });
    }
  }

  const opening = normalize(firstSentence(text));
  if (!opening || WEAK_OPENINGS.some((marker) => opening.startsWith(marker))) {
    addIssue(issues, {
      category: "weak_opening",
      severity: "critical",
      message: "Opening starts generically instead of naming the client's business leak.",
      evidence: firstSentence(text),
      suggestion: "Open with the pain, constraint, or revenue leak implied by the job post.",
    });
  } else if (PAIN_MARKERS.some((marker) => opening.includes(marker))) {
    positiveSignals.push("Opens with a concrete pain point or constraint.");
  }

  for (const claim of GENERIC_CLAIMS) {
    if (lower.includes(claim)) {
      addIssue(issues, {
        category: "generic_claim",
        severity: "warning",
        message: "Proposal uses a generic claim that does not sound like Steve.",
        evidence: claim,
        suggestion: "Trade broad claims for specific lifecycle, retention, Klaviyo, or revenue language.",
      });
    }
  }

  if (wordCount < 90 || wordCount > 220) {
    addIssue(issues, {
      category: "length",
      severity: wordCount < 60 || wordCount > 280 ? "critical" : "warning",
      message: `Proposal length is ${wordCount} words; Steve's preference is roughly 120-190 words.`,
      suggestion: "Keep the draft tight: pain, first diagnostic moves, relevant proof, and one low-friction CTA.",
    });
  } else if (wordCount >= 120 && wordCount <= 190) {
    positiveSignals.push("Length matches the preferred 120-190 word range.");
  }

  if (!CTA_MARKERS.some((marker) => lower.includes(marker)) || !/[?]|send me|share|quick sense/i.test(text)) {
    addIssue(issues, {
      category: "cta",
      severity: "warning",
      message: "CTA is missing or too vague.",
      suggestion: "End with a specific low-friction next step, such as asking for the store URL or current Klaviyo problem.",
    });
  } else {
    positiveSignals.push("Ends with a specific, low-friction CTA.");
  }

  const terms = jobTerms(job);
  const matchedJobTerms = terms.filter((term) => lower.includes(term));
  const hasProofMarker = PROOF_MARKERS.some((marker) => lower.includes(marker));
  if (matchedJobTerms.length < 2 || !hasProofMarker) {
    addIssue(issues, {
      category: "proof_relevance",
      severity: "warning",
      message: "Proof is thin or not clearly tied to the job post.",
      evidence: matchedJobTerms.slice(0, 5).join(", ") || undefined,
      suggestion: "Mention job-relevant proof such as Klaviyo, lifecycle flows, campaigns, SMS, retention, audits, or selected portfolio examples.",
    });
  } else {
    positiveSignals.push("Proof language is tied to the job context.");
  }

  if (preferredPhrases.some((phrase) => lower.includes(normalize(phrase)))) {
    positiveSignals.push("Uses a preferred Steve voice marker.");
  }
  if (["i would", "what i would", "if useful", "practical"].some((marker) => lower.includes(marker))) {
    positiveSignals.push("Keeps a direct, diagnostic tone.");
  }
  if (!positiveSignals.some((signal) => signal.includes("voice")) && !lower.includes("i would")) {
    addIssue(issues, {
      category: "voice",
      severity: "info",
      message: "Steve voice markers are limited.",
      suggestion: "Use direct diagnostic phrasing like 'What I would look at first' or 'If useful, send me...'.",
    });
  }

  const penalties = issues.reduce((total, issue) => {
    if (issue.severity === "critical") return total + 20;
    if (issue.severity === "warning") return total + 12;
    return total + 5;
  }, 0);
  const bonus = Math.min(10, positiveSignals.length * 2);
  const score = Math.max(0, Math.min(100, 100 - penalties + bonus));

  return {
    score,
    issues,
    positiveSignals: unique(positiveSignals),
    wordCount,
  };
}
