import * as fs from "node:fs";
import * as path from "node:path";

const SOUL_FILE_NAME = "soul.md";
let cachedSoul: string | null = null;

function soulCandidates(): string[] {
  return [
    process.env.SOUL_MD_PATH,
    path.resolve(process.cwd(), SOUL_FILE_NAME),
    path.resolve(__dirname, "..", SOUL_FILE_NAME),
    path.resolve(__dirname, "..", "..", SOUL_FILE_NAME),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export function loadSoulConstitution(): string {
  if (cachedSoul !== null) {
    return cachedSoul;
  }
  for (const candidate of soulCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    cachedSoul = fs.readFileSync(candidate, "utf8").trim();
    return cachedSoul;
  }
  cachedSoul = "";
  return cachedSoul;
}

export function buildSoulPromptSection(surface: string): string {
  const soul = loadSoulConstitution();
  if (!soul) {
    return "";
  }
  return [
    "Operating constitution from soul.md:",
    `Surface: ${surface}`,
    soul,
    "Hard safety overrides soul.md whenever there is a conflict: never final-submit, never bypass browser/security checks, and never fake verification.",
  ].join("\n\n");
}

export function buildSoulPromptContext(surface: string): Record<string, unknown> {
  const soul = loadSoulConstitution();
  return {
    surface,
    loaded: Boolean(soul),
    soulMarkdown: soul,
    hardSafetyOverrides: [
      "never final-submit",
      "never bypass CAPTCHA/security/login/passkey/2FA checks",
      "never claim attached/selected/filled unless deterministic verification saw it",
    ],
  };
}

export function buildSoulRuntimeGuidance(surface: string): string[] {
  const soul = loadSoulConstitution();
  if (!soul) return [];
  return [
    `soul.md loaded for ${surface}`,
    "Use first-person teammate language; never call yourself the agent in normal Slack copy.",
    "Be commercially opinionated and concise; optimize for signed clients, not activity.",
    "Choose the strongest relevant proof instead of dumping everything.",
    "Treat CV as cover letter/proposal draft and everything as full safe prep unless the current instruction says otherwise.",
    "Final submit remains manual and verification claims must be evidence-backed.",
  ];
}
