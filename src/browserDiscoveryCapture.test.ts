import { strict as assert } from "node:assert";
import { extractUpworkSourceContextJobContent } from "./browserCapture";
import { getDiscoverySourceMetadata, isCaptureBlockedState, isCaptureManualAttentionState, isDirectUpworkJobPage, isDiscoveryBestMatchesCaptureAction, isDiscoverySourceContextPage, shouldFallbackToDirectJobCaptureFromSourceContext, shouldUseDirectFallbackForCaptureAction, tryCaptureDiscoverySourceContext } from "./browserWorker";
import { buildDeterministicOpportunityPacket, normalizedPacketToJobPosting } from "./normalization";
import type { BrowserAction } from "./types";

const targetJobId = "022054851116146838271";
const canonicalJobUrl = `https://www.upwork.com/jobs/~${targetJobId}`;

function action(overrides: Partial<BrowserAction> = {}): BrowserAction {
  return {
    id: 15,
    jobId: `manual:upwork-${targetJobId}`,
    actionType: "capture_job_from_url",
    status: "pending",
    payload: {
      source: "discovery.best_matches",
      url: canonicalJobUrl,
      originalUrl: `https://www.upwork.com/nx/find-work/best-matches/details/~${targetJobId}?modal=1`,
      canonicalJobUrl,
      discovery: {
        sourceType: "best_matches",
        sourceLabel: "Best Matches",
        discoveredAt: "2026-05-14T00:00:00.000Z",
        canonicalJobUrl,
      },
    },
    attempts: 0,
    lastError: null,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    ...overrides,
  };
}

function page(input: { url: string; title?: string; html: string; text?: string }) {
  const text = input.text ?? input.html.replace(/<[^>]+>/g, " ");
  return {
    goto: async () => {
      throw new Error("direct navigation should not be used for source-context capture");
    },
    url: () => input.url,
    title: async () => input.title ?? "Upwork",
    locator: () => ({
      count: async () => 1,
      textContent: async () => text,
      fill: async () => undefined,
      setInputFiles: async () => undefined,
      check: async () => undefined,
      first() {
        return this;
      },
    }),
    evaluate: async <R>(fn?: () => R) => {
      const source = fn?.toString() ?? "";
      if (source.includes("innerText")) return text as unknown as R;
      return input.html as unknown as R;
    },
  };
}

function sourceCaptureResult(
  extracted: NonNullable<ReturnType<typeof extractUpworkSourceContextJobContent>>,
  overrides: Partial<Awaited<ReturnType<typeof tryCaptureDiscoverySourceContext>>> = {},
): NonNullable<Awaited<ReturnType<typeof tryCaptureDiscoverySourceContext>>> {
  return {
    state: "captured",
    snapshot: {
      url: canonicalJobUrl,
      title: "Upwork",
      textExcerpt: extracted.description.slice(0, 120),
    },
    bodyText: extracted.description,
    extracted,
    detection: {
      state: "captured",
      source: "body_text",
      matchedText: targetJobId,
      summary: "Test source-context capture.",
    },
    sourcePageUrl: "https://www.upwork.com/nx/find-work/best-matches",
    matchedTarget: true,
    readable: true,
    ...overrides,
  };
}

async function runTests(): Promise<void> {
  const readableHtml = `
    <main>
      <article data-test="job-tile">
        <a href="/jobs/Email-Marketing-Automation_~${targetJobId}/"><h2>Email Marketing Automation Specialist for Klaviyo Flows</h2></a>
        <section data-test="job-description-text">
          We need an experienced Klaviyo and Shopify automation specialist to audit existing flows, rebuild abandoned cart,
          welcome, browse abandonment, post-purchase, and winback sequences, then report revenue impact and deliver clear QA notes.
          The right freelancer should understand ecommerce segmentation, deliverability basics, offer testing, and lifecycle email strategy.
        </section>
        <div>Hourly: $35.00 - $65.00</div>
        <div>Skills: Klaviyo, Shopify, Email Marketing, Marketing Automation</div>
      </article>
    </main>`;

  const extracted = extractUpworkSourceContextJobContent({
    html: readableHtml,
    pageUrl: "https://www.upwork.com/nx/find-work/best-matches",
    pageTitle: "Best Matches - Upwork",
    targetJobId,
    canonicalJobUrl,
  });
  assert.ok(extracted, "readable Best Matches source context should extract");
  assert.equal(extracted.diagnostics.lowConfidence, false);
  assert.equal(extracted.title, "Email Marketing Automation Specialist for Klaviyo Flows");
  assert.equal(extracted.diagnostics.titleSource, "card_heading");
  assert.match(extracted.rawText, new RegExp(canonicalJobUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(extracted.rawText, /Klaviyo|Shopify|automation/i);

  const discoveryAction = action();
  assert.equal(
    shouldFallbackToDirectJobCaptureFromSourceContext(discoveryAction, sourceCaptureResult(extracted)),
    true,
    "metadata-thin Best Matches source context should fall through to direct job capture for client-quality enrichment",
  );

  const noisyThinExtracted = extractUpworkSourceContextJobContent({
    html: `
      <main>
        <div>Find jobs you're interested in. Narrow down your results by rate, location, client history, and more.</div>
        <article data-test="job-tile">
          <a href="/jobs/Klaviyo-Retention-Lead_~${targetJobId}/"><h2>Klaviyo Retention Lead for DTC Supplement Brand</h2></a>
          <section data-test="job-description-text">
            We need a senior Klaviyo operator to own lifecycle campaigns, flows, segmentation, and reporting for a scaling ecommerce account.
          </section>
          <div>Hourly: $55.00 - $85.00</div>
        </article>
      </main>`,
    pageUrl: "https://www.upwork.com/nx/find-work/best-matches",
    pageTitle: "Best Matches - Upwork",
    targetJobId,
    canonicalJobUrl,
  });
  assert.ok(noisyThinExtracted, "feed chrome plus readable target card should still extract");
  const noisyThinPreview = normalizedPacketToJobPosting(buildDeterministicOpportunityPacket(noisyThinExtracted.rawText, {
    url: canonicalJobUrl,
    source: "deterministic",
    capturedAt: new Date(),
  }));
  assert.match(noisyThinPreview.clientCountry, /client history, and more/i, "feed chrome can currently look like a country");
  assert.equal(
    shouldFallbackToDirectJobCaptureFromSourceContext(discoveryAction, sourceCaptureResult(noisyThinExtracted)),
    true,
    "source context with only location-shaped feed chrome must still fall through to direct job capture",
  );

  const richClientExtracted = extractUpworkSourceContextJobContent({
    html: `
      <main>
        <article data-test="job-tile">
          <a href="/jobs/Retention-Lead_~${targetJobId}/"><h2>Retention Lead for Klaviyo Lifecycle Flows</h2></a>
          <section data-test="job-description-text">
            We need a senior lifecycle operator for Klaviyo email and SMS flows, campaign planning, reporting, and segmentation for a scaling DTC brand.
          </section>
          <div>4.9 of 5 stars</div>
          <div>24 reviews</div>
          <div>$12K+ total spent</div>
          <div>14 hires</div>
          <div>86% hire rate</div>
          <div>United States</div>
        </article>
      </main>`,
    pageUrl: "https://www.upwork.com/nx/find-work/best-matches",
    pageTitle: "Best Matches - Upwork",
    targetJobId,
    canonicalJobUrl,
  });
  assert.ok(richClientExtracted, "rich client history text should still extract from source context");
  assert.equal(
    shouldFallbackToDirectJobCaptureFromSourceContext(discoveryAction, sourceCaptureResult(richClientExtracted)),
    false,
    "source context with usable client signals should stay on the source-context path",
  );

  const wrongId = extractUpworkSourceContextJobContent({
    html: readableHtml,
    pageUrl: "https://www.upwork.com/nx/find-work/best-matches",
    pageTitle: "Best Matches - Upwork",
    targetJobId: "022054664830593225996",
    canonicalJobUrl: "https://www.upwork.com/jobs/~022054664830593225996",
  });
  assert.equal(wrongId, null, "source context must reject wrong target job IDs");

  const shortId = extractUpworkSourceContextJobContent({
    html: `<a href="/jobs/~1234">Bad</a><p>Readable text that should not matter because ID is short and invalid.</p>`,
    pageUrl: "https://www.upwork.com/nx/find-work/best-matches",
    pageTitle: "Best Matches - Upwork",
    targetJobId: "1234",
    canonicalJobUrl: "https://www.upwork.com/jobs/~1234",
  });
  assert.equal(shortId, null, "source context must reject invalid short numeric job IDs");

  const multiCard = extractUpworkSourceContextJobContent({
    html: `
      <main>
        <article><a href="/jobs/Other_~022054664830593225996/"><h2>Wrong Lifecycle Job</h2></a><p>Other card content</p></article>
        <article>
          <h2>Jobs you might like</h2>
          <a href="/jobs/Target_~${targetJobId}/"><h2>Klaviyo Email Marketing Specialist Needed for Peptide eCommerce Brand</h2></a>
          <p>We need a Klaviyo specialist for ecommerce flows, campaigns, segmentation, and retention strategy for a peptide supplement brand.</p>
        </article>
      </main>`,
    pageUrl: "https://www.upwork.com/nx/find-work/best-matches",
    pageTitle: "Upwork",
    targetJobId,
    canonicalJobUrl,
  });
  assert.ok(multiCard, "matching target card should extract when multiple cards exist");
  assert.equal(multiCard.title, "Klaviyo Email Marketing Specialist Needed for Peptide eCommerce Brand");
  assert.equal(multiCard.diagnostics.rejectedGenericTitle, false);

  const genericBeforeTarget = extractUpworkSourceContextJobContent({
    html: `<main><h1>Jobs you might like</h1><a href="/jobs/~${targetJobId}">Lifecycle Retention Lead for Shopify Brand</a><p>Need help with Klaviyo automation, retention campaigns, Shopify segmentation, repeat purchase, and lifecycle reporting for a growing ecommerce brand.</p></main>`,
    pageUrl: "https://www.upwork.com/nx/find-work/best-matches",
    pageTitle: "Upwork",
    targetJobId,
    canonicalJobUrl,
  });
  assert.ok(genericBeforeTarget, "generic page heading before target should not become title");
  assert.equal(genericBeforeTarget.title, "Lifecycle Retention Lead for Shopify Brand");
  assert.equal(genericBeforeTarget.diagnostics.titleSource, "card_heading");

  const restricted = extractUpworkSourceContextJobContent({ 
    html: `<html><title>Just a moment...</title><body>Checking if the site connection is secure <a href="/jobs/~${targetJobId}">job</a></body></html>`,
    text: "Checking if the site connection is secure",
    pageUrl: "https://www.upwork.com/nx/find-work/best-matches",
    pageTitle: "Just a moment...",
    targetJobId,
    canonicalJobUrl,
  });
  assert.ok(restricted, "restricted pages may identify target but must be low confidence");
  assert.equal(restricted.diagnostics.lowConfidence, true);
  assert.match(restricted.diagnostics.reasons.join(" "), /restricted|manual|missing|short/i);

  assert.equal(isDiscoveryBestMatchesCaptureAction(discoveryAction), true);
  assert.deepEqual(getDiscoverySourceMetadata(discoveryAction), { sourceType: "best_matches", sourceLabel: "Best Matches", canonicalJobUrl });
  assert.equal(shouldUseDirectFallbackForCaptureAction(discoveryAction), false, "discovery-origin captures must not direct-fallback by default");
  const manualCapture = action({ payload: { url: canonicalJobUrl, canonicalJobUrl }, jobId: `manual:upwork-${targetJobId}` });
  assert.equal(isDiscoveryBestMatchesCaptureAction(manualCapture), false, "manual/non-discovery captures keep existing direct behavior");
  assert.equal(shouldUseDirectFallbackForCaptureAction(manualCapture), true, "manual Slack URL captures may still use direct capture behavior");
  assert.equal(isCaptureBlockedState("source_context_unavailable" as never), true, "source_context_unavailable should suppress scoring/packet/auto-prepare");
  assert.equal(isCaptureManualAttentionState("source_context_unavailable" as never), false, "source_context_unavailable should fail one capture without marking global browser manual attention");
  assert.equal(isCaptureManualAttentionState("captcha_or_security_challenge" as never), true, "true security challenges should still require manual attention");
  assert.equal(isDirectUpworkJobPage(canonicalJobUrl), true, "canonical /jobs/~id URL is a direct job page");
  assert.equal(isDirectUpworkJobPage(`https://www.upwork.com/jobs/Email-Marketing_~${targetJobId}/`), true, "slug_~id URL is a direct job page");
  assert.equal(isDiscoverySourceContextPage(`https://www.upwork.com/nx/find-work/best-matches/details/~${targetJobId}?modal=1`), true, "Best Matches details/modal URL is a source context page");
  assert.equal(isDiscoverySourceContextPage(canonicalJobUrl), false, "canonical direct job URL is not a source context page");

  const sourceCapture = await tryCaptureDiscoverySourceContext(
    { pages: () => [page({ url: canonicalJobUrl, html: `<title>Just a moment...</title>Checking if the site connection is secure` }), page({ url: "https://www.upwork.com/nx/find-work/best-matches", html: readableHtml })] },
    discoveryAction,
    canonicalJobUrl
  );
  assert.ok(sourceCapture, "discovery-origin capture should prefer readable source context over an existing direct job page");
  assert.equal(sourceCapture.state, "captured");
  assert.equal(sourceCapture.snapshot.url, canonicalJobUrl);
  assert.equal(sourceCapture.extracted.title, "Email Marketing Automation Specialist for Klaviyo Flows");
  assert.match(sourceCapture.extracted.rawText, /Source: Best Matches source-context capture/);

  let newPageCalls = 0;
  const directOnlyUnavailable = await tryCaptureDiscoverySourceContext(
    { pages: () => [page({ url: canonicalJobUrl, html: readableHtml })] },
    discoveryAction,
    canonicalJobUrl
  );
  assert.equal(directOnlyUnavailable, null, "discovery-origin source-context capture must not reuse an existing direct /jobs/~id page");

  const unavailable = await tryCaptureDiscoverySourceContext(
    {
      pages: () => [page({ url: "https://www.upwork.com/nx/find-work/best-matches", html: `<a href="/jobs/~022054664830593225996">Other job</a>` })],
      // This property is intentionally ignored by source-context capture. Discovery-origin worker handling fails the action instead of direct fallback.
      newPage: async () => {
        newPageCalls += 1;
        return page({ url: "about:blank", html: "" });
      },
    } as { pages: () => ReturnType<typeof page>[] },
    discoveryAction,
    canonicalJobUrl
  );
  assert.equal(unavailable, null, "unavailable source context should return null so discovery-origin worker can fail the action as source_context_unavailable");
  assert.equal(newPageCalls, 0, "source-context attempt must not perform direct navigation itself");

  const hiddenBlockerSource = await tryCaptureDiscoverySourceContext(
    { pages: () => [page({ url: "https://www.upwork.com/nx/find-work/best-matches", html: `${readableHtml}<script>window.cf='captcha cloudflare challenge checking if the site connection is secure'</script>`, text: "Customer Success Manager For Klaviyo\nWe need an experienced Klaviyo and Shopify automation specialist to audit existing flows, rebuild abandoned cart, welcome, browse abandonment, post-purchase, and winback sequences. Hourly: $35-$65" })] },
    discoveryAction,
    canonicalJobUrl
  );
  assert.ok(hiddenBlockerSource, "hidden/full-DOM blocker-like text should not override normal Best Matches source context");
  assert.equal(hiddenBlockerSource.state, "captured");
  assert.equal(hiddenBlockerSource.readable, true);

  const lowConfidenceTarget = await tryCaptureDiscoverySourceContext(
    { pages: () => [page({ url: "https://www.upwork.com/nx/find-work/best-matches", html: `<a href="/jobs/~${targetJobId}">Tiny</a>`, text: "Tiny" })] },
    discoveryAction,
    canonicalJobUrl
  );
  assert.ok(lowConfidenceTarget, "low-confidence target source context should be reported without direct fallback");
  assert.equal(lowConfidenceTarget.state, "source_context_unavailable");
  assert.equal(lowConfidenceTarget.readable, false);

  const visibleBlocked = await tryCaptureDiscoverySourceContext(
    { pages: () => [page({ url: "https://www.upwork.com/nx/find-work/best-matches", title: "Upwork", html: `<a href="/jobs/~${targetJobId}">Job</a><body>Checking if the site connection is secure</body>`, text: "Checking if the site connection is secure" })] },
    discoveryAction,
    canonicalJobUrl
  );
  assert.ok(visibleBlocked, "visible source-context challenge text should fail closed");
  assert.equal(visibleBlocked.state, "captcha_or_security_challenge");
  assert.equal(visibleBlocked.detection.signalStrength, "strong");
  assert.equal(visibleBlocked.detection.matchedVisible, true);
  assert.equal(shouldFallbackToDirectJobCaptureFromSourceContext(discoveryAction, visibleBlocked), true, "visible source-context blockers should allow direct job fallback");

  const blocked = await tryCaptureDiscoverySourceContext(
    { pages: () => [page({ url: "https://www.upwork.com/nx/find-work/best-matches", title: "Just a moment...", html: `<body>Checking if the site connection is secure</body>` })] },
    discoveryAction,
    canonicalJobUrl
  );
  assert.ok(blocked, "blocked source context should fail closed instead of falling through to scoring");
  assert.equal(blocked.state, "captcha_or_security_challenge");
  assert.equal(blocked.detection.signalStrength, "strong");
  assert.equal(blocked.readable, false);
  assert.equal(blocked.matchedTarget, false);

  console.log("browser discovery capture tests passed");
}

void runTests();
