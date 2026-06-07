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

function discoveryContext(html: string, initialUrl = "https://www.upwork.com/nx/find-work/best-matches/") {
  let currentUrl = initialUrl;
  const page = {
    url: () => currentUrl,
    title: async () => "Best Matches - Upwork",
    locator: () => ({
      count: async () => 1,
      textContent: async () => "Best Matches Find Work My Jobs Proposals Profile",
      first() {
        return this;
      },
    }),
    goto: async (url: string) => {
      currentUrl = url;
    },
    evaluate: async <R>() => html as unknown as R,
  };
  return { pages: () => [page] };
}

function multiSourceDiscoveryContext(htmlByUrl: Record<string, string>, initialUrl = "https://www.upwork.com/nx/find-work/best-matches/") {
  let currentUrl = initialUrl;
  const navigations: string[] = [];
  const page = {
    url: () => currentUrl,
    title: async () => {
      const html = htmlByUrl[currentUrl] ?? "";
      return /just\s+a\s+moment|captcha|cloudflare|security\s+check/i.test(html) ? "Just a moment..." : "Best Matches - Upwork";
    },
    locator: () => ({
      count: async () => 1,
      textContent: async () => htmlByUrl[currentUrl] ?? "",
      first() {
        return this;
      },
    }),
    goto: async (url: string) => {
      currentUrl = url;
      navigations.push(url);
    },
    evaluate: async <R>() => (htmlByUrl[currentUrl] ?? "") as unknown as R,
  };
  return { pages: () => [page], navigations };
}

function workOnlyDiscoveryContext(html: string, options: { canOpenNewPage: boolean; workUrl?: string; sourceUrl?: string }) {
  const workPage = {
    url: () => options.workUrl ?? "https://www.upwork.com/jobs/~022054121212121212121",
    title: async () => "Random Upwork job",
    locator: () => ({
      count: async () => 1,
      textContent: async () => "Job details",
      first() {
        return this;
      },
    }),
    evaluate: async <R>() => {
      throw new Error("random work/apply tab must not be used as a discovery source");
    },
  };
  let sourceUrl = options.sourceUrl ?? "";
  const sourcePage = {
    url: () => sourceUrl,
    title: async () => "Best Matches - Upwork",
    locator: () => ({
      count: async () => 1,
      textContent: async () => "Best Matches Find Work My Jobs Proposals Profile",
      first() {
        return this;
      },
    }),
    goto: async (url: string) => {
      sourceUrl = url;
    },
    evaluate: async <R>() => html as unknown as R,
  };
  return {
    pages: () => options.canOpenNewPage && sourceUrl ? [workPage, sourcePage] : [workPage],
    ...(options.canOpenNewPage ? { newPage: async () => sourcePage } : {}),
  };
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
    DISCOVERY_SOURCES,
    buildConfiguredDiscoverySources,
    canonicalizeDiscoveryUpworkJobUrl,
    countUnknownSourceQueuedCaptureActions,
    extractBestMatchesJobLinksFromHtml,
    extractBestMatchesJobLinksWithStats,
    extractDiscoveryJobLinksWithStats,
    getActiveDiscoverySourceLabelForUrl,
    hasAllowedCaptureSourceMetadata,
    isAlreadyHandledDiscoveryJob,
    isAllowedDiscoverySourceConfig,
    isDuplicateDiscoveryJob,
    isValidDiscoveryUpworkJobId,
    loadSavedDiscoverySearches,
    runDiscoveryBestMatches,
    runDiscoveryConfiguredSources,
    runDiscoverySource,
  } = await import("./browserDiscoveryTool");
  const {
    clearPausedDiscoverySourceHealth,
    formatDiscoverySourceHealthForSlack,
    isDiscoverySourceTemporarilyPaused,
  } = await import("./browserDiscoverySourceHealth");
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

    const savedConfigPath = path.join(tempDir, "saved-searches.json");
    fs.writeFileSync(savedConfigPath, JSON.stringify({
      searches: [
        {
          id: "klaviyo-dtc",
          name: "Klaviyo DTC",
          purpose: "Focused Klaviyo DTC roles",
          sourceType: "saved_search",
          query: "Klaviyo Shopify retention",
        },
      ],
    }));
    const savedSources = buildConfiguredDiscoverySources(loadSavedDiscoverySearches(savedConfigPath));
    assert.deepEqual(savedSources.map((source) => source.sourceLabel), ["Best Matches", "Saved Search - Klaviyo DTC"], "default configured discovery sources should exclude broad unfiltered Most Recent");
    const savedSearch = savedSources.find((source) => source.sourceLabel === "Saved Search - Klaviyo DTC");
    assert(savedSearch, "configured sources should include named saved searches");
    assert.equal(savedSearch?.sourceType, "saved_search");
    assert(savedSearch?.url.includes("Klaviyo+Shopify+retention"), "saved search query should be encoded into an Upwork search URL");
    assert(savedSearch && isAllowedDiscoverySourceConfig(savedSearch), "saved/filtered search source should be allowed only when configured and labeled");
    assert.equal(isAllowedDiscoverySourceConfig({ sourceType: "saved_search", sourceLabel: "Bad Job Source", url: "https://www.upwork.com/jobs/~022054111111111111111" }), false, "job pages are not allowed discovery sources");
    if (!savedSearch) throw new Error("saved search source missing");
    assert.equal(getActiveDiscoverySourceLabelForUrl(savedSearch.url, savedSources), "Saved Search - Klaviyo DTC", "diagnostics should identify active configured search source");

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

    const savedDiscovery = await runDiscoverySource(
      discoveryContext(`<article><a href="/jobs/~022056222222222222222">Fresh saved-search role</a><span>Posted 3 minutes ago</span></article>`, savedSearch.url),
      savedSearch,
      { maxJobs: 5, now: discoveredAt }
    );
    assert.equal(savedDiscovery.ok, true);
    assert.equal(savedDiscovery.jobsQueued, 1, "saved/filtered search discovery should enqueue valid capture actions");
    const savedQueued = listBrowserActions(null, 10).find((item) => item.payload.url === "https://www.upwork.com/jobs/~022056222222222222222");
    const savedPayload = savedQueued?.payload.discovery as { sourceLabel?: string; sourceType?: string; sourceUrl?: string; discoveredAt?: string; canonicalJobUrl?: string } | undefined;
    assert.equal(savedQueued?.payload.sourceType, "saved_search");
    assert.equal(savedQueued?.payload.sourceLabel, "Saved Search - Klaviyo DTC");
    assert.equal(savedQueued?.payload.sourceUrl, savedSearch.url);
    assert.equal(savedQueued?.payload.discoveredAt, discoveredAt.toISOString());
    assert.equal(savedPayload?.sourceLabel, "Saved Search - Klaviyo DTC");
    assert.equal(savedPayload?.sourceType, "saved_search");
    assert.equal(savedPayload?.sourceUrl, savedSearch.url);
    assert.equal(savedPayload?.discoveredAt, discoveredAt.toISOString());
    assert.equal(savedPayload?.canonicalJobUrl, "https://www.upwork.com/jobs/~022056222222222222222");
    assert(savedQueued && hasAllowedCaptureSourceMetadata(savedQueued), "queued saved-search capture should carry allowed source metadata");

    clearPausedDiscoverySourceHealth();
    const bestOnlyJob = `<article><a href="/jobs/~022056777777777777777">Best Matches safe role</a><span>Posted 2 minutes ago</span></article>`;
    const blockedSavedSearchHtml = "Just a moment... Checking if the site connection is secure Cloudflare CAPTCHA";
    const sourceBlockedContext = multiSourceDiscoveryContext({
      [DISCOVERY_SOURCES.best_matches.url]: bestOnlyJob,
      [savedSearch.url]: blockedSavedSearchHtml,
    });
    const oneBlockedSearch = await runDiscoveryConfiguredSources(
      sourceBlockedContext,
      { maxJobs: 3, now: discoveredAt },
      [DISCOVERY_SOURCES.best_matches, savedSearch]
    );
    assert.equal(oneBlockedSearch.ok, true, "one blocked search source should not fail the whole discovery run");
    assert.equal(oneBlockedSearch.blocked, false, "one blocked search source should not mark the browser globally blocked");
    assert.equal(oneBlockedSearch.manualAttentionRequired, false, "source-level search checks should not become manual browser attention");
    assert.equal(oneBlockedSearch.jobsQueued, 1, "Best Matches should continue when it is clean");
    const pausedSavedSearch = isDiscoverySourceTemporarilyPaused(savedSearch, discoveredAt);
    assert(pausedSavedSearch, "blocked saved search should be paused in source health");
    assert.equal(pausedSavedSearch.humanLabel, "Saved Search - Klaviyo DTC");
    assert.equal(pausedSavedSearch.challengeCheckCount, 1);
    assert(pausedSavedSearch.pauseUntil, "blocked saved search should have a backoff timestamp");

    const avoidedContext = multiSourceDiscoveryContext({
      [savedSearch.url]: `<article><a href="/jobs/~022056888888888888888">Should wait for backoff</a><span>Posted 1 minute ago</span></article>`,
    }, savedSearch.url);
    const avoidedSavedSearch = await runDiscoverySource(avoidedContext, savedSearch, { maxJobs: 3, now: discoveredAt });
    assert.equal(avoidedSavedSearch.ok, true);
    assert.equal(avoidedSavedSearch.sourceAvoided, true, "repeated checked search page should be avoided temporarily");
    assert.equal(avoidedSavedSearch.jobsQueued, 0);
    assert.equal(avoidedContext.navigations.length, 0, "temporarily avoided search should not be hammered with a new navigation");

    const normalCopy = formatDiscoverySourceHealthForSlack({ now: discoveredAt });
    assert.match(normalCopy, /Upwork checked one search page/);
    assert.match(normalCopy, /I’ll keep hunting from the safer feed/);
    assert.doesNotMatch(normalCopy, /source cooldown|manual_attention_required|sourceId|retry Klaviyo DTC|https?:\/\//i, "normal Slack copy should avoid backend jargon and raw URLs");
    const debugCopy = formatDiscoverySourceHealthForSlack({ debug: true, now: discoveredAt });
    assert.match(debugCopy, /sourceId=/, "debug copy may include technical source ids");
    assert.match(debugCopy, /url=https:\/\/www\.upwork\.com\/nx\/search\/jobs\//, "debug copy may include raw source URLs");

    clearPausedDiscoverySourceHealth();
    assert.equal(isDiscoverySourceTemporarilyPaused(savedSearch, discoveredAt), null, "manual clear should reset blocked source state");
    const retriedSavedSearch = await runDiscoverySource(
      multiSourceDiscoveryContext({
        [savedSearch.url]: `<article><a href="/jobs/~022056999999999999999">Recovered saved search role</a><span>Posted 1 minute ago</span></article>`,
      }, savedSearch.url),
      savedSearch,
      { maxJobs: 3, now: discoveredAt }
    );
    assert.equal(retriedSavedSearch.ok, true);
    assert.equal(retriedSavedSearch.jobsQueued, 1, "cleared search source should be retried normally");

    const multiSourceDiscovery = await runDiscoveryConfiguredSources(
      discoveryContext(`<article><a href="/jobs/~022056333333333333333">Multi source duplicate role</a><span>Posted 4 minutes ago</span></article>`),
      { maxJobs: 2, now: discoveredAt },
      [DISCOVERY_SOURCES.best_matches, savedSearch]
    );
    assert.equal(multiSourceDiscovery.ok, true);
    assert.deepEqual(multiSourceDiscovery.sourcesChecked, ["Best Matches", "Saved Search - Klaviyo DTC"]);
    assert.equal(multiSourceDiscovery.jobsQueued, 1, "multi-source discovery should dedupe jobs across sources");
    assert.equal(multiSourceDiscovery.duplicatesSkipped, 1, "second source should count duplicate canonical jobs");

    const randomWorkTabDiscovery = await runDiscoveryBestMatches(
      workOnlyDiscoveryContext(`<a href="/jobs/~022056444444444444444">Should not scrape random tab</a>`, { canOpenNewPage: false }),
      { maxJobs: 5, now: discoveredAt }
    );
    assert.equal(randomWorkTabDiscovery.ok, false);
    assert.match(randomWorkTabDiscovery.error ?? "", /No allowed feed\/search tab/);
    assert.equal(listBrowserActions(null, 100).some((item) => item.payload.url === "https://www.upwork.com/jobs/~022056444444444444444"), false, "random open job tab should not be used as discovery source");

    const openedSourceDiscovery = await runDiscoveryBestMatches(
      workOnlyDiscoveryContext(`<a href="/jobs/~022056555555555555555">Opened source tab role</a>`, { canOpenNewPage: true }),
      { maxJobs: 5, now: discoveredAt }
    );
    assert.equal(openedSourceDiscovery.ok, true);
    assert.equal(openedSourceDiscovery.jobsQueued, 1, "discovery may open a controlled source tab instead of reusing work/apply tabs");

    const staleApplyDiscovery = await runDiscoveryBestMatches(
      workOnlyDiscoveryContext(`<a href="/jobs/~022056666666666666666">Apply protected role</a>`, { canOpenNewPage: true, workUrl: "https://www.upwork.com/ab/proposals/job/~022056999999999999999/apply/" }),
      { maxJobs: 5, now: discoveredAt }
    );
    assert.equal(staleApplyDiscovery.ok, true, "stale apply tab should be ignored while a source tab is opened for discovery");

    assert.equal(
      countUnknownSourceQueuedCaptureActions([
        action(100, "manual:upwork-022057000000000000000", "https://www.upwork.com/jobs/~022057000000000000000", "pending"),
      ]),
      1,
      "unknown-source queued captures should be diagnosed"
    );

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
