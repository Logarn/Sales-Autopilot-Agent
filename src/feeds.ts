export const DEFAULT_SEARCH_QUERIES = [
  "Klaviyo Shopify email marketing",
  "Klaviyo retention marketing",
  "Klaviyo SMS marketing",
  "Shopify email automation Klaviyo",
  "Klaviyo email flows",
  "Shopify retention email SMS",
  "Klaviyo campaign management",
  "ecommerce email marketing Klaviyo",
  "Shopify Plus Klaviyo",
  "Klaviyo segmentation flows",
  "email marketing Shopify retention",
  "SMS marketing ecommerce Shopify",
];

export function buildUpworkFeedUrl(query: string): string {
  return `https://www.upwork.com/ab/feed/jobs/rss?q=${encodeURIComponent(query)}&sort=recency`;
}

export function buildFeedUrls(queries: string[]): string[] {
  return queries.map((query) => buildUpworkFeedUrl(query));
}
