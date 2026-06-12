import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function cleanupDatabase(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore cleanup failures
    }
  }
  const dir = dirname(path);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runTests(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-memori-local-first/jobs.db");
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });

  process.env.DB_PATH = tempDb;
  process.env.MEMORI_ENABLED = "true";
  process.env.MEMORI_SHADOW_MODE = "false";
  process.env.MEMORI_ACTIVE_RECALL = "true";
  process.env.MEMORI_API_KEY = "memori-test-key";

  const {
    closeDb,
    listAgentMemories,
    upsertAgentMemory,
  } = require("./db") as {
    closeDb: () => void;
    listAgentMemories: (limit?: number) => Array<{ id: number; memoryType: string; scope: string; title: string; summary: string; evidenceCount: number; version: number; status: string }>;
    upsertAgentMemory: (input: any) => { id: number; evidenceCount: number; version: number; status: string };
  };

  try {
    const first = upsertAgentMemory({
      memoryType: "proposal_style",
      scope: "beauty:klaviyo",
      title: "routine-first opener",
      summary: "Open beauty retention proposals with routine and replenishment logic before proof.",
      hypothesisText: "Routine/replenishment logic helps beauty clients see the commercial leak.",
      confidence: "low",
      evidenceCount: 1,
      status: "tentative",
      keywords: ["beauty", "klaviyo", "routine", "replenishment"],
      remotePolicyMetadata: { source: "proposal_revision" },
    });
    assert(first.id > 0, "local memory should be inserted when Memori shadow mode is off");

    const duplicate = upsertAgentMemory({
      memoryType: "proposal_style",
      scope: "beauty:klaviyo",
      title: "routine-first opener",
      summary: "Open beauty retention proposals with routine and replenishment logic before proof.",
      hypothesisText: "Routine/replenishment logic helps beauty clients see the commercial leak.",
      confidence: "medium",
      evidenceCount: 1,
      status: "tentative",
      keywords: ["beauty", "klaviyo", "routine", "replenishment"],
      remotePolicyMetadata: { source: "proposal_revision" },
    });
    assert(duplicate.id === first.id, "duplicate proposal-style memory should update the existing local row");
    assert(duplicate.evidenceCount === first.evidenceCount + 1, "duplicate memory should compact evidence into the existing row");
    assert(duplicate.version > first.version, "duplicate memory update should increment the local version");

    const memories = listAgentMemories(10);
    assert(memories.length === 1, "duplicate proposal-style memory should not create a second local memory");
    assert(memories[0].status === "active", "repeated evidence should promote the local memory");
  } finally {
    closeDb();
    cleanupDatabase(tempDb);
  }

  console.log("memori local-first tests passed");
}

runTests().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
