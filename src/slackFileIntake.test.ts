import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import * as os from "node:os";
import { dirname, join, resolve } from "node:path";

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
}

function pdfBytes(label: string): Buffer {
  return Buffer.from(`%PDF-1.7\n${label}\n%%EOF\n`);
}

function cleanup(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

async function runTests(): Promise<void> {
  const tempDir = resolve(os.tmpdir(), `slack-file-intake-${process.pid}`);
  const tempDb = join(tempDir, "jobs.db");
  const proofRoot = join(tempDir, "proof-assets");
  cleanup(tempDir);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;
  process.env.PROOF_ASSET_ROOT = proofRoot;
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";

  const {
    classifySlackFileForIntake,
    formatSlackFileIntakeReply,
    ingestSlackFilesForThread,
  } = require("./slackFileIntake") as typeof import("./slackFileIntake");
  const { closeDb, listApplicationAssets } = require("./db") as typeof import("./db");
  const { resolveProofAssetPath } = require("./proofAssets") as typeof import("./proofAssets");

  try {
    assert.equal(classifySlackFileForIntake({ name: "store-logo.png", mimetype: "image/png" }).classification, "client_asset");
    assert.equal(classifySlackFileForIntake({ name: "truly-beauty-case-study.pdf" }).classification, "case_study");
    assert.equal(classifySlackFileForIntake({ name: "truly-beauty-case-study.pdf" }).attachPolicy, "manual_review");
    assert.equal(classifySlackFileForIntake({ name: "new-brand-case-study.pdf" }).attachPolicy, "manual_review");
    assert.equal(classifySlackFileForIntake({ name: "dashboard-screenshot.png", mimetype: "image/png" }).classification, "screenshot");
    assert.equal(classifySlackFileForIntake({ name: "client-context-notes.pdf" }).classification, "temporary_context");
    assert.equal(classifySlackFileForIntake({ name: "invoice.pdf" }).classification, "irrelevant");

    const downloadedIds: string[] = [];
    const result = await ingestSlackFilesForThread({
      state: {
        channelId: "C_TEST",
        messageTs: "1000.1",
        threadTs: "1000.1",
        jobId: "job/42",
        status: "drafted",
      } as any,
      token: "xoxb-test-token",
      files: [
        {
          id: "F_ASSET",
          name: "store-logo.png",
          size: pngBytes().byteLength,
          mimetype: "image/png",
          url_private_download: "https://files.slack.com/files-pri/T/F_ASSET",
        },
        {
          id: "F_PROOF",
          name: "new-brand-case-study.pdf",
          size: pdfBytes("case study").byteLength,
          mimetype: "application/pdf",
          url_private_download: "https://files.slack.com/files-pri/T/F_PROOF",
        },
        {
          id: "F_CONTEXT",
          name: "client-context-notes.pdf",
          size: pdfBytes("context").byteLength,
          mimetype: "application/pdf",
          url_private_download: "https://files.slack.com/files-pri/T/F_CONTEXT",
        },
        {
          id: "F_UNKNOWN",
          name: "mystery.pdf",
          size: pdfBytes("unknown").byteLength,
          mimetype: "application/pdf",
          url_private_download: "https://files.slack.com/files-pri/T/F_UNKNOWN",
        },
        {
          id: "F_INVOICE",
          name: "invoice.pdf",
          size: pdfBytes("invoice").byteLength,
          mimetype: "application/pdf",
          url_private_download: "https://files.slack.com/files-pri/T/F_INVOICE",
        },
        {
          id: "F_SECRET",
          name: "credentials.pdf",
          size: pdfBytes("credentials").byteLength,
          mimetype: "application/pdf",
          url_private_download: "https://files.slack.com/files-pri/T/F_SECRET",
        },
        {
          id: "F_BAD",
          name: "fake.png",
          size: 12,
          mimetype: "image/png",
          url_private_download: "https://files.slack.com/files-pri/T/F_BAD",
        },
      ],
      downloader: async (file) => {
        downloadedIds.push(file.id ?? "");
        if (file.id === "F_ASSET") return pngBytes();
        if (file.id === "F_BAD") return Buffer.from("not a png");
        return pdfBytes(file.name ?? "file");
      },
    });

    assert.equal(result.accepted.length, 4);
    assert.equal(result.rejected.length, 3);
    assert(!downloadedIds.includes("F_INVOICE"), "irrelevant files should not be downloaded");
    assert(!downloadedIds.includes("F_SECRET"), "likely secret files should not be downloaded");

    const clientAsset = result.accepted.find((item) => item.classification === "client_asset");
    assert(clientAsset, "client asset should be accepted");
    assert.equal(clientAsset.asset.attachPolicy, "auto_attach");
    assert.match(clientAsset.asset.relativePath ?? "", /^slack-intake\/job_42\/client-asset\/store-logo\.png$/);
    assert.deepEqual(readFileSync(resolveProofAssetPath(clientAsset.asset.relativePath ?? "")), pngBytes());

    const caseStudy = result.accepted.find((item) => item.classification === "case_study");
    assert(caseStudy, "case study should be accepted for review");
    assert.equal(caseStudy.asset.attachPolicy, "manual_review");
    assert.match(caseStudy.asset.relativePath ?? "", /\/case-study\/new-brand-case-study\.pdf$/);

    const context = result.accepted.find((item) => item.classification === "temporary_context");
    assert(context, "temporary context should be accepted");
    assert.equal(context.asset.attachPolicy, "mention_only");
    assert.equal(context.asset.proofType, "mention_only");

    const needsReview = result.accepted.find((item) => item.classification === "needs_review");
    assert(needsReview, "uncertain supported files should be stored for review");
    assert.equal(needsReview.asset.attachPolicy, "manual_review");

    assert(result.rejected.some((item) => item.name === "invoice.pdf" && item.classification === "irrelevant"));
    assert(result.rejected.some((item) => item.name === "credentials.pdf" && item.classification === "needs_review"));
    assert(result.rejected.some((item) => item.name === "fake.png" && /does not match/.test(item.reason)));

    const assets = listApplicationAssets("job/42");
    assert.equal(assets.length, 4);
    assert.equal(assets.filter((asset) => asset.attachPolicy === "auto_attach").length, 1);
    assert.equal(assets.filter((asset) => asset.attachPolicy === "manual_review").length, 2);
    assert.equal(assets.filter((asset) => asset.attachPolicy === "mention_only").length, 1);

    const reply = formatSlackFileIntakeReply(result);
    assert.match(reply, /safe to attach/);
    assert.match(reply, /proof review only/);
    assert.match(reply, /not as attachable proof/);
    assert.match(reply, /needs Steve review/);
    assert.match(reply, /will not claim or attach these as verified proof/);
    assert(!reply.includes("https://files.slack.com"), "reply must not expose Slack private URLs");
    assert(!reply.includes("xoxb-test-token"), "reply must not expose bot tokens");
  } finally {
    closeDb();
    cleanup(tempDir);
  }
}

runTests()
  .then(() => console.log("slack file intake tests passed"))
  .catch((error) => {
    console.error(`slack file intake tests failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
