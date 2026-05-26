import { getBrowserSessionStatus, BrowserSessionStatus } from "./browserSession";
import { ManualAttentionCategory, ManualAttentionReason } from "./browserSafetyGuard";

export type BrowserToolSessionState =
  | "logged_in"
  | "logged_out"
  | "login_in_progress"
  | "password_required"
  | "passkey_required"
  | "two_factor_required"
  | "captcha_or_security_challenge"
  | "suspicious_login_check"
  | "browser_session_unhealthy"
  | "manual_attention_required"
  | "unknown";

export interface BrowserSessionPageSnapshot {
  currentUrl: string;
  title: string;
  textExcerpt: string;
  jobLinkCount?: number;
  feedSignalCount?: number;
  hasLikelyJobCardText?: boolean;
}

export interface BrowserSessionInspection {
  internalState: BrowserToolSessionState;
  sessionState: BrowserToolSessionState | "manual_attention_required";
  manualAttentionRequired: boolean;
  blocked: boolean;
  manualAttentionReason?: ManualAttentionReason | "manual_attention_required" | "browser_session_unhealthy";
  manualAttentionCategory?: ManualAttentionCategory | "session";
  currentUrl: string;
  title: string;
  matchedText?: string;
  summary: string;
  retryAllowedAfterManualFix?: boolean;
}

export interface InspectorLocatorLike {
  count(): Promise<number>;
  first(): InspectorLocatorLike;
  textContent(options?: { timeout?: number }): Promise<string | null>;
}

export interface InspectorPageLike {
  url(): string;
  title(): Promise<string>;
  locator(selector: string): InspectorLocatorLike;
}

export interface InspectorContextLike {
  pages?(): InspectorPageLike[];
}

interface PatternRule {
  state: BrowserToolSessionState;
  category?: ManualAttentionCategory;
  patterns: Array<{ pattern: RegExp; label: string }>;
}

const RISK_RULES: PatternRule[] = [
  {
    state: "captcha_or_security_challenge",
    category: "challenge",
    patterns: [
      { pattern: /__cf_chl|__cf_chl_rt_tk|\/cdn-cgi\/challenge|just\s+a\s+moment|security\s+check|attention\s+required|captcha|cloudflare|i['’]?m\s+not\s+a\s+robot|verify\s+you\s+are\s+human|checking\s+your\s+browser|checking\s+if\s+the\s+site\s+connection\s+is\s+secure|unusual\s+traffic/i, label: "restricted_or_unreadable" },
      { pattern: /access\s+denied|security\s+challenge|something\s+went\s+wrong/i, label: "restricted_or_unreadable" },
    ],
  },
  {
    state: "suspicious_login_check",
    category: "auth_sensitive",
    patterns: [
      { pattern: /suspicious\s+login|unusual\s+activity|verify\s+it['’]?s\s+you|confirm\s+it['’]?s\s+you|identity\s+verification/i, label: "suspicious_login" },
    ],
  },
  {
    state: "passkey_required",
    category: "auth_sensitive",
    patterns: [
      { pattern: /passkey|security\s+key|touch\s+your\s+security\s+key|webauthn/i, label: "passkey" },
    ],
  },
  {
    state: "two_factor_required",
    category: "auth_sensitive",
    patterns: [
      { pattern: /two[-\s]?factor|2[-\s]?step|verification[\s_-]*code|enter\s+the\s+code|authenticator|one[-\s]?time\s+code|otp/i, label: "two_factor" },
    ],
  },
  {
    state: "password_required",
    category: "auth_sensitive",
    patterns: [
      { pattern: /password|current-password|enter\s+your\s+password/i, label: "password" },
    ],
  },
];

function compact(value: string, maxLength = 1600): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isRiskState(state: BrowserToolSessionState): state is ManualAttentionReason {
  return state === "password_required" || state === "passkey_required" || state === "two_factor_required" || state === "captcha_or_security_challenge" || state === "suspicious_login_check";
}

function externalize(input: {
  internalState: BrowserToolSessionState;
  currentUrl: string;
  title: string;
  matchedText?: string;
  summary: string;
  category?: ManualAttentionCategory | "session";
}): BrowserSessionInspection {
  if (isRiskState(input.internalState)) {
    return {
      internalState: input.internalState,
      sessionState: "manual_attention_required",
      manualAttentionReason: input.internalState,
      manualAttentionCategory: input.category ?? (input.internalState === "captcha_or_security_challenge" ? "challenge" : "auth_sensitive"),
      manualAttentionRequired: true,
      blocked: true,
      currentUrl: input.currentUrl,
      title: input.title,
      matchedText: input.matchedText,
      summary: input.summary,
      retryAllowedAfterManualFix: true,
    };
  }
  if (input.internalState === "manual_attention_required" || input.internalState === "browser_session_unhealthy") {
    return {
      internalState: input.internalState,
      sessionState: input.internalState,
      manualAttentionRequired: true,
      blocked: true,
      manualAttentionReason: input.internalState,
      manualAttentionCategory: "session",
      retryAllowedAfterManualFix: true,
      currentUrl: input.currentUrl,
      title: input.title,
      matchedText: input.matchedText,
      summary: input.summary,
    };
  }
  return {
    internalState: input.internalState,
    sessionState: input.internalState,
    manualAttentionRequired: false,
    blocked: false,
    currentUrl: input.currentUrl,
    title: input.title,
    matchedText: input.matchedText,
    summary: input.summary,
  };
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isUpworkUrl(value: string): boolean {
  const host = hostOf(value);
  return host === "upwork.com" || host.endsWith(".upwork.com");
}

function isGoogleAccountsUrl(value: string): boolean {
  const host = hostOf(value);
  return host === "accounts.google.com" || host.endsWith(".accounts.google.com");
}

function isUpworkFindWorkFeedUrl(value: string): boolean {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return /^\/nx\/find-work\/(?:best-matches|most-recent|saved-search(?:es)?|search(?:\/jobs)?|search-jobs)(?:\/|$)/.test(pathname);
  } catch {
    return false;
  }
}

function hasLoginMarkers(value: string): boolean {
  return /\blog\s*in\b|\bsign\s*in\b|\bjoin\b|continue\s+with\s+google|upwork\s+login|hire\s+top\s+freelance\s+talent|find\s+talent|post\s+a\s+job/i.test(value);
}

function hasUsableFeedSignals(value: string): boolean {
  return /jobs\s+you\s+might\s+like|best\s+matches|most\s+recent|search\s+jobs|job\s+postings?|recommended\s+for\s+you/i.test(value);
}

function countFeedSignals(value: string): number {
  const matches = value.match(/jobs\s+you\s+might\s+like|best\s+matches|most\s+recent|search\s+jobs|job\s+postings?|recommended\s+for\s+you/gi);
  return matches?.length ?? 0;
}

function hasLikelyUpworkJobCardText(value: string): boolean {
  return /\bpayment\s+verified\b|\bproposals?\b|\bconnects?\s+to\s+apply\b|\bhourly\b|\bfixed-price\b|\bintermediate\b|\bexpert\b|\bentry\s+level\b|\bposted\b|\b(est\.?|estimated)\s+budget\b/i.test(value);
}

function hasAuthenticatedUiSignals(value: string): boolean {
  return /best\s+matches|my\s+jobs|messages|proposals|profile|saved\s+search|connects\s+(?:balance|available)/i.test(value);
}

export function classifyBrowserSessionSnapshot(snapshot: BrowserSessionPageSnapshot, sessionStatus?: Pick<BrowserSessionStatus, "state" | "blocked" | "reason">): BrowserSessionInspection {
  const currentUrl = snapshot.currentUrl || "";
  const title = snapshot.title || "";
  const text = compact(snapshot.textExcerpt || "");
  const haystack = `${currentUrl}\n${title}\n${text}`;
  const feedSignalCount = snapshot.feedSignalCount ?? countFeedSignals(haystack);
  const hasLikelyJobCardText = snapshot.hasLikelyJobCardText ?? hasLikelyUpworkJobCardText(haystack);
  const strongUsableFeedEvidence = (snapshot.jobLinkCount ?? 0) >= 10 || (feedSignalCount >= 2 && hasLikelyJobCardText);

  for (const rule of RISK_RULES) {
    for (const entry of rule.patterns) {
      if (entry.pattern.test(haystack)) {
        return externalize({ internalState: rule.state, currentUrl, title, matchedText: entry.label, summary: `Detected ${rule.state}.`, category: rule.category });
      }
    }
  }

  if (isGoogleAccountsUrl(currentUrl) || /google\s+account|choose\s+an\s+account|email\s+or\s+phone|use\s+another\s+account|sign\s+in\s+-\s+google/i.test(haystack)) {
    return externalize({ internalState: "login_in_progress", currentUrl, title, matchedText: "google_login", summary: "Detected safe Google login-in-progress page." });
  }

  if (hasLoginMarkers(haystack) && isUpworkUrl(currentUrl)) {
    return externalize({ internalState: "logged_out", currentUrl, title, matchedText: "upwork_logged_out_or_public_home", summary: "Detected Upwork logged-out/public homepage context." });
  }

  if (isUpworkUrl(currentUrl) && isUpworkFindWorkFeedUrl(currentUrl) && hasUsableFeedSignals(haystack) && strongUsableFeedEvidence && !hasLoginMarkers(haystack)) {
    return externalize({ internalState: "logged_in", currentUrl, title, matchedText: "upwork_usable_feed", summary: "Detected usable Upwork find-work feed." });
  }

  if (isUpworkUrl(currentUrl) && hasAuthenticatedUiSignals(haystack) && !/\blog\s*in\b|\bsign\s*in\b|\bjoin\b/i.test(haystack)) {
    return externalize({ internalState: "logged_in", currentUrl, title, matchedText: "upwork_authenticated_ui", summary: "Detected authenticated Upwork UI." });
  }

  if (sessionStatus?.state === "browser_session_unhealthy") {
    return externalize({ internalState: "browser_session_unhealthy", currentUrl, title, summary: sessionStatus.reason ?? "Existing browser session state is unhealthy.", category: "session" });
  }
  if (sessionStatus?.blocked && sessionStatus.state !== "healthy") {
    return externalize({ internalState: "manual_attention_required", currentUrl, title, summary: sessionStatus.reason ?? `Existing browser session state is ${sessionStatus.state}.`, category: "session" });
  }

  return externalize({ internalState: "unknown", currentUrl, title, summary: "Could not confidently classify the browser session." });
}

export async function buildSessionPageSnapshot(page: InspectorPageLike): Promise<BrowserSessionPageSnapshot> {
  const currentUrl = page.url();
  const title = await page.title();
  let textExcerpt = "";
  let jobLinkCount = 0;
  try {
    textExcerpt = compact((await page.locator("body").first().textContent({ timeout: 2500 })) ?? "");
  } catch {
    textExcerpt = "";
  }
  try {
    jobLinkCount = await page.locator("a[href*='/jobs/~'], a[href*='/nx/search/jobs/details/~'], a[href*='/nx/find-work/'][href*='/details/~'], a[data-test='job-tile-title-link']").count();
  } catch {
    jobLinkCount = 0;
  }
  return {
    currentUrl,
    title,
    textExcerpt,
    jobLinkCount,
    feedSignalCount: countFeedSignals(textExcerpt),
    hasLikelyJobCardText: hasLikelyUpworkJobCardText(textExcerpt),
  };
}

export function selectRelevantBrowserPage(pages: InspectorPageLike[]): { page: InspectorPageLike | null; ambiguous: boolean; reason: string } {
  const candidates = pages.filter((page) => {
    const url = page.url();
    return isUpworkUrl(url) || isGoogleAccountsUrl(url);
  });
  if (candidates.length === 0) {
    return { page: pages[pages.length - 1] ?? null, ambiguous: pages.length > 1, reason: "No Upwork/Google tab found; selected the last available page conservatively." };
  }
  const upworkOrGoogle = candidates.filter((page) => page.url() && page.url() !== "about:blank");
  if (upworkOrGoogle.length === 1) {
    return { page: upworkOrGoogle[0]!, ambiguous: false, reason: "Selected the only Upwork/Google tab." };
  }
  const activeLike = upworkOrGoogle[upworkOrGoogle.length - 1] ?? null;
  return { page: activeLike, ambiguous: false, reason: "Selected the most recent Upwork/Google tab." };
}

export async function inspectBrowserSession(context: InspectorContextLike, options: { includeStoredSessionState?: boolean } = {}): Promise<BrowserSessionInspection> {
  const pages = context.pages?.() ?? [];
  const selected = selectRelevantBrowserPage(pages);
  if (!selected.page) {
    return externalize({ internalState: "unknown", currentUrl: "", title: "", summary: "No browser pages are available in the CDP session." });
  }
  if (selected.ambiguous) {
    return externalize({ internalState: "manual_attention_required", currentUrl: selected.page.url(), title: await selected.page.title(), summary: selected.reason, category: "session" });
  }
  const snapshot = await buildSessionPageSnapshot(selected.page);
  const status = options.includeStoredSessionState === false ? undefined : getBrowserSessionStatus();
  return classifyBrowserSessionSnapshot(snapshot, status);
}
