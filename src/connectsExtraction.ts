import type {
  ConnectsExtractionConfidence,
  ConnectsExtractionMethod,
  SourceBackedConnects,
} from "./types";

type JsonChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface ConnectsExtractionProvider {
  isAvailable(): boolean;
  completeJson<T>(request: {
    messages: JsonChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ ok: boolean; data?: T; skippedReason?: string; error?: string }>;
}

type ConnectsCandidate = Partial<SourceBackedConnects> & {
  required?: unknown;
  boost?: unknown;
  total?: unknown;
};

interface MatchResult {
  value: number;
  sourceText: string;
  sourceLocation: string;
  confidence: Exclude<ConnectsExtractionConfidence, "unknown">;
}

const REQUIRED_PATTERNS: Array<{ pattern: RegExp; confidence: Exclude<ConnectsExtractionConfidence, "unknown"> }> = [
  { pattern: /\b(?:this\s+)?proposal\s+requires\s+(\d{1,3})\s+Connects\b/i, confidence: "high" },
  { pattern: /\brequired\s+for\s+proposal\s*:?\s*(\d{1,3})\s+Connects\b/i, confidence: "high" },
  { pattern: /\bsend\s+a\s+proposal\s+for\s*:?\s*(\d{1,3})\s+Connects\b/i, confidence: "high" },
  { pattern: /\bsend\s+for\s+(\d{1,3})\s+Connects\b/i, confidence: "high" },
  { pattern: /\brequires\s+(\d{1,3})\s+Connects\s+to\s+(?:apply|submit)\b/i, confidence: "high" },
  { pattern: /\bConnects\s+to\s+apply\s*:?\s*(\d{1,3})\b/i, confidence: "high" },
  { pattern: /\bRequired\s+Connects\s*:?\s*(\d{1,3})\b/i, confidence: "high" },
  { pattern: /\bConnects\s+required\s*:?\s*(\d{1,3})\b/i, confidence: "high" },
  { pattern: /\b(\d{1,3})\s+Connects\s+(?:required|to\s+apply)\b/i, confidence: "medium" },
];

const BOOST_PATTERNS = [
  /\bBid\s+to\s+boost\s*:?\s*(\d{1,3})\s+Connects\b/i,
  /\bBoost(?:ed)?(?:\s+bid)?\s*:?\s*(\d{1,3})\s+Connects\b/i,
];

const TOTAL_PATTERNS = [
  /\bTotal\s*:?\s*(\d{1,3})\s+Connects\b/i,
  /\bTotal\s+Connects\s*:?\s*(\d{1,3})\b/i,
];

const REQUIRED_EXCLUSION = /\b(?:remaining|available|balance|purchased?|buy|membership|boost|bid|spent|refund|your\s+Connects)\b/i;

export function unknownConnectsExtraction(extractionMethod: ConnectsExtractionMethod = "not_found"): SourceBackedConnects {
  return {
    requiredConnects: null,
    boostConnects: null,
    totalConnects: null,
    confidence: "unknown",
    sourceText: null,
    sourceLocation: null,
    extractionMethod,
  };
}

function parseConnectsNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function visibleLines(text: string): string[] {
  return text.replace(/\r/g, "").split("\n");
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function findLineMatch(
  text: string,
  patterns: Array<{ pattern: RegExp; confidence: Exclude<ConnectsExtractionConfidence, "unknown"> }>,
  options: { exclude?: RegExp } = {},
): MatchResult | null {
  const lines = visibleLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const line = compact(lines[index]);
    if (!line || options.exclude?.test(line)) continue;
    for (const { pattern, confidence } of patterns) {
      const match = line.match(pattern);
      const value = parseConnectsNumber(match?.[1]);
      if (match?.[0] && value !== null) {
        return {
          value,
          sourceText: compact(match[0]),
          sourceLocation: `line ${index + 1}`,
          confidence,
        };
      }
    }
  }
  return null;
}

function findSimpleLineMatch(text: string, patterns: RegExp[]): MatchResult | null {
  return findLineMatch(
    text,
    patterns.map((pattern) => ({ pattern, confidence: "high" as const })),
  );
}

function joinSourceText(...matches: Array<MatchResult | null>): string {
  return matches
    .filter((match): match is MatchResult => Boolean(match))
    .map((match) => match.sourceText)
    .join(" | ");
}

function joinSourceLocations(...matches: Array<MatchResult | null>): string {
  return matches
    .filter((match): match is MatchResult => Boolean(match))
    .map((match) => match.sourceLocation)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(", ");
}

export function extractConnectsFromVisibleText(text: string): SourceBackedConnects {
  const required = findLineMatch(text, REQUIRED_PATTERNS, { exclude: REQUIRED_EXCLUSION });
  if (!required) return unknownConnectsExtraction("not_found");

  const boost = findSimpleLineMatch(text, BOOST_PATTERNS);
  const explicitTotal = findSimpleLineMatch(text, TOTAL_PATTERNS);
  const boostConnects = boost?.value ?? null;
  const totalConnects = explicitTotal?.value ?? (boostConnects !== null ? required.value + boostConnects : null);

  return {
    requiredConnects: required.value,
    boostConnects,
    totalConnects,
    confidence: required.confidence,
    sourceText: joinSourceText(required, boost, explicitTotal),
    sourceLocation: joinSourceLocations(required, boost, explicitTotal),
    extractionMethod: "deterministic_visible_text",
  };
}

function normalizeForSearch(value: string): string {
  return compact(value).toLowerCase();
}

function sourceTextIsVisible(visibleText: string, sourceText: string): boolean {
  const haystack = normalizeForSearch(visibleText);
  const parts = sourceText.split("|").map(normalizeForSearch).filter(Boolean);
  return parts.length > 0 && parts.every((part) => haystack.includes(part));
}

function lineForSourceText(visibleText: string, sourceText: string): string | null {
  const lines = visibleLines(visibleText);
  const firstPart = sourceText.split("|").map(normalizeForSearch).find(Boolean);
  if (!firstPart) return null;
  const index = lines.findIndex((line) => normalizeForSearch(line).includes(firstPart));
  return index >= 0 ? `line ${index + 1}` : null;
}

function normalizeConfidence(value: unknown): ConnectsExtractionConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function sanitizedSourceText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? compact(value) : null;
}

export function normalizeLlmConnectsExtraction(candidate: ConnectsCandidate | null | undefined, visibleText: string): SourceBackedConnects {
  const sourceText = sanitizedSourceText(candidate?.sourceText);
  const requiredConnects = parseConnectsNumber(candidate?.requiredConnects ?? candidate?.required);
  if (requiredConnects === null || !sourceText || !sourceTextIsVisible(visibleText, sourceText)) {
    return unknownConnectsExtraction("not_found");
  }

  const boostConnects = parseConnectsNumber(candidate?.boostConnects ?? candidate?.boost);
  const explicitTotal = parseConnectsNumber(candidate?.totalConnects ?? candidate?.total);
  return {
    requiredConnects,
    boostConnects,
    totalConnects: explicitTotal ?? (boostConnects !== null ? requiredConnects + boostConnects : null),
    confidence: normalizeConfidence(candidate?.confidence),
    sourceText,
    sourceLocation: lineForSourceText(visibleText, sourceText) ?? sanitizedSourceText(candidate?.sourceLocation),
    extractionMethod: "llm_visible_text",
  };
}

function buildConnectsExtractionMessages(visibleText: string): JsonChatMessage[] {
  return [
    {
      role: "system",
      content:
        "Return JSON only. Extract Upwork Connects only from the provided visible text. If visible text does not explicitly state required Connects, return requiredConnects null, boostConnects null, totalConnects null, confidence unknown, sourceText null, sourceLocation null, extractionMethod llm_visible_text. Never infer or default missing Connects to 0.",
    },
    {
      role: "user",
      content: JSON.stringify({
        schema: {
          requiredConnects: "number|null",
          boostConnects: "number|null",
          totalConnects: "number|null",
          confidence: "high|medium|low|unknown",
          sourceText: "exact visible text supporting requiredConnects, or null",
          sourceLocation: "line/section if visible, or null",
          extractionMethod: "llm_visible_text",
        },
        visibleText,
      }),
    },
  ];
}

export async function extractConnectsWithLlmFallback(
  visibleText: string,
  provider: ConnectsExtractionProvider,
): Promise<SourceBackedConnects> {
  const deterministic = extractConnectsFromVisibleText(visibleText);
  if (deterministic.requiredConnects !== null || !provider.isAvailable()) return deterministic;

  const result = await provider.completeJson<ConnectsCandidate>({
    messages: buildConnectsExtractionMessages(visibleText),
    temperature: 0,
    maxTokens: 500,
  });
  if (!result.ok || !result.data) return deterministic;
  return normalizeLlmConnectsExtraction(result.data, visibleText);
}
