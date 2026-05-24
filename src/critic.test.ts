import assert from "node:assert/strict";
import { critiqueProposal } from "./critic";
import type { JobPosting } from "./types";

const hubspotJob: JobPosting = {
  id: "critic-job",
  title: "HubSpot email automation for ecommerce brand",
  url: "https://www.upwork.com/jobs/~critic123456",
  description: "We need HubSpot lifecycle email automation and segmentation support.",
  postedAt: new Date().toISOString(),
  budget: "$1,500",
  clientCountry: "US",
  clientRating: 4.8,
  clientSpend: 20000,
  clientHireRate: 70,
  clientTotalHires: 8,
  clientFeedbackCount: 6,
  category: "Marketing",
  experienceLevel: "Expert",
  connectsCost: 8,
  skills: ["HubSpot", "Email Automation"],
  sourceQuery: "test",
};

const weak = critiqueProposal(
  [
    "Hi there, I am excited to apply and leverage my expertise to help you grow your business.",
    "I can optimize your marketing with best practices and cutting-edge strategies that drive results.",
    "I would rebuild this in Klaviyo and take your business to the next level.",
    "Let me know if you want to discuss.",
  ].join("\n\n"),
  hubspotJob,
);

assert(weak.score < 60, "Generic/wrong-platform proposal should score poorly");
assert(weak.issues.some((issue) => issue.category === "platform_mismatch"), "Wrong platform language should be caught");
assert(weak.issues.some((issue) => issue.category === "fluff"), "Fluffy language should be caught");
assert(weak.issues.some((issue) => issue.category === "vague_claim"), "Vague claims should be caught");

const sharp = critiqueProposal(
  [
    "If HubSpot is already in place, the first leak I would look for is where subscribers stall after the first buying signal.",
    "I would audit the lifecycle paths, rebuild the highest-impact automation gaps, and tighten segmentation so campaigns are not doing work flows should handle.",
    "Relevant background: email, retention, lifecycle, campaign, and segmentation work tied to repeat purchase.",
    "Send me the store URL and I can point to the first HubSpot retention fixes I would make.",
  ].join("\n\n"),
  hubspotJob,
);

assert(sharp.score > weak.score, "Steve-style specific proposal should score better than generic copy");
assert(!sharp.issues.some((issue) => issue.category === "platform_mismatch"), "Grounded HubSpot draft should not trigger platform mismatch");

console.log("critic tests passed");
