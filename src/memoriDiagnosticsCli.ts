import { execFile } from "node:child_process";
import { lookup, setDefaultResultOrder } from "node:dns";
import { promisify } from "node:util";
import {
  MEMORI_ACTIVE_RECALL,
  MEMORI_ACTIVE_RECALL_ENABLED,
  MEMORI_API_KEY,
  MEMORI_API_URL,
  MEMORI_ENABLED,
  MEMORI_REQUEST_TIMEOUT_MS,
  MEMORI_SHADOW_ENABLED,
  MEMORI_SHADOW_MODE,
} from "./config";
import { closeDb, upsertAgentMemory } from "./db";
import { memoriErrorDiagnostics, shadowWriteMemoriMemory, type MemoriClientDiagnostics } from "./memoriAdapter";

const execFileAsync = promisify(execFile);

interface ProbeResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  bodySnippet?: string;
  error?: MemoriClientDiagnostics;
}

function apiBase(): string {
  const parsed = new URL(MEMORI_API_URL);
  if (parsed.hostname === "api.memori.ai") {
    parsed.hostname = "api.memorilabs.ai";
  }
  return parsed.toString().replace(/\/+$/, "");
}

function apiEndpoint(path: string): string {
  return `${apiBase()}${path.startsWith("/") ? path : `/${path}`}`;
}

function collectorBase(): string {
  const parsed = new URL(apiBase());
  parsed.hostname = parsed.hostname
    .replace(/^api\./, "collector.")
    .replace(/^staging-api\./, "staging-collector.");
  return parsed.toString().replace(/\/+$/, "");
}

function collectorEndpoint(path: string): string {
  return `${collectorBase()}${path.startsWith("/") ? path : `/${path}`}`;
}

function compact(input: string, max = 500): string {
  const safe = input
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, "Bearer [REDACTED]")
    .replace(/\b(?:sk|mk|memori)[-_][A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED]")
    .split(MEMORI_API_KEY.length >= 4 ? MEMORI_API_KEY : "__NO_SECRET__")
    .join("[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return safe.length > max ? `${safe.slice(0, max - 3)}...` : safe;
}

function print(label: string, value: unknown): void {
  console.log(`${label}: ${JSON.stringify(value, null, 2)}`);
}

function envShape(): Record<string, unknown> {
  return {
    MEMORI_ENABLED,
    MEMORI_SHADOW_MODE,
    MEMORI_ACTIVE_RECALL,
    MEMORI_SHADOW_ENABLED,
    MEMORI_ACTIVE_RECALL_ENABLED,
    MEMORI_API_KEY: MEMORI_API_KEY ? "[present]" : "[missing]",
    MEMORI_API_URL,
    normalizedApiUrl: apiBase(),
    MEMORI_REQUEST_TIMEOUT_MS,
  };
}

async function dnsLookup(hostname: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    lookup(hostname, { all: true }, (error, addresses) => {
      if (error) {
        resolve({ ok: false, hostname, error: memoriErrorDiagnostics(error, [MEMORI_API_KEY]) });
        return;
      }
      resolve({ ok: true, hostname, addresses });
    });
  });
}

async function curlHead(url: string, familyFlag?: "-4" | "-6"): Promise<Record<string, unknown>> {
  const args = [familyFlag, "-sS", "--max-time", "10", "-I", url].filter(Boolean) as string[];
  try {
    const { stdout, stderr } = await execFileAsync("curl", args, { timeout: 12_000, maxBuffer: 20_000 });
    return { ok: true, command: ["curl", ...args], output: compact(`${stdout}${stderr}`) };
  } catch (error) {
    const record = error as { stdout?: string; stderr?: string; code?: number };
    return {
      ok: false,
      command: ["curl", ...args],
      exitCode: record.code,
      output: compact(`${record.stdout ?? ""}${record.stderr ?? ""}`),
    };
  }
}

async function fetchProbe(url: string, method: "GET" | "HEAD" | "POST", body?: unknown): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEMORI_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = method === "HEAD" ? "" : await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      bodySnippet: compact(text),
    };
  } catch (error) {
    return {
      ok: false,
      error: memoriErrorDiagnostics(error, [MEMORI_API_KEY]),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runShadowSmoke(): Promise<boolean> {
  const activeRecallAllowed = process.argv.includes("--allow-active-recall");
  if (MEMORI_ACTIVE_RECALL_ENABLED && !activeRecallAllowed) {
    print("activeRecallGuard", {
      ok: false,
      activeRecall: MEMORI_ACTIVE_RECALL_ENABLED,
      message: "Refusing shadow smoke with active recall enabled unless --allow-active-recall is explicit.",
    });
    return false;
  }

  print("safety", {
    browserAction: false,
    finalSubmit: false,
    activeRecall: MEMORI_ACTIVE_RECALL_ENABLED,
    localDbSourceOfTruth: true,
  });

  const memory = upsertAgentMemory({
    memoryType: "writing_preference",
    scope: "global",
    title: "Steve prefers diagnosis-first proposal openers",
    summary: "Steve prefers concise proposal openers that start with diagnosis, not generic intros.",
    ruleText: "For Upwork proposal drafts, open with a concise diagnosis before credentials or generic introductions.",
    hypothesisText: "Diagnosis-first proposal openers are Steve's preferred style for Upwork drafts.",
    confidence: "medium",
    importance: 8,
    evidenceCount: 1,
    status: "active",
    keywords: ["steve", "proposal", "diagnosis-first", "concise", "no generic intros"],
  });

  print("localWrite", {
    ok: true,
    id: memory.id,
    memoryType: memory.memoryType,
    title: memory.title,
    sourceOfTruth: "local",
  });

  const shadow = await shadowWriteMemoriMemory({
    memory,
    kind: "memori_production_smoke",
    attribution: {
      source: "memori_smoke",
      entityId: "steve",
      processId: "upwork-autonomous-agent",
    },
    metadata: {
      smokeTest: true,
      browserAction: false,
      finalSubmit: false,
      localSourceOfTruth: true,
    },
  });

  print("shadowWrite", {
    ok: shadow.ok,
    shadowed: shadow.shadowed,
    skippedReason: shadow.skippedReason ?? null,
    sourceOfTruth: shadow.sourceOfTruth,
    diagnostics: shadow.diagnostics ?? null,
  });

  return shadow.shadowed;
}

async function runDiagnose(): Promise<boolean> {
  if (process.argv.includes("--ipv4-first")) {
    setDefaultResultOrder("ipv4first");
  }

  const parsed = new URL(apiBase());
  print("envShape", envShape());
  print("dns", {
    currentHost: await dnsLookup(parsed.hostname),
    legacyHost: await dnsLookup("api.memori.ai"),
    officialHost: await dnsLookup("api.memorilabs.ai"),
  });
  print("curlRootHttps", await curlHead(apiBase()));
  print("curlRootHttpsIpv4", await curlHead(apiBase(), "-4"));
  print("curlRootHttpsIpv6", await curlHead(apiBase(), "-6"));
  print("nodeFetchRoot", await fetchProbe(apiBase(), "HEAD"));
  print("nodeFetchConversationEndpoint", await fetchProbe(apiEndpoint("/v1/cloud/conversation/messages"), "HEAD"));
  print("nodeFetchCollectorRoot", await fetchProbe(collectorBase(), "HEAD"));
  print("nodeFetchAugmentationEndpoint", await fetchProbe(collectorEndpoint("/v1/cloud/augmentation"), "HEAD"));
  print("endpointConfirmation", {
    expectedWriteEndpoints: [
      apiEndpoint("/v1/cloud/conversation/messages"),
      collectorEndpoint("/v1/cloud/augmentation"),
    ],
    deprecatedEndpoint: "https://api.memori.ai/v1/memories/shadow",
    deprecatedEndpointUsed: false,
  });
  return runShadowSmoke();
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "smoke";
  print("mode", mode);
  print("envShape", envShape());
  const ok = mode === "diagnose" ? await runDiagnose() : await runShadowSmoke();
  closeDb();
  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  print("fatal", memoriErrorDiagnostics(error, [MEMORI_API_KEY]));
  try {
    closeDb();
  } catch {
    // ignore close failures during fatal exit
  }
  process.exitCode = 1;
});
