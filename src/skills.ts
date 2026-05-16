import fs from "node:fs";
import path from "node:path";

export interface SkillInfo {
  name: string;
  path: string;
  title: string;
}

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function repoRoot(): string {
  return path.resolve(__dirname, "..");
}

export function skillsRoot(): string {
  return path.join(repoRoot(), "skills");
}

export function validateSkillName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid skill name "${name}". Use lowercase letters, numbers, and hyphens only.`);
  }
}

function skillMarkdownPath(name: string): string {
  validateSkillName(name);
  const root = skillsRoot();
  const resolved = path.resolve(root, name, "SKILL.md");
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid skill path for "${name}".`);
  }
  return resolved;
}

function readTitle(markdown: string, fallback: string): string {
  const firstHeading = markdown.split(/\r?\n/).find((line) => line.startsWith("# "));
  return firstHeading ? firstHeading.replace(/^#\s+/, "").trim() : fallback;
}

export function listSkills(): SkillInfo[] {
  const root = skillsRoot();
  if (!fs.existsSync(root)) {
    throw new Error(`Skills directory not found: ${root}`);
  }

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => SKILL_NAME_PATTERN.test(name))
    .filter((name) => fs.existsSync(skillMarkdownPath(name)))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const filePath = skillMarkdownPath(name);
      const markdown = fs.readFileSync(filePath, "utf8");
      return { name, path: path.relative(repoRoot(), filePath), title: readTitle(markdown, name) };
    });
}

export function readSkill(name: string): string {
  const filePath = skillMarkdownPath(name);
  if (!fs.existsSync(filePath)) {
    const available = listSkills().map((skill) => skill.name).join(", ") || "none";
    throw new Error(`Skill "${name}" not found. Available skills: ${available}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function usage(): void {
  console.log(`Usage:
  npm run skills:list
  npm run skills:read -- <skill-name>
  tsx src/skills.ts list
  tsx src/skills.ts read <skill-name>`);
}

function main(): void {
  const [command, skillName] = process.argv.slice(2);

  try {
    if (!command || command === "list") {
      for (const skill of listSkills()) {
        console.log(`${skill.name}\t${skill.title}\t${skill.path}`);
      }
      return;
    }

    if (command === "read") {
      if (!skillName) {
        throw new Error("Missing skill name for read command.");
      }
      process.stdout.write(readSkill(skillName));
      return;
    }

    throw new Error(`Unknown skills command "${command}".`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
