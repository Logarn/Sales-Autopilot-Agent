import {
  APIFY_API_TOKEN,
  APIFY_REQUEST_TIMEOUT_MS,
  FETCH_RETRY_ATTEMPTS,
} from "../config";
import { logger } from "../logger";
import { JobPosting } from "../types";
import { truncateText } from "../utils";
import { failedSourceResult, JobSource, JobSourceFetchResult } from "./types";

interface ApifyJob {
  uid: string;
  title: string;
  description: string;
  publishedAt: string;
  skills: string[];
  externalLink: string;
  applicationCost: number;
  category: string;
  budget: {
    fixedBudget: number;
    hourlyRate: {
      min: number | null;
      max: number | null;
    };
  };
  client: {
    countryCode: string;
    stats: {
      totalSpent: number;
      totalHires: number;
      hireRate: number;
      feedbackRate: number;
      feedbackCount: number;
    };
  };
  vendor: {
    experienceLevel: string;
  };
}

const APIFY_ENDPOINT_BASE =
  "https://api.apify.com/v2/acts/upwork-vibe~upwork-job-scraper/run-sync-get-dataset-items";

const APIFY_INCLUDE_KEYWORDS = [
  "Klaviyo lifecycle marketing",
  "Retention Marketing",
  "Klaviyo retention marketing",
  "Klaviyo email flows",
  "Klaviyo segmentation flows",
  "Klaviyo campaign management",
  "Klaviyo deliverability ecommerce",
  "Klaviyo Shopify retention",
  "Shopify lifecycle email retention",
  "DTC lifecycle email marketing",
  "ecommerce retention Klaviyo",
  "Postscript SMS retention",
  "Attentive SMS retention",
  "Omnisend email SMS retention",
  "Mailchimp ecommerce retention",
  "Klaviyo flows",
  "Klaviyo flow audit",
  "Klaviyo automation audit",
  "Klaviyo email specialist",
  "welcome series Klaviyo",
  "abandoned cart email",
  "post-purchase flow",
  "win-back campaign",
  "browse abandonment",
];

const APIFY_EXCLUDE_KEYWORDS = [
  "GHL",
  "GoHighLevel",
  "Go High Level",
  "Mailchimp",
  "Brevo",
  "Airtable",
  "Salesforce",
  "HubSpot",
  "WordPress",
  "Wix",
  "Squarespace",
  "CRO",
  "conversion rate optimization",
  "landing page",
  "Shopify developer",
  "Shopify development",
  "Shopify theme",
  "Liquid",
  "full-time",
  "W2",
  "on-site",
];

function formatBudget(budget: ApifyJob["budget"] | null | undefined): string {
  if (!budget) return "Not specified";
  if (budget.fixedBudget > 0) return `Fixed: $${budget.fixedBudget.toLocaleString()}`;
  if (budget.hourlyRate.min !== null && budget.hourlyRate.max !== null) {
    return `Hourly: $${budget.hourlyRate.min} - $${budget.hourlyRate.max}`;
  }
  return "Not specified";
}

function mapApifyJobToInternal(job: ApifyJob, sourceQuery: string): JobPosting | null {
  if (!job.uid || !job.title || !job.externalLink) return null;

  const publishedAt = job.publishedAt ?? new Date().toISOString();
  const normalizedPostedAt = Number.isNaN(new Date(publishedAt).getTime())
    ? new Date().toISOString()
    : new Date(publishedAt).toISOString();

  return {
    id: job.uid,
    title: job.title.trim(),
    url: job.externalLink.trim(),
    description: truncateText((job.description ?? "Not specified").trim(), 2500),
    postedAt: normalizedPostedAt,
    skills: Array.isArray(job.skills) ? job.skills : [],
    budget: formatBudget(job.budget),
    clientCountry: job.client?.countryCode ?? "Not specified",
    clientRating: job.client?.stats?.feedbackRate ?? 0,
    clientSpend: job.client?.stats?.totalSpent ?? 0,
    clientHireRate: job.client?.stats?.hireRate ?? 0,
    clientTotalHires: job.client?.stats?.totalHires ?? 0,
    clientFeedbackCount: job.client?.stats?.feedbackCount ?? 0,
    category: job.category ?? "Not specified",
    experienceLevel: job.vendor?.experienceLevel ?? "Not specified",
    connectsCost: job.applicationCost ?? 0,
    sourceQuery,
  };
}

async function fetchApifyForQuery(query: string, attempt = 1): Promise<ApifyJob[]> {
  void query;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), APIFY_REQUEST_TIMEOUT_MS);

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = yesterday.toISOString().slice(0, 10);

  try {
    const response = await fetch(`${APIFY_ENDPOINT_BASE}?token=${APIFY_API_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        "includeKeywords.keywords": APIFY_INCLUDE_KEYWORDS,
        "includeKeywords.matchDescription": true,
        "includeKeywords.matchSkills": true,
        "includeKeywords.matchTitle": true,
        "excludeKeywords.keywords": APIFY_EXCLUDE_KEYWORDS,
        "excludeKeywords.matchDescription": true,
        "excludeKeywords.matchSkills": true,
        "excludeKeywords.matchTitle": true,
        jobCategories: ["Digital Marketing"],
        limit: 50,
        fromDate,
        toDate,
        "client.paymentMethodVerified": true,
        "client.includeLocations": [
          { type: "COUNTRY", value: "US" },
          { type: "COUNTRY", value: "CA" },
          { type: "COUNTRY", value: "GB" },
          { type: "COUNTRY", value: "AU" },
          { type: "COUNTRY", value: "NZ" },
          { type: "COUNTRY", value: "IE" },
          { type: "COUNTRY", value: "DE" },
          { type: "COUNTRY", value: "NL" },
          { type: "COUNTRY", value: "SE" },
          { type: "COUNTRY", value: "DK" },
          { type: "COUNTRY", value: "NO" },
          { type: "COUNTRY", value: "FI" },
          { type: "COUNTRY", value: "CH" },
          { type: "COUNTRY", value: "AT" },
          { type: "COUNTRY", value: "BE" },
          { type: "COUNTRY", value: "FR" },
          { type: "COUNTRY", value: "SG" },
          { type: "COUNTRY", value: "AE" },
          { type: "COUNTRY", value: "IL" },
        ],
        "client.totalSpent.min": "100",
        "client.includeWithNoFeedback": true,
        "budget.allowUnspecifiedBudget": true,
        "vendor.type": ["UNSPECIFIED"],
        "vendor.includeWithoutCountryPreference": true,
        "vendor.excludeWithQuestions": false,
        "vendor.includeFeatured": false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Apify request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) throw new Error("Apify response payload is not an array.");
    return payload as ApifyJob[];
  } catch (error) {
    if (attempt >= FETCH_RETRY_ATTEMPTS) throw error;
    const waitMs = 2 ** (attempt - 1) * 1000;
    logger.warn(`Apify fetch attempt ${attempt} failed. Retrying in ${waitMs}ms`);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    return fetchApifyForQuery(query, attempt + 1);
  } finally {
    clearTimeout(timeoutId);
  }
}

export class ApifyUpworkSource implements JobSource {
  name = "apify-multi-keyword";
  kind = "apify" as const;

  async fetchJobs(): Promise<JobSourceFetchResult> {
    try {
      const apifyJobs = await fetchApifyForQuery(this.name);
      const jobs = apifyJobs
        .map((job) => mapApifyJobToInternal(job, this.name))
        .filter((job): job is JobPosting => Boolean(job));
      return { sourceName: this.name, sourceKind: this.kind, jobs, failed: false };
    } catch (error) {
      return failedSourceResult(this.name, this.kind, error);
    }
  }
}
