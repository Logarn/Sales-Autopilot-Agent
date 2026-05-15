export type BrowserInteractionType = "click" | "fill" | "check";

export type ManualAttentionReason =
  | "password_required"
  | "passkey_required"
  | "two_factor_required"
  | "captcha_or_security_challenge"
  | "suspicious_login_check";

export type ManualAttentionCategory = "auth_sensitive" | "challenge";

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

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; reason: ManualAttentionReason; category: ManualAttentionCategory; label: string }> = [
  { pattern: /captcha|g-recaptcha|hcaptcha|i['’]?m\s+not\s+a\s+robot|verify\s+you\s+are\s+human|are\s+you\s+human/i, reason: "captcha_or_security_challenge", category: "challenge", label: "captcha" },
  { pattern: /cloudflare|cf-chl|__cf_chl|security\s+check|checking\s+if\s+the\s+site\s+connection\s+is\s+secure/i, reason: "captcha_or_security_challenge", category: "challenge", label: "cloudflare_or_security_check" },
  { pattern: /passkey|security\s+key|touch\s+your\s+security\s+key|webauthn/i, reason: "passkey_required", category: "auth_sensitive", label: "passkey" },
  { pattern: /two[-\s]?factor|2[-\s]?step|verification[\s_-]*code|enter\s+the\s+code|authenticator|one[-\s]?time\s+code|otp/i, reason: "two_factor_required", category: "auth_sensitive", label: "two_factor_or_verification_code" },
  { pattern: /password|current-password|new-password|enter\s+your\s+password/i, reason: "password_required", category: "auth_sensitive", label: "password" },
  { pattern: /suspicious\s+login|unusual\s+activity|verify\s+it['’]?s\s+you|confirm\s+it['’]?s\s+you|identity\s+verification/i, reason: "suspicious_login_check", category: "auth_sensitive", label: "suspicious_login" },
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
