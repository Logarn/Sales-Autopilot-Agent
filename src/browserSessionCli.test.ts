import { strict as assert } from "node:assert";
import { runBrowserSessionClear } from "./browserSessionCli";
import { getChromeProfileProcessDiagnostics } from "./browserSessionControl";
import { BrowserSessionStatus } from "./browserSession";
import { BrowserSessionInspection } from "./browserSessionInspector";
import { BrowserAction } from "./types";

function session(overrides: Partial<BrowserSessionStatus> = {}): BrowserSessionStatus {
  return {
    state: "manual_attention_required",
    updatedAt: "2026-05-13T00:00:00.000Z",
    lastManualAttentionAt: "2026-05-13T00:00:00.000Z",
    lastManualAttention: {
      at: "2026-05-13T00:00:00.000Z",
      actionId: 9,
      jobId: "manual:upwork-9",
      url: "https://www.upwork.com/jobs/~9abcdefghi",
      title: "Challenge",
      reason: "captcha_or_security_challenge",
    },
    challengeEvents: [],
    blocked: true,
    alertCooldownRemainingMs: 0,
    retryCommand: "npm run browser:retry -- --id 9",
    reason: "captcha_or_security_challenge",
    ...overrides,
  };
}

function action(overrides: Partial<BrowserAction> = {}): BrowserAction {
  return {
    id: 9,
    jobId: "manual:upwork-9",
    actionType: "capture_job_from_url",
    status: "paused",
    payload: { url: "https://www.upwork.com/jobs/~9abcdefghi" },
    attempts: 1,
    lastError: "Detected state: captcha_or_security_challenge.",
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
  };
}

function visible(overrides: Partial<BrowserSessionInspection> = {}): BrowserSessionInspection {
  return {
    internalState: "logged_in",
    sessionState: "logged_in",
    manualAttentionRequired: false,
    blocked: false,
    currentUrl: "https://www.upwork.com/nx/find-work/best-matches/",
    title: "Best Matches - Upwork",
    summary: "Detected authenticated Upwork UI.",
    ...overrides,
  };
}

async function call(input: {
  id?: number | null;
  initialSession?: BrowserSessionStatus;
  action?: BrowserAction | null;
  visible?: BrowserSessionInspection;
}) {
  let currentSession = input.initialSession ?? session();
  let currentAction = input.action === undefined ? action() : input.action;
  let clearCalls = 0;
  const outcome = await runBrowserSessionClear(input.id === undefined ? 9 : input.id, {
    getSessionStatus: () => currentSession,
    getActionById: () => currentAction,
    inspectVisibleSession: async () => input.visible ?? visible(),
    clearManualAttention: () => {
      clearCalls += 1;
      currentSession = session({ state: "healthy", blocked: false, lastManualAttention: currentSession.lastManualAttention });
    },
  });
  return { ...outcome, clearCalls, currentAction };
}

async function runTests(): Promise<void> {
  let result = await call({ id: null });
  assert.equal(result.result.ok, false);
  assert.equal(result.result.reason, undefined);
  assert.equal(result.result.error, "Missing required --id value.");
  assert.equal(result.clearCalls, 0);

  result = await call({ initialSession: session({ state: "healthy", blocked: false }) });
  assert.equal(result.result.reason, "stored_session_is_not_blocked");
  assert.equal(result.clearCalls, 0);

  result = await call({ id: 10 });
  assert.equal(result.result.reason, "manual_attention_action_id_mismatch");
  assert.equal(result.clearCalls, 0);

  result = await call({ action: null });
  assert.equal(result.result.reason, "action_not_found");
  assert.equal(result.clearCalls, 0);

  result = await call({ action: action({ status: "pending" }) });
  assert.equal(result.result.reason, "action_is_not_paused");
  assert.equal(result.result.actionStatusUnchanged, "pending");
  assert.equal(result.clearCalls, 0);

  result = await call({ visible: visible({ internalState: "captcha_or_security_challenge", sessionState: "manual_attention_required", manualAttentionRequired: true, blocked: true, title: "Challenge - Upwork" }) });
  assert.equal(result.result.reason, "visible_browser_still_requires_manual_attention");
  assert.equal(result.result.visibleSessionState, "manual_attention_required");
  assert.equal(result.clearCalls, 0);

  result = await call({ visible: visible({ internalState: "unknown", sessionState: "unknown", currentUrl: "https://www.upwork.com/?__cf_chl_tk=abc", title: "Challenge" }) });
  assert.equal(result.result.reason, "visible_browser_still_requires_manual_attention", "unknown visible pages with restricted markers are refused");
  assert.equal(result.clearCalls, 0);

  const cleanUnknown = await call({ visible: visible({ internalState: "unknown", sessionState: "unknown", currentUrl: "https://www.upwork.com/nx/find-work/", title: "Upwork", summary: "Could not confidently classify the browser session." }) });
  assert.equal(cleanUnknown.result.ok, true);
  assert.equal(cleanUnknown.result.cleared, true);
  assert.equal(cleanUnknown.result.actionStatusUnchanged, "paused");
  assert.equal(cleanUnknown.clearCalls, 1);

  result = await call({});
  assert.equal(result.result.ok, true);
  assert.equal(result.result.tool, "browser.session.clear");
  assert.equal(result.result.cleared, true);
  assert.equal(result.result.actionId, 9);
  assert.equal(result.result.previousSessionState, "manual_attention_required");
  assert.equal(result.result.sessionState, "healthy");
  assert.equal(result.result.visibleSessionState, "logged_in");
  assert.equal(result.result.blocked, false);
  assert.equal(result.result.actionStatusUnchanged, "paused");
  assert.equal(result.currentAction?.status, "paused", "session clear must not mark the action pending");
  assert.equal(result.clearCalls, 1);

  const json = JSON.stringify(result.result);
  assert.ok(json.length < 1000, "session clear JSON should be compact");
  assert.doesNotMatch(json, /<html|<body|document\.querySelector|window\.TOP_NAV_USER_CONFIG/i);

  const profile = "/opt/upwork-agent/shared/browser-profile";
  const processDiagnostics = getChromeProfileProcessDiagnostics({
    userDataDir: profile,
    cdpUrl: "http://127.0.0.1:9222",
    processListText: [
      `101 /usr/bin/google-chrome --remote-debugging-port=9222 --user-data-dir=${profile}`,
      `202 /usr/bin/google-chrome --remote-debugging-port=9222 --user-data-dir=${profile}`,
      "303 /usr/bin/google-chrome --remote-debugging-port=9333 --user-data-dir=/tmp/other",
    ].join("\n"),
  });
  assert.equal(processDiagnostics.chromeProcessCount, 2);
  assert.deepEqual(processDiagnostics.chromePids, [101, 202]);
  assert.equal(processDiagnostics.duplicateProfileConflict, true);

  console.log("browser session CLI tests passed");
}

void runTests();
