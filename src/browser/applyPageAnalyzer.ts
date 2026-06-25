import * as path from "node:path";

import { extractConnectsFromVisibleText } from "../connectsExtraction";
import { extractVisibleBoostBids, type VisibleBoostBid } from "../connectsStrategy";
import type { BrowserApplyFillPlan, SourceBackedConnects } from "../types";

export type ApplyPageKind = "apply" | "security_challenge" | "login_required" | "two_factor_required" | "unknown";
export type ApplyPageSectionState = "not_visible" | "visible_empty" | "visible_filled" | "visible_requires_input" | "not_required";

export interface ApplyPageFieldSnapshot {
  kind: "input" | "textarea";
  inputType: string | null;
  label: string;
  id: string | null;
  name: string | null;
  ariaLabel: string | null;
  placeholder: string | null;
  dataTest: string | null;
  value: string;
  visible?: boolean;
}

export interface ApplyPageSourceEvidence {
  sourceText: string;
  sourceLocation: string;
}

export interface ApplyPageQuestionEvidence extends ApplyPageSourceEvidence {
  questionText: string;
  answerState: ApplyPageSectionState;
  answerPreview?: string;
}

export interface ApplyPageSnapshot {
  url: string;
  visibleText: string;
  inputValues: string[];
  fieldValues: ApplyPageFieldSnapshot[];
  checkedLabels: string[];
  fileNames: string[];
  attachmentRows: string[];
  selectedHighlightLabels: string[];
  actionLabels: string[];
  title?: string;
}

export interface ApplyPageFieldState {
  state: ApplyPageSectionState;
  visible: boolean;
  filled: boolean;
  valuePreview?: string;
  sourceText?: string;
  sourceLocation?: string;
  detail: string;
}

export interface ApplyPageConnectsAnalysis {
  visible: boolean;
  value: number | null;
  extraction: SourceBackedConnects;
  sourceText: string | null;
  sourceLocation: string | null;
  detail: string;
}

export interface ApplyPageBoostAnalysis {
  visible: boolean;
  selectedValue: number | null;
  table: VisibleBoostBid[];
  sourceText: string | null;
  sourceLocation: string | null;
  state: "not_visible" | "visible_unset" | "visible_set" | "visible_over_cap" | "visible_table_only";
  detail: string;
}

export interface ApplyPageScreeningAnalysis {
  visible: boolean;
  questionCount: number;
  answeredCount: number;
  questions: ApplyPageQuestionEvidence[];
  sourceText: string | null;
  sourceLocation: string | null;
  state: ApplyPageSectionState;
  detail: string;
}

export interface ApplyPageFinalSubmitAnalysis {
  visible: boolean;
  label: string | null;
  clicked: false;
  detail: string;
}

export interface ApplyPageChallengeAnalysis {
  detected: boolean;
  kind: Extract<ApplyPageKind, "security_challenge" | "login_required" | "two_factor_required"> | null;
  matchedText: string | null;
  sourceText: string | null;
  sourceLocation: string | null;
}

export interface ApplyPageAnalyzerResult {
  pageKind: ApplyPageKind;
  ready: boolean;
  blockers: string[];
  warnings: string[];
  challenge: ApplyPageChallengeAnalysis;
  connects: ApplyPageConnectsAnalysis;
  boost: ApplyPageBoostAnalysis;
  coverLetter: ApplyPageFieldState;
  screening: ApplyPageScreeningAnalysis;
  rate: ApplyPageFieldState;
  attachments: ApplyPageFieldState;
  portfolioHighlights: ApplyPageFieldState;
  finalSubmit: ApplyPageFinalSubmitAnalysis;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function lower(value: string): string {
  return compact(value).toLowerCase();
}

function visibleLines(text: string): string[] {
  return text.replace(/\r/g, "").split("\n");
}

function compactLines(text: string): string[] {
  return visibleLines(text).map(compact);
}

function lineEvidence(text: string, patterns: RegExp[], limit = 4): ApplyPageSourceEvidence[] {
  const evidence: ApplyPageSourceEvidence[] = [];
  const lines = compactLines(text);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (patterns.some((pattern) => pattern.test(line))) {
      evidence.push({ sourceText: line.slice(0, 240), sourceLocation: `line ${index + 1}` });
      if (evidence.length >= limit) break;
    }
  }
  return evidence;
}

function joinedEvidence(evidence: ApplyPageSourceEvidence[]): { sourceText: string | null; sourceLocation: string | null } {
  return {
    sourceText: evidence.length > 0 ? evidence.map((item) => item.sourceText).join(" | ") : null,
    sourceLocation: evidence.length > 0 ? evidence.map((item) => item.sourceLocation).join(", ") : null,
  };
}

function fieldDescriptor(field: ApplyPageFieldSnapshot): string {
  return [
    field.kind,
    field.inputType,
    field.label,
    field.id,
    field.name,
    field.ariaLabel,
    field.placeholder,
    field.dataTest,
  ].filter(Boolean).join(" ").toLowerCase();
}

function isUserTextField(field: ApplyPageFieldSnapshot): boolean {
  if (field.kind === "textarea") return true;
  const inputType = (field.inputType ?? "text").toLowerCase();
  return !["button", "checkbox", "file", "hidden", "image", "radio", "reset", "submit"].includes(inputType);
}

function isVisibleField(field: ApplyPageFieldSnapshot): boolean {
  return field.visible !== false;
}

function fieldEvidence(field: ApplyPageFieldSnapshot, index: number): ApplyPageSourceEvidence {
  const descriptor = compact([
    field.label,
    field.ariaLabel,
    field.placeholder,
    field.name,
    field.id,
    field.dataTest,
  ].filter(Boolean).join(" ")) || field.kind;
  return { sourceText: descriptor.slice(0, 240), sourceLocation: `field ${index + 1}` };
}

function parseNumber(value: string): number | null {
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value: string): string {
  return lower(value);
}

function significantExpectedText(value: string): string {
  const normalized = normalizeText(value);
  return normalized.length > 120 ? normalized.slice(0, 120) : normalized;
}

function containsExpected(values: string[], expected: string): boolean {
  const needle = significantExpectedText(expected);
  if (!needle) return false;
  return values.some((value) => normalizeText(value).includes(needle));
}

function highlightAliases(highlight: string): string[] {
  const aliases = [highlight];
  const withoutSlashSuffix = highlight.replace(/\s*\/\s*[^/]+$/, "").trim();
  if (withoutSlashSuffix && withoutSlashSuffix !== highlight) aliases.push(withoutSlashSuffix);
  if (/truly beauty/i.test(highlight)) aliases.push("From $250k to $1.2 Million In 12 Months");
  if (/design case studies/i.test(highlight)) aliases.push("Steve's Design Case Studies");
  if (/fly boutique/i.test(highlight)) aliases.push("The Fly Boutique");
  if (/lifely/i.test(highlight)) {
    aliases.push("How Lifely Transformed Their Retention Marketing");
    aliases.push("How Lifely Transformed Their Retention M");
  }
  return Array.from(new Set(aliases.filter(Boolean)));
}

function containsExpectedHighlight(values: string[], expected: string): boolean {
  return highlightAliases(expected).some((alias) => containsExpected(values, alias));
}

function selectedHighlightControlCount(snapshot: ApplyPageSnapshot): number {
  return snapshot.actionLabels.filter((label) => normalizeText(label) === "selected").length;
}

function profileHighlightPickerLooksOpen(snapshot: ApplyPageSnapshot): boolean {
  return /\b(?:add profile highlights|select highlight|add to highlights|highlights\s*\(\s*\d\s*[/]\s*4\s*\)|portfolio\s*\(\d+\))\b/i.test(
    [snapshot.visibleText, ...snapshot.actionLabels].join("\n")
  );
}

function bestValue(values: string[]): string | null {
  return [...values].filter((value) => value.trim()).sort((a, b) => b.length - a.length)[0] ?? null;
}

export function coverLetterValues(snapshot: ApplyPageSnapshot): string[] {
  const explicit = snapshot.fieldValues
    .filter((field) => field.kind === "textarea" && isUserTextField(field))
    .filter((field) => /\b(?:cover|letter|proposal|message)\b/i.test(fieldDescriptor(field)))
    .map((field) => field.value)
    .filter((value) => value.trim());
  if (explicit.length > 0) return explicit;
  return snapshot.fieldValues
    .filter((field) => field.kind === "textarea" && isUserTextField(field))
    .map((field) => field.value)
    .filter((value) => value.trim());
}

export function rateValues(snapshot: ApplyPageSnapshot): string[] {
  return snapshot.fieldValues
    .filter((field) => field.kind === "input" && isUserTextField(field))
    .filter((field) => /\b(?:bid|hourly|rate|currency|amount|terms)\b/i.test(fieldDescriptor(field)))
    .map((field) => field.value)
    .filter((value) => value.trim());
}

function nonCoverTextFields(snapshot: ApplyPageSnapshot, coverLetter: string): ApplyPageFieldSnapshot[] {
  return snapshot.fieldValues.filter((field) => {
    if (!isUserTextField(field)) return false;
    if (field.value === coverLetter) return false;
    return !/\b(?:cover|letter|proposal|message)\b/i.test(fieldDescriptor(field));
  });
}

export function screeningValuesForAnswer(snapshot: ApplyPageSnapshot, coverLetter: string, index: number): string[] {
  const candidates = nonCoverTextFields(snapshot, coverLetter);
  const questionNumberPattern = new RegExp(`\\b(?:question|answer)\\s*${index + 1}\\b`, "i");
  const exactIndex = candidates
    .filter((field) => questionNumberPattern.test(fieldDescriptor(field)))
    .map((field) => field.value)
    .filter((value) => value.trim());
  if (exactIndex.length > 0) return exactIndex;
  return candidates
    .filter((field) => field.kind === "textarea" || /\b(?:question|answer|screening)\b/i.test(fieldDescriptor(field)))
    .map((field) => field.value)
    .filter((value) => value.trim());
}

export function bestCoverLetterValue(snapshot: ApplyPageSnapshot, expected: string | null | undefined): string | null {
  if (expected?.trim()) {
    const expectedMatch = coverLetterValues(snapshot).find((value) => containsExpected([value], expected));
    if (expectedMatch) return expectedMatch;
  }
  return bestValue(coverLetterValues(snapshot));
}

function detectChallenge(snapshot: ApplyPageSnapshot): ApplyPageChallengeAnalysis {
  const sources = [
    { text: snapshot.url, location: "url" },
    { text: snapshot.title ?? "", location: "title" },
    ...compactLines(snapshot.visibleText).map((text, index) => ({ text, location: `line ${index + 1}` })),
    ...snapshot.actionLabels.map((text, index) => ({ text, location: `action ${index + 1}` })),
  ];
  const checks: Array<{ kind: ApplyPageChallengeAnalysis["kind"]; pattern: RegExp; label: string }> = [
    { kind: "two_factor_required", pattern: /\b(two[-\s]?factor|verification code|2fa)\b/i, label: "two-factor verification" },
    { kind: "security_challenge", pattern: /\b(__cf_chl|cdn-cgi\/challenge|just a moment|security check|attention required|verify you are human|i'?m not a robot|checking your browser|checking if the site connection is secure|captcha|cloudflare|unusual traffic)\b/i, label: "browser security challenge" },
    { kind: "login_required", pattern: /\b(log in|login|sign in)\b/i, label: "login required" },
  ];
  for (const check of checks) {
    for (const source of sources) {
      const match = source.text.match(check.pattern);
      if (match) {
        return {
          detected: true,
          kind: check.kind,
          matchedText: match[0] || check.label,
          sourceText: compact(source.text).slice(0, 240),
          sourceLocation: source.location,
        };
      }
    }
  }
  return { detected: false, kind: null, matchedText: null, sourceText: null, sourceLocation: null };
}

function looksLikeApplyPage(snapshot: ApplyPageSnapshot): boolean {
  const urlLooksApply = /\/(?:ab|nx)\/proposals\/job\/~?[A-Za-z0-9_-]{8,}\/apply\/?/i.test(snapshot.url);
  const text = lower([snapshot.visibleText, ...snapshot.actionLabels].join("\n"));
  const hasApplyMarkers = /\b(?:cover letter|proposal settings|required for proposal|send for \d{1,3} connects|submit proposal|send proposal|boost your proposal|screening questions|terms|hourly rate|bid)\b/i.test(text);
  const hasApplyFields = snapshot.fieldValues.some((field) => /\b(?:cover|proposal|question|answer|screening|hourly|rate|bid|terms)\b/i.test(fieldDescriptor(field)));
  return (urlLooksApply && (hasApplyMarkers || hasApplyFields)) || (hasApplyMarkers && hasApplyFields);
}

function analyzeCoverLetter(snapshot: ApplyPageSnapshot, plan?: BrowserApplyFillPlan | null): ApplyPageFieldState {
  const values = coverLetterValues(snapshot);
  const best = bestValue(values);
  const expected = plan?.coverLetter ?? "";
  const coverFieldIndex = snapshot.fieldValues.findIndex((field) =>
    field.kind === "textarea" &&
    isUserTextField(field) &&
    (/\b(?:cover|letter|proposal|message)\b/i.test(fieldDescriptor(field)) || field.value === best)
  );
  const evidence = coverFieldIndex >= 0 ? fieldEvidence(snapshot.fieldValues[coverFieldIndex]!, coverFieldIndex) : undefined;
  if (expected.trim() && containsExpected(values, expected)) {
    return { state: "visible_filled", visible: true, filled: true, valuePreview: compact(best ?? "").slice(0, 160), ...(evidence ?? {}), detail: "Cover letter field contains the intended text." };
  }
  if (best) {
    return { state: "visible_filled", visible: true, filled: true, valuePreview: compact(best).slice(0, 160), ...(evidence ?? {}), detail: "Cover letter field has text, but it does not match the planned text." };
  }
  const visibleIndex = snapshot.fieldValues.findIndex((field) =>
    field.kind === "textarea" &&
    isUserTextField(field) &&
    isVisibleField(field) &&
    (/\b(?:cover|letter|proposal|message)\b/i.test(fieldDescriptor(field)) || !field.value.trim())
  );
  const visible = visibleIndex >= 0;
  const visibleEvidence = visible ? fieldEvidence(snapshot.fieldValues[visibleIndex]!, visibleIndex) : undefined;
  return visible
    ? { state: "visible_empty", visible: true, filled: false, ...(visibleEvidence ?? {}), detail: "Cover letter field is visible but empty." }
    : { state: "not_visible", visible: false, filled: false, detail: "Cover letter field was not detected." };
}

function normalizeQuestionText(value: string): string {
  return compact(value)
    .replace(/^(?:\d{1,2}[.)]|[-•*])\s*/, "")
    .replace(/^question\s*\d{1,2}\s*[:.)-]?\s*/i, "")
    .replace(/\s+answer$/i, "")
    .trim();
}

function genericQuestionLabel(value: string): boolean {
  return /^(?:question\s*\d{1,2}|answer\s*\d{1,2}|question\s*\d{1,2}\s*answer)$/i.test(compact(value));
}

function extractVisibleScreeningQuestions(snapshot: ApplyPageSnapshot, questionFields: ApplyPageFieldSnapshot[]): ApplyPageQuestionEvidence[] {
  const evidence: ApplyPageQuestionEvidence[] = [];
  const seen = new Set<string>();
  const push = (questionText: string, sourceText: string, sourceLocation: string, answerValue = "") => {
    const normalized = normalizeQuestionText(questionText);
    if (!normalized || normalized.length < 4) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const answer = compact(answerValue);
    evidence.push({
      questionText: normalized.slice(0, 500),
      sourceText: compact(sourceText).slice(0, 500),
      sourceLocation,
      answerState: answer ? "visible_filled" : "visible_empty",
      ...(answer ? { answerPreview: answer.slice(0, 160) } : {}),
    });
  };

  const lines = compactLines(snapshot.visibleText);
  const startIndex = lines.findIndex((line) => /\b(?:screening questions|additional questions|questions from the client|answer the following|application questions)\b/i.test(line));
  const scanStart = startIndex >= 0 ? startIndex + 1 : 0;
  const stopPattern = /\b(?:cover letter|boost your proposal|profile highlights|portfolio|attachments?|hourly rate|terms|submit proposal|send for \d{1,3} connects|send proposal)\b/i;
  for (let index = scanStart; index < lines.length && evidence.length < 6; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (startIndex >= 0 && index > scanStart && stopPattern.test(line)) break;
    if (startIndex < 0 && index > 80) break;
    const next = lines[index + 1] ?? "";
    if (/^question\s*\d{1,2}\s*$/i.test(line) && next && !stopPattern.test(next)) {
      push(next, `${line} ${next}`, `line ${index + 1}`, questionFields[evidence.length]?.value ?? "");
      index += 1;
      continue;
    }
    if (/[?]$/.test(line) || /^(?:\d{1,2}[.)]|[-•*])\s+/.test(line) || /^question\s*\d{1,2}\s*[:.)-]\s+\S/i.test(line)) {
      push(line, line, `line ${index + 1}`, questionFields[evidence.length]?.value ?? "");
    }
  }

  questionFields.forEach((field) => {
    const fieldIndex = snapshot.fieldValues.indexOf(field);
    const candidates = [field.label, field.ariaLabel, field.placeholder].filter((value): value is string => Boolean(value?.trim()));
    const bestLabel = candidates.find((value) => !genericQuestionLabel(value)) ?? candidates[0];
    if (!bestLabel) return;
    const fieldSource = fieldEvidence(field, fieldIndex >= 0 ? fieldIndex : 0);
    push(bestLabel, fieldSource.sourceText, fieldSource.sourceLocation, field.value);
  });

  return evidence;
}

function analyzeScreening(snapshot: ApplyPageSnapshot, plan?: BrowserApplyFillPlan | null): ApplyPageScreeningAnalysis {
  const planned = plan?.screeningAnswers ?? [];
  const visibleText = lower(snapshot.visibleText);
  const candidates = nonCoverTextFields(snapshot, bestCoverLetterValue(snapshot, plan?.coverLetter) ?? "");
  const questionLikeFields = candidates.filter((field) => field.kind === "textarea" || /\b(?:question|answer|screening)\b/i.test(fieldDescriptor(field)));
  const questions = extractVisibleScreeningQuestions(snapshot, questionLikeFields);
  const source = joinedEvidence(questions);
  const visible = questionLikeFields.length > 0 || /\b(?:screening questions|additional questions|questions from the client|answer the following)\b/i.test(visibleText);
  if (planned.length === 0 && !visible) {
    return { visible: false, questionCount: 0, answeredCount: 0, questions, ...source, state: "not_required", detail: "No screening questions were detected or planned." };
  }
  if (planned.length > 0 && !visible) {
    return { visible: false, questionCount: 0, answeredCount: 0, questions, ...source, state: "not_required", detail: "No screening question fields are visible on this apply page." };
  }
  const answers = planned.length > 0
    ? planned.filter((answer, index) => containsExpected(screeningValuesForAnswer(snapshot, bestCoverLetterValue(snapshot, plan?.coverLetter) ?? "", index), answer)).length
    : questionLikeFields.filter((field) => field.value.trim()).length;
  const questionCount = Math.max(planned.length, questions.length, questionLikeFields.length, visible ? 1 : 0);
  return {
    visible,
    questionCount,
    answeredCount: answers,
    questions,
    ...source,
    state: answers >= questionCount && questionCount > 0 ? "visible_filled" : visible ? "visible_requires_input" : "not_visible",
    detail: questionCount === 0 ? "No screening questions were detected." : `${answers}/${questionCount} screening answers detected.`,
  };
}

function analyzeRate(snapshot: ApplyPageSnapshot, plan?: BrowserApplyFillPlan | null): ApplyPageFieldState {
  const values = rateValues(snapshot);
  const expected = parseNumber(plan?.rate ?? "");
  const matched = expected !== null && values.some((value) => {
    const actual = parseNumber(value);
    return actual !== null && Math.abs(actual - expected) < 0.005;
  });
  if (matched) {
    return { state: "visible_filled", visible: true, filled: true, valuePreview: String(expected), detail: `Rate field contains ${expected}.` };
  }
  if (values.length > 0) {
    return { state: "visible_filled", visible: true, filled: true, valuePreview: values.join(" | ").slice(0, 120), detail: "Rate field has a value, but it does not match the planned rate." };
  }
  const visible = snapshot.fieldValues.some((field) => /\b(?:bid|hourly|rate|currency|amount|terms)\b/i.test(fieldDescriptor(field)));
  return visible
    ? { state: "visible_empty", visible: true, filled: false, detail: "Rate field is visible but empty." }
    : { state: "not_visible", visible: false, filled: false, detail: "Rate field was not detected." };
}

function analyzeConnects(snapshot: ApplyPageSnapshot): ApplyPageConnectsAnalysis {
  const extraction = extractConnectsFromVisibleText(snapshot.visibleText);
  if (extraction.requiredConnects === null) {
    return { visible: false, value: null, extraction, sourceText: extraction.sourceText, sourceLocation: extraction.sourceLocation, detail: "Required Connects were not readable on the apply page." };
  }
  return { visible: true, value: extraction.requiredConnects, extraction, sourceText: extraction.sourceText, sourceLocation: extraction.sourceLocation, detail: `Required Connects visible as ${extraction.requiredConnects}.` };
}

function analyzeBoost(snapshot: ApplyPageSnapshot, plan?: BrowserApplyFillPlan | null): ApplyPageBoostAnalysis {
  const text = snapshot.visibleText;
  const table = extractVisibleBoostBids(text);
  const source = joinedEvidence(lineEvidence(text, [
    /\bboost your proposal\b/i,
    /(?:rank|place|position|#)\s*\d{1,2}[^\n]{0,60}?\d{1,3}\s+connects?\b/i,
    /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:place|position)[^\n]{0,60}?\d{1,3}\s+connects?\b/i,
    /\bbid to boost\b/i,
  ]));
  const plannedBoost = plan?.connects.boost ?? 0;
  const boostFields = snapshot.fieldValues
    .filter(isUserTextField)
    .filter((field) => /\b(?:boost|bid to boost|top bid|connects)\b/i.test(fieldDescriptor(field)));
  const selectedValue = plannedBoost > 0
    ? boostFields.map((field) => parseNumber(field.value)).find((value): value is number => value !== null && value > 0) ?? null
    : null;
  const visible = table.length > 0 || boostFields.length > 0 || /\b(?:boost your proposal|bid to boost|top\s+\d|place bid)\b/i.test(text);
  if (!visible) {
    return { visible: false, selectedValue: null, table, ...source, state: "not_visible", detail: "Boost controls/table were not detected." };
  }
  if (selectedValue !== null && selectedValue > 50) {
    return { visible: true, selectedValue, table, ...source, state: "visible_over_cap", detail: `Boost field contains ${selectedValue}, above the hard cap.` };
  }
  if (selectedValue !== null) {
    return { visible: true, selectedValue, table, ...source, state: "visible_set", detail: `Boost field contains ${selectedValue}.` };
  }
  if (plannedBoost > 0) {
    return { visible: true, selectedValue: null, table, ...source, state: "visible_unset", detail: "Boost was planned but no selected boost value was detected." };
  }
  return { visible: true, selectedValue: null, table, ...source, state: table.length > 0 ? "visible_table_only" : "visible_unset", detail: table.length > 0 ? "Boost table is visible; no boost is selected." : "Boost controls are visible; no boost is selected." };
}

function analyzeAttachments(snapshot: ApplyPageSnapshot, plan?: BrowserApplyFillPlan | null): ApplyPageFieldState {
  const expectedNames = (plan?.attachments ?? []).map((attachment) => path.basename(attachment.filePath));
  const visible = snapshot.attachmentRows.length > 0 || snapshot.fileNames.length > 0 || /\b(?:attachments?|upload|attach file|drag and drop)\b/i.test(snapshot.visibleText);
  if (expectedNames.length === 0) {
    return { state: visible ? "not_required" : "not_required", visible, filled: false, detail: visible ? "Attachment section is visible; no files were planned." : "No attachment section or planned files detected." };
  }
  const attachmentEvidence = snapshot.attachmentRows.length > 0 ? snapshot.attachmentRows : snapshot.fileNames;
  const verified = expectedNames.filter((name) => attachmentEvidence.filter((value) => containsExpected([value], name)).length === 1);
  if (verified.length === expectedNames.length && attachmentEvidence.length === expectedNames.length) {
    return { state: "visible_filled", visible: true, filled: true, valuePreview: verified.join(", "), detail: `Verified attached files: ${verified.join(", ")}.` };
  }
  return {
    state: visible ? "visible_requires_input" : "not_visible",
    visible,
    filled: false,
    detail: visible ? `Attachment rows need QA. Expected exactly once: ${expectedNames.join(", ")}. Actual: ${attachmentEvidence.join(", ") || "none"}.` : `Attachment section was not detected. Expected files: ${expectedNames.join(", ")}.`,
  };
}

function analyzePortfolioHighlights(snapshot: ApplyPageSnapshot, plan?: BrowserApplyFillPlan | null): ApplyPageFieldState {
  const expected = plan?.highlights ?? [];
  const selectedEvidence = [...snapshot.checkedLabels, ...snapshot.selectedHighlightLabels];
  const selectedControls = selectedHighlightControlCount(snapshot);
  const pickerOpen = profileHighlightPickerLooksOpen(snapshot);
  const visible = selectedEvidence.length > 0 || selectedControls > 0 || /\b(?:portfolio project|profile highlight|certificates?|work samples?|add portfolio)\b/i.test(snapshot.visibleText);
  if (expected.length === 0) {
    return { state: visible ? "not_required" : "not_required", visible, filled: false, detail: visible ? "Portfolio/profile section is visible; no highlights were planned." : "No portfolio/profile highlight section or planned highlights detected." };
  }
  const verified = expected.filter((highlight) => containsExpectedHighlight(selectedEvidence, highlight));
  const expectedSelections = Math.min(expected.length, 4);
  if (verified.length === expected.length || (!pickerOpen && selectedControls >= expectedSelections)) {
    const valuePreview = verified.length === expected.length ? verified.join(", ") : `${selectedControls} selected Upwork profile highlight controls`;
    return { state: "visible_filled", visible: true, filled: true, valuePreview, detail: `Verified selected portfolio/profile proof: ${valuePreview}.` };
  }
  return {
    state: visible ? "visible_requires_input" : "not_visible",
    visible,
    filled: false,
    detail: visible ? `Portfolio/profile controls visible; expected highlights not fully verified: ${expected.join(", ")}.` : "Portfolio/profile highlight controls were not detected.",
  };
}

function analyzeFinalSubmit(snapshot: ApplyPageSnapshot): ApplyPageFinalSubmitAnalysis {
  const labels = [...snapshot.actionLabels, ...snapshot.fieldValues.filter((field) => /submit|button/i.test(field.inputType ?? "")).map((field) => [field.label, field.value, field.ariaLabel].filter(Boolean).join(" "))];
  const text = [snapshot.visibleText, ...labels].join("\n");
  const patterns = [
    /\bSend\s+for\s+\d{1,3}\s+Connects\b/i,
    /\bSubmit\s+proposal\b/i,
    /\bSend\s+proposal\b/i,
    /\bSend\s+application\b/i,
    /\bSubmit\s+application\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { visible: true, label: compact(match[0]), clicked: false, detail: `Final submit control detected as "${compact(match[0])}" and was not clicked.` };
  }
  return { visible: false, label: null, clicked: false, detail: "Final submit/send control was not detected." };
}

export function analyzeApplyPageSnapshot(snapshot: ApplyPageSnapshot, plan?: BrowserApplyFillPlan | null): ApplyPageAnalyzerResult {
  const challenge = detectChallenge(snapshot);
  const pageKind: ApplyPageKind = challenge.detected ? challenge.kind! : looksLikeApplyPage(snapshot) ? "apply" : "unknown";
  const connects = analyzeConnects(snapshot);
  const boost = analyzeBoost(snapshot, plan);
  const coverLetter = analyzeCoverLetter(snapshot, plan);
  const screening = analyzeScreening(snapshot, plan);
  const rate = analyzeRate(snapshot, plan);
  const attachments = analyzeAttachments(snapshot, plan);
  const portfolioHighlights = analyzePortfolioHighlights(snapshot, plan);
  const finalSubmit = analyzeFinalSubmit(snapshot);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (pageKind === "security_challenge" || pageKind === "login_required" || pageKind === "two_factor_required") {
    blockers.push(`browser_${pageKind}`);
  } else if (pageKind === "unknown") {
    blockers.push("unknown_apply_page_structure");
  }

  if (pageKind === "apply") {
    if (!connects.visible) blockers.push("required_connects_unreadable");
    if (!finalSubmit.visible) blockers.push("final_submit_control_not_detected");
    if (plan?.coverLetter.trim() && coverLetter.state !== "visible_filled") blockers.push("cover_letter_not_verified");
    if (plan?.screeningAnswers.length && screening.visible && screening.answeredCount < plan.screeningAnswers.length) blockers.push("screening_answers_not_verified");
    if (plan?.rate.trim() && rate.state !== "visible_filled") blockers.push("rate_not_verified");
    if ((plan?.attachments.length ?? 0) > 0 && attachments.state !== "visible_filled") warnings.push("attachments_not_verified");
    if ((plan?.highlights.length ?? 0) > 0 && portfolioHighlights.state !== "visible_filled") warnings.push("portfolio_highlights_not_verified");
    if (boost.state === "visible_over_cap") blockers.push("boost_over_cap");
  }

  return {
    pageKind,
    ready: blockers.length === 0,
    blockers,
    warnings,
    challenge,
    connects,
    boost,
    coverLetter,
    screening,
    rate,
    attachments,
    portfolioHighlights,
    finalSubmit,
  };
}
