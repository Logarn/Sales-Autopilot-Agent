import * as fs from "node:fs";
import * as path from "node:path";
import { PROFILE_KNOWLEDGE_DIR } from "./config";
import {
  KnowledgeArtifact,
  KnowledgeArtifactMetadata,
  KnowledgeArtifactType,
  KnowledgeLoadWarning,
  ProfileKnowledge,
} from "./types";

const SUPPORTED_TYPES: KnowledgeArtifactType[] = [
  "voice",
  "proof",
  "portfolio",
  "video",
  "bid_rules",
  "general",
];

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".json"]);
const SUMMARY_MAX_CHARS = 700;
const CONTEXT_MAX_CHARS = 1000;

function emptyByType(): Record<KnowledgeArtifactType, KnowledgeArtifact[]> {
  return SUPPORTED_TYPES.reduce((acc, type) => {
    acc[type] = [];
    return acc;
  }, {} as Record<KnowledgeArtifactType, KnowledgeArtifact[]>);
}

function isKnowledgeType(value: unknown): value is KnowledgeArtifactType {
  return typeof value === "string" && SUPPORTED_TYPES.includes(value as KnowledgeArtifactType);
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((tag) => String(tag).trim()).filter(Boolean);
}

function truncateText(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

function stripFrontMatter(raw: string): { metadata: KnowledgeArtifactMetadata; body: string } {
  if (!raw.startsWith("---")) {
    return { metadata: {}, body: raw };
  }

  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    return { metadata: {}, body: raw };
  }

  const frontMatter = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const metadata: KnowledgeArtifactMetadata = {};

  for (const line of frontMatter.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (key === "tags") {
      metadata.tags = rawValue
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    } else if (["title", "type", "source", "createdAt", "updatedAt"].includes(key)) {
      (metadata as Record<string, unknown>)[key] = rawValue.replace(/^['\"]|['\"]$/g, "");
    }
  }

  return { metadata, body };
}

function inferType(relativeKnowledgePath: string, metadataType: unknown): KnowledgeArtifactType | null {
  if (isKnowledgeType(metadataType)) {
    return metadataType;
  }

  const parts = relativeKnowledgePath.split(path.sep);
  for (const part of parts) {
    if (isKnowledgeType(part)) {
      return part;
    }
  }

  const baseName = path.basename(relativeKnowledgePath).split(/[._-]/)[0];
  return isKnowledgeType(baseName) ? baseName : null;
}

function titleFromFile(filePath: string): string {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonArtifact(raw: string): { metadata: KnowledgeArtifactMetadata; content: string } {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const metadata: KnowledgeArtifactMetadata = {
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    type: isKnowledgeType(parsed.type) ? parsed.type : undefined,
    tags: normalizeTags(parsed.tags),
    source: typeof parsed.source === "string" ? parsed.source : undefined,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : undefined,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
  };

  const content =
    typeof parsed.content === "string"
      ? parsed.content
      : typeof parsed.summary === "string"
        ? parsed.summary
        : JSON.stringify(parsed, null, 2);

  return { metadata, content };
}

function collectFiles(rootDir: string, warnings: KnowledgeLoadWarning[]): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  try {
    const stat = fs.statSync(rootDir);
    if (!stat.isDirectory()) {
      warnings.push({ filePath: path.relative(process.cwd(), rootDir), message: "Knowledge path is not a directory" });
      return [];
    }
  } catch (error) {
    warnings.push({
      filePath: path.relative(process.cwd(), rootDir),
      message: error instanceof Error ? error.message : "Unable to inspect knowledge directory",
    });
    return [];
  }

  const files: string[] = [];
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      warnings.push({
        filePath: path.relative(process.cwd(), dir),
        message: error instanceof Error ? error.message : "Unable to read knowledge directory",
      });
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  };

  visit(rootDir);
  return files.sort((a, b) => a.localeCompare(b));
}

function artifactToContext(artifact: KnowledgeArtifact): string {
  const tags = artifact.tags.length > 0 ? ` [${artifact.tags.join(", ")}]` : "";
  return `- ${artifact.type}: ${artifact.title}${tags} — ${truncateText(artifact.content, CONTEXT_MAX_CHARS)}`;
}

export function loadProfileKnowledge(knowledgeDir = PROFILE_KNOWLEDGE_DIR): ProfileKnowledge {
  const resolvedDir = path.resolve(process.cwd(), knowledgeDir);
  const warnings: KnowledgeLoadWarning[] = [];
  const artifacts: KnowledgeArtifact[] = [];

  for (const filePath of collectFiles(resolvedDir, warnings)) {
    const ext = path.extname(filePath).toLowerCase();
    const relativePath = path.relative(process.cwd(), filePath);
    const relativeKnowledgePath = path.relative(resolvedDir, filePath);
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      warnings.push({ filePath: relativePath, message: `Unsupported knowledge file extension: ${ext}` });
      continue;
    }

    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const format = ext === ".json" ? "json" : "markdown";
      const parsed = format === "json" ? parseJsonArtifact(raw) : stripFrontMatter(raw);
      const content = "content" in parsed ? parsed.content : parsed.body;
      const type = inferType(relativeKnowledgePath, parsed.metadata.type);
      if (!type) {
        warnings.push({ filePath: relativePath, message: "Unsupported or missing knowledge type" });
        continue;
      }

      const title = parsed.metadata.title?.trim() || titleFromFile(filePath);
      artifacts.push({
        id: relativePath.replace(/\\/g, "/"),
        type,
        title,
        tags: normalizeTags(parsed.metadata.tags),
        sourcePath: relativePath,
        format,
        content: truncateText(content, CONTEXT_MAX_CHARS),
        summary: truncateText(content, SUMMARY_MAX_CHARS),
        createdAt: parsed.metadata.createdAt,
        updatedAt: parsed.metadata.updatedAt,
      });
    } catch (error) {
      warnings.push({
        filePath: relativePath,
        message: error instanceof Error ? error.message : "Unable to read knowledge file",
      });
    }
  }

  artifacts.sort((a, b) => `${a.type}:${a.sourcePath}`.localeCompare(`${b.type}:${b.sourcePath}`));
  const byType = emptyByType();
  for (const artifact of artifacts) {
    byType[artifact.type].push(artifact);
  }

  return {
    artifacts,
    byType,
    contextSections: artifacts.map(artifactToContext),
    warnings,
  };
}

export { SUPPORTED_TYPES, truncateText };
