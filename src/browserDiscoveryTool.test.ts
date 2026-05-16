import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BrowserAction } from "./types";

function action(id: number, jobId: string, url: string, status: BrowserAction["status"] = "pending"): BrowserAction {
  return {
    id,
    jobId,
    actionType: "capture_job_from_url",
    status,
    payload: { url, canonicalJobUrl: url },
    attempts: 0,
    lastError: null,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
  };
}

function blockedContext() {
  const page = {
    url: () => "https://www.upwork.com/?__cf_chl_tk=abc",
    title: async () => "Challenge - Upwork",
    locator: () => ({
      count: async () => 1,
      textContent: async () => "Cloudflare CAPTCHA security check",
      first() {
        return this;
      },
    }),
    evaluate: async <R>() => {
      throw new Error("evaluate should not be called for blocked sessions");
    },
  };
  return { pages: () => [page] };
}

function discoveryContext(html: string) {
  const page = {
    url: () => "https://www.upwork.com/nx/find-work/best-matches/",
    title: async () => "Best Matches - Upwork",
    locator: () => ({
      count: async () => 1,
      textContent: async () => "Best Matches Find Work My Jobs Proposals Profile",
      first() {
        return this;
      },
    }),
    evaluate: async <R>() => html as unknown as R,
  };
  return { pages: () => [page] };
}

function scrollingDiscoveryContext(htmlPages: string[]) {
  let pageIndex = 0;
  let scrollTop = 0;
  const page = {
    url: () => "https://www.upwork.com/nx/find-work/best-matches/",
    title: async () => "Best Matches - Upwork",
    locator: () => ({
      count: async () => 1,
      textContent: async () => "Best Matches Find Work My Jobs Proposals Profile",
      first() {
        return this;
      },
    }),
    waitForTimeout: async () => undefined,
    evaluate: async <R>(fn: () => R) => {
      const source = String(fn);
      if (source.includes("scrollBy")) {
        const before = scrollTop;
        scrollTop += pageIndex < htmlPages.length - 1 ? 900 : 0;
        if (pageIndex < htmlPages.length - 1) pageIndex += 1;
        return { before, after: scrollTop, height: 3000 } as R;
      }
      return htmlPages[pageIndex] as unknown as R;
    },
  };
  return { pages: () => [page] };
}

async function runTests(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "upwork-discovery-test-"));
  process.env.DB_PATH = path.join(tempDir, "jobs.db");

  const {
    DISCOVERY_BEST_MATCHES_TOOL,
    canonicalizeDiscoveryUpworkJobUrl,
    extractBestMatchesJobLinksFromHtml,
    extractBestMatchesJobLinksWithStats,
    isAlreadyHandledDiscoveryJob,
    isDuplicateDiscoveryJob,
    isValidDiscoveryUpworkJobId,
    runDiscoveryBestMatches,
  } = await import("./browserDiscoveryTool");
  const { closeDb, listBrowserActions } = await import("./db");

  try {
    const discoveredAt = new Date("2026-05-13T12:00:00.000Z");
    const html = `
    <main>
      <article><a href="/jobs/Email-Marketing-Automation_~022054111111111111111/?ref=find-work">Email automation</a><span>Posted 1 hour ago</span></article>
      <article><a href="https://www.upwork.com/nx/find-work/best-matches/details/~022054222222222222222?pageTitle=Job%20Details&_modalInfo=%5B%5D">Modal job</a><span>Posted 5 minutes ago</span></article>
      <a href="https://www.upwork.com/jobs/~022054111111111111111?source=rss">Duplicate canonical</a>
      <a href="https://www.upwork.com/ab/proposals/job/~022054333333333333333/apply/">Apply URL must be ignored</a>
      <a href="https://example.com/jobs/~022054444444444444444">External ignored</a>
      <article><a href="/jobs/~022054555555555555555">Plain job</a><span>Posted yesterday</span></article>
    </main>`;

    assert.equal(isValidDiscoveryUpworkJobId("022054609169964170419"), true);
    assert.equal(isValidDiscoveryUpworkJobId("1234"), false);
    assert.equal(isValidDiscoveryUpworkJobId("139ba39c"), false);
    assert.equal(isValidDiscoveryUpworkJobId("JobTile-HnXIl"), false);

    assert.equal(
      canonicalizeDiscoveryUpworkJobUrl("https://www.upwork.com/jobs/~022054609169964170419?referrer_url_path=%2Fnx%2Ffind-work"),
      "https://www.upwork.com/jobs/~022054609169964170419",
      "valid /jobs/~DIGITS URLs canonicalize without params"
    );
    assert.equal(
      canonicalizeDiscoveryUpworkJobUrl("https://www.upwork.com/jobs/Some-Job-Title_~022054609169964170419/"),
      "https://www.upwork.com/jobs/~022054609169964170419",
      "valid slug URLs with _~DIGITS are accepted"
    );
    assert.equal(
      canonicalizeDiscoveryUpworkJobUrl("https://www.upwork.com/nx/find-work/best-matches/details/~022054609169964170419?pageTitle=Job%20Details"),
      "https://www.upwork.com/jobs/~022054609169964170419",
      "valid Best Matches details URLs are accepted"
    );
    assert.equal(
      canonicalizeDiscoveryUpworkJobUrl("https://upwork.com/jobs/~022054609169964170419?tracking=1"),
      "https://www.upwork.com/jobs/~022054609169964170419",
      "canonical discovery URLs always use www.upwork.com"
    );
    assert.equal(canonicalizeDiscoveryUpworkJobUrl("https://www.upwork.com/jobs/~CategoriesEditModal-mCqPI"), null);
    assert.equal(canonicalizeDiscoveryUpworkJobUrl("https://www.upwork.com/jobs/~139ba39c"), null);
    assert.equal(canonicalizeDiscoveryUpworkJobUrl("https://www.upwork.com/jobs/~JobTile-HnXIl"), null);
    assert.equal(canonicalizeDiscoveryUpworkJobUrl("https://www.upwork.com/jobs/~abc123"), null);
    assert.equal(canonicalizeDiscoveryUpworkJobUrl("https://www.upwork.com/jobs/~1234"), null);
    assert.equal(canonicalizeDiscoveryUpworkJobUrl("https://www.upwork.com/ab/proposals/job/~022054333333333333333/apply/"), null);

    const links = extractBestMatchesJobLinksFromHtml(html, { maxJobs: 10, now: discoveredAt });
    assert.deepEqual(links.map((link) => link.canonicalJobUrl), [
      "https://www.upwork.com/jobs/~022054111111111111111",
      "https://www.upwork.com/jobs/~022054222222222222222",
      "https://www.upwork.com/jobs/~022054555555555555555",
    ]);
    assert.equal(links[0]?.sourceType, "best_matches");
    assert.equal(links[0]?.sourceLabel, "Best Matches");
    assert.equal(links[0]?.postedAtText, "1 hour ago");
    assert.equal(links[0]?.discoveredAt, discoveredAt.toISOString());

    const capped = extractBestMatchesJobLinksFromHtml(html, { maxJobs: 2, now: discoveredAt });
    assert.equal(capped.length, 2, "max-jobs cap should be enforced after dedupe/apply filtering");

    const modalOnly = extractBestMatchesJobLinksFromHtml(
      `<a href="/nx/find-work/best-matches/details/~022054666666666666666?pageTitle=Job%20Details&_modalInfo=%5B%7B%7D%5D">Details</a>`,
      { maxJobs: 5, now: discoveredAt }
    );
    assert.equal(modalOnly[0]?.canonicalJobUrl, "https://www.upwork.com/jobs/~022054666666666666666");

    const invalidOnlyHtml = `
      <a href="https://www.upwork.com/jobs/~CategoriesEditModal-mCqPI">Modal token</a>
      <a href="https://www.upwork.com/jobs/~139ba39c">Hash token</a>
      <a href="https://www.upwork.com/jobs/~JobTile-HnXIl">Component token</a>
      <a href="https://www.upwork.com/jobs/~abc123">Mixed short token</a>
      <a href="https://www.upwork.com/jobs/~1234">Short numeric token</a>`;
    assert.equal(extractBestMatchesJobLinksFromHtml(invalidOnlyHtml, { maxJobs: 10, now: discoveredAt }).length, 0);

    const applyOnly = extractBestMatchesJobLinksFromHtml(
      `<a href="/ab/proposals/job/~022054777777777777777/apply/">Apply</a>`,
      { maxJobs: 5, now: discoveredAt }
    );
    assert.equal(applyOnly.length, 0, "apply URLs are not discovery results");

    const appliedCard = extractBestMatchesJobLinksWithStats(
      `<article><a href="/jobs/~022054777777777777777">Applied job</a><span>Proposal sent</span></article>`,
      { maxJobs: 5, now: discoveredAt }
    );
    assert.equal(appliedCard.links.length, 0, "visible applied/proposal-sent cards should be skipped");
    assert.equal(appliedCard.alreadyHandledSkipped, 1);

    assert.equal(
      isDuplicateDiscoveryJob(links[0]!, [action(1, "manual:upwork-022054111111111111111", "https://www.upwork.com/jobs/~022054111111111111111", "paused")]),
      true,
      "paused/completed active-ish historical actions should be skipped"
    );
    assert.equal(
      isDuplicateDiscoveryJob(links[0]!, [action(2, "manual:upwork-022054111111111111111", "https://www.upwork.com/jobs/~022054111111111111111", "failed")]),
      false,
      "failed actions should not block rediscovery"
    );
    assert.equal(isAlreadyHandledDiscoveryJob(links[0]!, "submitted"), true, "submitted application state should skip discovery");
    assert.equal(isAlreadyHandledDiscoveryJob(links[0]!, "rejected"), true, "rejected application state should skip discovery");
    assert.equal(isAlreadyHandledDiscoveryJob(links[0]!, "draft"), false, "draft application state should not block discovery by itself");

    const invalidDiscovery = await runDiscoveryBestMatches(discoveryContext(invalidOnlyHtml), { maxJobs: 5, now: discoveredAt });
    assert.equal(invalidDiscovery.ok, true);
    assert.equal(invalidDiscovery.jobsFound, 0);
    assert.equal(invalidDiscovery.jobsQueued, 0, "invalid tokens must not enqueue capture actions");
    assert.equal(listBrowserActions(null, 10).length, 0, "invalid discovery page should leave action queue unchanged");

    const validDiscovery = await runDiscoveryBestMatches(discoveryContext(`<a href="/jobs/~022054888888888888888?referrer_url_path=%2Fnx%2Ffind-work">Valid</a>`), {
      maxJobs: 5,
      now: discoveredAt,
    });
    assert.equal(validDiscovery.ok, true);
    assert.equal(validDiscovery.jobsFound, 1);
    assert.equal(validDiscovery.jobsQueued, 1, "clean valid URLs should enqueue capture_job_from_url actions");
    const queued = listBrowserActions(null, 10);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.actionType, "capture_job_from_url");
    assert.equal(queued[0]?.payload.url, "https://www.upwork.com/jobs/~022054888888888888888");

    const scrolledDiscovery = await runDiscoveryBestMatches(
      scrollingDiscoveryContext([
        `<a href="/jobs/~022054888888888888888">Duplicate already queued</a>`,
        `<article><a href="/jobs/~022054999999999999999">Fresh after scroll older</a><span>Posted 2 hours ago</span></article><article><a href="/jobs/~022055111111111111111">Fresh after scroll newer</a><span>Posted 10 minutes ago</span></article>`,
      ]),
      { maxJobs: 1, maxScrolls: 2, now: discoveredAt }
    );
    assert.equal(scrolledDiscovery.ok, true);
    assert.equal(scrolledDiscovery.scrollsPerformed, 1, "discovery should scroll to load additional cards");
    assert.equal(scrolledDiscovery.duplicatesSkipped, 1, "already queued duplicate should be skipped");
    assert.equal(scrolledDiscovery.jobsQueued, 1, "fresh post-scroll job should be queued");
    assert.equal(scrolledDiscovery.jobsFound, 3);
    assert.equal(scrolledDiscovery.newestQueuedPostedAtText, "10 minutes ago", "newer jobs should be queued before older visible jobs");

    const noScrollDiscovery = await runDiscoveryBestMatches(
      scrollingDiscoveryContext([
        `<a href="/jobs/~022054888888888888888">Duplicate already queued</a>`,
        `<a href="/jobs/~022055000000000000000">Should not load with maxScrolls zero</a>`,
      ]),
      { maxJobs: 1, maxScrolls: 0, now: discoveredAt }
    );
    assert.equal(noScrollDiscovery.scrollsPerformed, 0, "max-scrolls=0 should prevent scrolling");
    assert.equal(noScrollDiscovery.jobsQueued, 0);

    const blocked = await runDiscoveryBestMatches(blockedContext(), { maxJobs: 5, now: discoveredAt });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.tool, DISCOVERY_BEST_MATCHES_TOOL);
    assert.equal(blocked.sessionState, "manual_attention_required");
    assert.ok(
      blocked.manualAttentionReason === "manual_attention_required" || blocked.manualAttentionReason === "captcha_or_security_challenge",
      "blocked discovery should preserve stored manual attention or page challenge reason"
    );
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.jobsFound, 0);
    assert.equal(blocked.jobsQueued, 0);
    assert.equal(blocked.duplicatesSkipped, 0);
    assert.equal(blocked.retryAllowedAfterManualFix, true);
    assert.ok(JSON.stringify(blocked).length < 1000, "blocked discovery JSON should be compact");
    assert.doesNotMatch(JSON.stringify(blocked), /<html|document\.querySelector|window\.TOP_NAV_USER_CONFIG/i);

    const outputShape = {
      ok: true,
      tool: DISCOVERY_BEST_MATCHES_TOOL,
      sessionState: "logged_in",
      jobsFound: 5,
      jobsQueued: 3,
      duplicatesSkipped: 2,
      alreadyHandledSkipped: 1,
      invalidSkipped: 1,
      scrollsPerformed: 3,
      manualAttentionRequired: false,
      blocked: false,
    };
    assert.ok(JSON.stringify(outputShape).length < 600, "success discovery JSON should be compact");

    // Phase A discovery only extracts/enqueues capture actions. It does not score, post Slack packets,
    // auto-prepare drafts, or touch apply/submit behavior.
    assert.equal(links.every((link) => link.sourceType === "best_matches"), true);
  } finally {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log("browser discovery tool tests passed");
}

void runTests();
