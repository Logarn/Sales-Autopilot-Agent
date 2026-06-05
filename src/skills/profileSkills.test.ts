import { buildProposalContextPack } from "./profileContextSkill";
import { selectPortfolioAssetsForJob } from "./portfolioSelectionSkill";
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

function runTests(): void {
  const beautyJob = createJob({
    title: "Klaviyo manager for beauty skincare Shopify brand",
    description: "Need beauty retention strategy, quiz segmentation, zero-party data, flows and campaigns.",
    skills: ["Klaviyo", "Shopify", "Retention Marketing", "SMS Marketing"],
  });
  const beautySelection = selectPortfolioAssetsForJob(beautyJob);
  assert(includes(beautySelection.selectedProof, "truly-beauty"), "Beauty job should select Truly Beauty proof");
  assert(includes(beautySelection.autoAttachAssets, "truly-beauty-case-study"), "Beauty job should auto-attach Truly Beauty case study");
  assert(beautySelection.autoAttachAssets.length <= 2, "Non-design beauty job should limit auto-attach assets");
  assert(beautySelection.selectedFigmaLinks.length === 0, "Non-design beauty job should not include Figma links by default");

  const healthJob = createJob({
    title: "Supplements lifecycle strategist for health brand",
    description: "Need Klaviyo + SMS retention help for a supplement subscription brand.",
    skills: ["Klaviyo", "SMS Marketing", "Subscriptions"],
  });
  const healthSelection = selectPortfolioAssetsForJob(healthJob);
  assert(includes(healthSelection.selectedProof, "dr-rachael-institute"), "Health job should select Dr. Rachael proof");
  assert(includes(healthSelection.autoAttachAssets, "dr-rachael-report"), "Approved Dr. Rachael report should be auto-attach-capable when relevant");
  assert(healthSelection.autoAttachAssets.length <= 3, "Health jobs should cap proof files at the strongest three");

  const homeJob = createJob({
    title: "Retention lead for premium furniture ecommerce brand",
    description: "Need lifecycle strategy for high-AOV furniture/home goods brand.",
    skills: ["Klaviyo", "Shopify", "Lifecycle Marketing"],
  });
  const homeSelection = selectPortfolioAssetsForJob(homeJob);
  assert(includes(homeSelection.selectedProof, "lifely"), "High-AOV home job should select Lifely");
  assert(includes(homeSelection.autoAttachAssets, "lifely-case-study"), "High-AOV home job should auto-attach Lifely");

  const fashionJob = createJob({
    title: "Deliverability + Klaviyo consultant for fashion boutique",
    description: "Need deliverability rescue, segmentation, flows, and campaigns for apparel brand.",
    skills: ["Klaviyo", "Deliverability", "SMS Marketing"],
  });
  const fashionSelection = selectPortfolioAssetsForJob(fashionJob);
  assert(includes(fashionSelection.selectedProof, "fly-boutique"), "Fashion job should select Fly Boutique");
  assert(includes(fashionSelection.autoAttachAssets, "fly-boutique-case-study"), "Fashion job should auto-attach Fly Boutique case study");

  const designJob = createJob({
    title: "Email design + Figma specialist for DTC brand",
    description: "Need Figma-based email templates and campaign design support.",
    skills: ["Figma", "Email Design", "Klaviyo"],
  });
  const designSelection = selectPortfolioAssetsForJob(designJob);
  assert(includes(designSelection.selectedProof, "design-case-studies"), "Design job should select design case studies");
  assert(includes(designSelection.autoAttachAssets, "design-case-studies"), "Design job should auto-attach design case studies PDF");
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

  const petJob = createJob({
    title: "Retention strategist for pet DTC brand",
    description: "Need Klaviyo/Recharge help for pet ecommerce lifecycle and repeat purchase.",
    skills: ["Klaviyo", "Recharge", "Retention Marketing"],
  });
  const petSelection = selectPortfolioAssetsForJob(petJob);
  assert(includes(petSelection.selectedProof, "whisker-seeker"), "Pet job should select Whisker Seeker");
  assert(includes(petSelection.selectedProof, "my-pet-chicken"), "Pet job should select My Pet Chicken");
  assert(includes(petSelection.autoAttachAssets, "dtc-performance-figures"), "Approved DTC figures PDF should auto-attach when relevant");

  const beautyPack = buildProposalContextPack(beautyJob);
  assert(beautyPack.selectedProofPoints.some((line) => line.includes("Truly Beauty")), "Beauty context pack should include Truly Beauty proof");
  assert(beautyPack.selectedAttachments.includes("profile/attachments/truly-beauty-case-study.pdf"), "Beauty context pack should include Truly Beauty attachment path");

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
