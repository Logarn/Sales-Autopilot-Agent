import assert from "node:assert/strict";
import {
  EMPTY_PROOF_PLAN_OVERRIDES,
  applyProofPlanOverridesToSelection,
  reviseProofPlanOverrides,
} from "./proofPlanOverrides";
import { selectPortfolioAssetsForJob } from "./skills/portfolioSelectionSkill";
import type { JobPosting } from "./types";

function createJob(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "job-1",
    title: "Klaviyo retention strategist",
    url: "https://www.upwork.com/jobs/~example",
    description: "Shopify beauty brand needs Klaviyo retention flows, campaigns, quiz segmentation, and email proof.",
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

function hasAsset(selection: ReturnType<typeof selectPortfolioAssetsForJob>, id: string): boolean {
  return selection.autoAttachAssets.some((asset) => asset.id === id);
}

function hasPortfolio(selection: ReturnType<typeof selectPortfolioAssetsForJob>, text: string): boolean {
  return selection.selectedUpworkPortfolioItems.some((item) => item.name.includes(text));
}

const beautySelection = selectPortfolioAssetsForJob(createJob());
assert(hasAsset(beautySelection, "truly-beauty-case-study"), "Beauty base plan should select Truly attachment.");
assert(hasPortfolio(beautySelection, "Truly Beauty"), "Beauty base plan should select Truly Upwork portfolio item.");

const swap = reviseProofPlanOverrides(
  EMPTY_PROOF_PLAN_OVERRIDES,
  "Use Fly Boutique instead of Truly and add the intro PDF.",
  new Date("2026-06-05T00:00:00Z"),
);
assert(swap.summary.changed, "Swap command should parse as a proof plan change.");
assert(swap.overrides.includeAssetIds.includes("fly-boutique-case-study"), "Swap should include Fly file.");
assert(swap.overrides.includeAssetIds.includes("steve-intro-pdf"), "Swap should include intro PDF.");
assert(swap.overrides.excludeAssetIds.includes("truly-beauty-case-study"), "Swap should exclude Truly file.");
const swappedSelection = applyProofPlanOverridesToSelection(beautySelection, swap.overrides);
assert(hasAsset(swappedSelection, "fly-boutique-case-study"), "Swapped plan should attach Fly.");
assert(hasAsset(swappedSelection, "steve-intro-pdf"), "Swapped plan should attach intro PDF.");
assert(!hasAsset(swappedSelection, "truly-beauty-case-study"), "Swapped plan should remove Truly.");
assert(hasPortfolio(swappedSelection, "The Fly Boutique"), "Swapped plan should select Fly Upwork portfolio item.");

const addDesign = reviseProofPlanOverrides(swap.overrides, "Attach the Design Case Studies too.", new Date("2026-06-05T00:01:00Z"));
const withDesign = applyProofPlanOverridesToSelection(beautySelection, addDesign.overrides);
assert(hasAsset(withDesign, "design-case-studies"), "Attach-too command should add Design Case Studies.");
assert(withDesign.autoAttachAssets.length <= 3, "Proof plan should still cap files at strongest one to three.");

const removeIntro = reviseProofPlanOverrides(addDesign.overrides, "Remove the intro PDF.", new Date("2026-06-05T00:02:00Z"));
const withoutIntro = applyProofPlanOverridesToSelection(beautySelection, removeIntro.overrides);
assert(!hasAsset(withoutIntro, "steve-intro-pdf"), "Remove command should remove intro PDF from planned files.");

const trulyLifely = reviseProofPlanOverrides(
  EMPTY_PROOF_PLAN_OVERRIDES,
  "Use Truly + Lifely.",
  new Date("2026-06-05T00:03:00Z"),
);
const trulyLifelySelection = applyProofPlanOverridesToSelection(beautySelection, trulyLifely.overrides);
assert(hasAsset(trulyLifelySelection, "truly-beauty-case-study"), "Plus command should include Truly.");
assert(hasAsset(trulyLifelySelection, "lifely-case-study"), "Plus command should include Lifely.");

const noScreenshots = reviseProofPlanOverrides(
  EMPTY_PROOF_PLAN_OVERRIDES,
  "Don't attach screenshots on this one.",
  new Date("2026-06-05T00:04:00Z"),
);
assert(noScreenshots.overrides.noScreenshots, "No-screenshots command should set the screenshot exclusion flag.");

const portfolioOnly = reviseProofPlanOverrides(
  EMPTY_PROOF_PLAN_OVERRIDES,
  "Use portfolio only.",
  new Date("2026-06-05T00:05:00Z"),
);
const portfolioOnlySelection = applyProofPlanOverridesToSelection(beautySelection, portfolioOnly.overrides);
assert.equal(portfolioOnlySelection.autoAttachAssets.length, 0, "Portfolio-only command should remove file attachments.");
assert(hasPortfolio(portfolioOnlySelection, "Truly Beauty"), "Portfolio-only command should keep the strongest Upwork portfolio selection.");

console.log("proof plan override tests passed");
