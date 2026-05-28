import { strict as assert } from "node:assert";
import { assertNoChallengeInteraction, classifySensitiveTarget, guardedClick, guardedFill } from "./browserSafetyGuard";

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

  console.log("browser safety guard tests passed");
}

void runTests();
