import { strict as assert } from "node:assert";
import { classifyBrowserSessionSnapshot } from "./browserSessionInspector";

function inspect(url: string, title: string, text: string, sessionStatus?: any) {
  return classifyBrowserSessionSnapshot({ currentUrl: url, title, textExcerpt: text }, sessionStatus ?? { state: "healthy", blocked: false });
}

function assertState(actual: string, expected: string): void {
  assert.equal(actual, expected, `expected ${expected}, got ${actual}`);
}

async function runTests(): Promise<void> {
  assertState(inspect("https://www.upwork.com/nx/find-work/best-matches", "Best Matches - Upwork", "Find work Best Matches My Jobs Messages Profile").internalState, "logged_in");
  assertState(inspect("https://www.upwork.com/ab/account-security/login", "Log In - Upwork", "Log in Continue with Google Sign in").internalState, "logged_out");
  assertState(inspect("https://www.upwork.com/", "Upwork | Hire Top Freelance Talent with Confidence", "Find talent Post a job Log in Sign up").internalState, "logged_out");
  assertState(inspect("https://accounts.google.com/signin/v2/identifier", "Sign in - Google Accounts", "Email or phone Use another account").internalState, "login_in_progress");
  assertState(inspect("https://accounts.google.com/signin/chooser", "Choose an account", "user@example.com Use another account").internalState, "login_in_progress");

  const password = inspect("https://accounts.google.com/signin/challenge/pwd", "Welcome", "Enter your password");
  assertState(password.internalState, "password_required");
  assertState(password.sessionState, "manual_attention_required");

  const passkey = inspect("https://accounts.google.com/signin/challenge/pk", "Use your passkey", "Touch your security key");
  assertState(passkey.internalState, "passkey_required");
  assertState(passkey.sessionState, "manual_attention_required");

  const twoFactor = inspect("https://accounts.google.com/signin/challenge/ootp", "2-Step Verification", "Enter the verification code");
  assertState(twoFactor.internalState, "two_factor_required");
  assertState(twoFactor.sessionState, "manual_attention_required");

  const challenge = inspect("https://www.upwork.com/?__cf_chl_tk=abc", "Challenge - Upwork", "Checking if the site connection is secure Cloudflare CAPTCHA");
  assertState(challenge.internalState, "captcha_or_security_challenge");
  assertState(challenge.sessionState, "manual_attention_required");

  const jobShapedChallenge = inspect("https://www.upwork.com/jobs/~022053711714121332703?__cf_chl_rt_tk=abc", "Challenge", "Checking your browser");
  assertState(jobShapedChallenge.internalState, "captcha_or_security_challenge");
  assertState(jobShapedChallenge.sessionState, "manual_attention_required");

  const suspicious = inspect("https://accounts.google.com/signin/challenge", "Verify it's you", "Suspicious login unusual activity");
  assertState(suspicious.internalState, "suspicious_login_check");
  assertState(suspicious.sessionState, "manual_attention_required");

  const blockedSession = inspect("https://www.upwork.com", "Upwork", "Find work", { state: "manual_attention_required", blocked: true, reason: "captcha_or_security_challenge" });
  assertState(blockedSession.internalState, "manual_attention_required");

  const staleBlockedButUsableFeed = classifyBrowserSessionSnapshot({
    currentUrl: "https://www.upwork.com/nx/find-work/best-matches",
    title: "Upwork",
    textExcerpt: "Jobs you might like Best Matches Klaviyo Email Marketing Specialist Payment verified Proposals: Less than 5 Hourly Posted 2 hours ago",
    jobLinkCount: 215,
  }, { state: "manual_attention_required", blocked: true, reason: "captcha_or_security_challenge" });
  assertState(staleBlockedButUsableFeed.internalState, "logged_in");
  assert.equal(staleBlockedButUsableFeed.blocked, false);
  assert.equal(staleBlockedButUsableFeed.manualAttentionRequired, false);

  const staleBlockedButUsableFeedWithoutReliableLinkCount = classifyBrowserSessionSnapshot({
    currentUrl: "https://www.upwork.com/nx/find-work/best-matches",
    title: "Upwork",
    textExcerpt: "Jobs you might like Best Matches Most Recent Klaviyo Email Marketing Specialist Payment verified Proposals: Less than 5 Hourly Posted 2 hours ago",
    jobLinkCount: 0,
  }, { state: "manual_attention_required", blocked: true, reason: "captcha_or_security_challenge" });
  assertState(staleBlockedButUsableFeedWithoutReliableLinkCount.internalState, "logged_in");
  assert.equal(staleBlockedButUsableFeedWithoutReliableLinkCount.blocked, false);

  const unhealthy = inspect("https://www.upwork.com", "Upwork", "Find work", { state: "browser_session_unhealthy", blocked: true, reason: "too many challenges" });
  assertState(unhealthy.internalState, "browser_session_unhealthy");

  console.log("browser session inspector tests passed");
}

void runTests();
