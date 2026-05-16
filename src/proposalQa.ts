import { detectPlatformMismatchWarnings } from "./jobIntelligenceParser";
import { ApplicationDraft, JobIntelligence } from "./types";

export type ProposalQaWarningCode = "platform_mismatch" | "platform_manual_review";

export interface ProposalQaWarning {
  code: ProposalQaWarningCode;
  severity: "warning" | "review";
  message: string;
}

export interface ProposalQaResult {
  ok: boolean;
  warnings: ProposalQaWarning[];
}

function cleanPlatformMismatchWarning(value: string): string {
  return value.replace(/^platform_mismatch:\s*/i, "").trim();
}

function uniqueWarnings(warnings: ProposalQaWarning[]): ProposalQaWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.message.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function qaProposalPlatformGrounding(input: {
  draftText?: string;
  intelligence?: JobIntelligence | null;
}): ProposalQaResult {
  const intelligence = input.intelligence ?? null;
  const draftText = input.draftText?.trim() ?? "";
  if (!intelligence || !draftText) {
    return { ok: true, warnings: [] };
  }

  const mismatchWarnings = [
    ...(intelligence.platformMismatchWarnings ?? []),
    ...detectPlatformMismatchWarnings(intelligence.primaryPlatform, intelligence.platformsMentioned, draftText),
  ];

  const warnings: ProposalQaWarning[] = mismatchWarnings.map((warning) => ({
    code: "platform_mismatch",
    severity: "warning",
    message: `Platform mismatch: ${cleanPlatformMismatchWarning(warning)}`,
  }));

  if (intelligence.needsManualReview && intelligence.platformPreferenceTier === "non_core_review") {
    warnings.push({
      code: "platform_manual_review",
      severity: "review",
      message: `Manual platform review: ${intelligence.primaryPlatform} is a non-core/review platform; keep the proposal grounded in the actual job platform.`,
    });
  }

  const unique = uniqueWarnings(warnings);
  return { ok: unique.length === 0, warnings: unique };
}

export function qaApplicationDraftPlatformGrounding(draft?: ApplicationDraft | null): ProposalQaResult {
  return qaProposalPlatformGrounding({
    draftText: draft?.proposalText,
    intelligence: draft?.jobIntelligence,
  });
}
