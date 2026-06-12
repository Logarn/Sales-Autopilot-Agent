import {
  MEMORI_ACTIVE_RECALL_ENABLED,
  MEMORI_API_KEY,
  MEMORI_API_URL,
  MEMORI_REQUEST_TIMEOUT_MS,
  MEMORI_SHADOW_ENABLED,
} from "./config";
import type { AgentMemory, AgentMemoryConfidence, AgentMemoryStatus } from "./db";

const MEMORI_PUBLIC_PROD_API_KEY = "96a7ea3e-11c2-428c-b9ae-5a168363dc80";
const MEMORI_PUBLIC_STAGING_API_KEY = "c18b1022-7fe2-42af-ab01-b1f9139184f0";

export type MemoriSourceOfTruth = "local";
export type MemoriSkipReason =
  | "disabled"
  | "missing_api_key"
  | "missing_local_memory"
  | "remote_policy_blocked"
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

export interface MemoriHttpTrace {
  phase: string;
  method: string;
  endpoint: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  bodySnippet?: string;
}

export interface MemoriClientDiagnostics {
  phase?: string;
  endpoint?: string;
  status?: number;
  statusText?: string;
  bodySnippet?: string;
  errorName?: string;
  errorMessage?: string;
  cause?: unknown;
  traces?: MemoriHttpTrace[];
}

export interface MemoriShadowWriteResult {
  ok: boolean;
  shadowed: boolean;
  sourceOfTruth: MemoriSourceOfTruth;
  skippedReason?: MemoriSkipReason;
  policy?: MemoriRemoteWritePolicyDecision;
  payload?: MemoriShadowPayload;
  diagnostics?: MemoriClientDiagnostics;
}

export interface MemoriRemoteWritePolicyDecision {
  allowed: boolean;
  reason: string;
  category: "explicit" | "proposal" | "outcome" | "proof" | "source" | "screening" | "blocked" | "default_local";
  quiet: true;
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
  diagnostics?: MemoriClientDiagnostics;
}

export interface MemoriClient {
  shadowWrite(payload: MemoriShadowPayload, config: MemoriAdapterConfig): Promise<void | MemoriHttpTrace[]>;
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

interface MemoriRemoteRecallItem {
  id?: number;
  localMemoryId?: number;
  local_memory_id?: number;
  score?: number;
  rank_score?: number;
  similarity?: number;
  content?: string;
  reason?: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

export class MemoriHttpError extends Error {
  readonly diagnostics: MemoriClientDiagnostics;

  constructor(message: string, diagnostics: MemoriClientDiagnostics) {
    super(message);
    this.name = "MemoriHttpError";
    this.diagnostics = diagnostics;
  }
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

const RESERVED_ATTRIBUTION_KEYS = new Set([
  "activeRecallEligible",
  "adapter",
  "kind",
  "localSource",
  "localSourceOfTruth",
  "shadowOnly",
  "sourceOfTruth",
]);

const LOW_SIGNAL_MEMORY_TYPES = new Set([
  "browser_action",
  "browser_challenge",
  "browser_retry",
  "code_improvement_proposal",
  "code_improvement_task",
  "draft_attempt",
  "failure_pattern",
  "failure_reflection",
  "health_check",
  "lead_discovery",
  "pivot_state",
  "qa_handoff",
  "slack_status",
  "skill_trace",
  "tavily_research",
]);

const LOW_SIGNAL_SOURCE_PATTERNS = [
  /\bhealth(?:_check)?\b/i,
  /\bbrowser(?:_|-|\s)*(?:action|apply|prep|retry|challenge|capture|worker|session)\b/i,
  /\b(?:captcha|cloudflare|login|passkey|2fa|security)(?:_|-|\s)*(?:challenge|alert|block|state)?\b/i,
  /\bslack(?:_|-|\s)*(?:status|heartbeat|ack|startup|socket|trace|noise)\b/i,
  /\blead(?:_|-|\s)*(?:discovery|scan|feed|hunt|engine)\b/i,
  /\b(?:draft|proposal)(?:_|-|\s)*(?:attempt|preview|generation|trace)\b/i,
  /\b(?:qa|handoff|transient)(?:_|-|\s)*(?:state|status|trace)?\b/i,
  /\bskill(?:_|-|\s)*(?:trace|use|runtime)\b/i,
  /\btavily(?:_|-|\s)*(?:raw|research|source|trace)\b/i,
];

function metadataText(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata ?? {});
}

function sourceHint(input: MemoriShadowWriteInput, memory: MemoriLocalMemory | AgentMemory): string {
  const metadata = input.metadata ?? {};
  return [
    input.kind,
    input.attribution?.source,
    input.attribution?.eventType,
    metadata.source,
    metadata.eventType,
    metadata.signalKind,
    metadata.origin,
    memory.memoryType,
    memory.scope,
    memory.title,
    memory.summary,
    memory.keywords?.join(" "),
  ].filter((item): item is string => typeof item === "string" && item.trim().length > 0).join(" ");
}

function hasPositiveOutcomeMetadata(metadata: Record<string, unknown>): boolean {
  const outcome = String(metadata.outcome ?? metadata.status ?? "").toLowerCase();
  return /\b(reply|replied|interview|hired|won|positive|submitted)\b/.test(outcome);
}

function hasOutcomeMetadata(metadata: Record<string, unknown>): boolean {
  const outcome = String(metadata.outcome ?? metadata.status ?? "").toLowerCase();
  return /\b(reply|replied|interview|hired|won|lost|rejected|submitted|applied|positive|negative)\b/.test(outcome);
}

export function evaluateMemoriRemoteWritePolicy(input: MemoriShadowWriteInput): MemoriRemoteWritePolicyDecision {
  const memory = input.memory;
  if (!memory) {
    return { allowed: false, reason: "No local memory was provided.", category: "blocked", quiet: true };
  }
  const metadata = input.metadata ?? {};
  const source = sourceHint(input, memory);
  const memoryType = memory.memoryType.toLowerCase();
  const evidenceCount = Math.max(0, Number(memory.evidenceCount) || 0);
  const text = `${source} ${metadataText(metadata)}`;

  if (LOW_SIGNAL_MEMORY_TYPES.has(memoryType) || LOW_SIGNAL_SOURCE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { allowed: false, reason: "Low-signal operational memory stays local-only.", category: "blocked", quiet: true };
  }

  if (/slack_remember_command|explicit_remember|remember\s+this/i.test(text) || memoryType === "operator_preference") {
    return { allowed: true, reason: "Explicit operator memory is high-signal.", category: "explicit", quiet: true };
  }

  if (memoryType === "proposal_style" && /human_edit|human[-_\s]*proposal|proposal_revision|operator_edit|final_submitted|application_outcome/i.test(text)) {
    return { allowed: true, reason: "Human/final proposal style learning is high-signal.", category: "proposal", quiet: true };
  }

  if (hasOutcomeMetadata(metadata) || /application_outcome|outcome_recorded|final_submitted|submitted_proposal/i.test(text)) {
    if (["proposal_style", "proof_preference", "source_quality", "boost_strategy", "timing_hypothesis", "screening_answer"].includes(memoryType)) {
      return { allowed: true, reason: "Outcome-linked sales learning is high-signal.", category: "outcome", quiet: true };
    }
  }

  if (memoryType === "screening_answer" && (evidenceCount >= 2 || /screening_answer_diff|repeated_screening/i.test(text))) {
    return { allowed: true, reason: "Repeated screening answer pattern is high-signal.", category: "screening", quiet: true };
  }

  if (memoryType === "proof_preference" && /proof_correction|verified_proof|operator|application_outcome/i.test(text)) {
    return { allowed: true, reason: "Durable proof strategy is high-signal.", category: "proof", quiet: true };
  }

  if (memoryType === "source_quality" && (hasPositiveOutcomeMetadata(metadata) || evidenceCount >= 2)) {
    return { allowed: true, reason: "Durable source strategy has outcome/repeated evidence.", category: "source", quiet: true };
  }

  return { allowed: false, reason: "Memory is local-first until it has explicit, human, outcome, or repeated evidence.", category: "default_local", quiet: true };
}

function defaultConfig(): MemoriAdapterConfig {
  return {
    shadowEnabled: MEMORI_SHADOW_ENABLED,
    activeRecallEnabled: MEMORI_ACTIVE_RECALL_ENABLED,
    apiKey: MEMORI_API_KEY,
    apiUrl: MEMORI_API_URL,
    requestTimeoutMs: MEMORI_REQUEST_TIMEOUT_MS,
  };
}

function normalizeMemoriApiUrl(apiUrl: string): string {
  const parsed = new URL(apiUrl);
  if (parsed.hostname === "api.memori.ai") {
    parsed.hostname = "api.memorilabs.ai";
  }
  return parsed.toString().replace(/\/+$/, "");
}

function memoriEndpoint(config: MemoriAdapterConfig, path: string, options: { collector?: boolean } = {}): string {
  const base = normalizeMemoriApiUrl(config.apiUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const parsed = new URL(base);
  if (options.collector) {
    parsed.hostname = parsed.hostname
      .replace(/^api\./, "collector.")
      .replace(/^staging-api\./, "staging-collector.");
  }
  const normalizedBase = parsed.toString().replace(/\/+$/, "");
  const basePath = parsed.pathname.replace(/\/+$/, "");
  if (/\/v1$/i.test(basePath) && normalizedPath.startsWith("/v1/")) {
    return `${normalizedBase}${normalizedPath.slice(3)}`;
  }
  return `${normalizedBase}${normalizedPath}`;
}

function memoriHeaders(config: MemoriAdapterConfig): Record<string, string> {
  const isStaging = /staging/i.test(normalizeMemoriApiUrl(config.apiUrl));
  const publicKey = isStaging ? MEMORI_PUBLIC_STAGING_API_KEY : MEMORI_PUBLIC_PROD_API_KEY;
  return {
    "Authorization": `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    "X-Memori-API-Key": publicKey,
  };
}

function redactString(input: string, secrets: string[]): string {
  let output = input
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, "Bearer [REDACTED]")
    .replace(/\b(?:sk|mk|memori)[-_][A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED]");
  for (const secret of secrets.filter((item) => item.length >= 4)) {
    output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function snippet(input: string, secrets: string[], max = 500): string {
  const compact = input.replace(/\s+/g, " ").trim();
  return redactString(compact.length > max ? `${compact.slice(0, max - 3)}...` : compact, secrets);
}

async function postMemoriJson<T>(input: {
  phase: string;
  endpoint: string;
  body: unknown;
  config: MemoriAdapterConfig;
}): Promise<{ data: T; trace: MemoriHttpTrace }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.requestTimeoutMs);
  try {
    const response = await fetch(input.endpoint, {
      method: "POST",
      headers: memoriHeaders(input.config),
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
    const responseText = await response.text();
    const trace: MemoriHttpTrace = {
      phase: input.phase,
      method: "POST",
      endpoint: input.endpoint,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      bodySnippet: snippet(responseText, [input.config.apiKey]),
    };
    if (!response.ok) {
      throw new MemoriHttpError(`Memori ${input.phase} failed with status ${response.status}`, trace);
    }
    if (!responseText.trim()) {
      return { data: {} as T, trace };
    }
    try {
      return { data: JSON.parse(responseText) as T, trace };
    } catch {
      return { data: {} as T, trace };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function payloadAttribution(payload: MemoriShadowPayload): { entity: { id: string }; process: { id: string } } {
  const attribution = payload.attribution ?? {};
  const entityId = clean(
    typeof attribution.entityId === "string"
      ? attribution.entityId
      : typeof attribution.ownerUserId === "string"
        ? attribution.ownerUserId
        : "steve",
    120
  ) || "steve";
  const processId = clean(
    typeof attribution.processId === "string"
      ? attribution.processId
      : "upwork-autonomous-agent",
    120
  ) || "upwork-autonomous-agent";
  return {
    entity: { id: entityId },
    process: { id: processId },
  };
}

function payloadSession(payload: MemoriShadowPayload): { id: string } {
  return { id: `local-agent-memory-${payload.localSource.localMemoryId}` };
}

function shadowConversation(payload: MemoriShadowPayload): Array<{ role: string; text: string; type: string }> {
  const summary = [
    payload.content.summary,
    payload.content.hypothesis ? `Hypothesis: ${payload.content.hypothesis}` : null,
    payload.content.keywords.length ? `Keywords: ${payload.content.keywords.join(", ")}` : null,
  ].filter(Boolean).join("\n");
  return [
    {
      role: "user",
      type: "text",
      text: `Remember this local ${payload.localSource.memoryType} memory for Steve. Local memory id: ${payload.localSource.localMemoryId}.`,
    },
    {
      role: "assistant",
      type: "text",
      text: `${payload.content.title}\n${summary}`,
    },
  ];
}

function remoteLocalMemoryId(input: {
  localMemoryId?: number;
  local_memory_id?: number;
  id?: number;
  content?: string;
  reason?: string;
  text?: string;
  metadata?: Record<string, unknown>;
}): number | null {
  for (const value of [input.localMemoryId, input.local_memory_id, input.metadata?.localMemoryId, input.metadata?.local_memory_id]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  const text = [input.content, input.reason, input.text, JSON.stringify(input.metadata ?? {})].filter(Boolean).join(" ");
  const match = text.match(/\blocal\s+memory\s+id\s*:?\s*#?(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function remoteMatchesLocalMemory(input: {
  content?: string;
  reason?: string;
  text?: string;
  metadata?: Record<string, unknown>;
}, localMemory: MemoriLocalMemory): boolean {
  const text = clean([input.content, input.reason, input.text, JSON.stringify(input.metadata ?? {})].filter(Boolean).join(" "), 4000).toLowerCase();
  if (!text) return false;
  const title = clean(localMemory.title, 240).toLowerCase();
  const summary = clean(localMemory.summary, 600).toLowerCase();
  return Boolean(title && text.includes(title)) || Boolean(summary.length >= 40 && text.includes(summary.slice(0, 120)));
}

const defaultMemoriClient: MemoriClient = {
  async shadowWrite(payload, config) {
    const attribution = payloadAttribution(payload);
    const session = payloadSession(payload);
    const conversation = shadowConversation(payload);
    const conversationResponse = await postMemoriJson({
      phase: "conversation_messages",
      endpoint: memoriEndpoint(config, "/v1/cloud/conversation/messages"),
      body: {
        attribution,
        messages: conversation,
        session,
      },
      config,
    });
    const augmentationResponse = await postMemoriJson({
      phase: "augmentation",
      endpoint: memoriEndpoint(config, "/v1/cloud/augmentation", { collector: true }),
      body: {
        conversation: {
          messages: conversation.map((message) => ({ role: message.role, content: message.text })),
          summary: payload.content.summary,
        },
        session,
        meta: {
          attribution,
          framework: null,
          llm: {
            model: {
              provider: "local",
              sdk: { version: null },
              version: "upwork-agent",
            },
          },
          platform: { provider: "upwork-agent" },
          sdk: { lang: "javascript", version: "upwork-agent-memori-shadow" },
          storage: { cockroachdb: false, dialect: "sqlite" },
        },
      },
      config,
    });
    return [conversationResponse.trace, augmentationResponse.trace];
  },
  async recall(input, config) {
    const localMemoryById = new Map(input.localMemoryIds.map((id) => [id, true]));
    const response = await postMemoriJson<{
      memories?: MemoriRemoteRecallItem[];
      results?: MemoriRemoteRecallItem[];
      facts?: MemoriRemoteRecallItem[];
    }>({
      phase: "recall",
      endpoint: memoriEndpoint(config, "/v1/cloud/recall"),
      body: {
        attribution: {
          entity: { id: "steve" },
          process: { id: "upwork-autonomous-agent" },
        },
        query: input.query,
        session: null,
      },
      config,
    });
    const remote: MemoriRemoteRecallItem[] = response.data.memories ?? response.data.results ?? response.data.facts ?? [];
    return remote.map((memory) => ({
      localMemoryId: remoteLocalMemoryId(memory) ?? (localMemoryById.has(Number(memory.id)) ? Number(memory.id) : undefined),
      score: memory.score ?? memory.rank_score ?? memory.similarity,
      reason: memory.reason ?? memory.content,
      text: memory.text ?? memory.content,
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

function callerAttribution(input: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input ?? {}).filter(([key]) => !RESERVED_ATTRIBUTION_KEYS.has(key))
  );
}

export function memoriErrorDiagnostics(error: unknown, secrets: string[] = [MEMORI_API_KEY]): MemoriClientDiagnostics {
  if (error instanceof MemoriHttpError) {
    return {
      ...error.diagnostics,
      bodySnippet: error.diagnostics.bodySnippet ? snippet(error.diagnostics.bodySnippet, secrets) : undefined,
    };
  }
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = record.cause && typeof record.cause === "object"
    ? Object.fromEntries(Object.entries(record.cause as Record<string, unknown>)
      .filter(([key]) => ["code", "errno", "syscall", "hostname", "host", "port", "address", "message", "name"].includes(key))
      .map(([key, value]) => [key, typeof value === "string" ? snippet(value, secrets, 240) : value]))
    : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: snippet(message, secrets, 300),
    cause,
  };
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
        ...callerAttribution(input.attribution),
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
  const policy = evaluateMemoriRemoteWritePolicy(input);
  if (!policy.allowed) {
    return { ok: true, shadowed: false, sourceOfTruth: "local", skippedReason: "remote_policy_blocked", policy };
  }
  const client = input.client ?? defaultMemoriClient;
  const built = buildMemoriShadowPayload(input);
  if (!built.ok) {
    return { ok: true, shadowed: false, sourceOfTruth: "local", skippedReason: built.reason };
  }
  try {
    const traces = await client.shadowWrite(built.payload, config);
    return {
      ok: true,
      shadowed: true,
      sourceOfTruth: "local",
      payload: built.payload,
      diagnostics: Array.isArray(traces) ? { traces } : undefined,
    };
  } catch (error) {
    return {
      ok: true,
      shadowed: false,
      sourceOfTruth: "local",
      skippedReason: "client_failed",
      diagnostics: memoriErrorDiagnostics(error, [config.apiKey]),
    };
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
  const localMemoryById = new Map(input.localMemories.map((memory) => [memory.id, memory]));
  try {
    const remote = await client.recall({
      query: clean(input.query, 500),
      localMemoryIds: Array.from(localIds),
      limit: Math.max(1, input.limit ?? 10),
    }, config);
    const attributions = remote
      .map((item): MemoriRecallAttribution | null => {
        let localMemoryId = typeof item.localMemoryId === "number" ? item.localMemoryId : null;
        if (!localMemoryId || !localIds.has(localMemoryId)) {
          const matched = input.localMemories.find((memory) => remoteMatchesLocalMemory(item, memory));
          localMemoryId = matched?.id ?? null;
        }
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
  } catch (error) {
    return {
      sourceOfTruth: "local",
      activeRecallUsed: false,
      semanticScoresByMemoryId: {},
      attributions: [],
      fallbackReason: "client_failed",
      diagnostics: memoriErrorDiagnostics(error, [config.apiKey]),
    };
  }
}

export function redactMemoriPayload<T>(value: T, secrets: string[] = [MEMORI_API_KEY]): T {
  const filteredSecrets = secrets.filter((secret) => secret.length >= 4);
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") return redactString(item, filteredSecrets);
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
