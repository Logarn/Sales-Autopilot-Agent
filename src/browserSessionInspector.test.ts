import { strict as assert } from "node:assert";
import { buildBrowserTabDiagnostics, buildSessionPageSnapshot, classifyBrowserSessionSnapshot, selectRelevantBrowserPage } from "./browserSessionInspector";

function inspect(url: string, title: string, text: string, sessionStatus?: any) {
  return classifyBrowserSessionSnapshot({ currentUrl: url, title, textExcerpt: text }, sessionStatus ?? { state: "healthy", blocked: false });
}

function assertState(actual: string, expected: string): void {
  assert.equal(actual, expected, `expected ${expected}, got ${actual}`);
}

class FakeLocator {
  constructor(
    private readonly countValue = 0,
    private readonly textValue: string | null = null,
  ) {}

  async count(): Promise<number> {
    return this.countValue;
  }

  first(): FakeLocator {
    return this;
  }

  async textContent(): Promise<string | null> {
    return this.textValue;
  }
}

class FakePage {
  public waitCalls = 0;

  constructor(
    private readonly currentUrl: string,
    private readonly pageTitle: string,
    private readonly bodyText: string,
    private readonly linkCount: number,
    private readonly evaluatedBodyText: string,
    private readonly evaluatedLinkCount: number,
  ) {}

  url(): string {
    return this.currentUrl;
  }

  async title(): Promise<string> {
    return this.pageTitle;
  }

  locator(selector: string): FakeLocator {
    if (selector === "body") {
      return new FakeLocator(1, this.bodyText);
    }
    return new FakeLocator(this.linkCount, null);
  }

  async waitForTimeout(): Promise<void> {
    this.waitCalls += 1;
  }

  async evaluate<R>(fn: () => R): Promise<R> {
    const documentStub = {
      body: { innerText: this.evaluatedBodyText },
      querySelectorAll: (selector: string) => {
        if (selector === "a[href]") {
          return Array.from({ length: this.evaluatedLinkCount }, () => ({
            getAttribute: () => "/jobs/~12345678901234567890",
          }));
        }
        if (selector === "[data-test='job-tile-title-link']") {
          return Array.from({ length: this.evaluatedLinkCount }, () => ({}));
        }
        return [];
      },
    };
    const previousDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = documentStub;
    try {
      return fn();
    } finally {
      (globalThis as { document?: unknown }).document = previousDocument;
    }
  }
}

class UrlOnlyPage {
  constructor(private readonly currentUrl: string) {}

  url(): string {
    return this.currentUrl;
  }

  async title(): Promise<string> {
    return "Upwork";
  }

  locator(): FakeLocator {
    return new FakeLocator();
  }
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
  assert.equal(staleBlockedButUsableFeed.matchedText, "upwork_usable_feed");

  const staleBlockedButUsableFeedWithoutReliableLinkCount = classifyBrowserSessionSnapshot({
    currentUrl: "https://www.upwork.com/nx/find-work/best-matches",
    title: "Upwork",
    textExcerpt: "Jobs you might like Best Matches Most Recent Klaviyo Email Marketing Specialist Payment verified Proposals: Less than 5 Hourly Posted 2 hours ago",
    jobLinkCount: 0,
  }, { state: "manual_attention_required", blocked: true, reason: "captcha_or_security_challenge" });
  assertState(staleBlockedButUsableFeedWithoutReliableLinkCount.internalState, "logged_in");
  assert.equal(staleBlockedButUsableFeedWithoutReliableLinkCount.blocked, false);

  const bareFindWorkBestMatchesFeed = classifyBrowserSessionSnapshot({
    currentUrl: "https://www.upwork.com/nx/find-work/",
    title: "Best Matches - Upwork",
    textExcerpt: "Klaviyo Email Marketing Specialist Payment verified Proposals: Less than 5 Hourly Posted 2 hours ago",
    jobLinkCount: 0,
  }, { state: "manual_attention_required", blocked: true, reason: "captcha_or_security_challenge" });
  assertState(bareFindWorkBestMatchesFeed.internalState, "logged_in");
  assert.equal(bareFindWorkBestMatchesFeed.blocked, false);
  assert.equal(bareFindWorkBestMatchesFeed.manualAttentionRequired, false);

  const fallbackSnapshot = await buildSessionPageSnapshot(new FakePage(
    "https://www.upwork.com/nx/find-work/best-matches",
    "Upwork",
    "Find work",
    0,
    "Jobs you might like Best Matches Most Recent Klaviyo retention strategist Payment verified Proposals: 10 to 15 Hourly Posted 3 hours ago",
    215,
  ));
  assert.equal(fallbackSnapshot.jobLinkCount, 215);
  assert.equal(fallbackSnapshot.feedSignalCount, 3);
  assert.equal(fallbackSnapshot.hasLikelyJobCardText, true);
  const fallbackInspection = classifyBrowserSessionSnapshot(
    fallbackSnapshot,
    { state: "manual_attention_required", blocked: true, reason: "captcha_or_security_challenge" },
  );
  assertState(fallbackInspection.internalState, "logged_in");
  assert.equal(fallbackInspection.blocked, false);
  assert.equal(fallbackInspection.matchedText, "upwork_usable_feed");

  const hiddenChallengeSnapshot = await buildSessionPageSnapshot(new FakePage(
    "https://www.upwork.com/nx/find-work/",
    "Best Matches - Upwork",
    "Checking your browser Cloudflare CAPTCHA Log in Sign up Jobs you might like Best Matches Payment verified Proposals: Less than 5",
    0,
    "Klaviyo retention strategist Payment verified Proposals: 10 to 15 Hourly Posted 3 hours ago",
    0,
  ));
  assert.doesNotMatch(hiddenChallengeSnapshot.textExcerpt, /Cloudflare|CAPTCHA|Log in/i);
  const hiddenChallengeInspection = classifyBrowserSessionSnapshot(
    hiddenChallengeSnapshot,
    { state: "manual_attention_required", blocked: true, reason: "captcha_or_security_challenge" },
  );
  assertState(hiddenChallengeInspection.internalState, "logged_in");
  assert.equal(hiddenChallengeInspection.blocked, false);

  const unhealthy = inspect("https://www.upwork.com", "Upwork", "Find work", { state: "browser_session_unhealthy", blocked: true, reason: "too many challenges" });
  assertState(unhealthy.internalState, "browser_session_unhealthy");

  const feed = new UrlOnlyPage("https://www.upwork.com/nx/find-work/best-matches/");
  const work = new UrlOnlyPage("https://www.upwork.com/jobs/~022054111111111111111");
  const newerWork = new UrlOnlyPage("https://www.upwork.com/ab/proposals/job/~022054222222222222222/apply/");
  const ignoredUpworkTab = new UrlOnlyPage("https://www.upwork.com/freelancers/~0123456789abcdef");
  const selected = selectRelevantBrowserPage([work, newerWork, feed]);
  assert.equal(selected.page, feed, "session check should prefer the stable feed tab over the most recent work tab");
  assert.match(selected.reason, /feed\/search/);

  const tabDiagnostics = buildBrowserTabDiagnostics([feed, work, newerWork, ignoredUpworkTab]);
  assert.equal(tabDiagnostics.openUpworkTabCount, 4);
  assert.equal(tabDiagnostics.selectedFeedTabUrl, feed.url());
  assert.equal(tabDiagnostics.selectedWorkTabUrl, work.url());
  assert.equal(tabDiagnostics.staleWorkTabCount, 1);
  assert.equal(tabDiagnostics.ignoredTabCount, 1);

  console.log("browser session inspector tests passed");
}

void runTests();
