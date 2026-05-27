import { strict as assert } from "node:assert";
import { startGoogleLoginOnPage } from "./upworkLoginDriver";

type LocatorDef = { selector: string; count: number; text?: string; onClick?: () => void; onFill?: (value: string) => void };

class FakeLocator {
  constructor(private def: LocatorDef) {}
  first(): FakeLocator { return this; }
  async count(): Promise<number> { return this.def.count; }
  async textContent(): Promise<string | null> { return this.def.text ?? null; }
  async click(): Promise<void> { this.def.onClick?.(); }
  async fill(value: string): Promise<void> { this.def.onFill?.(value); }
}

class FakePage {
  currentUrl: string;
  currentTitle: string;
  body: string;
  locators: LocatorDef[];
  clicked: string[] = [];
  filled: Array<{ selector: string; value: string }> = [];

  constructor(input: { url: string; title: string; body: string; locators?: LocatorDef[] }) {
    this.currentUrl = input.url;
    this.currentTitle = input.title;
    this.body = input.body;
    this.locators = input.locators ?? [];
  }

  url(): string { return this.currentUrl; }
  async title(): Promise<string> { return this.currentTitle; }
  locator(selector: string): FakeLocator {
    if (selector === "body") return new FakeLocator({ selector, count: 1, text: this.body });
    const found = this.locators.find((item) => item.selector === selector);
    if (!found) return new FakeLocator({ selector, count: 0 });
    return new FakeLocator({
      ...found,
      onClick: () => { this.clicked.push(selector); found.onClick?.(); },
      onFill: (value) => { this.filled.push({ selector, value }); found.onFill?.(value); },
    });
  }
  async goto(url: string): Promise<void> { this.currentUrl = url; this.currentTitle = "Upwork"; this.body = "Log in Continue with Google"; }
  async waitForTimeout(): Promise<void> {}
}

async function runTests(): Promise<void> {
  const loggedIn = new FakePage({ url: "https://www.upwork.com/nx/find-work/best-matches", title: "Best Matches", body: "Find work Best Matches My Jobs Messages Profile" });
  const loggedInResult = await startGoogleLoginOnPage(loggedIn as any, "user@example.com");
  assert.equal(loggedInResult.ok, true);
  assert.equal(loggedInResult.actionTaken, "already_logged_in");

  const loggedInFeed = new FakePage({
    url: "https://www.upwork.com/nx/find-work/best-matches",
    title: "Upwork",
    body: "Jobs you might like Best Matches Most Recent Klaviyo Email Marketing Specialist Payment verified Proposals: Less than 5 Hourly Posted 2 hours ago",
  });
  const loggedInFeedResult = await startGoogleLoginOnPage(loggedInFeed as any, "user@example.com");
  assert.equal(loggedInFeedResult.ok, true);
  assert.equal(loggedInFeedResult.sessionState, "logged_in");
  assert.equal(loggedInFeedResult.actionTaken, "already_logged_in");

  const loggedOut = new FakePage({
    url: "https://www.upwork.com/ab/account-security/login",
    title: "Log In - Upwork",
    body: "Log in Continue with Google",
    locators: [
      { selector: "a:has-text('Log in')", count: 1 },
      { selector: "button:has-text('Continue with Google')", count: 1, onClick: () => { loggedOut.currentUrl = "https://accounts.google.com/signin/v2/identifier"; loggedOut.currentTitle = "Sign in - Google Accounts"; loggedOut.body = "Email or phone"; } },
      { selector: "input[type='email']", count: 1 },
    ],
  });
  const loggedOutResult = await startGoogleLoginOnPage(loggedOut as any, "user@example.com");
  assert.equal(loggedOutResult.ok, true);
  assert.equal(loggedOutResult.emailSelectedOrEntered, true);
  assert.equal(loggedOut.filled.some((item) => item.value === "user@example.com"), true);

  const chooser = new FakePage({
    url: "https://accounts.google.com/signin/chooser",
    title: "Choose an account",
    body: "Choose an account Steve Logarn user@example.com Use another account",
    locators: [
      { selector: "text=user@example.com", count: 1, text: "Steve Logarn\nuser@example.com" },
      { selector: "text=Use another account", count: 1 },
    ],
  });
  const chooserResult = await startGoogleLoginOnPage(chooser as any, "user@example.com");
  assert.equal(chooserResult.ok, true);
  assert.equal(chooserResult.emailSelectedOrEntered, true);
  assert.equal(chooserResult.googleAccountChooserVisible, true);
  assert.equal(chooserResult.matchingGoogleAccountVisible, true);
  assert.equal(chooserResult.googleAccountSelected, true);
  assert.equal(chooserResult.emailEntered, false);
  assert.equal(chooser.clicked.includes("text=user@example.com"), true);
  assert.equal(chooser.clicked.includes("text=Use another account"), false);

  const multipleChooser = new FakePage({
    url: "https://accounts.google.com/signin/chooser",
    title: "Choose an account",
    body: "Choose an account wrong@example.com user@example.com Use another account",
    locators: [
      { selector: "text=wrong@example.com", count: 1, text: "Wrong Account\nwrong@example.com" },
      { selector: "text=user@example.com", count: 1, text: "Steve Logarn\nuser@example.com" },
      { selector: "text=Use another account", count: 1 },
    ],
  });
  const multipleChooserResult = await startGoogleLoginOnPage(multipleChooser as any, "user@example.com");
  assert.equal(multipleChooserResult.googleAccountSelected, true);
  assert.equal(multipleChooser.clicked.includes("text=user@example.com"), true);
  assert.equal(multipleChooser.clicked.includes("text=wrong@example.com"), false);
  assert.equal(multipleChooser.clicked.includes("text=Use another account"), false);

  const chooserNoMatchWithEmailField = new FakePage({
    url: "https://accounts.google.com/signin/chooser",
    title: "Choose an account",
    body: "Choose an account someone@example.com Use another account Email or phone",
    locators: [
      { selector: "text=Use another account", count: 1 },
      { selector: "input[type='email']", count: 1 },
    ],
  });
  const chooserNoMatchResult = await startGoogleLoginOnPage(chooserNoMatchWithEmailField as any, "user@example.com");
  assert.equal(chooserNoMatchResult.googleAccountChooserVisible, true);
  assert.equal(chooserNoMatchResult.matchingGoogleAccountVisible, false);
  assert.equal(chooserNoMatchResult.googleAccountSelected, false);
  assert.equal(chooserNoMatchResult.emailEntered, true);
  assert.equal(chooserNoMatchWithEmailField.clicked.includes("text=Use another account"), false);
  assert.equal(chooserNoMatchWithEmailField.filled.some((item) => item.value === "user@example.com"), true);

  const passwordAfterChooser = new FakePage({
    url: "https://accounts.google.com/signin/chooser",
    title: "Choose an account",
    body: "Choose an account user@example.com",
    locators: [{ selector: "text=user@example.com", count: 1, text: "Steve Logarn\nuser@example.com", onClick: () => { passwordAfterChooser.currentUrl = "https://accounts.google.com/signin/challenge/pwd"; passwordAfterChooser.currentTitle = "Welcome"; passwordAfterChooser.body = "Enter your password"; } }],
  });
  const passwordAfterChooserResult = await startGoogleLoginOnPage(passwordAfterChooser as any, "user@example.com");
  assert.equal(passwordAfterChooserResult.ok, false);
  assert.equal(passwordAfterChooserResult.sessionState, "manual_attention_required");
  assert.equal(passwordAfterChooserResult.manualAttentionReason, "password_required");
  assert.equal(passwordAfterChooserResult.googleAccountSelected, true);

  const twoFactorAfterChooser = new FakePage({
    url: "https://accounts.google.com/signin/chooser",
    title: "Choose an account",
    body: "Choose an account user@example.com",
    locators: [{ selector: "text=user@example.com", count: 1, text: "Steve Logarn\nuser@example.com", onClick: () => { twoFactorAfterChooser.currentUrl = "https://accounts.google.com/signin/challenge/selection"; twoFactorAfterChooser.currentTitle = "2-Step Verification"; twoFactorAfterChooser.body = "2-Step Verification Use your passkey or enter the code"; } }],
  });
  const twoFactorAfterChooserResult = await startGoogleLoginOnPage(twoFactorAfterChooser as any, "user@example.com");
  assert.equal(twoFactorAfterChooserResult.ok, false);
  assert.equal(twoFactorAfterChooserResult.sessionState, "manual_attention_required");
  assert.equal(twoFactorAfterChooserResult.manualAttentionCategory, "auth_sensitive");
  assert.equal(twoFactorAfterChooserResult.googleAccountSelected, true);

  const emailEntry = new FakePage({
    url: "https://accounts.google.com/signin/v2/identifier",
    title: "Sign in - Google Accounts",
    body: "Email or phone",
    locators: [{ selector: "input[type='email']", count: 1 }],
  });
  const emailResult = await startGoogleLoginOnPage(emailEntry as any, "user@example.com");
  assert.equal(emailResult.ok, true);
  assert.equal(emailResult.emailSelectedOrEntered, true);

  const passwordAfterEmail = new FakePage({
    url: "https://accounts.google.com/signin/v2/identifier",
    title: "Sign in - Google Accounts",
    body: "Email or phone",
    locators: [{ selector: "input[type='email']", count: 1, onFill: () => { passwordAfterEmail.currentUrl = "https://accounts.google.com/signin/challenge/pwd"; passwordAfterEmail.currentTitle = "Welcome"; passwordAfterEmail.body = "Enter your password"; } }],
  });
  const passwordResult = await startGoogleLoginOnPage(passwordAfterEmail as any, "user@example.com");
  assert.equal(passwordResult.ok, false);
  assert.equal(passwordResult.sessionState, "manual_attention_required");
  assert.equal(passwordResult.manualAttentionReason, "password_required");
  assert.equal(passwordResult.emailSelectedOrEntered, true);

  const challenge = new FakePage({ url: "https://www.upwork.com/?__cf_chl_tk=abc", title: "Challenge - Upwork", body: "Cloudflare CAPTCHA security check" });
  const challengeResult = await startGoogleLoginOnPage(challenge as any, "user@example.com");
  assert.equal(challengeResult.ok, false);
  assert.equal(challengeResult.manualAttentionReason, "captcha_or_security_challenge");

  console.log("upwork login driver tests passed");
}

void runTests();
