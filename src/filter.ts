import { MIN_SCORE_HIGH, MIN_SCORE_TO_NOTIFY } from "./config";
import { MatchLevel, JobPosting, ScoredJob } from "./types";

const HIGH_VALUE_KEYWORDS = [
  "klaviyo",
  "shopify plus",
  "retention marketing",
  "email flows",
  "sms flows",
  "lifecycle marketing",
  "customer retention",
  "win-back",
  "abandoned cart",
  "post-purchase",
  "welcome series",
  "browse abandonment",
  "shopify plus email",
  "welcome series klaviyo",
  "abandoned cart email",
  "post-purchase flow",
  "win-back campaign",
  "klaviyo specialist",
  "klaviyo for shopify",
  "klaviyo shopify email specialist",
  "klaviyo email specialist",
  "klaviyo email flows",
  "klaviyo flows",
];

const MEDIUM_VALUE_KEYWORDS = [
  "shopify",
  "email marketing",
  "sms marketing",
  "email automation",
  "ecommerce email",
  "drip campaign",
  "email sequence",
  "segmentation",
  "campaign management",
  "marketing automation",
  "customer journey",
  "postscript",
  "attentive",
  "omnisend",
  "mailchimp marketing",
  "mailchimp email marketing",
  "shopify marketing",
  "shopify retention marketing",
  "shopify email marketing",
  "email automation shopify",
  "dtc email marketing",
  "ecommerce retention",
  "klaviyo marketing",
];

const LOW_VALUE_KEYWORDS = [
  "ecommerce",
  "email",
  "sms",
  "retention",
  "crm",
  "newsletter",
  "subscriber",
  "opt-in",
  "deliverability",
  "a/b testing",
];

const NEGATIVE_KEYWORDS = [
  "wordpress",
  "wix",
  "squarespace",
  "hubspot only",
  "salesforce only",
  "full-time",
  "w2",
  "on-site",
  "in-office",
];

interface ScoreResult {
  score: number;
  matchedKeywords: string[];
  negativeKeywords: string[];
  matchLevel: MatchLevel;
}

function scoreText(text: string): ScoreResult {
  const normalized = text.toLowerCase();
  let score = 0;

  const matchedHigh = HIGH_VALUE_KEYWORDS.filter((keyword) => normalized.includes(keyword));
  const matchedMedium = MEDIUM_VALUE_KEYWORDS.filter((keyword) => normalized.includes(keyword));
  const matchedLow = LOW_VALUE_KEYWORDS.filter((keyword) => normalized.includes(keyword));
  const negatives = NEGATIVE_KEYWORDS.filter((keyword) => normalized.includes(keyword));

  score += matchedHigh.length * 3;
  score += matchedMedium.length * 2;
  score += matchedLow.length;
  score -= negatives.length * 5;

  let matchLevel: MatchLevel = "skip";
  if (score >= MIN_SCORE_HIGH) {
    matchLevel = "high";
  } else if (score >= MIN_SCORE_TO_NOTIFY) {
    matchLevel = "medium";
  } else if (score >= 2) {
    matchLevel = "low";
  }

  if (negatives.length > 0) {
    matchLevel = "skip";
  }

  return {
    score,
    matchedKeywords: [...matchedHigh, ...matchedMedium, ...matchedLow],
    negativeKeywords: negatives,
    matchLevel,
  };
}

export function scoreJob(job: JobPosting): ScoredJob {
  const fields = [
    job.title,
    job.description,
    job.skills.join(" "),
    job.category,
    job.sourceQuery,
  ];
  const combinedText = fields.join(" ");
  const scoreResult = scoreText(combinedText);

  return {
    ...job,
    score: scoreResult.score,
    matchedKeywords: scoreResult.matchedKeywords,
    negativeKeywords: scoreResult.negativeKeywords,
    matchLevel: scoreResult.matchLevel,
  };
}

export function shouldNotify(job: ScoredJob): boolean {
  return job.matchLevel === "high" || job.matchLevel === "medium";
}

export function getKeywordConfig(): {
  high: string[];
  medium: string[];
  low: string[];
  negative: string[];
} {
  return {
    high: HIGH_VALUE_KEYWORDS,
    medium: MEDIUM_VALUE_KEYWORDS,
    low: LOW_VALUE_KEYWORDS,
    negative: NEGATIVE_KEYWORDS,
  };
}
