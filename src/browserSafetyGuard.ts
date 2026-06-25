export type BrowserInteractionType = "click" | "fill" | "check";

export type UpworkNavigationSafetyReason =
  | "malformed_url"
  | "non_https_upwork_url"
  | "non_upwork_url"
  | "sensitive_upwork_url"
  | "unsupported_upwork_url";

export type SafeUpworkNavigationKind =
  | "find_work_feed"
  | "job_search"
  | "job_detail"
  | "apply_review";

export type ManualAttentionReason =
  | "password_required"
  | "passkey_required"
  | "two_factor_required"
  | "captcha_or_security_challenge"
  | "suspicious_login_check"
  | "final_submit_forbidden";

export type ManualAttentionCategory = "auth_sensitive" | "challenge" | "final_submit";

export interface BrowserInteractionTarget {
  selector?: string;
  label?: string;
  text?: string;
  value?: string;
  type?: BrowserInteractionType;
}

export interface SensitiveTargetClassification {
  blocked: boolean;
  reason?: ManualAttentionReason;
  category?: ManualAttentionCategory;
  matchedPattern?: string;
}

export interface UpworkNavigationSafetyClassification {
  allowed: boolean;
  reason?: UpworkNavigationSafetyReason;
  kind?: SafeUpworkNavigationKind;
  matchedPattern?: string;
  normalizedUrl?: string;
}

export class BrowserSafetyGuardBlockedError extends Error {
  readonly reason: ManualAttentionReason;
  readonly category: ManualAttentionCategory;
  readonly matchedPattern?: string;
  readonly target: BrowserInteractionTarget;

  constructor(classification: Required<Pick<SensitiveTargetClassification, "reason" | "category">> & Pick<SensitiveTargetClassification, "matchedPattern">, target: BrowserInteractionTarget) {
    super(`Blocked unsafe browser interaction: ${classification.reason}${classification.matchedPattern ? ` (${classification.matchedPattern})` : ""}`);
    this.name = "BrowserSafetyGuardBlockedError";
    this.reason = classification.reason;
    this.category = classification.category;
    this.matchedPattern = classification.matchedPattern;
    this.target = target;
  }
}

export class UnsafeUpworkNavigationError extends Error {
  readonly reason: UpworkNavigationSafetyReason;
  readonly matchedPattern?: string;
  readonly url: string;

  constructor(url: string, classification: Required<Pick<UpworkNavigationSafetyClassification, "reason">> & Pick<UpworkNavigationSafetyClassification, "matchedPattern">) {
    super(`Blocked unsafe Upwork navigation: ${classification.reason}${classification.matchedPattern ? ` (${classification.matchedPattern})` : ""}`);
    this.name = "UnsafeUpworkNavigationError";
    this.reason = classification.reason;
    this.matchedPattern = classification.matchedPattern;
    this.url = url;
  }
}

const UPWORK_HOSTS = new Set(["upwork.com", "www.upwork.com"]);

const SENSITIVE_UPWORK_PATH_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^\/(?:ab|nx)\/(?:account|account-security|settings|security|payments?|billing|financial|wallet|contracts?|workroom|reports|identity|membership|connects)(?:\/|$)/i, label: "sensitive_app_area" },
  { pattern: /^\/freelancers\/settings(?:\/|$)/i, label: "freelancer_settings" },
  { pattern: /^\/(?:account|account-security|settings|security|payments?|billing|financial|wallet|contracts?|workroom|reports|identity|membership|connects)(?:\/|$)/i, label: "sensitive_area" },
  { pattern: /\/(?:account-security|security-center|two-factor|password|payment-methods?|billing-methods?|contracts?|contract-room|financial-account|withdraw|membership|connects)(?:\/|$)/i, label: "sensitive_path_segment" },
];

const SAFE_UPWORK_NAVIGATION_PATH_PATTERNS: Array<{ pattern: RegExp; kind: SafeUpworkNavigationKind; label: string }> = [
  { pattern: /^\/nx\/find-work\/?$/i, kind: "find_work_feed", label: "find_work_feed" },
  { pattern: /^\/jobs\/(?:[^/?#]+_)?~[A-Za-z0-9_-]{8,}\/?$/i, kind: "job_detail", label: "job_detail" },
  { pattern: /^\/nx\/find-work\/best-matches\/details\/~[A-Za-z0-9_-]{8,}\/?$/i, kind: "job_detail", label: "find_work_job_detail" },
  { pattern: /^\/(?:nx|ab)\/proposals\/job\/~[A-Za-z0-9_-]{8,}\/apply\/?$/i, kind: "apply_review", label: "apply_review" },
  { pattern: /^\/nx\/find-work\/(?:best-matches|most-recent|saved-search(?:es)?|search(?:\/jobs)?|search-jobs)(?:\/|$)/i, kind: "job_search", label: "find_work_search" },
  { pattern: /^\/nx\/search\/jobs(?:\/|$)/i, kind: "job_search", label: "job_search" },
];

function parseUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

function isUpworkHost(hostname: string): boolean {
  return UPWORK_HOSTS.has(hostname.toLowerCase());
}

export function classifyUpworkNavigationUrl(value: string): UpworkNavigationSafetyClassification {
  const parsed = parseUrl(value);
  if (!parsed) {
    return { allowed: false, reason: "malformed_url" };
  }
  if (!isUpworkHost(parsed.hostname)) {
    return { allowed: false, reason: "non_upwork_url", normalizedUrl: parsed.toString() };
  }
  if (parsed.protocol !== "https:") {
    return { allowed: false, reason: "non_https_upwork_url", normalizedUrl: parsed.toString() };
  }

  const pathname = parsed.pathname;
  const sensitive = SENSITIVE_UPWORK_PATH_PATTERNS.find((entry) => entry.pattern.test(pathname));
  if (sensitive) {
    return { allowed: false, reason: "sensitive_upwork_url", matchedPattern: sensitive.label, normalizedUrl: parsed.toString() };
  }

  const safe = SAFE_UPWORK_NAVIGATION_PATH_PATTERNS.find((entry) => entry.pattern.test(pathname));
  if (safe) {
    return { allowed: true, kind: safe.kind, matchedPattern: safe.label, normalizedUrl: parsed.toString() };
  }

  return { allowed: false, reason: "unsupported_upwork_url", normalizedUrl: parsed.toString() };
}

export function isSafeUpworkNavigationUrl(value: string): boolean {
  return classifyUpworkNavigationUrl(value).allowed;
}

export function assertSafeUpworkNavigationUrl(value: string): void {
  const classification = classifyUpworkNavigationUrl(value);
  if (!classification.allowed && classification.reason) {
    throw new UnsafeUpworkNavigationError(value, { reason: classification.reason, matchedPattern: classification.matchedPattern });
  }
}

export interface GuardedGotoLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
}

export async function guardedGoto(page: GuardedGotoLike, url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown> {
  assertSafeUpworkNavigationUrl(url);
  return page.goto(url, options);
}

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; reason: ManualAttentionReason; category: ManualAttentionCategory; label: string }> = [
  { pattern: /captcha|g-recaptcha|hcaptcha|i['’]?m\s+not\s+a\s+robot|verify\s+you\s+are\s+human|are\s+you\s+human/i, reason: "captcha_or_security_challenge", category: "challenge", label: "captcha" },
  { pattern: /cloudflare|cf-chl|__cf_chl|security\s+check|checking\s+if\s+the\s+site\s+connection\s+is\s+secure/i, reason: "captcha_or_security_challenge", category: "challenge", label: "cloudflare_or_security_check" },
  { pattern: /passkey|security\s+key|touch\s+your\s+security\s+key|webauthn/i, reason: "passkey_required", category: "auth_sensitive", label: "passkey" },
  { pattern: /two[-\s]?factor|2[-\s]?step|verification[\s_-]*code|enter\s+the\s+code|authenticator|one[-\s]?time\s+code|otp/i, reason: "two_factor_required", category: "auth_sensitive", label: "two_factor_or_verification_code" },
  { pattern: /password|current-password|new-password|enter\s+your\s+password/i, reason: "password_required", category: "auth_sensitive", label: "password" },
  { pattern: /suspicious\s+login|unusual\s+activity|verify\s+it['’]?s\s+you|confirm\s+it['’]?s\s+you|identity\s+verification/i, reason: "suspicious_login_check", category: "auth_sensitive", label: "suspicious_login" },
  { pattern: /\b(send\s+(?:for\s+\d{1,3}\s+connects|proposal)|submit\s+proposal)\b/i, reason: "final_submit_forbidden", category: "final_submit", label: "final_submit" },
];

function targetText(target: BrowserInteractionTarget): string {
  return [target.selector, target.label, target.text, target.value, target.type].filter(Boolean).join("\n");
}

export function classifySensitiveTarget(target: BrowserInteractionTarget): SensitiveTargetClassification {
  const haystack = targetText(target);
  for (const entry of SENSITIVE_PATTERNS) {
    if (entry.pattern.test(haystack)) {
      return {
        blocked: true,
        reason: entry.reason,
        category: entry.category,
        matchedPattern: entry.label,
      };
    }
  }
  return { blocked: false };
}

export function isSensitiveAuthOrChallengeTarget(target: BrowserInteractionTarget): boolean {
  return classifySensitiveTarget(target).blocked;
}

export function assertNoChallengeInteraction(target: BrowserInteractionTarget): void {
  const classification = classifySensitiveTarget(target);
  if (classification.blocked && classification.reason && classification.category) {
    throw new BrowserSafetyGuardBlockedError({ reason: classification.reason, category: classification.category, matchedPattern: classification.matchedPattern }, target);
  }
}

export interface GuardedClickLike {
  click(options?: { timeout?: number }): Promise<unknown>;
}

export interface GuardedFillLike {
  fill(value: string, options?: { timeout?: number }): Promise<unknown>;
}

export interface GuardedCheckLike {
  check(options?: { timeout?: number }): Promise<unknown>;
}

export async function guardedClick(locator: GuardedClickLike, target: BrowserInteractionTarget, options?: { timeout?: number }): Promise<unknown> {
  assertNoChallengeInteraction({ ...target, type: "click" });
  return locator.click(options);
}

export async function guardedFill(locator: GuardedFillLike, target: BrowserInteractionTarget, value: string, options?: { timeout?: number }): Promise<unknown> {
  assertNoChallengeInteraction({ ...target, value, type: "fill" });
  return locator.fill(value, options);
}

export async function guardedCheck(locator: GuardedCheckLike, target: BrowserInteractionTarget, options?: { timeout?: number }): Promise<unknown> {
  assertNoChallengeInteraction({ ...target, type: "check" });
  return locator.check(options);
}
