import * as fs from "node:fs";
import * as path from "node:path";
import { PORTFOLIO_CONFIG_PATH, PROFILE_KNOWLEDGE_DIR } from "./config";
import { PortfolioItem, PortfolioLibrary, KnowledgeArtifactType } from "./types";

const allowedTypes: KnowledgeArtifactType[] = ["voice", "proof", "portfolio", "video", "bid_rules", "general"];

function usage(): void {
  console.log(`Usage:
  npm run knowledge:add -- --type <voice|proof|portfolio|video|bid_rules|general> (--text <note> | --file <path>) [--title <title>] [--tags "tag1,tag2"]
  npm run knowledge:video -- --file <transcript.md> [--title <title>] [--tags "intro,proof"]
  npm run portfolio:upsert -- --id <id> --name <name> --description <text> --result <text> [--industries "DTC,Shopify"] [--platforms "Klaviyo,Shopify"] [--job-types "Klaviyo audit"] [--file-path <path>] [--sensitivity safe|approved_external|private] [--allowed-usage always_include_when_relevant|include_only_when_relevant|never]

Examples:
  npm run knowledge:add -- --type voice --title "Direct CTA" --text "Prefer a confident, specific next step."
  npm run knowledge:video -- --file profile/video-intro-transcript.md --title "Intro video transcript"
  npm run portfolio:upsert -- --id retention-audit --name "Retention Audit" --description "Klaviyo audit sample" --result "Found revenue leaks" --industries "DTC,ecommerce"`);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "knowledge";
}

function requireValue(name: string): string {
  const value = argValue(name);
  if (!value?.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function readTextInput(): string {
  const file = argValue("--file");
  const text = argValue("--text");
  if (file) {
    return fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
  }
  if (text) {
    return text;
  }
  throw new Error("Provide --text or --file");
}

function writeKnowledgeNote(type: KnowledgeArtifactType, title: string, content: string, tags: string[]): string {
  const dir = path.resolve(process.cwd(), PROFILE_KNOWLEDGE_DIR, type);
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  const timestampSlug = timestamp.replace(/[:.]/g, "-");
  const baseFilename = `${timestampSlug}-${slugify(title)}`;
  let filePath = path.join(dir, `${baseFilename}.md`);
  let counter = 2;
  while (fs.existsSync(filePath)) {
    filePath = path.join(dir, `${baseFilename}-${counter}.md`);
    counter += 1;
  }
  const frontMatter = [
    "---",
    `type: ${type}`,
    `title: ${title}`,
    tags.length ? `tags: ${tags.join(", ")}` : "tags: ",
    `createdAt: ${timestamp}`,
    "---",
    "",
  ].join("\n");
  fs.writeFileSync(filePath, `${frontMatter}${content.trim()}\n`);
  return path.relative(process.cwd(), filePath);
}

function addKnowledge(typeOverride?: KnowledgeArtifactType): void {
  const rawType = typeOverride ?? requireValue("--type");
  if (!allowedTypes.includes(rawType as KnowledgeArtifactType)) {
    throw new Error(`Unsupported type: ${rawType}`);
  }
  const type = rawType as KnowledgeArtifactType;
  const content = readTextInput();
  const title = argValue("--title")?.trim() || content.split(/\r?\n/).find(Boolean)?.slice(0, 60) || `${type} note`;
  const tags = parseCsv(argValue("--tags"));
  const written = writeKnowledgeNote(type, title, content, tags);
  console.log(`Added ${type} knowledge: ${title}`);
  console.log(`Path: ${written}`);
  console.log(`Tags: ${tags.length ? tags.join(", ") : "none"}`);
}

function readPortfolio(): PortfolioLibrary {
  const resolved = path.resolve(process.cwd(), PORTFOLIO_CONFIG_PATH);
  if (!fs.existsSync(resolved)) {
    return { items: [] };
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as PortfolioLibrary;
}

function writePortfolio(portfolio: PortfolioLibrary): void {
  const resolved = path.resolve(process.cwd(), PORTFOLIO_CONFIG_PATH);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(portfolio, null, 2)}\n`);
}

function upsertPortfolio(): void {
  const id = requireValue("--id");
  const portfolio = readPortfolio();
  const items = portfolio.items ?? [];
  const existingIndex = items.findIndex((item) => item.id === id);
  const existing = existingIndex >= 0 ? items[existingIndex] : undefined;
  const incoming: PortfolioItem = {
    id,
    name: argValue("--name") ?? existing?.name ?? id,
    description: argValue("--description") ?? existing?.description ?? "",
    industries: parseCsv(argValue("--industries")).length ? parseCsv(argValue("--industries")) : existing?.industries ?? [],
    platforms: parseCsv(argValue("--platforms")).length ? parseCsv(argValue("--platforms")) : existing?.platforms ?? [],
    bestFitJobTypes: parseCsv(argValue("--job-types")).length ? parseCsv(argValue("--job-types")) : existing?.bestFitJobTypes ?? [],
    result: argValue("--result") ?? existing?.result ?? "",
    sensitivity: (argValue("--sensitivity") as PortfolioItem["sensitivity"] | undefined) ?? existing?.sensitivity ?? "safe",
    allowedUsage: (argValue("--allowed-usage") as PortfolioItem["allowedUsage"] | undefined) ?? existing?.allowedUsage ?? "include_only_when_relevant",
    filePath: argValue("--file-path") ?? existing?.filePath ?? "",
    neverUseWhen: parseCsv(argValue("--never-use-when")).length ? parseCsv(argValue("--never-use-when")) : existing?.neverUseWhen ?? [],
  };

  if (existingIndex >= 0) {
    items[existingIndex] = incoming;
  } else {
    items.push(incoming);
  }
  writePortfolio({ items });
  console.log(`${existingIndex >= 0 ? "Updated" : "Added"} portfolio item: ${incoming.name}`);
  console.log(`ID: ${incoming.id}`);
  console.log(`Industries: ${incoming.industries.join(", ") || "none"}`);
  console.log(`Platforms: ${incoming.platforms.join(", ") || "none"}`);
}

function main(): void {
  try {
    if (hasFlag("--help") || process.argv.length <= 2) {
      usage();
      return;
    }
    if (hasFlag("--portfolio-upsert")) {
      upsertPortfolio();
      return;
    }
    if (hasFlag("--video")) {
      addKnowledge("video");
      return;
    }
    addKnowledge();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    process.exitCode = 1;
  }
}

main();
