import { strict as assert } from "node:assert";
import { classifyBrowserSessionSnapshot } from "./browserSessionInspector";
import { buildBrowserSessionLaunchCommand } from "./browserSessionControl";

function compactJsonString(value: unknown): string {
  return JSON.stringify(value);
}

async function runTests(): Promise<void> {
  const loggedIn = classifyBrowserSessionSnapshot({
    currentUrl: "https://www.upwork.com/nx/find-work/best-matches",
    title: "Best Matches - Upwork",
    textExcerpt: "Find work Best Matches My Jobs Messages Profile",
    jobLinkCount: 12,
  }, { state: "healthy", blocked: false });
  const sessionCheck = {
    ok: !loggedIn.blocked,
    tool: "session.check",
    sessionState: loggedIn.sessionState,
    manualAttentionRequired: loggedIn.manualAttentionRequired,
    blocked: loggedIn.blocked,
    currentUrl: loggedIn.currentUrl,
    title: loggedIn.title,
  };
  assert.equal(sessionCheck.ok, true);
  assert.equal(sessionCheck.sessionState, "logged_in");
  const json = compactJsonString(sessionCheck);
  assert.doesNotMatch(json, /<html|<body|document\.querySelector|window\.TOP_NAV_USER_CONFIG/i);
  assert.ok(json.length < 1000, "session.check JSON should be compact");

  const launchCommand = buildBrowserSessionLaunchCommand({
    chromeExecutablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    userDataDir: "./data/browser-profile",
    cdpUrl: "http://127.0.0.1:9222",
  });
  assert.equal(launchCommand.args[launchCommand.args.length - 1], "https://www.upwork.com/nx/find-work/best-matches/", "browser session should bootstrap to Best Matches by default");
  assert.ok(launchCommand.args.some((arg) => arg.includes("--user-data-dir=")), "browser session should use the dedicated agent profile");

  const publicHome = classifyBrowserSessionSnapshot({
    currentUrl: "https://www.upwork.com/",
    title: "Upwork | Hire Top Freelance Talent with Confidence",
    textExcerpt: "Find talent Post a job Log in Sign up",
  }, { state: "healthy", blocked: false });
  assert.equal(publicHome.internalState, "logged_out");
  assert.equal(publicHome.blocked, false);

  const blocked = classifyBrowserSessionSnapshot({
    currentUrl: "https://www.upwork.com/?__cf_chl_tk=abc",
    title: "Challenge - Upwork",
    textExcerpt: "Cloudflare CAPTCHA security check",
  }, { state: "healthy", blocked: false });
  const blockedJson = {
    ok: !blocked.blocked,
    tool: "session.check",
    sessionState: blocked.sessionState,
    manualAttentionReason: blocked.manualAttentionReason,
    manualAttentionCategory: blocked.manualAttentionCategory,
    manualAttentionRequired: blocked.manualAttentionRequired,
    blocked: blocked.blocked,
    currentUrl: blocked.currentUrl,
    title: blocked.title,
    retryAllowedAfterManualFix: blocked.retryAllowedAfterManualFix,
  };
  assert.equal(blockedJson.ok, false);
  assert.equal(blockedJson.sessionState, "manual_attention_required");
  assert.equal(blockedJson.manualAttentionReason, "captcha_or_security_challenge");
  assert.ok(compactJsonString(blockedJson).length < 1000, "blocked JSON should be compact");

  const staleBlockedButUsableFeed = classifyBrowserSessionSnapshot({
    currentUrl: "https://www.upwork.com/nx/find-work/best-matches/",
    title: "Upwork",
    textExcerpt: "Jobs you might like Best Matches Most Recent Klaviyo retention strategist Shopify lifecycle marketer",
    jobLinkCount: 217,
  }, { state: "manual_attention_required", blocked: true, reason: "captcha_or_security_challenge" });
  assert.equal(staleBlockedButUsableFeed.blocked, false, "usable find-work feed should override stale stored manual-attention state");
  assert.equal(staleBlockedButUsableFeed.sessionState, "logged_in");
  assert.equal(staleBlockedButUsableFeed.matchedText, "upwork_usable_feed");

  const blockedFeedChallenge = classifyBrowserSessionSnapshot({
    currentUrl: "https://www.upwork.com/nx/find-work/best-matches/",
    title: "Upwork",
    textExcerpt: "Jobs you might like Best Matches Verify you are human Checking your browser",
    jobLinkCount: 217,
  }, { state: "manual_attention_required", blocked: true, reason: "captcha_or_security_challenge" });
  assert.equal(blockedFeedChallenge.blocked, true, "challenge markers on the feed should still block the session");
  assert.equal(blockedFeedChallenge.manualAttentionReason, "captcha_or_security_challenge");

  const loginStart = {
    ok: true,
    tool: "login.start-google",
    sessionState: "login_in_progress",
    emailSelectedOrEntered: true,
    manualAttentionRequired: false,
    blocked: false,
    currentUrl: "https://accounts.google.com/signin/v2/identifier",
    title: "Sign in - Google Accounts",
    nextExpectedStep: "manual_password_or_account_completion_if_prompted",
  };
  assert.equal(loginStart.tool, "login.start-google");
  assert.ok(compactJsonString(loginStart).length < 1000, "login JSON should be compact");

  console.log("browser tool CLI output tests passed");
}

void runTests();
