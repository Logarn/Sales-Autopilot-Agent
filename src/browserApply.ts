import * as fs from "node:fs";
import * as path from "node:path";
import { CONNECTS_RULES_CONFIG_PATH } from "./config";
import { getApplicationDraft, getApplicationJobLink } from "./db";
import {
  ApplicationDraft,
  BrowserApplyAttachmentInstruction,
  BrowserApplyConnectsPlan,
  BrowserApplyFillPlan,
  BrowserApplySkippedAttachment,
  BrowserApplyValidationIssue,
  ConnectsRules,
  PortfolioItem,
} from "./types";

const DEFAULT_CONNECTS_RULES: ConnectsRules = {
  maxRequiredPerJob: 50,
  idealBoostMin: 10,
  idealBoostMax: 30,
  maxBoost: 50,
  dailyCap: 75,
  weeklyCap: 225,
  neverBidMax: true,
  requireApprovalAbove: 30,
  targetBoostRank: 3,
  skipIfTopBidAbove: 50,
};

export interface BrowserApplyPlanOptions {
  now?: Date;
  connectsRulesPath?: string;
}

export interface BrowserApplyPlanResult {
  plan: BrowserApplyFillPlan | null;
  valid: boolean;
  issues: BrowserApplyValidationIssue[];
}

function issue(severity: BrowserApplyValidationIssue["severity"], code: string, message: string): BrowserApplyValidationIssue {
  return { severity, code, message };
}

function loadConnectsRules(configPath = CONNECTS_RULES_CONFIG_PATH): ConnectsRules {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), configPath), "utf8");
    return { ...DEFAULT_CONNECTS_RULES, ...(JSON.parse(raw) as Partial<ConnectsRules>) };
  } catch {
    return DEFAULT_CONNECTS_RULES;
  }
}

function parseUpworkUrl(rawUrl: string | null | undefined): URL | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (host !== "upwork.com" && !host.endsWith(".upwork.com")) return null;
    return url;
  } catch {
    return null;
  }
}

function extractUpworkJobId(url: URL): string | null {
  const decodedPath = decodeURIComponent(url.pathname);
  const applyMatch = decodedPath.match(/\/ab\/proposals\/job\/(~?[A-Za-z0-9_-]{8,})\/apply\/?/i);
  if (applyMatch) return applyMatch[1].startsWith("~") ? applyMatch[1] : `~${applyMatch[1]}`;
  const jobMatch = decodedPath.match(/\/jobs\/[^\s/]*~([A-Za-z0-9_-]{8,})/i);
  return jobMatch ? `~${jobMatch[1]}` : null;
}

function deriveApplyUrl(rawUrl: string | null | undefined): { sourceUrl: string; applyUrl: string } | null {
  const parsed = parseUpworkUrl(rawUrl);
  if (!parsed) return null;
  const sourceUrl = parsed.toString();
  const upworkJobId = extractUpworkJobId(parsed);
  if (!upworkJobId) return null;
  if (parsed.pathname.includes("/apply")) {
    return { sourceUrl, applyUrl: sourceUrl };
  }
  return {
    sourceUrl,
    applyUrl: `https://www.upwork.com/ab/proposals/job/${encodeURIComponent(upworkJobId)}/apply/`,
  };
}

function safeTrim(value: string | undefined): string {
  return value?.trim() ?? "";
}

function buildAttachmentInstructions(items: PortfolioItem[]): {
  attachments: BrowserApplyAttachmentInstruction[];
  skipped: BrowserApplySkippedAttachment[];
} {
  const attachments: BrowserApplyAttachmentInstruction[] = [];
  const skipped: BrowserApplySkippedAttachment[] = [];

  for (const item of items) {
    const name = item.name || item.id;
    if (item.sensitivity === "private") {
      skipped.push({ id: item.id, name, reason: "Private portfolio item is not allowed for browser apply preparation." });
      continue;
    }
    if (item.allowedUsage === "never") {
      skipped.push({ id: item.id, name, reason: "Portfolio item is marked never-use." });
      continue;
    }
    if (!item.filePath) {
      skipped.push({ id: item.id, name, reason: "Portfolio item has no file path." });
      continue;
    }
    const resolvedPath = path.resolve(process.cwd(), item.filePath);
    if (!fs.existsSync(resolvedPath)) {
      skipped.push({ id: item.id, name, reason: `Attachment file not found: ${item.filePath}` });
      continue;
    }
    attachments.push({ id: item.id, name, filePath: item.filePath, sensitivity: item.sensitivity });
  }

  return { attachments, skipped };
}

function parseRate(draft: ApplicationDraft): string {
  const structuredRate = safeTrim(draft.structuredProposal?.browserFillNotes.rate);
  if (structuredRate) return structuredRate;
  return draft.suggestedBid || "Not specified";
}

function parseProfile(draft: ApplicationDraft): string {
  const notes = draft.structuredProposal?.browserFillNotes.profileNotes ?? [];
  return notes.find((note) => note.trim().length > 0)?.trim() ?? "Default Upwork profile; verify manually before submission.";
}

function buildConnectsPlan(draft: ApplicationDraft, rules: ConnectsRules, issues: BrowserApplyValidationIssue[]): BrowserApplyConnectsPlan {
  const required = Math.max(0, draft.suggestedConnects || 0);
  const requestedBoost = Math.max(0, draft.suggestedBoostConnects || 0);
  let boost = Math.min(requestedBoost, rules.maxBoost);
  const notes = [...draft.connectsWarnings];

  if (draft.suggestedConnects < 0 || draft.suggestedBoostConnects < 0) {
    issues.push(issue("error", "invalid_connects", "Connects values must be non-negative."));
  }
  if (required > rules.maxRequiredPerJob) {
    issues.push(issue("error", "required_connects_cap", `Required Connects ${required} exceeds cap ${rules.maxRequiredPerJob}.`));
  }
  if (requestedBoost > rules.maxBoost) {
    notes.push(`Requested boost ${requestedBoost} was clamped to maxBoost ${rules.maxBoost}.`);
    issues.push(issue("warning", "boost_clamped", `Boost Connects clamped from ${requestedBoost} to ${boost}.`));
  }
  if (rules.neverBidMax && boost >= rules.maxBoost && boost > 0) {
    boost = Math.max(0, rules.maxBoost - 1);
    notes.push(`Boost reduced below maxBoost because neverBidMax is enabled.`);
    issues.push(issue("warning", "never_bid_max", "Boost was reduced to avoid automatically bidding the maximum."));
  }

  const total = required + boost;
  const approvalRequired = total > rules.requireApprovalAbove || boost > rules.idealBoostMax;
  if (approvalRequired) {
    notes.push(`Human approval/verification required for total Connects ${total}.`);
    issues.push(issue("warning", "connects_approval_required", `Connects total ${total} exceeds approval threshold ${rules.requireApprovalAbove}.`));
  }

  return { required, boost, total, approvalRequired, notes };
}

export function buildBrowserApplyPlan(jobId: string, options: BrowserApplyPlanOptions = {}): BrowserApplyPlanResult {
  const issues: BrowserApplyValidationIssue[] = [];
  const draft = getApplicationDraft(jobId);
  const link = getApplicationJobLink(jobId);

  if (!draft) {
    return {
      plan: null,
      valid: false,
      issues: [issue("error", "application_not_found", `No application draft found for job_id=${jobId}.`)],
    };
  }

  if (draft.status !== "approved") {
    issues.push(issue("error", "not_approved", `Application status must be approved before browser preparation; found ${draft.status}.`));
  }
  if (!draft.proposalText.trim()) {
    issues.push(issue("error", "missing_proposal", "Approved application has no proposal text to fill."));
  }

  const urlInfo = deriveApplyUrl(link?.url);
  if (!urlInfo) {
    issues.push(issue("error", "invalid_upwork_link", "A direct Upwork job/apply URL is required before browser preparation."));
  }

  const { attachments, skipped } = buildAttachmentInstructions(draft.selectedPortfolioItems);
  for (const skippedAttachment of skipped) {
    issues.push(issue("warning", "attachment_skipped", `${skippedAttachment.name}: ${skippedAttachment.reason}`));
  }

  const connects = buildConnectsPlan(draft, loadConnectsRules(options.connectsRulesPath), issues);
  const plan: BrowserApplyFillPlan | null = urlInfo
    ? {
        schemaVersion: "1.0",
        jobId,
        sourceUrl: urlInfo.sourceUrl,
        applyUrl: urlInfo.applyUrl,
        status: draft.status,
        profile: parseProfile(draft),
        rate: parseRate(draft),
        coverLetter: draft.proposalText,
        attachments,
        skippedAttachments: skipped,
        highlights: draft.structuredProposal?.browserFillNotes.highlights ?? draft.selectedPortfolioItems.map((item) => item.name),
        connects,
        stopBeforeSubmit: true,
        dryRunSafe: true,
        validationIssues: issues,
        createdAt: (options.now ?? new Date()).toISOString(),
      }
    : null;

  return {
    plan,
    valid: issues.every((validationIssue) => validationIssue.severity !== "error"),
    issues,
  };
}
