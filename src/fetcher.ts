import Parser from "rss-parser";
import { load } from "cheerio";
import {
  FEED_DELAY_MS,
  FETCH_RETRY_ATTEMPTS,
  SEARCH_QUERIES,
} from "./config";
import { buildFeedUrls } from "./feeds";
import { logger } from "./logger";
import { FeedJobResult, JobPosting } from "./types";
import { hashJobId, sleep, truncateText } from "./utils";

type RssItem = {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  pubDate?: string;
};

const parser: Parser<Record<string, never>, RssItem> = new Parser({
  timeout: 20_000,
});

function parseDescriptionFields(htmlDescription: string): {
  textDescription: string;
  budget: string;
  category: string;
  duration: string;
  skills: string[];
  clientLocation: string;
  clientRating: string;
  clientSpend: string;
  clientHireRate: string;
} {
  const $ = load(htmlDescription ?? "");
  const textDescription = $.text().replace(/\s+/g, " ").trim();
  const lowerText = textDescription.toLowerCase();

  function extractValue(prefixes: string[]): string {
    for (const prefix of prefixes) {
      const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`${escapedPrefix}\\s*:\\s*([^|\\n]+)`, "i");
      const match = textDescription.match(regex);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return "Not specified";
  }

  const budget = extractValue(["Budget", "Hourly Range", "Fixed Price"]);
  const category = extractValue(["Category"]);
  const duration = extractValue(["Project Length", "Duration", "Time Requirement"]);
  const clientLocation = extractValue(["Country", "Client Location", "Location"]);
  const clientRating = extractValue(["Rating", "Client rating"]);
  const clientSpend = extractValue(["Spent", "Total Spent"]);
  const clientHireRate = extractValue(["Hire Rate", "Hires"]);

  const skills: string[] = [];
  const skillsMatch = textDescription.match(/Skills?\s*:\s*([^\n|]+)/i);
  if (skillsMatch?.[1]) {
    const parsedSkills = skillsMatch[1]
      .split(/[,•]/)
      .map((skill) => skill.trim())
      .filter(Boolean);
    skills.push(...parsedSkills);
  }

  if (skills.length === 0) {
    const fallbackSkillCandidates = ["klaviyo", "shopify", "email", "sms", "retention"];
    for (const candidate of fallbackSkillCandidates) {
      if (lowerText.includes(candidate)) {
        skills.push(candidate);
      }
    }
  }

  return {
    textDescription: truncateText(textDescription, 2_500),
    budget,
    category,
    duration,
    skills,
    clientLocation,
    clientRating,
    clientSpend,
    clientHireRate,
  };
}

async function fetchFeedWithRetry(url: string, attempt = 1): Promise<RssItem[]> {
  try {
    const feed = await parser.parseURL(url);
    return feed.items ?? [];
  } catch (error) {
    if (attempt >= FETCH_RETRY_ATTEMPTS) {
      throw error;
    }
    const waitMs = 2 ** (attempt - 1) * 1_000;
    logger.warn(`Feed fetch attempt ${attempt} failed. Retrying in ${waitMs}ms for ${url}`);
    await sleep(waitMs);
    return fetchFeedWithRetry(url, attempt + 1);
  }
}

function mapRssItemToJob(item: RssItem, sourceQuery: string): JobPosting | null {
  const title = item.title?.trim();
  const url = item.link?.trim();
  if (!title || !url) {
    return null;
  }
  const htmlDescription = item.content ?? item.contentSnippet ?? "";
  const parsed = parseDescriptionFields(htmlDescription);
  const postedAtRaw = item.pubDate ?? new Date().toISOString();
  const postedAt = Number.isNaN(new Date(postedAtRaw).getTime())
    ? new Date().toISOString()
    : new Date(postedAtRaw).toISOString();

  return {
    id: hashJobId(url, title),
    title,
    url,
    description: parsed.textDescription || "Not specified.",
    postedAt,
    budget: parsed.budget,
    clientLocation: parsed.clientLocation,
    clientRating: parsed.clientRating,
    clientSpend: parsed.clientSpend,
    clientHireRate: parsed.clientHireRate,
    category: parsed.category,
    duration: parsed.duration,
    skills: parsed.skills,
    sourceQuery,
  };
}

export async function fetchAllFeeds(): Promise<FeedJobResult> {
  const feedUrls = buildFeedUrls(SEARCH_QUERIES);
  const failedFeeds: string[] = [];
  const jobs: JobPosting[] = [];

  for (let index = 0; index < feedUrls.length; index += 1) {
    const feedUrl = feedUrls[index]!;
    const sourceQuery = SEARCH_QUERIES[index]!;
    try {
      const items = await fetchFeedWithRetry(feedUrl);
      for (const item of items) {
        const job = mapRssItemToJob(item, sourceQuery);
        if (job) {
          jobs.push(job);
        }
      }
    } catch (error) {
      logger.error(`Failed to fetch feed for query "${sourceQuery}": ${String(error)}`);
      failedFeeds.push(sourceQuery);
    }

    if (index < feedUrls.length - 1) {
      await sleep(FEED_DELAY_MS);
    }
  }

  return { jobs, failedFeeds };
}

if (require.main === module) {
  (async () => {
    const result = await fetchAllFeeds();
    logger.info(
      `Fetched ${result.jobs.length} jobs across ${SEARCH_QUERIES.length} feeds. Failed feeds: ${result.failedFeeds.length}`
    );
    const preview = result.jobs.slice(0, 5).map((job) => ({
      title: job.title,
      url: job.url,
      postedAt: job.postedAt,
      budget: job.budget,
    }));
    console.log(preview);
  })().catch((error) => {
    logger.error(`test:fetch failed: ${String(error)}`);
    process.exitCode = 1;
  });
}
