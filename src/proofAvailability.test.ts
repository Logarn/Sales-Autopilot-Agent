import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildProofAvailabilityReport, formatProofAvailabilityLines } from "./proofAvailability";
import type { PortfolioAsset, PortfolioSelectionResult } from "./skills/portfolioSelectionSkill";

function asset(input: Pick<PortfolioAsset, "id" | "name" | "path" | "kind">): PortfolioAsset {
  return {
    ...input,
    categories: [],
    safeToMention: true,
    safeToAttach: true,
    safeToAutoInclude: true,
    requiresManualReview: false,
    recommendedUsage: "test",
  };
}

function runTests(): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "proof-availability-"));
  try {
    fs.mkdirSync(path.join(tempDir, "profile/attachments"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "profile/attachments/available.pdf"), "test");

    const selection: PortfolioSelectionResult = {
      matchedThemes: [],
      selectedProof: [],
      autoAttachAssets: [
        asset({ id: "available", name: "Available proof", path: "profile/attachments/available.pdf", kind: "attachment" }),
        asset({ id: "missing", name: "Missing proof", path: "profile/attachments/missing.pdf", kind: "attachment" }),
      ],
      recommendOnlyAssets: [
        { ...asset({ id: "review", name: "Manual review proof", path: "profile/attachments/manual.pdf", kind: "attachment" }), requiresManualReview: true },
      ],
      mentionOnlyProof: [
        {
          id: "proof",
          name: "Mention-only case study",
          headline: "Proof headline",
          supporting: [],
          useFor: [],
          assetRules: [],
        },
      ],
      doNotUseAssets: [],
      selectedFigmaLinks: [],
      selectedVideoLinks: [],
      warnings: [],
    };

    const report = buildProofAvailabilityReport(selection, { cwd: tempDir });
    assert.equal(report.find((item) => item.name === "Available proof")?.status, "available_uploadable");
    assert.equal(report.find((item) => item.name === "Missing proof")?.status, "missing_manual_upload");
    assert.equal(report.find((item) => item.name === "Manual review proof")?.requiresManualReview, true);
    assert.equal(report.find((item) => item.name === "Mention-only case study")?.status, "mention_only");

    const lines = formatProofAvailabilityLines(report, { includePath: true });
    assert(lines.some((line) => line.includes("Suggested proof: Missing proof; Status: File missing locally - manual upload needed; File: profile/attachments/missing.pdf")));
    assert(lines.some((line) => line.includes("Suggested proof: Available proof; Status: File available - eligible for attachment")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests();
console.log("proof availability tests passed");
