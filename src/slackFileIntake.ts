import * as fs from "node:fs";
import * as path from "node:path";
import { SLACK_FILE_ALLOWED_EXTENSIONS, SLACK_FILE_MAX_BYTES } from "./config";
import {
  registerApplicationAsset,
  type ApplicationAsset,
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
}

export interface SlackFileIntakeRejected {
  file: SlackFileLike;
  name: string;
  reason: string;
}

export interface SlackFileIntakeResult {
  accepted: SlackFileIntakeAccepted[];
  rejected: SlackFileIntakeRejected[];
}

export type SlackFileDownloader = (file: SlackFileLike, token: string) => Promise<Buffer>;

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

function validateSlackFile(file: SlackFileLike): { ok: true; name: string } | { ok: false; name: string; reason: string } {
  const name = inferFileName(file);
  const ext = path.extname(name).toLowerCase();
  if (!ext || !SLACK_FILE_ALLOWED_EXTENSIONS.includes(ext)) {
    return { ok: false, name, reason: `Unsupported file type ${ext || "(none)"}. Allowed: ${SLACK_FILE_ALLOWED_EXTENSIONS.join(", ")}` };
  }
  const size = Number(file.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, name, reason: "Slack did not provide a valid file size." };
  }
  if (size > SLACK_FILE_MAX_BYTES) {
    return { ok: false, name, reason: `File is too large (${size} bytes, max ${SLACK_FILE_MAX_BYTES}).` };
  }
  if (!file.url_private_download && !file.url_private) {
    return { ok: false, name, reason: "Slack did not provide a downloadable private URL." };
  }
  return { ok: true, name };
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

function slackIntakeRelativePath(jobId: string, fileName: string): string {
  return path.join("slack-intake", safeJobSegment(jobId), safeFileName(fileName));
}

function chooseUniqueRelativePath(jobId: string, fileName: string): string {
  const parsed = path.parse(safeFileName(fileName));
  let candidate = slackIntakeRelativePath(jobId, `${parsed.name}${parsed.ext}`);
  let index = 2;
  while (fs.existsSync(resolveProofAssetPath(candidate))) {
    candidate = slackIntakeRelativePath(jobId, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
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
      rejected: input.files.map((file) => ({ file, name: inferFileName(file), reason: "Thread is not tied to a parsed job yet." })),
    };
  }

  const downloader = input.downloader ?? defaultDownloader;
  for (const file of input.files) {
    const validation = validateSlackFile(file);
    if (!validation.ok) {
      rejected.push({ file, name: validation.name, reason: validation.reason });
      continue;
    }

    try {
      const contents = await downloader(file, input.token);
      if (contents.byteLength > SLACK_FILE_MAX_BYTES) {
        rejected.push({ file, name: validation.name, reason: `Downloaded file is too large (${contents.byteLength} bytes, max ${SLACK_FILE_MAX_BYTES}).` });
        continue;
      }
      const relativePath = chooseUniqueRelativePath(jobId, validation.name);
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
        proofType: "file",
        attachPolicy: "auto_attach",
      });
      accepted.push({ file, asset });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rejected.push({ file, name: validation.name, reason: message });
    }
  }

  return { accepted, rejected };
}

export function formatSlackFileIntakeReply(result: SlackFileIntakeResult): string {
  const acceptedNames = result.accepted.map((item) => item.asset.originalName);
  const rejectedLines = result.rejected.map((item) => `${item.name}: ${item.reason}`);
  if (acceptedNames.length > 0 && rejectedLines.length === 0) {
    return `Got ${acceptedNames.length} file${acceptedNames.length === 1 ? "" : "s"}: ${acceptedNames.join(", ")}. I can use these for this application and retry prep when you say “retry after files.”`;
  }
  if (acceptedNames.length > 0) {
    return [
      `Accepted: ${acceptedNames.join(", ")}.`,
      `Skipped: ${rejectedLines.join("; ")}.`,
      "I can retry prep once the missing files are covered.",
    ].join("\n");
  }
  return `I could not ingest those files. ${rejectedLines.join("; ") || "No supported files were attached."}`;
}
