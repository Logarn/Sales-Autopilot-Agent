import * as fs from "node:fs";
import * as path from "node:path";
import { listSkills, readSkill } from "./skills";
import {
  BrandFactPack,
  CopyStrategy,
  JobPosting,
  ProofStrategy,
  SelectedSkillTrace,
  SkillUseTrace,
  SkillWorkflowStage,
} from "./types";

export type RuntimeSkillKind = "markdown" | "runtime_module";

export interface RuntimeSkillInfo {
  name: string;
  path: string;
  title: string;
  purpose: string;
  triggers: string[];
  stages: SkillWorkflowStage[];
  kind: RuntimeSkillKind;
}

export interface LoadedRuntimeSkill extends RuntimeSkillInfo {
  content: string;
  loadedAt: string;
}

export interface SelectedRuntimeSkill extends LoadedRuntimeSkill {
  stage: SkillWorkflowStage;
  reason: string;
  mandatory: boolean;
}

const RUNTIME_SKILL_FILES: Array<Omit<RuntimeSkillInfo, "kind">> = [
  {
    name: "skill-registry-runtime",
    path: "src/skills.ts",
    title: "Skill Registry Runtime",
    purpose: "List and load markdown skills from the repo-local skills directory.",
    triggers: ["skill inventory", "skill loading", "debug skill usage"],
    stages: ["job_understanding"],
  },
  {
    name: "portfolio-selection-runtime",
    path: "src/skills/portfolioSelectionSkill.ts",
    title: "Portfolio Selection Runtime Skill",
    purpose: "Select safe proof assets, portfolio highlights, mention-only proof, and manual-review proof warnings.",
    triggers: ["proof selection", "portfolio selection", "attachment strategy"],
    stages: ["proof_selection", "portfolio_profile_selection", "browser_application_prep"],
  },
  {
    name: "profile-context-runtime",
    path: "src/skills/profileContextSkill.ts",
    title: "Profile Context Runtime Skill",
    purpose: "Build profile positioning, common answers, proof lines, and profile/browser-fill context for a job.",
    triggers: ["profile highlight selection", "portfolio/profile context", "browser application prep"],
    stages: ["portfolio_profile_selection", "cover_letter_drafting", "browser_application_prep"],
  },
  {
    name: "proposal-copywriting-runtime",
    path: "src/skills/proposalCopywritingSkill.ts",
    title: "Proposal Copywriting Runtime",
    purpose: "Build job understanding, copy strategy, cover letters, screening answers, and copy quality gates.",
    triggers: ["cover-letter drafting", "screening answers", "proposal quality gate"],
    stages: ["cover_letter_drafting", "screening_answer_drafting"],
  },
  {
    name: "brand-research-runtime",
    path: "src/skills/brandResearchSkill.ts",
    title: "Brand Research Runtime",
    purpose: "Build conservative brand/category fact packs from visible job clues and optional safe web-search source results.",
    triggers: ["brand research", "category research", "brand fact pack"],
    stages: ["brand_research"],
  },
  {
    name: "proposal-style-memory-runtime",
    path: "src/salesLearningMemory.ts",
    title: "Proposal Style Memory Runtime",
    purpose: "Retrieve prior proposal, proof, source, timing, and boost lessons for the current job context.",
    triggers: ["proposal style memory", "proof memory", "screening answer style"],
    stages: ["cover_letter_drafting", "screening_answer_drafting", "proof_selection", "outcome_learning"],
  },
  {
    name: "soul-runtime-guidance",
    path: "src/soul.ts",
    title: "Soul Runtime Guidance",
    purpose: "Load the repo soul guidance and hard safety overrides into operational proposal/proof contexts.",
    triggers: ["proposal voice", "proof philosophy", "safety overrides"],
    stages: ["cover_letter_drafting", "proof_selection", "slack_draft_preview", "browser_application_prep"],
  },
];

const MARKDOWN_METADATA: Record<string, Partial<Pick<RuntimeSkillInfo, "triggers" | "stages">>> = {
  "browser-apply": {
    triggers: ["browser prep", "apply page", "QA handoff", "stop before submit"],
    stages: ["browser_application_prep", "qa_handoff"],
  },
  "brand-research": {
    triggers: ["brand", "website", "product", "category", "ICP", "brand fact pack"],
    stages: ["brand_research"],
  },
  "connects-governor": {
    triggers: ["Connects", "boost", "bid risk"],
    stages: ["job_scoring", "browser_application_prep"],
  },
  "fit-scoring": {
    triggers: ["score job", "client quality", "red flags"],
    stages: ["job_scoring"],
  },
  "heartbeat-monitor": {
    triggers: ["health", "worker status", "runtime monitor"],
    stages: ["lead_discovery"],
  },
  "job-extraction": {
    triggers: ["job capture", "job understanding", "raw Upwork text"],
    stages: ["job_capture", "job_understanding"],
  },
  "llm-normalization": {
    triggers: ["normalize captured job", "messy job detail"],
    stages: ["job_capture", "job_understanding"],
  },
  "outcome-tracking": {
    triggers: ["submitted", "reply", "interview", "hired", "lost", "learning"],
    stages: ["outcome_learning"],
  },
  "proof-selector": {
    triggers: ["proof", "portfolio", "attachments", "case study"],
    stages: ["proof_selection", "portfolio_profile_selection"],
  },
  "proposal-copywriting": {
    triggers: ["cover letter", "proposal", "screening answer", "copy strategy"],
    stages: ["cover_letter_drafting", "screening_answer_drafting", "slack_draft_preview"],
  },
  "proposal-critic": {
    triggers: ["quality gate", "proposal critique", "generic copy"],
    stages: ["cover_letter_drafting", "screening_answer_drafting", "browser_application_prep"],
  },
  "proposal-writing": {
    triggers: ["legacy proposal writing", "proposal sections"],
    stages: ["cover_letter_drafting", "screening_answer_drafting"],
  },
  "slack-conversation": {
    triggers: ["Slack operator reply", "Slack thread", "operator proxy"],
    stages: ["slack_draft_preview", "qa_handoff"],
  },
  "slack-packet": {
    triggers: ["Slack preview", "approval packet", "lead packet"],
    stages: ["slack_draft_preview"],
  },
  "upwork-search": {
    triggers: ["lead discovery", "Upwork search", "candidate jobs"],
    stages: ["lead_discovery"],
  },
};

function repoRoot(): string {
  return path.resolve(__dirname, "..");
}

function extractPurpose(markdown: string, fallback: string): string {
  const match = markdown.match(/## Purpose\s+([\s\S]*?)(?:\n## |\n# |$)/i);
  const purpose = match?.[1]
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  return purpose || fallback;
}

function markdownSkillInfo(): RuntimeSkillInfo[] {
  return listSkills().map((skill) => {
    const markdown = readSkill(skill.name);
    const metadata = MARKDOWN_METADATA[skill.name] ?? {};
    return {
      name: skill.name,
      path: skill.path,
      title: skill.title,
      purpose: extractPurpose(markdown, skill.title),
      triggers: metadata.triggers ?? ["manual skill read"],
      stages: metadata.stages ?? [],
      kind: "markdown",
    };
  });
}

function runtimeModuleInfo(): RuntimeSkillInfo[] {
  return RUNTIME_SKILL_FILES
    .filter((skill) => fs.existsSync(path.resolve(repoRoot(), skill.path)))
    .map((skill) => ({ ...skill, kind: "runtime_module" }));
}

export function listRuntimeSkills(): RuntimeSkillInfo[] {
  const byName = new Map<string, RuntimeSkillInfo>();
  for (const skill of [...markdownSkillInfo(), ...runtimeModuleInfo()]) {
    byName.set(skill.name, skill);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadRuntimeSkill(name: string, now = new Date()): LoadedRuntimeSkill {
  const skill = listRuntimeSkills().find((item) => item.name === name);
  if (!skill) {
    const available = listRuntimeSkills().map((item) => item.name).join(", ") || "none";
    throw new Error(`Runtime skill "${name}" not found. Available skills: ${available}`);
  }
  const content = skill.kind === "markdown"
    ? readSkill(skill.name)
    : fs.readFileSync(path.resolve(repoRoot(), skill.path), "utf8");
  return { ...skill, content, loadedAt: now.toISOString() };
}

export function assertRequiredSkillsPresent(skillNames: string[]): void {
  const available = new Set(listRuntimeSkills().map((skill) => skill.name));
  const missing = skillNames.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing required runtime skill(s): ${missing.join(", ")}`);
  }
}

function sourceText(job: Pick<JobPosting, "title" | "description" | "skills" | "category" | "budget" | "clientCountry">): string {
  return [job.title, job.description, job.skills.join(" "), job.category, job.budget, job.clientCountry].join("\n");
}

export function hasUsefulBrandOrCategoryClue(job: Pick<JobPosting, "title" | "description" | "skills" | "category" | "budget" | "clientCountry">): boolean {
  const text = sourceText(job);
  if (/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s),.;]*)?/i.test(text)) return true;
  if (/\b(?:brand|store|company|site)\s+[A-Z][A-Za-z0-9&' -]{2,60}/.test(`${job.title}\n${job.description}`)) return true;
  if (/\b(?:beauty|skincare|cosmetic|garden|gardening|plant|nursery|fashion|apparel|jewelry|pet|supplement|wellness|home goods|furniture|b2b|saas|email design|figma|shopify|dtc|d2c)\b/i.test(text)) return true;
  return false;
}

function captureConfidence(job: Pick<JobPosting, "description">): SkillUseTrace["captureConfidence"] {
  const text = job.description.trim();
  if (!text) return "low";
  if (/\b(?:cookie|feedback helps us improve search|browser extension|job details? close|html|css selector|undefined|null|lorem ipsum)\b/i.test(text)) return "low";
  if (text.length >= 500) return "high";
  return "medium";
}

function selectedTrace(skill: SelectedRuntimeSkill): SelectedSkillTrace {
  return {
    name: skill.name,
    path: skill.path,
    title: skill.title,
    stage: skill.stage,
    reason: skill.reason,
    mandatory: skill.mandatory,
    loaded: true,
    loadedAt: skill.loadedAt,
    contentLength: skill.content.length,
  };
}

function selectSkill(
  selected: SelectedRuntimeSkill[],
  name: string,
  stage: SkillWorkflowStage,
  reason: string,
  mandatory: boolean,
  now: Date,
): void {
  const loaded = loadRuntimeSkill(name, now);
  selected.push({ ...loaded, stage, reason, mandatory });
}

export function selectApplicationPrepSkills(
  job: Pick<JobPosting, "id" | "title" | "description" | "skills" | "category" | "budget" | "clientCountry">,
  now = new Date(),
): SelectedRuntimeSkill[] {
  const selected: SelectedRuntimeSkill[] = [];
  selectSkill(selected, "job-extraction", "job_understanding", "Validate that the captured title and full description are the source for job understanding.", true, now);
  if (hasUsefulBrandOrCategoryClue(job)) {
    selectSkill(selected, "brand-research", "brand_research", "The job has brand, website, product, or category clues; build brand_fact_pack before copy_strategy.", true, now);
  }
  selectSkill(selected, "proposal-copywriting", "cover_letter_drafting", "Cover letter drafting must use the direct-response proposal-copywriting skill.", true, now);
  selectSkill(selected, "proposal-copywriting", "screening_answer_drafting", "Screening answers must use the same proposal-copywriting skill and stay concise/proof-backed.", true, now);
  selectSkill(selected, "proof-selector", "proof_selection", "Proof strategy must be selected before the draft claims or plans proof.", true, now);
  selectSkill(selected, "portfolio-selection-runtime", "proof_selection", "Runtime proof selector chooses safe assets, mention-only proof, and warnings.", true, now);
  selectSkill(selected, "profile-context-runtime", "portfolio_profile_selection", "Profile/portfolio highlights must come from the runtime profile context skill.", true, now);
  selectSkill(selected, "connects-governor", "browser_application_prep", "Connects and boost decisions must stay conservative before browser prep.", false, now);
  return selected;
}

export function buildInitialSkillUseTrace(
  job: Pick<JobPosting, "id" | "description">,
  selectedSkills: SelectedRuntimeSkill[],
  missingRequiredSkills: string[] = [],
  now = new Date(),
): SkillUseTrace {
  return {
    jobId: job.id,
    selectedSkills: selectedSkills.map(selectedTrace),
    missingRequiredSkills,
    jobDescriptionLength: job.description.trim().length,
    captureConfidence: captureConfidence(job),
    invocationOrder: selectedSkills.map((skill) => `${skill.stage}:${skill.name}`),
    brandFactPackSummary: "not built yet",
    copyStrategySummary: "not built yet",
    proofStrategySummary: "not built yet",
    brandResearchProvider: "not run",
    brandResearchSourceCount: 0,
    qualityGateReady: false,
    browserFillAllowed: false,
    createdAt: now.toISOString(),
  };
}

export function summarizeBrandFactPack(pack?: BrandFactPack | null): string {
  if (!pack) return "brand_fact_pack missing";
  return `${pack.confidence} confidence; ${pack.productCategory || "unknown category"}; ${pack.targetCustomerIcp || "unknown customer"}; web=${pack.webResearchStatus}/${pack.webResearchProvider}; ${pack.researchSummary}`;
}

export function summarizeCopyStrategy(strategy?: CopyStrategy | null): string {
  if (!strategy) return "copy_strategy missing";
  return `${strategy.category}: ${strategy.one_sentence_sales_argument}`;
}

export function summarizeProofStrategy(strategy?: ProofStrategy | null): string {
  if (!strategy) return "proof_strategy missing";
  return strategy.summary;
}

export function finalizeSkillUseTrace(input: {
  trace: SkillUseTrace;
  brandFactPack?: BrandFactPack | null;
  copyStrategy?: CopyStrategy | null;
  proofStrategy?: ProofStrategy | null;
  qualityGateReady: boolean;
}): SkillUseTrace {
  return {
    ...input.trace,
    brandFactPackSummary: summarizeBrandFactPack(input.brandFactPack),
    copyStrategySummary: summarizeCopyStrategy(input.copyStrategy),
    proofStrategySummary: summarizeProofStrategy(input.proofStrategy),
    brandResearchProvider: input.brandFactPack?.webResearchProvider ?? "not run",
    brandResearchSourceCount: input.brandFactPack?.sourceDetails.length ?? 0,
    qualityGateReady: input.qualityGateReady,
    browserFillAllowed: input.qualityGateReady && input.trace.captureConfidence !== "low" && input.trace.missingRequiredSkills.length === 0,
  };
}
