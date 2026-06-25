import { strict as assert } from "node:assert";
import { assertNoChallengeInteraction, assertSafeUpworkNavigationUrl, classifySensitiveTarget, classifyUpworkNavigationUrl, guardedClick, guardedFill, guardedGoto } from "./browserSafetyGuard";

async function runTests(): Promise<void> {
  const blocked = [
    { selector: "iframe[src*='captcha']", label: "captcha" },
    { label: "I'm not a robot" },
    { selector: "input[type='password']", label: "Password" },
    { label: "Use your passkey" },
    { selector: "input[name='verification_code']" },
    { label: "Cloudflare security check" },
    { text: "Suspicious login unusual activity verify it's you" },
  ];
  for (const target of blocked) {
    assert.equal(classifySensitiveTarget(target).blocked, true, `should block ${JSON.stringify(target)}`);
    assert.throws(() => assertNoChallengeInteraction(target));
  }

  const allowed = [
    { selector: "a:has-text('Log in')", label: "normal Upwork sign-in" },
    { selector: "button:has-text('Continue with Google')", label: "Continue with Google" },
    { selector: "input[type='email']", label: "safe Google email field" },
    { selector: "text=user@example.com", label: "user@example.com" },
    { selector: "button:has-text('Apply now')", label: "Apply now" },
  ];
  for (const target of allowed) {
    assert.equal(classifySensitiveTarget(target).blocked, false, `should allow ${JSON.stringify(target)}`);
    assert.doesNotThrow(() => assertNoChallengeInteraction(target));
  }

  let clicked = false;
  await guardedClick({ click: async () => { clicked = true; } }, { label: "Continue with Google" });
  assert.equal(clicked, true, "allowed click should execute");

  let filled = false;
  await guardedFill({ fill: async () => { filled = true; } }, { selector: "input[type='email']" }, "user@example.com");
  assert.equal(filled, true, "allowed fill should execute");

  let unsafeClicked = false;
  await assert.rejects(() => guardedClick({ click: async () => { unsafeClicked = true; } }, { label: "I'm not a robot" }));
  assert.equal(unsafeClicked, false, "blocked click should not execute");

  for (const label of ["Send for 14 Connects", "Send proposal", "Submit proposal"]) {
    let finalSubmitClicked = false;
    await assert.rejects(() => guardedClick({ click: async () => { finalSubmitClicked = true; } }, { label }));
    assert.equal(finalSubmitClicked, false, `${label} should be blocked as final submit`);
  }

  const allowedNavigationUrls = [
    "https://www.upwork.com/nx/find-work/best-matches",
    "https://www.upwork.com/nx/search/jobs/?q=klaviyo",
    "https://www.upwork.com/jobs/Email-Marketing_~022053866890130225260/",
    "https://www.upwork.com/nx/find-work/best-matches/details/~022053866890130225260?pageTitle=Job%20Details",
    "https://www.upwork.com/ab/proposals/job/~022053795172113889247/apply/",
    "https://www.upwork.com/nx/proposals/job/~022053795172113889247/apply/",
  ];
  for (const url of allowedNavigationUrls) {
    assert.equal(classifyUpworkNavigationUrl(url).allowed, true, `should allow navigation to ${url}`);
    assert.doesNotThrow(() => assertSafeUpworkNavigationUrl(url));
  }

  const blockedNavigationUrls = [
    { url: "https://www.upwork.com/ab/account-security/login", reason: "sensitive_upwork_url" },
    { url: "https://www.upwork.com/nx/payments/billing-methods", reason: "sensitive_upwork_url" },
    { url: "https://www.upwork.com/ab/contracts/~022053866890130225260", reason: "sensitive_upwork_url" },
    { url: "https://www.upwork.com/freelancers/settings/profile", reason: "sensitive_upwork_url" },
    { url: "http://www.upwork.com/jobs/~022053866890130225260", reason: "non_https_upwork_url" },
    { url: "https://evil.example/jobs/~022053866890130225260", reason: "non_upwork_url" },
  ];
  for (const { url, reason } of blockedNavigationUrls) {
    const classification = classifyUpworkNavigationUrl(url);
    assert.equal(classification.allowed, false, `should block navigation to ${url}`);
    assert.equal(classification.reason, reason, `blocked reason for ${url}`);
    assert.throws(() => assertSafeUpworkNavigationUrl(url));
  }

  let navigatedTo = "";
  await guardedGoto({ goto: async (url) => { navigatedTo = url; } }, allowedNavigationUrls[0]);
  assert.equal(navigatedTo, allowedNavigationUrls[0], "allowed navigation should execute");

  await assert.rejects(() => guardedGoto({ goto: async (url) => { navigatedTo = url; } }, blockedNavigationUrls[0].url));
  assert.equal(navigatedTo, allowedNavigationUrls[0], "blocked navigation should not execute");

  console.log("browser safety guard tests passed");
}

void runTests();
