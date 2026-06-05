import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { auditProofAssets, formatProofAssetAudit, proofAssetExists, resolveProofAssetPath } from "./proofAssets";

function runTests(): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "proof-assets-"));
  try {
    const assetRoot = path.join(tempDir, "shared/proof-assets");
    fs.mkdirSync(path.join(assetRoot, "profile/attachments"), { recursive: true });
    fs.writeFileSync(path.join(assetRoot, "profile/attachments/truly-beauty-case-study.pdf"), "test");

    const resolved = resolveProofAssetPath("profile/attachments/truly-beauty-case-study.pdf", {
      cwd: tempDir,
      assetRoot: "shared/proof-assets",
    });
    assert.equal(resolved, path.join(assetRoot, "profile/attachments/truly-beauty-case-study.pdf"));
    assert.equal(proofAssetExists("profile/attachments/truly-beauty-case-study.pdf", { cwd: tempDir, assetRoot: "shared/proof-assets" }), true);
    assert.equal(proofAssetExists("profile/attachments/fly-boutique-case-study.pdf", { cwd: tempDir, assetRoot: "shared/proof-assets" }), false);

    const report = auditProofAssets({ cwd: tempDir, assetRoot: "shared/proof-assets" });
    assert(report.availableLocalFiles.some((entry) => entry.relativePath === "profile/attachments/truly-beauty-case-study.pdf"));
    assert(report.missingLocalFiles.some((entry) => entry.relativePath === "profile/attachments/fly-boutique-case-study.pdf"));
    assert(report.mentionOnlyProof.some((entry) => entry.name === "Dr. Rachael Institute"));
    assert(report.portfolioSetupRequired.some((entry) => entry.name === "Portfolio"));
    assert(report.filesNotToAttach.some((entry) => entry.relativePath === "profile/attachments/dr-rachael-email-performance-report.pdf"));

    const formatted = formatProofAssetAudit(report);
    assert(formatted.includes("Missing local files:"));
    assert(formatted.includes("Mention-only proof:"));
    assert(
      !formatted.includes(path.join(assetRoot, "profile/attachments/truly-beauty-case-study.pdf")),
      "Default audit output should not expose per-file absolute local paths.",
    );
    const formattedWithPaths = formatProofAssetAudit(report, { includePaths: true });
    assert(formattedWithPaths.includes(assetRoot), "Explicit --paths audit output should expose actionable filesystem paths.");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runTests();
console.log("proof assets tests passed");
