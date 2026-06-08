import {
  MEMORI_ACTIVE_RECALL_ENABLED,
  MEMORI_API_KEY,
  MEMORI_API_URL,
  MEMORI_REQUEST_TIMEOUT_MS,
  MEMORI_SHADOW_ENABLED,
} from "./config";
import type { AgentMemory, AgentMemoryConfidence, AgentMemoryStatus } from "./db";

export type MemoriSourceOfTruth = "local";
export type MemoriSkipReason =
  | "disabled"
  | "missing_api_key"
  | "missing_local_memory"
  | "unsafe_final_submit_override"
  | "unsafe_security_bypass"
  | "unverified_proof_claim"
  | "client_unavailable"
  | "client_failed";

export interface MemoriAdapterConfig {
  shadowEnabled: boolean;
  activeRecallEnabled: boolean;
  apiKey: string;
  apiUrl: string;
  requestTimeoutMs: number;
}

export interface MemoriLocalMemory {
  id: number;
  memoryType: string;
  scope: string;
  title: string;
  summary: string;
  ruleText?: string | null;
  hypothesisText?: string | null;
  confidence: AgentMemoryConfidence;
  evidenceCount: number;
  status: AgentMemoryStatus;
  keywords?: string[];
  updatedAt?: string;
}

export interface MemoriProofVerification {
  verified: boolean;
  source?: "operator" | "browser" | "local_db" | "unverified" | string;
  verifiedAt?: string | null;
}

export interface MemoriShadowWriteInput {
  memory: MemoriLocalMemory | AgentMemory | null | undefined;
  kind?: string;
  attribution?: Record<string, unknown>;
  proofVerification?: MemoriProofVerification;
  metadata?: Record<string, unknown>;
}

export interface MemoriShadowPayload {
  shadowOnly: true;
  activeRecallEligible: false;
  sourceOfTruth: MemoriSourceOfTruth;
  localSource: {
    source: "agent_memories";
    localMemoryId: number;
    memoryType: string;
    scope: string;
    confidence: AgentMemoryConfidence;
    evidenceCount: number;
    status: AgentMemoryStatus;
  };
  content: {
    title: string;
    summary: string;
    hypothesis: string | null;
    keywords: string[];
  };
  attribution: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface MemoriShadowWriteResult {
  ok: boolean;
  shadowed: boolean;
  sourceOfTruth: MemoriSourceOfTruth;
  skippedReason?: MemoriSkipReason;
  payload?: MemoriShadowPayload;
}

export interface MemoriRecallInput {
  query: string;
  localMemories: MemoriLocalMemory[];
  limit?: number;
}

export interface MemoriRecallAttribution {
  localMemoryId: number;
  score: number;
  source: "memori_shadow";
  reason: string;
}

export interface MemoriRecallResult {
  sourceOfTruth: MemoriSourceOfTruth;
  activeRecallUsed: boolean;
  semanticScoresByMemoryId: Record<number, number>;
  attributions: MemoriRecallAttribution[];
  fallbackReason?: MemoriSkipReason;
}

export interface MemoriClient {
  shadowWrite(payload: MemoriShadowPayload, config: MemoriAdapterConfig): Promise<void>;
  recall(input: {
    query: string;
    localMemoryIds: number[];
    limit: number;
  }, config: MemoriAdapterConfig): Promise<Array<{
    localMemoryId?: number;
    score?: number;
    reason?: string;
    text?: string;
    metadata?: Record<string, unknown>;
  }>>;
}

const FINAL_SUBMIT_OVERRIDE_PATTERNS = [
  /\b(allow|enable|automate|auto[-\s]*(?:click|send|submit)|click|press|tap|override|ignore)\b.*\b(?:final\s*)?(?:submit|submission)\b/i,
  /\b(?:click|press|tap|auto[-\s]*click|automate)\b.*\b(?:send\s+proposal|submit\s+proposal|send\s+for\s+\d+\s+connects)\b/i,
  /\b(?:send|submit)\s+(?:the\s+)?(?:upwork\s+)?proposal\s+(?:automatically|without\s+(?:steve|human|manual)|on\s+my\s+own)\b/i,
  /\b(?:send|submit)\s+for\s+\d+\s+connects\b/i,
  /\b(final\s*)?submit\b.*\b(allowed|enabled|automatic|automated|override|ignored)\b/i,
];

const SECURITY_VERBS = "(?:bypass|override|ignore|disable|solve|circumvent|evade|get\\s+around|work\\s+around|skip|avoid|pass\\s+through|defeat|clear\\s+automatically)";
const SECURITY_TARGETS = "(?:captcha|cloudflare|security|2fa|two[-\\s]*factor|passkey|login|screen|challenge)";
const SECURITY_BYPASS_PATTERNS = [
  new RegExp(`\\b${SECURITY_VERBS}\\b.{0,80}\\b${SECURITY_TARGETS}\\b`, "i"),
  new RegExp(`\\b${SECURITY_TARGETS}\\b.{0,80}\\b${SECURITY_VERBS}\\b`, "i"),
];

const UNVERIFIED_PROOF_PATTERNS = [
  /\b(mark|treat|claim|set)\b.*\b(proof|asset|attachment|portfolio|file)\b.*\bverified\b/i,
  /\bverified\b.*\b(proof|asset|attachment|portfolio|file)\b/i,
  /\b(uploaded|selected|attached)\b.*\bverified\b/i,
];

function defaultConfig(): MemoriAdapterConfig {
  return {
    shadowEnabled: MEMORI_SHADOW_ENABLED,
    activeRecallEnabled: MEMORI_ACTIVE_RECALL_ENABLED,
    apiKey: MEMORI_API_KEY,
    apiUrl: MEMORI_API_URL,
    requestTimeoutMs: MEMORI_REQUEST_TIMEOUT_MS,
  };
}

function memoriEndpoint(config: MemoriAdapterConfig, path: string): string {
  const base = config.apiUrl.replace(/\/+$/, "");
  return /\/(?:memories|memory|shadow|recall)(?:\/|$)/i.test(new URL(base).pathname)
    ? base
    : `${base}${path}`;
}

async function postMemoriJson<T>(input: {
  endpoint: string;
  body: unknown;
  config: MemoriAdapterConfig;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.requestTimeoutMs);
  try {
    const response = await fetch(input.endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${input.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Memori request failed with status ${response.status}`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

const defaultMemoriClient: MemoriClient = {
  async shadowWrite(payload, config) {
    await postMemoriJson({
      endpoint: memoriEndpoint(config, "/v1/memories/shadow"),
      body: payload,
      config,
    });
  },
  async recall(input, config) {
    const response = await postMemoriJson<{ memories?: Array<{
      localMemoryId?: number;
      local_memory_id?: number;
      score?: number;
      reason?: string;
      text?: string;
      metadata?: Record<string, unknown>;
    }>; results?: Array<{
      localMemoryId?: number;
      local_memory_id?: number;
      score?: number;
      reason?: string;
      text?: string;
      metadata?: Record<string, unknown>;
    }> }>({
      endpoint: memoriEndpoint(config, "/v1/memories/recall"),
      body: input,
      config,
    });
    return (response.memories ?? response.results ?? []).map((memory) => ({
      localMemoryId: memory.localMemoryId ?? memory.local_memory_id,
      score: memory.score,
      reason: memory.reason,
      text: memory.text,
      metadata: memory.metadata,
    }));
  },
};

function clean(value: string | null | undefined, max = 1000): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

function memoryText(memory: MemoriLocalMemory | null | undefined, metadata?: Record<string, unknown>): string {
  return [
    memory?.title,
    memory?.summary,
    memory?.ruleText,
    memory?.hypothesisText,
    memory?.keywords?.join(" "),
    JSON.stringify(metadata ?? {}),
  ].filter(Boolean).join(" ");
}

function safetyBlockReason(input: {
  text: string;
  metadata?: Record<string, unknown>;
  proofVerification?: MemoriProofVerification;
}): MemoriSkipReason | null {
  const metadata = input.metadata ?? {};
  const text = `${input.text} ${JSON.stringify(metadata)}`;
  if (metadata.hardSafetyOverride === true || metadata.allowFinalSubmit === true || FINAL_SUBMIT_OVERRIDE_PATTERNS.some((pattern) => pattern.test(text))) {
    return "unsafe_final_submit_override";
  }
  if (metadata.allowSecurityBypass === true || (SECURITY_BYPASS_PATTERNS.some((pattern) => pattern.test(text)) && !isSafeCopywritingSecurityMention(text))) {
    return "unsafe_security_bypass";
  }

  const claimsVerifiedProof = metadata.proofVerified === true || UNVERIFIED_PROOF_PATTERNS.some((pattern) => pattern.test(text));
  if (claimsVerifiedProof && !hasVerifiedProofAttribution(input.proofVerification)) {
    return "unverified_proof_claim";
  }
  return null;
}

function isSafeCopywritingSecurityMention(text: string): boolean {
  return /\b(?:avoid|skip|remove|omit)\b.{0,40}\b(?:mentioning|saying|referencing|talking about)\b.{0,80}\b(?:captcha|cloudflare|security|2fa|two[-\s]*factor|passkey|login)\b.{0,80}\b(?:proposal|draft|copy|cover letter)\b/i.test(text)
    || /\b(?:proposal|draft|copy|cover letter)\b.{0,80}\b(?:avoid|skip|remove|omit)\b.{0,40}\b(?:mentioning|saying|referencing|talking about)\b.{0,80}\b(?:captcha|cloudflare|security|2fa|two[-\s]*factor|passkey|login)\b/i.test(text);
}

function hasVerifiedProofAttribution(proofVerification: MemoriProofVerification | undefined): boolean {
  if (!proofVerification?.verified) return false;
  if (!proofVerification.verifiedAt) return false;
  return proofVerification.source === "operator" || proofVerification.source === "browser" || proofVerification.source === "local_db";
}

function normalizeKeywords(memory: MemoriLocalMemory): string[] {
  return Array.from(new Set((memory.keywords ?? [])
    .map((keyword) => clean(keyword, 80).toLowerCase())
    .filter(Boolean)))
    .slice(0, 20);
}

export function buildMemoriShadowPayload(input: MemoriShadowWriteInput): { ok: true; payload: MemoriShadowPayload } | { ok: false; reason: MemoriSkipReason } {
  const memory = input.memory;
  if (!memory) {
    return { ok: false, reason: "missing_local_memory" };
  }
  const metadata = input.metadata ?? {};
  const blockReason = safetyBlockReason({
    text: memoryText(memory, metadata),
    metadata,
    proofVerification: input.proofVerification,
  });
  if (blockReason) {
    return { ok: false, reason: blockReason };
  }

  return {
    ok: true,
    payload: {
      shadowOnly: true,
      activeRecallEligible: false,
      sourceOfTruth: "local",
      localSource: {
        source: "agent_memories",
        localMemoryId: memory.id,
        memoryType: memory.memoryType,
        scope: memory.scope,
        confidence: memory.confidence,
        evidenceCount: memory.evidenceCount,
        status: memory.status,
      },
      content: {
        title: clean(memory.title, 240),
        summary: clean(memory.summary, 2000),
        hypothesis: memory.hypothesisText ? clean(memory.hypothesisText, 2000) : null,
        keywords: normalizeKeywords(memory),
      },
      attribution: {
        ...(input.attribution ?? {}),
        adapter: "memori_shadow",
        kind: input.kind ?? "agent_memory",
        localSourceOfTruth: true,
      },
      metadata: {
        ...metadata,
        proofVerification: input.proofVerification ?? null,
      },
    },
  };
}

export async function shadowWriteMemoriMemory(input: MemoriShadowWriteInput & {
  config?: Partial<MemoriAdapterConfig>;
  client?: Pick<MemoriClient, "shadowWrite">;
}): Promise<MemoriShadowWriteResult> {
  const config = { ...defaultConfig(), ...(input.config ?? {}) };
  if (!config.shadowEnabled) {
    return { ok: true, shadowed: false, sourceOfTruth: "local", skippedReason: "disabled" };
  }
  if (!config.apiKey) {
    return { ok: true, shadowed: false, sourceOfTruth: "local", skippedReason: "missing_api_key" };
  }
  const client = input.client ?? defaultMemoriClient;
  const built = buildMemoriShadowPayload(input);
  if (!built.ok) {
    return { ok: true, shadowed: false, sourceOfTruth: "local", skippedReason: built.reason };
  }
  try {
    await client.shadowWrite(redactMemoriPayload(built.payload, [config.apiKey]) as MemoriShadowPayload, config);
    return { ok: true, shadowed: true, sourceOfTruth: "local", payload: built.payload };
  } catch {
    return { ok: true, shadowed: false, sourceOfTruth: "local", skippedReason: "client_failed" };
  }
}

export async function recallMemoriAttributions(input: MemoriRecallInput & {
  config?: Partial<MemoriAdapterConfig>;
  client?: Pick<MemoriClient, "recall">;
}): Promise<MemoriRecallResult> {
  const config = { ...defaultConfig(), ...(input.config ?? {}) };
  if (!config.activeRecallEnabled) {
    return {
      sourceOfTruth: "local",
      activeRecallUsed: false,
      semanticScoresByMemoryId: {},
      attributions: [],
      fallbackReason: "disabled",
    };
  }
  if (!config.apiKey) {
    return {
      sourceOfTruth: "local",
      activeRecallUsed: false,
      semanticScoresByMemoryId: {},
      attributions: [],
      fallbackReason: "missing_api_key",
    };
  }
  const client = input.client ?? defaultMemoriClient;

  const localIds = new Set(input.localMemories.map((memory) => memory.id));
  try {
    const remote = await client.recall({
      query: clean(input.query, 500),
      localMemoryIds: Array.from(localIds),
      limit: Math.max(1, input.limit ?? 10),
    }, config);
    const attributions = remote
      .map((item): MemoriRecallAttribution | null => {
        const localMemoryId = typeof item.localMemoryId === "number" ? item.localMemoryId : null;
        if (!localMemoryId || !localIds.has(localMemoryId)) return null;
        const score = typeof item.score === "number" && Number.isFinite(item.score) ? Math.max(0, Math.min(1, item.score)) : 0;
        const reason = clean(item.reason ?? item.text ?? "Memori shadow recall matched this local memory.", 240);
        const blockReason = safetyBlockReason({ text: `${reason} ${item.text ?? ""}`, metadata: item.metadata });
        if (blockReason) return null;
        return {
          localMemoryId,
          score,
          source: "memori_shadow",
          reason,
        };
      })
      .filter((item): item is MemoriRecallAttribution => Boolean(item));
    return {
      sourceOfTruth: "local",
      activeRecallUsed: true,
      semanticScoresByMemoryId: Object.fromEntries(attributions.map((item) => [item.localMemoryId, item.score])),
      attributions,
    };
  } catch {
    return {
      sourceOfTruth: "local",
      activeRecallUsed: false,
      semanticScoresByMemoryId: {},
      attributions: [],
      fallbackReason: "client_failed",
    };
  }
}

export function redactMemoriPayload<T>(value: T, secrets: string[] = [MEMORI_API_KEY]): T {
  const filteredSecrets = secrets.filter((secret) => secret.length >= 4);
  const redactString = (input: string): string => {
    let output = input
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, "Bearer [REDACTED]")
      .replace(/\b(?:sk|mk|memori)[-_][A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED]");
    for (const secret of filteredSecrets) {
      output = output.split(secret).join("[REDACTED]");
    }
    return output;
  };

  const visit = (item: unknown): unknown => {
    if (typeof item === "string") return redactString(item);
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, nested]) => [
        /api[_-]?key|authorization|token|secret/i.test(key) ? key : key,
        /api[_-]?key|authorization|token|secret/i.test(key) && typeof nested === "string" ? "[REDACTED]" : visit(nested),
      ]));
    }
    return item;
  };
  return visit(value) as T;
}
