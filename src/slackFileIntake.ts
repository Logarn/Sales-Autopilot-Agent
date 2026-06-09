import * as fs from "node:fs";
import * as path from "node:path";
import { SLACK_FILE_ALLOWED_EXTENSIONS, SLACK_FILE_MAX_BYTES } from "./config";
import {
  registerApplicationAsset,
  type ApplicationAsset,
  type ApplicationAssetAttachPolicy,
  type ApplicationAssetProofType,
  type SlackThreadState,
} from "./db";
import { resolveProofAssetPath } from "./proofAssets";

export interface SlackFileLike {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private_download?: string;
  url_private?: string;
}

export interface SlackFileIntakeAccepted {
  file: SlackFileLike;
  asset: ApplicationAsset;
  classification: SlackFileClassification;
  storageBehavior: SlackFileStorageBehavior;
}

export interface SlackFileIntakeRejected {
  file: SlackFileLike;
  name: string;
  reason: string;
  classification: SlackFileClassification;
}

export interface SlackFileIntakeResult {
  accepted: SlackFileIntakeAccepted[];
  rejected: SlackFileIntakeRejected[];
}

export type SlackFileDownloader = (file: SlackFileLike, token: string) => Promise<Buffer>;
export type SlackFileClassification =
  | "case_study"
  | "proof"
  | "screenshot"
  | "client_asset"
  | "temporary_context"
  | "irrelevant"
  | "needs_review";
export type SlackFileStorageBehavior =
  | "application_asset_auto_attach"
  | "application_asset_manual_review"
  | "thread_context_only"
  | "not_stored";

interface SlackFileClassificationDecision {
  classification: SlackFileClassification;
  proofType: ApplicationAssetProofType;
  attachPolicy: ApplicationAssetAttachPolicy;
  storageBehavior: SlackFileStorageBehavior;
  shouldStore: boolean;
  reason?: string;
}

let knownPortfolioAttachmentNames: Set<string> | null = null;

function safeJobSegment(jobId: string): string {
  return jobId.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "unknown-job";
}

function safeFileName(name: string): string {
  const normalized = path.basename(name).replace(/[^A-Za-z0-9._ -]+/g, "_").trim();
  return normalized || "uploaded-file";
}

function inferFileName(file: SlackFileLike): string {
  return safeFileName(file.name || file.title || file.id || "uploaded-file");
}

function validateSlackFile(file: SlackFileLike): { ok: true; name: string } | { ok: false; name: string; reason: string; classification: SlackFileClassification } {
  const name = inferFileName(file);
  const ext = path.extname(name).toLowerCase();
  if (!ext || !SLACK_FILE_ALLOWED_EXTENSIONS.includes(ext)) {
    return { ok: false, name, reason: `Unsupported file type ${ext || "(none)"}. Allowed: ${SLACK_FILE_ALLOWED_EXTENSIONS.join(", ")}`, classification: "irrelevant" };
  }
  const size = Number(file.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, name, reason: "Slack did not provide a valid file size.", classification: "needs_review" };
  }
  if (size > SLACK_FILE_MAX_BYTES) {
    return { ok: false, name, reason: `File is too large (${size} bytes, max ${SLACK_FILE_MAX_BYTES}).`, classification: "irrelevant" };
  }
  if (!file.url_private_download && !file.url_private) {
    return { ok: false, name, reason: "Slack did not provide a downloadable private URL.", classification: "needs_review" };
  }
  return { ok: true, name };
}

function fileMetadataText(file: SlackFileLike, name = inferFileName(file)): string {
  return [name, file.title, file.mimetype, file.filetype].filter(Boolean).join(" ").toLowerCase();
}

function hasAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function loadKnownPortfolioAttachmentNames(): Set<string> {
  if (knownPortfolioAttachmentNames) return knownPortfolioAttachmentNames;
  const names = new Set<string>();
  const manifestPath = path.resolve(process.cwd(), "profile/portfolio-assets.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { assets?: Array<{ path?: string }> };
    for (const asset of parsed.assets ?? []) {
      if (asset.path) names.add(path.basename(asset.path).toLowerCase());
    }
  } catch {
    // If the optional manifest is unavailable, new Slack proof uploads stay in review.
  }
  knownPortfolioAttachmentNames = names;
  return names;
}

function isKnownPortfolioAttachmentName(name: string): boolean {
  return loadKnownPortfolioAttachmentNames().has(path.basename(name).toLowerCase());
}

function proofReviewDecision(classification: Extract<SlackFileClassification, "case_study" | "proof" | "screenshot">, name: string): SlackFileClassificationDecision {
  if (isKnownPortfolioAttachmentName(name)) {
    return {
      classification,
      proofType: "file",
      attachPolicy: "auto_attach",
      storageBehavior: "application_asset_auto_attach",
      shouldStore: true,
    };
  }
  return {
    classification,
    proofType: "file",
    attachPolicy: "manual_review",
    storageBehavior: "application_asset_manual_review",
    shouldStore: true,
  };
}

export function classifySlackFileForIntake(file: SlackFileLike): SlackFileClassificationDecision {
  const name = inferFileName(file);
  const text = fileMetadataText(file, name);
  const ext = path.extname(name).toLowerCase();
  const imageLike = [".png", ".jpg", ".jpeg", ".webp"].includes(ext) || /^image\//.test(file.mimetype ?? "");

  if (hasAny(text, [/\b(?:password|passwd|credential|credentials|secret|api[-_ ]?key|token|private[-_ ]?key|ssh[-_ ]?key)\b/])) {
    return {
      classification: "needs_review",
      proofType: "do_not_attach",
      attachPolicy: "do_not_attach",
      storageBehavior: "not_stored",
      shouldStore: false,
      reason: "Possible sensitive credential material; ask Steve for a redacted file or summary.",
    };
  }

  if (hasAny(text, [/\b(?:invoice|receipt|billing|payroll|bank|tax|w-?9|timesheet|expense)\b/])) {
    return {
      classification: "irrelevant",
      proofType: "do_not_attach",
      attachPolicy: "do_not_attach",
      storageBehavior: "not_stored",
      shouldStore: false,
      reason: "Looks unrelated to proof, application context, or client assets.",
    };
  }

  if (hasAny(text, [/\b(?:case[-_ ]?study|portfolio[-_ ]?proof|customer[-_ ]?story|success[-_ ]?story)\b/])) {
    return proofReviewDecision("case_study", name);
  }

  if (imageLike && hasAny(text, [/\b(?:screenshot|screen[-_ ]?shot|dashboard|analytics|report|results?|performance|revenue|roi|metric|metrics)\b/])) {
    return proofReviewDecision("screenshot", name);
  }

  if (hasAny(text, [/\b(?:proof|testimonial|review|results?|performance|revenue|roi|metric|metrics|klaviyo|retention|campaign|email[-_ ]?marketing)\b/])) {
    return proofReviewDecision("proof", name);
  }

  if (hasAny(text, [/\b(?:client[-_ ]?asset|asset|logo|brand|creative|ad[-_ ]?creative|mockup|banner|product[-_ ]?image)\b/])) {
    return {
      classification: "client_asset",
      proofType: "file",
      attachPolicy: "auto_attach",
      storageBehavior: "application_asset_auto_attach",
      shouldStore: true,
    };
  }

  if (hasAny(text, [/\b(?:context|brief|notes?|requirements?|scope|spec|transcript|background|conversation|thread|instructions?|job[-_ ]?details?)\b/])) {
    return {
      classification: "temporary_context",
      proofType: "mention_only",
      attachPolicy: "mention_only",
      storageBehavior: "thread_context_only",
      shouldStore: true,
    };
  }

  return {
    classification: "needs_review",
    proofType: "file",
    attachPolicy: "manual_review",
    storageBehavior: "application_asset_manual_review",
    shouldStore: true,
    reason: "File purpose is unclear; ask Steve whether it is proof, context, or a client asset.",
  };
}

async function defaultDownloader(file: SlackFileLike, token: string): Promise<Buffer> {
  const url = file.url_private_download || file.url_private;
  if (!url) throw new Error("Slack file has no download URL.");
  if (!token.trim()) throw new Error("SLACK_BOT_TOKEN is required to download Slack files.");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Slack file download URL must use HTTPS.");
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Slack file download failed: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function classificationSegment(classification: SlackFileClassification): string {
  return classification.replace(/_/g, "-");
}

function slackIntakeClassifiedRelativePath(jobId: string, classification: SlackFileClassification, fileName: string): string {
  return path.join("slack-intake", safeJobSegment(jobId), classificationSegment(classification), safeFileName(fileName));
}

function chooseUniqueRelativePath(jobId: string, classification: SlackFileClassification, fileName: string): string {
  const parsed = path.parse(safeFileName(fileName));
  let candidate = slackIntakeClassifiedRelativePath(jobId, classification, `${parsed.name}${parsed.ext}`);
  let index = 2;
  while (fs.existsSync(resolveProofAssetPath(candidate))) {
    candidate = slackIntakeClassifiedRelativePath(jobId, classification, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function validateDownloadedFileContents(name: string, contents: Buffer): string | null {
  if (contents.byteLength <= 0) return "Downloaded file was empty.";
  const ext = path.extname(name).toLowerCase();
  if (ext === ".pdf") {
    return contents.subarray(0, 5).toString("ascii") === "%PDF-" ? null : "Downloaded file does not match the .pdf type.";
  }
  if (ext === ".png") {
    return contents.length >= 8 &&
      contents[0] === 0x89 &&
      contents[1] === 0x50 &&
      contents[2] === 0x4e &&
      contents[3] === 0x47 &&
      contents[4] === 0x0d &&
      contents[5] === 0x0a &&
      contents[6] === 0x1a &&
      contents[7] === 0x0a
      ? null
      : "Downloaded file does not match the .png type.";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return contents.length >= 3 && contents[0] === 0xff && contents[1] === 0xd8 && contents[2] === 0xff
      ? null
      : `Downloaded file does not match the ${ext} type.`;
  }
  if (ext === ".webp") {
    return contents.length >= 12 &&
      contents.subarray(0, 4).toString("ascii") === "RIFF" &&
      contents.subarray(8, 12).toString("ascii") === "WEBP"
      ? null
      : "Downloaded file does not match the .webp type.";
  }
  return null;
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/\S+/g, "[redacted-url]")
    .replace(/xox[abprs]-[A-Za-z0-9-]+/g, "[redacted-token]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted-token]")
    .slice(0, 240);
}

export async function ingestSlackFilesForThread(input: {
  state: SlackThreadState;
  files: SlackFileLike[];
  token: string;
  downloader?: SlackFileDownloader;
}): Promise<SlackFileIntakeResult> {
  const accepted: SlackFileIntakeAccepted[] = [];
  const rejected: SlackFileIntakeRejected[] = [];
  const jobId = input.state.jobId;
  if (!jobId) {
    return {
      accepted,
      rejected: input.files.map((file) => ({
        file,
        name: inferFileName(file),
        reason: "Thread is not tied to a parsed job yet.",
        classification: "needs_review",
      })),
    };
  }

  const downloader = input.downloader ?? defaultDownloader;
  for (const file of input.files) {
    const validation = validateSlackFile(file);
    if (!validation.ok) {
      rejected.push({ file, name: validation.name, reason: validation.reason, classification: validation.classification });
      continue;
    }

    const classification = classifySlackFileForIntake(file);
    if (!classification.shouldStore) {
      rejected.push({
        file,
        name: validation.name,
        reason: classification.reason ?? "File was not stored.",
        classification: classification.classification,
      });
      continue;
    }

    try {
      const contents = await downloader(file, input.token);
      if (contents.byteLength > SLACK_FILE_MAX_BYTES) {
        rejected.push({ file, name: validation.name, reason: `Downloaded file is too large (${contents.byteLength} bytes, max ${SLACK_FILE_MAX_BYTES}).`, classification: classification.classification });
        continue;
      }
      const contentError = validateDownloadedFileContents(validation.name, contents);
      if (contentError) {
        rejected.push({ file, name: validation.name, reason: contentError, classification: classification.classification });
        continue;
      }
      const relativePath = chooseUniqueRelativePath(jobId, classification.classification, validation.name);
      const absolutePath = resolveProofAssetPath(relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, contents);
      const asset = registerApplicationAsset({
        jobId,
        source: "slack",
        sourceFileId: file.id ?? null,
        originalName: validation.name,
        relativePath,
        mimeType: file.mimetype ?? file.filetype ?? null,
        sizeBytes: contents.byteLength,
        proofType: classification.proofType,
        attachPolicy: classification.attachPolicy,
      });
      accepted.push({ file, asset, classification: classification.classification, storageBehavior: classification.storageBehavior });
    } catch (error) {
      rejected.push({ file, name: validation.name, reason: safeErrorMessage(error), classification: classification.classification });
    }
  }

  return { accepted, rejected };
}

function classificationLabel(classification: SlackFileClassification): string {
  return classification.replace(/_/g, " ");
}

function namesFor(result: SlackFileIntakeResult, predicate: (item: SlackFileIntakeAccepted) => boolean): string[] {
  return result.accepted.filter(predicate).map((item) => `${item.asset.originalName} (${classificationLabel(item.classification)})`);
}

export function formatSlackFileIntakeReply(result: SlackFileIntakeResult): string {
  const acceptedNames = result.accepted.map((item) => item.asset.originalName);
  const attachableNames = namesFor(result, (item) => item.storageBehavior === "application_asset_auto_attach");
  const proofReviewNames = namesFor(result, (item) => item.storageBehavior === "application_asset_manual_review" && item.classification !== "needs_review");
  const threadContextNames = namesFor(result, (item) => item.storageBehavior === "thread_context_only");
  const needsReviewNames = namesFor(result, (item) => item.classification === "needs_review");
  const rejectedLines = result.rejected.map((item) => `${item.name} (${classificationLabel(item.classification)}): ${item.reason}`);
  const lines: string[] = [];

  if (acceptedNames.length > 0) {
    lines.push(`Got ${acceptedNames.length} file${acceptedNames.length === 1 ? "" : "s"}: ${acceptedNames.join(", ")}.`);
  }
  if (attachableNames.length > 0) {
    lines.push(`Stored for this application only and safe to attach when prep needs them: ${attachableNames.join(", ")}. Proof claims still require page verification.`);
  }
  if (proofReviewNames.length > 0) {
    lines.push(`Stored for proof review only: ${proofReviewNames.join(", ")}. I will not claim or attach these as verified proof until review/page verification succeeds.`);
  }
  if (threadContextNames.length > 0) {
    lines.push(`Stored as temporary thread context only, not as attachable proof: ${threadContextNames.join(", ")}.`);
  }
  if (needsReviewNames.length > 0) {
    lines.push(`Stored but needs Steve review before use: ${needsReviewNames.join(", ")}. Tell me whether this is proof, context, or a client asset.`);
  }
  if (rejectedLines.length > 0) {
    lines.push(`Skipped: ${rejectedLines.join("; ")}.`);
  }
  if (lines.length === 0) {
    return "I could not ingest those files. No supported files were attached.";
  }
  return lines.join("\n");
}
