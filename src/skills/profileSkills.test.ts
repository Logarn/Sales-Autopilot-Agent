import { buildProposalContextPack } from "./profileContextSkill";
import {
  DEFAULT_UPWORK_PORTFOLIO_ITEM_IDS,
  MAX_UPWORK_PORTFOLIO_SELECTIONS,
  selectPortfolioAssetsForJob,
} from "./portfolioSelectionSkill";
import { JobPosting } from "../types";

function createJob(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "job-1",
    title: "Klaviyo retention strategist",
    url: "https://www.upwork.com/jobs/~example",
    description: "Need a senior lifecycle operator for a Shopify DTC brand.",
    postedAt: new Date().toISOString(),
    budget: "$50-$75/hr",
    clientCountry: "United States",
    clientRating: 4.9,
    clientSpend: 100000,
    clientHireRate: 80,
    clientTotalHires: 40,
    clientFeedbackCount: 22,
    category: "Digital Marketing",
    experienceLevel: "Expert",
    connectsCost: 4,
    skills: ["Klaviyo", "Shopify", "Email Marketing"],
    sourceQuery: "manual",
    ...overrides,
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function includes<T extends { id: string }>(items: T[], id: string): boolean {
  return items.some((item) => item.id === id);
}

function assertDefaultUpworkPortfolioSet(items: Array<{ id: string }>, message: string): void {
  assert(items.length === MAX_UPWORK_PORTFOLIO_SELECTIONS, `${message}: should select four Upwork portfolio items`);
  for (const id of DEFAULT_UPWORK_PORTFOLIO_ITEM_IDS) {
    assert(includes(items, id), `${message}: missing ${id}`);
  }
}

function runTests(): void {
  const beautyJob = createJob({
    title: "Klaviyo manager for beauty skincare Shopify brand",
    description: "Need beauty retention strategy, quiz segmentation, zero-party data, flows and campaigns.",
    skills: ["Klaviyo", "Shopify", "Retention Marketing", "SMS Marketing"],
  });
  const beautySelection = selectPortfolioAssetsForJob(beautyJob);
  assert(includes(beautySelection.selectedProof, "truly-beauty"), "Beauty job should select Truly Beauty proof");
  assert(includes(beautySelection.selectedUpworkPortfolioItems, "truly-beauty-upwork"), "Beauty job should select the matching Upwork portfolio item");
  assertDefaultUpworkPortfolioSet(beautySelection.selectedUpworkPortfolioItems, "Beauty job");
  assert(!includes(beautySelection.autoAttachAssets, "truly-beauty-case-study"), "Beauty job should not attach the same proof file when the Upwork portfolio item is selected");
  assert(beautySelection.autoAttachAssets.length <= 1, "Beauty job should use at most one proof artifact");
  assert(beautySelection.selectedFigmaLinks.length === 0, "Non-design beauty job should not include Figma links by default");

  const healthJob = createJob({
    title: "Supplements lifecycle strategist for health brand",
    description: "Need Klaviyo + SMS retention help for a supplement subscription brand.",
    skills: ["Klaviyo", "SMS Marketing", "Subscriptions"],
  });
  const healthSelection = selectPortfolioAssetsForJob(healthJob);
  assert(includes(healthSelection.selectedProof, "dr-rachael-institute"), "Health job should select Dr. Rachael proof");
  assert(includes(healthSelection.autoAttachAssets, "dr-rachael-screenshot"), "Health Klaviyo jobs should prefer a single performance screenshot");
  assert(healthSelection.autoAttachAssets.length <= 1, "Health jobs should use at most one proof artifact");

  const genericKlaviyoJobWithHealthBonus = createJob({
    title: "Email Marketing Specialist (Klaviyo)",
    description: "Fast-growing ecommerce brand needs Klaviyo flows, campaign calendar, segmentation, A/B testing, reporting, and examples with results. Bonus: mental wellness, health, or digital-product category experience.",
    budget: "$5.00 - $10.00 Hourly range",
    skills: ["Klaviyo", "Email Marketing", "Shopify", "Lifecycle Marketing"],
  });
  const genericSelection = selectPortfolioAssetsForJob(genericKlaviyoJobWithHealthBonus);
  assert(!includes(genericSelection.selectedProof, "dr-rachael-institute"), "Bonus-only health text should not select Dr. Rachael proof");
  assert(!includes(genericSelection.autoAttachAssets, "endurance-wellness-strategy"), "Bonus-only health text should not auto-attach Endurance Wellness");
  assert(includes(genericSelection.selectedProof, "hangaritas-screenshot"), "Generic Klaviyo proof requests should select one platform-performance proof");
  assert(includes(genericSelection.autoAttachAssets, "hangaritas-screenshot"), "Generic Klaviyo proof requests should use one Klaviyo screenshot instead of a portfolio dump");
  assertDefaultUpworkPortfolioSet(genericSelection.selectedUpworkPortfolioItems, "Generic Klaviyo proof requests");

  const homeJob = createJob({
    title: "Retention lead for premium furniture ecommerce brand",
    description: "Need lifecycle strategy for high-AOV furniture/home goods brand.",
    skills: ["Klaviyo", "Shopify", "Lifecycle Marketing"],
  });
  const homeSelection = selectPortfolioAssetsForJob(homeJob);
  assert(includes(homeSelection.selectedProof, "lifely"), "High-AOV home job should select Lifely");
  assert(includes(homeSelection.selectedUpworkPortfolioItems, "lifely-upwork"), "High-AOV home job should select Lifely in Upwork portfolio");
  assert(homeSelection.selectedUpworkPortfolioItems[0]?.id === "lifely-upwork", "High-AOV home job should rank Lifely first in Upwork portfolio");
  assert(!includes(homeSelection.autoAttachAssets, "lifely-case-study"), "High-AOV home job should not attach the same proof file when portfolio is selected");

  const fashionJob = createJob({
    title: "Deliverability + Klaviyo consultant for fashion boutique",
    description: "Need deliverability rescue, segmentation, flows, and campaigns for apparel brand.",
    skills: ["Klaviyo", "Deliverability", "SMS Marketing"],
  });
  const fashionSelection = selectPortfolioAssetsForJob(fashionJob);
  assert(includes(fashionSelection.selectedProof, "fly-boutique"), "Fashion job should select Fly Boutique");
  assert(includes(fashionSelection.selectedUpworkPortfolioItems, "fly-boutique-upwork"), "Fashion job should select Fly Boutique in Upwork portfolio");
  assert(fashionSelection.selectedUpworkPortfolioItems[0]?.id === "fly-boutique-upwork", "Fashion job should rank Fly Boutique first in Upwork portfolio");
  assert(!includes(fashionSelection.autoAttachAssets, "fly-boutique-case-study"), "Fashion job should not attach the same proof file when portfolio is selected");

  const designJob = createJob({
    title: "Email design + Figma specialist for DTC brand",
    description: "Need Figma-based email templates and campaign design support.",
    skills: ["Figma", "Email Design", "Klaviyo"],
  });
  const designSelection = selectPortfolioAssetsForJob(designJob);
  assert(includes(designSelection.selectedProof, "design-case-studies"), "Design job should select design case studies");
  assert(includes(designSelection.selectedUpworkPortfolioItems, "design-case-studies-upwork"), "Design job should select design case studies in Upwork portfolio");
  assert(designSelection.selectedUpworkPortfolioItems[0]?.id === "design-case-studies-upwork", "Design job should rank design case studies first in Upwork portfolio");
  assert(!includes(designSelection.autoAttachAssets, "design-case-studies"), "Design job should not attach the same proof file when portfolio is selected");
  assert(designSelection.selectedFigmaLinks.length > 0, "Design job should include Figma links");

  const mailchimpAutomationJob = createJob({
    title: "Mailchimp automation expert for premium skincare webshop",
    description: "Need lifecycle automation, segmentation, deliverability, flows, and revenue attribution for a skincare ecommerce brand.",
    skills: ["Mailchimp", "Lifecycle Marketing", "Email Marketing", "Shopify"],
  });
  const mailchimpSelection = selectPortfolioAssetsForJob(mailchimpAutomationJob);
  assert(mailchimpSelection.selectedFigmaLinks.length === 0, "Mailchimp automation job should not show Figma links");
  assert(mailchimpSelection.autoAttachAssets.length <= 2, "Mailchimp automation job should not flood auto-attach assets");
  assert(!includes(mailchimpSelection.autoAttachAssets, "design-case-studies"), "Mailchimp automation job should not auto-attach design case studies");
  assert(!includes(mailchimpSelection.autoAttachAssets, "endurance-wellness"), "Mailchimp automation job should not auto-attach Endurance Wellness by default");

  const crossPlatformEmailJob = createJob({
    title: "Email Marketing | Klaviyo Expert| Mailchimp |Omnisend| Ecommerce Flows",
    description: "Ecommerce brand needs Klaviyo, Mailchimp, and Omnisend flows, campaigns, subscriber list management, campaign performance analysis, and actionable insights. Responsibilities include designing email templates, but the goal is engagement and conversion.",
    skills: ["Klaviyo", "Mailchimp", "Omnisend", "Customer Retention", "Copywriting"],
  });
  const crossPlatformSelection = selectPortfolioAssetsForJob(crossPlatformEmailJob);
  assert(!includes(crossPlatformSelection.selectedProof, "design-case-studies"), "Lifecycle/platform email work with incidental template wording should not select design case studies");
  assert(!includes(crossPlatformSelection.autoAttachAssets, "design-case-studies"), "Lifecycle/platform email work should not auto-attach design proof unless design is primary");
  assert(crossPlatformSelection.selectedFigmaLinks.length === 0, "Lifecycle/platform email work should not show Figma links unless Figma/design is primary");
  assert(includes(crossPlatformSelection.selectedProof, "hangaritas-screenshot"), "Cross-platform lifecycle email work should pick one Klaviyo performance proof");
  assert(includes(crossPlatformSelection.autoAttachAssets, "hangaritas-screenshot"), "Cross-platform lifecycle email work should attach one Klaviyo PNG proof");
  assert(crossPlatformSelection.autoAttachAssets.length === 1, "Cross-platform lifecycle email work should not attach multiple proof files");
  assertDefaultUpworkPortfolioSet(crossPlatformSelection.selectedUpworkPortfolioItems, "Cross-platform lifecycle email work");

  const petJob = createJob({
    title: "Retention strategist for pet DTC brand",
    description: "Need Klaviyo/Recharge help for pet ecommerce lifecycle and repeat purchase.",
    skills: ["Klaviyo", "Recharge", "Retention Marketing"],
  });
  const petSelection = selectPortfolioAssetsForJob(petJob);
  assert(includes(petSelection.selectedProof, "whisker-seeker"), "Pet job should select Whisker Seeker");
  assert(includes(petSelection.autoAttachAssets, "dtc-performance-figures"), "Approved DTC figures PDF should auto-attach when relevant");
  assert(petSelection.autoAttachAssets.length === 1, "Pet jobs should use one proof file, not a proof dump");

  const beautyPack = buildProposalContextPack(beautyJob);
  assert(beautyPack.selectedProofPoints.some((line) => line.includes("Truly Beauty")), "Beauty context pack should include Truly Beauty proof");
  assert(!beautyPack.selectedAttachments.includes("profile/attachments/truly-beauty-case-study.pdf"), "Beauty context pack should not duplicate an Upwork portfolio proof as an attachment");

  const designPack = buildProposalContextPack(designJob);
  assert(designPack.selectedFigmaLinks.length > 0, "Design context pack should include Figma links");
  assert(designPack.selectedProofPoints.some((line) => line.includes("Design Case Studies")), "Design context pack should include design proof");

  const allSelectedAttachable = [beautySelection, healthSelection, homeSelection, fashionSelection, designSelection, petSelection].every((selection) =>
    selection.autoAttachAssets.every((asset) => asset.safeToAttach && !asset.requiresManualReview),
  );
  assert(allSelectedAttachable, "Selected auto-attach assets should be approved and not require manual review");

  console.log("profile skills tests passed");
}

if (require.main === module) {
  try {
    runTests();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`profile skills tests failed: ${message}`);
    process.exitCode = 1;
  }
}
