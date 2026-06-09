export interface EvidenceMetric {
  value: number;
  evidence: string;
}

export interface EvidenceItem {
  label: string;
  evidence: string;
  detail?: string;
}

export interface OperatorReportPeriod {
  label: string;
  startIso: string;
  endIso: string;
}

export interface OperatorReportSnapshot {
  generatedAt: string;
  period: OperatorReportPeriod;
  leadsFound: EvidenceMetric;
  qualifiedLeads: EvidenceMetric;
  applicationsPrepared: EvidenceMetric;
  applicationsSubmitted: EvidenceMetric;
  replies: EvidenceMetric;
  interviews: EvidenceMetric;
  wins: EvidenceMetric;
  losses: EvidenceMetric;
  connectsUsed: EvidenceMetric;
  bestSource: EvidenceItem | null;
  bestProof: EvidenceItem | null;
  blockedItems: EvidenceItem[];
  lessons: EvidenceItem[];
  steveActionItems: EvidenceItem[];
}

export interface OperatorReportQuestionResult {
  topic: "summary" | "connects" | "proof" | "source" | "blocked" | "lessons";
  text: string;
}

export const DEFAULT_OPERATOR_REPORT_TIME_ZONE = "Africa/Nairobi";

function weekdayInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(date);
}

export function shouldSendFridayHandoff(date = new Date(), timeZone = DEFAULT_OPERATOR_REPORT_TIME_ZONE): boolean {
  return weekdayInTimeZone(date, timeZone) === "Fri";
}

function metricLine(label: string, metric: EvidenceMetric): string {
  return `- ${label}: ${metric.value} (${metric.evidence})`;
}

function itemLine(item: EvidenceItem): string {
  const detail = item.detail ? ` - ${item.detail}` : "";
  return `- ${item.label}${detail} (${item.evidence})`;
}

function itemList(items: EvidenceItem[], emptyText: string): string {
  return items.length ? items.map(itemLine).join("\n") : `- ${emptyText}`;
}

function nullableItem(item: EvidenceItem | null, emptyText: string): string {
  return item ? itemLine(item) : `- ${emptyText}`;
}

export function buildFridayOperatorHandoff(snapshot: OperatorReportSnapshot): string {
  return [
    `Friday Operator Handoff - ${snapshot.period.label}`,
    "",
    "Pipeline metrics",
    metricLine("Leads found", snapshot.leadsFound),
    metricLine("Qualified leads", snapshot.qualifiedLeads),
    metricLine("Applications prepared", snapshot.applicationsPrepared),
    metricLine("Applications submitted", snapshot.applicationsSubmitted),
    metricLine("Replies", snapshot.replies),
    metricLine("Interviews", snapshot.interviews),
    metricLine("Wins", snapshot.wins),
    metricLine("Losses", snapshot.losses),
    metricLine("Connects used", snapshot.connectsUsed),
    "",
    "Best source",
    nullableItem(snapshot.bestSource, "Unavailable: no source-backed leads in this period."),
    "",
    "Best proof",
    nullableItem(snapshot.bestProof, "Unavailable: no submitted proof/asset evidence in this period."),
    "",
    "Blocked items",
    itemList(snapshot.blockedItems, "None found in DB for this period."),
    "",
    "Lessons",
    itemList(snapshot.lessons, "Unavailable: no sales learning memories updated in this period."),
    "",
    "Steve action items",
    itemList(snapshot.steveActionItems, "None found in DB. Final submit remains manual."),
    "",
    "Safety",
    "- Final submit remains manual. This report is read-only and does not click or submit anything.",
  ].join("\n");
}

export function buildScheduledFridayOperatorHandoff(
  snapshot: OperatorReportSnapshot,
  date = new Date(),
  timeZone = DEFAULT_OPERATOR_REPORT_TIME_ZONE,
): string | null {
  return shouldSendFridayHandoff(date, timeZone) ? buildFridayOperatorHandoff(snapshot) : null;
}

export function buildMonthlyOperatorReview(snapshot: OperatorReportSnapshot): string {
  return [
    `Monthly Operator Review - ${snapshot.period.label}`,
    "",
    "Outcome summary",
    metricLine("Leads found", snapshot.leadsFound),
    metricLine("Qualified leads", snapshot.qualifiedLeads),
    metricLine("Applications prepared", snapshot.applicationsPrepared),
    metricLine("Applications submitted", snapshot.applicationsSubmitted),
    metricLine("Replies", snapshot.replies),
    metricLine("Interviews", snapshot.interviews),
    metricLine("Wins", snapshot.wins),
    metricLine("Losses", snapshot.losses),
    metricLine("Connects used", snapshot.connectsUsed),
    "",
    "What worked",
    nullableItem(snapshot.bestSource, "Unavailable: no source evidence yet."),
    nullableItem(snapshot.bestProof, "Unavailable: no proof evidence yet."),
    "",
    "What needs attention",
    itemList([...snapshot.blockedItems, ...snapshot.steveActionItems].slice(0, 8), "No blocked or manual-action items found in DB."),
    "",
    "Lessons to carry forward",
    itemList(snapshot.lessons, "Unavailable: no DB-backed lessons yet."),
  ].join("\n");
}

export function answerMonthlyOperatorQuestion(snapshot: OperatorReportSnapshot, question: string): OperatorReportQuestionResult {
  const normalized = question.toLowerCase();
  if (/\bconnects?|boost|spend|wast/.test(normalized)) {
    return {
      topic: "connects",
      text: [
        `Connects used: ${snapshot.connectsUsed.value} (${snapshot.connectsUsed.evidence}).`,
        `Submitted applications: ${snapshot.applicationsSubmitted.value}. Replies: ${snapshot.replies.value}. Wins: ${snapshot.wins.value}. Losses: ${snapshot.losses.value}.`,
        snapshot.bestSource ? `Best source context: ${snapshot.bestSource.label} (${snapshot.bestSource.evidence}).` : "Best source context is unavailable.",
      ].join(" "),
    };
  }

  if (/\bproof|portfolio|asset|case stud/.test(normalized)) {
    return {
      topic: "proof",
      text: snapshot.bestProof
        ? `Best proof signal: ${snapshot.bestProof.label}${snapshot.bestProof.detail ? ` - ${snapshot.bestProof.detail}` : ""} (${snapshot.bestProof.evidence}).`
        : "Proof performance is unavailable because no submitted proof or asset evidence is present for this period.",
    };
  }

  if (/\bsource|search|where|channel/.test(normalized)) {
    return {
      topic: "source",
      text: snapshot.bestSource
        ? `Best source signal: ${snapshot.bestSource.label}${snapshot.bestSource.detail ? ` - ${snapshot.bestSource.detail}` : ""} (${snapshot.bestSource.evidence}).`
        : "Source performance is unavailable because no source-backed leads are present for this period.",
    };
  }

  if (/\bblocked|stuck|review|action|steve|manual/.test(normalized)) {
    const items = [...snapshot.blockedItems, ...snapshot.steveActionItems];
    return {
      topic: "blocked",
      text: items.length
        ? `Manual attention items:\n${items.map(itemLine).join("\n")}`
        : "No blocked or Steve action items were found in DB for this period. Final submit remains manual.",
    };
  }

  if (/\blesson|learn|improve|why/.test(normalized)) {
    return {
      topic: "lessons",
      text: snapshot.lessons.length
        ? `DB-backed lessons:\n${snapshot.lessons.map(itemLine).join("\n")}`
        : "No DB-backed lessons are available for this period yet.",
    };
  }

  return {
    topic: "summary",
    text: buildMonthlyOperatorReview(snapshot),
  };
}
