import type { FreelancerProfile } from "./types";

export type ScreeningQuestionIntent =
  | "similar_project"
  | "availability"
  | "hourly_rate"
  | "platform_experience"
  | "proof_request"
  | "legal_authorization"
  | "sensitive_personal_info"
  | "unknown";

export type ScreeningQuestionRisk = "low" | "medium" | "high";

export interface ScreeningQuestionClassification {
  originalText: string;
  normalizedText: string;
  intent: ScreeningQuestionIntent;
  risk: ScreeningQuestionRisk;
  autoAnswerAllowed: boolean;
  requiresHumanReview: boolean;
  matchedRule: string;
  notes: string[];
}

export interface ScreeningQuestionResolutionContext {
  profile?: FreelancerProfile | null;
  proofPoints?: string[];
}

export interface ScreeningQuestionAnswerResolution {
  classification: ScreeningQuestionClassification;
  answer: string | null;
  source: "profile" | "proof_points" | "none";
  confidence: "high" | "medium" | "low";
  needsHumanReview: boolean;
  reason: string;
}

type IntentRule = {
  intent: ScreeningQuestionIntent;
  risk: ScreeningQuestionRisk;
  matchedRule: string;
  patterns: RegExp[];
  notes: string[];
};

const INTENT_RULES: IntentRule[] = [
  {
    intent: "sensitive_personal_info",
    risk: "high",
    matchedRule: "sensitive_personal_info",
    patterns: [
      /\b(?:ssn|social security|passport|government id|national id|driver'?s license|date of birth|dob|birth date|tax id|tin|bank account|routing number|home address|personal address)\b/i,
      /\b(?:personal email|email address|phone number|mobile number|whatsapp|telegram|skype)\b/i,
    ],
    notes: ["Question asks for sensitive personal or off-platform contact information."],
  },
  {
    intent: "legal_authorization",
    risk: "high",
    matchedRule: "legal_authorization",
    patterns: [
      /\b(?:legally authorized|work authorization|authorized to work|eligible to work|visa|citizenship|citizen|resident|background check|criminal record|tax form|w-?9|w-?8ben|nda|non[-\s]?compete)\b/i,
    ],
    notes: ["Legal, tax, immigration, background-check, or contractual claims require human confirmation."],
  },
  {
    intent: "proof_request",
    risk: "medium",
    matchedRule: "proof_request",
    patterns: [
      /\b(?:portfolio|case stud(?:y|ies)|work samples?|examples?|screenshots?|proof|results?|references?|testimonials?)\b/i,
      /\b(?:share|send|attach|upload|provide|link)\b.{0,80}\b(?:sample|example|portfolio|case stud(?:y|ies)|screenshot|proof|reference|result)\b/i,
    ],
    notes: ["Proof requests may be safe to draft, but attachments/links should be checked against approved proof rules first."],
  },
  {
    intent: "hourly_rate",
    risk: "low",
    matchedRule: "hourly_rate",
    patterns: [
      /\b(?:hourly rate|rate|price|pricing|charge|cost|fee|budget|bid|per hour|\/hr)\b/i,
    ],
    notes: ["Rate questions can be answered from saved profile/bid data when present."],
  },
  {
    intent: "availability",
    risk: "low",
    matchedRule: "availability",
    patterns: [
      /\b(?:availability|available|start date|when can you start|hours per week|weekly hours|timezone|time zone|schedule|capacity|turnaround)\b/i,
    ],
    notes: ["Availability questions can be answered from saved profile availability when present."],
  },
  {
    intent: "platform_experience",
    risk: "low",
    matchedRule: "platform_experience",
    patterns: [
      /\b(?:experience|familiar|worked with|expertise|proficient)\b.{0,80}\b(?:klaviyo|shopify|mailchimp|omnisend|postscript|customer\.io|activecampaign|figma|ga4|google analytics|sms|email platform|esp|crm|ecommerce platform)\b/i,
      /\b(?:klaviyo|shopify|mailchimp|omnisend|postscript|customer\.io|activecampaign|figma|ga4|google analytics)\b.{0,80}\b(?:experience|expertise|years|worked with|familiar|proficient)\b/i,
    ],
    notes: ["Platform-experience questions can be grounded in saved profile skills."],
  },
  {
    intent: "similar_project",
    risk: "low",
    matchedRule: "similar_project",
    patterns: [
      /\b(?:similar|relevant|related|comparable)\b.{0,80}\b(?:project|work|client|job|experience|campaign|flow|audit|implementation)\b/i,
      /\b(?:have you|did you|can you describe)\b.{0,80}\b(?:done|built|managed|worked on|handled)\b.{0,80}\b(?:before|similar|this kind|this type)\b/i,
    ],
    notes: ["Similar-project questions can be answered from saved proof points when no private proof is requested."],
  },
];

export function normalizeScreeningQuestionText(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function classifyScreeningQuestion(text: string): ScreeningQuestionClassification {
  const originalText = text;
  const normalizedText = normalizeScreeningQuestionText(text);

  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalizedText))) {
      const autoAnswerAllowed = rule.risk === "low";
      return {
        originalText,
        normalizedText,
        intent: rule.intent,
        risk: rule.risk,
        autoAnswerAllowed,
        requiresHumanReview: !autoAnswerAllowed,
        matchedRule: rule.matchedRule,
        notes: rule.notes,
      };
    }
  }

  return {
    originalText,
    normalizedText,
    intent: "unknown",
    risk: "high",
    autoAnswerAllowed: false,
    requiresHumanReview: true,
    matchedRule: "fallback_unknown",
    notes: ["Question did not match a known low-risk screening intent; human review is required."],
  };
}

export function classifyScreeningQuestions(questions: string[]): ScreeningQuestionClassification[] {
  return questions.map(classifyScreeningQuestion);
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function formatRate(profile: FreelancerProfile): string | null {
  return Number.isFinite(profile.hourlyRate) && profile.hourlyRate > 0 ? `$${profile.hourlyRate}/hr` : null;
}

function relevantSkills(question: string, profile: FreelancerProfile): string[] {
  const normalized = normalizeScreeningQuestionText(question);
  return profile.skills.filter((skill) => normalized.includes(skill.toLowerCase()));
}

function firstProofPoints(context: ScreeningQuestionResolutionContext, profile?: FreelancerProfile | null): string[] {
  return uniq([...(context.proofPoints ?? []), ...(profile?.proofPoints ?? [])]).slice(0, 2);
}

export function resolveScreeningQuestionAnswer(
  question: string,
  context: ScreeningQuestionResolutionContext = {},
): ScreeningQuestionAnswerResolution {
  const classification = classifyScreeningQuestion(question);
  const profile = context.profile ?? null;

  if (!classification.autoAnswerAllowed) {
    return {
      classification,
      answer: null,
      source: "none",
      confidence: "low",
      needsHumanReview: true,
      reason: `${classification.intent} is ${classification.risk}-risk or unknown; do not auto-answer without human review.`,
    };
  }

  if (!profile) {
    return {
      classification,
      answer: null,
      source: "none",
      confidence: "low",
      needsHumanReview: true,
      reason: "No saved freelancer profile was provided for a grounded answer.",
    };
  }

  if (classification.intent === "hourly_rate") {
    const rate = formatRate(profile);
    return rate
      ? {
          classification,
          answer: `My standard Upwork rate is ${rate}.`,
          source: "profile",
          confidence: "high",
          needsHumanReview: false,
          reason: "Answered from saved profile.hourlyRate.",
        }
      : {
          classification,
          answer: null,
          source: "none",
          confidence: "low",
          needsHumanReview: true,
          reason: "Saved profile has no positive hourlyRate.",
        };
  }

  if (classification.intent === "availability") {
    const availability = profile.upwork?.availability?.trim();
    return availability
      ? {
          classification,
          answer: `My current Upwork availability is: ${availability}.`,
          source: "profile",
          confidence: "medium",
          needsHumanReview: false,
          reason: "Answered from saved profile.upwork.availability.",
        }
      : {
          classification,
          answer: null,
          source: "none",
          confidence: "low",
          needsHumanReview: true,
          reason: "Saved profile has no Upwork availability value.",
        };
  }

  if (classification.intent === "platform_experience") {
    const skills = relevantSkills(question, profile);
    const namedSkills = skills.length > 0 ? skills : profile.skills.slice(0, 5);
    if (namedSkills.length === 0) {
      return {
        classification,
        answer: null,
        source: "none",
        confidence: "low",
        needsHumanReview: true,
        reason: "Saved profile has no skills to ground a platform-experience answer.",
      };
    }
    return {
      classification,
      answer: `Yes — my saved profile lists experience with ${namedSkills.join(", ")}. ${profile.summary}`.trim(),
      source: "profile",
      confidence: skills.length > 0 ? "high" : "medium",
      needsHumanReview: false,
      reason: skills.length > 0 ? "Answered from profile skills explicitly mentioned in the question." : "Answered from saved profile skills.",
    };
  }

  if (classification.intent === "similar_project") {
    const proofPoints = firstProofPoints(context, profile);
    if (proofPoints.length === 0) {
      return {
        classification,
        answer: null,
        source: "none",
        confidence: "low",
        needsHumanReview: true,
        reason: "No saved proof points were available for a grounded similar-project answer.",
      };
    }
    return {
      classification,
      answer: `Yes. Relevant saved proof: ${proofPoints.join("; ")}.`,
      source: context.proofPoints?.length ? "proof_points" : "profile",
      confidence: "medium",
      needsHumanReview: false,
      reason: "Answered from saved proof points without adding private attachments or links.",
    };
  }

  return {
    classification,
    answer: null,
    source: "none",
    confidence: "low",
    needsHumanReview: true,
    reason: "No safe resolver is registered for this intent.",
  };
}

export function resolveScreeningQuestionAnswers(
  questions: string[],
  context: ScreeningQuestionResolutionContext = {},
): ScreeningQuestionAnswerResolution[] {
  return questions.map((question) => resolveScreeningQuestionAnswer(question, context));
}
