import { BrowserSessionInspection, buildSessionPageSnapshot, classifyBrowserSessionSnapshot, InspectorPageLike } from "./browserSessionInspector";
import { BrowserSafetyGuardBlockedError, guardedClick, guardedFill, ManualAttentionCategory, ManualAttentionReason } from "./browserSafetyGuard";

export interface LoginDriverLocatorLike {
  count(): Promise<number>;
  first(): LoginDriverLocatorLike;
  textContent(options?: { timeout?: number }): Promise<string | null>;
  click(options?: { timeout?: number }): Promise<unknown>;
  fill(value: string, options?: { timeout?: number }): Promise<unknown>;
}

export interface LoginDriverPageLike extends InspectorPageLike {
  goto?(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  locator(selector: string): LoginDriverLocatorLike;
  waitForTimeout?(ms: number): Promise<unknown>;
}

export interface LoginStartGoogleResult {
  ok: boolean;
  tool: "login.start-google";
  sessionState: BrowserSessionInspection["sessionState"];
  internalState?: BrowserSessionInspection["internalState"];
  manualAttentionReason?: ManualAttentionReason | "manual_attention_required" | "browser_session_unhealthy";
  manualAttentionCategory?: ManualAttentionCategory | "session";
  emailSelectedOrEntered: boolean;
  googleAccountChooserVisible?: boolean;
  matchingGoogleAccountVisible?: boolean;
  googleAccountSelected?: boolean;
  emailEntered?: boolean;
  manualAttentionRequired: boolean;
  blocked: boolean;
  currentUrl: string;
  title: string;
  retryAllowedAfterManualFix?: boolean;
  nextExpectedStep?: string;
  actionTaken?: string;
}

const UPWORK_HOME = "https://www.upwork.com";

type LoginProgressFlags = Pick<LoginStartGoogleResult, "emailSelectedOrEntered" | "googleAccountChooserVisible" | "matchingGoogleAccountVisible" | "googleAccountSelected" | "emailEntered">;

function toBlockedResult(inspection: BrowserSessionInspection, flags: LoginProgressFlags): LoginStartGoogleResult {
  return {
    ok: false,
    tool: "login.start-google",
    sessionState: "manual_attention_required",
    internalState: inspection.internalState,
    manualAttentionReason: inspection.manualAttentionReason,
    manualAttentionCategory: inspection.manualAttentionCategory,
    ...flags,
    manualAttentionRequired: true,
    blocked: true,
    currentUrl: inspection.currentUrl,
    title: inspection.title,
    retryAllowedAfterManualFix: true,
    nextExpectedStep: "manual_password_passkey_2fa_security_or_verification_completion",
  };
}

function toResult(input: {
  ok: boolean;
  inspection: BrowserSessionInspection;
  flags: LoginProgressFlags;
  actionTaken?: string;
  nextExpectedStep?: string;
}): LoginStartGoogleResult {
  if (input.inspection.blocked || input.inspection.manualAttentionRequired) {
    return toBlockedResult(input.inspection, input.flags);
  }
  return {
    ok: input.ok,
    tool: "login.start-google",
    sessionState: input.inspection.sessionState,
    internalState: input.inspection.internalState,
    ...input.flags,
    manualAttentionRequired: false,
    blocked: false,
    currentUrl: input.inspection.currentUrl,
    title: input.inspection.title,
    actionTaken: input.actionTaken,
    nextExpectedStep: input.nextExpectedStep,
  };
}

async function inspectPage(page: LoginDriverPageLike): Promise<BrowserSessionInspection> {
  return classifyBrowserSessionSnapshot(await buildSessionPageSnapshot(page), { state: "healthy", blocked: false });
}

async function waitBriefly(page: LoginDriverPageLike): Promise<void> {
  if (page.waitForTimeout) {
    await page.waitForTimeout(500);
  }
}

async function firstLocator(page: LoginDriverPageLike, selectors: string[]): Promise<{ selector: string; locator: LoginDriverLocatorLike } | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0) {
        return { selector, locator };
      }
    } catch {
      // Try the next conservative selector.
    }
  }
  return null;
}

async function clickIfPresent(page: LoginDriverPageLike, selectors: string[], label: string): Promise<boolean> {
  const found = await firstLocator(page, selectors);
  if (!found) return false;
  await guardedClick(found.locator, { selector: found.selector, label }, { timeout: 2500 });
  await waitBriefly(page);
  return true;
}

async function fillIfPresent(page: LoginDriverPageLike, selectors: string[], label: string, value: string): Promise<boolean> {
  const found = await firstLocator(page, selectors);
  if (!found) return false;
  await guardedFill(found.locator, { selector: found.selector, label }, value, { timeout: 2500 });
  await waitBriefly(page);
  return true;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function bodyText(page: LoginDriverPageLike): Promise<string> {
  try {
    return (await page.locator("body").first().textContent({ timeout: 1500 })) ?? "";
  } catch {
    return "";
  }
}

function pageLooksLikeGoogleAccountChooser(inspection: BrowserSessionInspection, text: string): boolean {
  return /accounts\.google\.com/i.test(inspection.currentUrl) && /choose\s+an\s+account|use\s+another\s+account|to\s+continue\s+to/i.test(`${inspection.title}\n${text}`);
}

function textContainsExactEmail(text: string, email: string): boolean {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9._%+-])${escaped}([^a-z0-9._%+-]|$)`, "i").test(text);
}

async function findMatchingGoogleAccount(page: LoginDriverPageLike, email: string): Promise<{ selector: string; locator: LoginDriverLocatorLike } | null> {
  const selectors = [
    `[data-identifier='${email}']`,
    `[data-email='${email}']`,
    `div[role='link']:has-text('${email}')`,
    `div[role='button']:has-text('${email}')`,
    `li:has-text('${email}')`,
    `[role='link']:has-text('${email}')`,
    `[role='button']:has-text('${email}')`,
    `text=${email}`,
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) <= 0) continue;
      const text = (await locator.textContent({ timeout: 1000 })) ?? email;
      if (text === email || textContainsExactEmail(text, email)) return { selector, locator };
    } catch {
      // Try the next conservative selector.
    }
  }
  return null;
}

export async function startGoogleLoginOnPage(page: LoginDriverPageLike, email: string): Promise<LoginStartGoogleResult> {
  const flags: LoginProgressFlags = {
    emailSelectedOrEntered: false,
    googleAccountChooserVisible: false,
    matchingGoogleAccountVisible: false,
    googleAccountSelected: false,
    emailEntered: false,
  };
  try {
    let inspection = await inspectPage(page);
    if (inspection.blocked || inspection.manualAttentionRequired) return toBlockedResult(inspection, flags);
    if (inspection.internalState === "logged_in") {
      return toResult({ ok: true, inspection, flags, actionTaken: "already_logged_in" });
    }

    let currentBody = await bodyText(page);
    flags.googleAccountChooserVisible = pageLooksLikeGoogleAccountChooser(inspection, currentBody);

    if (inspection.internalState === "unknown" && !flags.googleAccountChooserVisible && page.goto) {
      await page.goto(UPWORK_HOME, { waitUntil: "domcontentloaded", timeout: 30000 });
      await waitBriefly(page);
      inspection = await inspectPage(page);
      if (inspection.blocked || inspection.manualAttentionRequired) return toBlockedResult(inspection, flags);
      currentBody = await bodyText(page);
      flags.googleAccountChooserVisible = pageLooksLikeGoogleAccountChooser(inspection, currentBody);
    }

    if ((inspection.internalState === "logged_out" || inspection.internalState === "unknown") && !flags.googleAccountChooserVisible) {
      await clickIfPresent(page, [
        "a:has-text('Log in')",
        "a:has-text('Sign in')",
        "button:has-text('Log in')",
        "button:has-text('Sign in')",
        "text=Log in",
        "text=Sign in",
      ], "normal Upwork sign-in");
      inspection = await inspectPage(page);
      if (inspection.blocked || inspection.manualAttentionRequired) return toBlockedResult(inspection, flags);
      currentBody = await bodyText(page);
      flags.googleAccountChooserVisible = pageLooksLikeGoogleAccountChooser(inspection, currentBody);
    }

    if (!flags.googleAccountChooserVisible) {
      await clickIfPresent(page, [
        "button:has-text('Continue with Google')",
        "a:has-text('Continue with Google')",
        "div[role='button']:has-text('Continue with Google')",
        "text=Continue with Google",
      ], "Continue with Google");
      inspection = await inspectPage(page);
      if (inspection.blocked || inspection.manualAttentionRequired) return toBlockedResult(inspection, flags);
      currentBody = await bodyText(page);
      flags.googleAccountChooserVisible = pageLooksLikeGoogleAccountChooser(inspection, currentBody);
    }

    const safeEmail = normalizeEmail(email);
    if (flags.googleAccountChooserVisible) {
      flags.matchingGoogleAccountVisible = textContainsExactEmail(currentBody, safeEmail);
      const matchingAccount = flags.matchingGoogleAccountVisible ? await findMatchingGoogleAccount(page, safeEmail) : null;
      if (matchingAccount) {
        await guardedClick(matchingAccount.locator, { selector: matchingAccount.selector, label: "Google account chooser matching account row" }, { timeout: 2500 });
        flags.googleAccountSelected = true;
        flags.emailSelectedOrEntered = true;
        await waitBriefly(page);
        inspection = await inspectPage(page);
        if (inspection.blocked || inspection.manualAttentionRequired) return toBlockedResult(inspection, flags);
        return toResult({ ok: true, inspection: inspection.internalState === "unknown" ? { ...inspection, internalState: "login_in_progress", sessionState: "login_in_progress" } : inspection, flags, actionTaken: "selected_google_account", nextExpectedStep: "manual_password_or_account_completion_if_prompted" });
      }
    }

    const emailFilled = await fillIfPresent(page, [
      "input[type='email']",
      "input[name='identifier']",
      "input[autocomplete='username']",
      "input[aria-label*='Email' i]",
      "input[aria-label*='Phone' i]",
    ], "safe Google email entry", email);
    if (emailFilled) {
      flags.emailEntered = true;
      flags.emailSelectedOrEntered = true;
      inspection = await inspectPage(page);
      if (inspection.blocked || inspection.manualAttentionRequired) return toBlockedResult(inspection, flags);
      return toResult({ ok: true, inspection: inspection.internalState === "unknown" ? { ...inspection, internalState: "login_in_progress", sessionState: "login_in_progress" } : inspection, flags, actionTaken: "entered_google_email", nextExpectedStep: "manual_password_or_account_completion_if_prompted" });
    }

    inspection = await inspectPage(page);
    if (inspection.blocked || inspection.manualAttentionRequired) return toBlockedResult(inspection, flags);
    return toResult({ ok: inspection.internalState === "login_in_progress", inspection, flags, actionTaken: flags.googleAccountChooserVisible ? "matching_google_account_not_visible" : "no_safe_login_control_found", nextExpectedStep: flags.googleAccountChooserVisible ? "manual_choose_google_account_or_use_another_account" : "manual_password_or_account_completion_if_prompted" });
  } catch (error) {
    if (error instanceof BrowserSafetyGuardBlockedError) {
      const inspection = await inspectPage(page);
      return {
        ok: false,
        tool: "login.start-google",
        sessionState: "manual_attention_required",
        internalState: inspection.internalState,
        manualAttentionReason: error.reason,
        manualAttentionCategory: error.category,
        ...flags,
        manualAttentionRequired: true,
        blocked: true,
        currentUrl: inspection.currentUrl,
        title: inspection.title,
        retryAllowedAfterManualFix: true,
        nextExpectedStep: "manual_password_passkey_2fa_security_or_verification_completion",
      };
    }
    throw error;
  }
}
