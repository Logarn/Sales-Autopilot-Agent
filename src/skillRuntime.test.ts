import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "upwork-skill-runtime-"));
process.env.DB_PATH = path.join(tempDir, "test.sqlite");
process.env.PROOF_ASSET_ROOT = path.join(tempDir, "proof-assets");
fs.mkdirSync(process.env.PROOF_ASSET_ROOT, { recursive: true });

const { scoreJob } = require("./filter") as {
  scoreJob: (job: any) => any;
};
const { buildApplicationDraft } = require("./agent") as {
  buildApplicationDraft: (job: any) => any;
};
const { buildApplicationDraftWithResearch } = require("./agent") as {
  buildApplicationDraftWithResearch: (job: any, options?: any) => Promise<any>;
};
const { createMockBrandResearchProvider, isSafeBrandResearchUrl } = require("./brandResearchProvider") as {
  createMockBrandResearchProvider: (results: any[]) => any;
  isSafeBrandResearchUrl: (value: string) => boolean;
};
const {
  listRuntimeSkills,
  selectApplicationPrepSkills,
  hasUsefulBrandOrCategoryClue,
} = require("./skillRuntime") as {
  listRuntimeSkills: () => Array<{ name: string; path: string; kind: string }>;
  selectApplicationPrepSkills: (job: any) => Array<{ name: string; stage: string }>;
  hasUsefulBrandOrCategoryClue: (job: any) => boolean;
};
const {
  buildCopywritingDraft,
  evaluateDraftQualityGate,
  loadProposalCopywritingSkill,
} = require("./skills/proposalCopywritingSkill") as {
  buildCopywritingDraft: (input: any) => any;
  evaluateDraftQualityGate: (input: any) => { ready: boolean; issues: Array<{ code: string }> };
  loadProposalCopywritingSkill: () => any;
};
const { buildBrandFactPack, loadBrandResearchSkill } = require("./skills/brandResearchSkill") as {
  buildBrandFactPack: (input: any) => any;
  loadBrandResearchSkill: () => any;
};
const { markJobSeen } = require("./db") as {
  markJobSeen: (job: any, notified: boolean) => void;
};
const { buildBrowserApplyPlan } = require("./browserApply") as {
  buildBrowserApplyPlan: (jobId: string) => { plan: any; valid: boolean; issues: Array<{ code: string; severity: string }> };
};

function job(partial: Record<string, unknown> = {}) {
  return {
    id: `skill-runtime-${Math.random().toString(16).slice(2)}`,
    title: "Klaviyo lifecycle strategist for Shopify beauty brand",
    url: "https://www.upwork.com/jobs/~123456789012345678",
    description: [
      "Store GlowRoutine / glowroutine.com needs help rebuilding Klaviyo lifecycle flows for a Shopify skincare brand.",
      "We need welcome, replenishment, and post-purchase education that improves trust, routine-building, repeat purchase, and conversion.",
      "Please mention relevant proof and keep the application concise.",
    ].join(" "),
    postedAt: new Date("2026-06-12T08:00:00Z").toISOString(),
    budget: "$60-$90/hr",
    clientCountry: "United States",
    clientRating: 4.9,
    clientSpend: 25000,
    clientHireRate: 80,
    clientTotalHires: 14,
    clientFeedbackCount: 9,
    category: "Email Marketing",
    experienceLevel: "Expert",
    connectsCost: 8,
    skills: ["Klaviyo", "Shopify", "Email Marketing", "Lifecycle Marketing"],
    sourceQuery: "skill-runtime-test",
    proposalCount: 8,
    competitionLevel: "medium",
    ...partial,
  };
}

function scored(partial: Record<string, unknown> = {}) {
  return scoreJob(job(partial));
}

function indexOfRequired(text: string, needle: RegExp, label: string): number {
  const match = text.toLowerCase().match(needle);
  assert(match?.index !== undefined, `${label} should exist in proposal: ${text}`);
  return match.index;
}

const inventory = listRuntimeSkills();
const inventoryNames = new Set(inventory.map((skill) => skill.name));
const markdownSkillNames = fs.readdirSync(path.resolve(process.cwd(), "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.resolve(process.cwd(), "skills", name, "SKILL.md")));
for (const name of markdownSkillNames) {
  assert(inventoryNames.has(name), `Skill inventory should include ${name}`);
}
assert(inventoryNames.has("brand-research"), "Brand-research skill should exist.");
assert(inventoryNames.has("proposal-copywriting"), "Proposal-copywriting skill should exist.");
assert(inventoryNames.has("portfolio-selection-runtime"), "Runtime inventory should include portfolio selection module.");
assert(inventoryNames.has("profile-context-runtime"), "Runtime inventory should include profile context module.");

assert.equal(isSafeBrandResearchUrl("https://example.com/about"), true, "HTTPS public brand URLs should be allowed.");
assert.equal(isSafeBrandResearchUrl("http://example.com/about"), false, "Plain HTTP brand research URLs should be rejected.");
const credentialBearingUrl = ["https://user", "pass@example.com/about"].join(":");
assert.equal(isSafeBrandResearchUrl(credentialBearingUrl), false, "Credential-bearing URLs should be rejected.");
assert.equal(isSafeBrandResearchUrl("https://upwork.com/jobs/example"), false, "Upwork URLs should not be used as brand research sources.");
assert.equal(isSafeBrandResearchUrl("https://slack.com/files/example"), false, "Slack URLs should not be used as brand research sources.");
assert.equal(isSafeBrandResearchUrl("https://localhost/about"), false, "localhost URLs should be rejected.");
assert.equal(isSafeBrandResearchUrl("https://127.0.0.1/about"), false, "loopback URLs should be rejected.");
assert.equal(isSafeBrandResearchUrl("https://10.0.0.4/about"), false, "private network URLs should be rejected.");
assert.equal(isSafeBrandResearchUrl("https://169.254.10.20/about"), false, "link-local URLs should be rejected.");

const brandJob = job();
const selectedForBrand = selectApplicationPrepSkills(brandJob);
assert(selectedForBrand.some((skill) => skill.name === "brand-research"), "Brand-research should be selected when brand/site/category clues exist.");
const genericNoClueJob = job({
  title: "Need help writing short emails",
  description: "Need a few account emails rewritten. No brand, website, product, platform, or category details are available yet.",
  category: "",
  skills: ["Email Writing"],
});
assert.equal(hasUsefulBrandOrCategoryClue(genericNoClueJob), false, "No-clue job should not trigger brand/category research.");
assert(!selectApplicationPrepSkills(genericNoClueJob).some((skill) => skill.name === "brand-research"), "Brand-research should not be selected without useful clues.");
assert(selectedForBrand.some((skill) => skill.name === "proposal-copywriting" && skill.stage === "cover_letter_drafting"), "Proposal-copywriting should be selected for cover letters.");
assert(selectedForBrand.some((skill) => skill.name === "proposal-copywriting" && skill.stage === "screening_answer_drafting"), "Proposal-copywriting should be selected for screening answers.");
assert(selectedForBrand.some((skill) => skill.name === "proof-selector" && skill.stage === "proof_selection"), "Proof-selector should be selected before proof selection.");
assert(selectedForBrand.some((skill) => skill.name === "profile-context-runtime" && skill.stage === "portfolio_profile_selection"), "Profile/portfolio runtime skill should be selected.");

const beauty = scored();
const beautyDraft = buildApplicationDraft(beauty);
assert.equal(beautyDraft.jobUnderstanding.fullJobDescription, beauty.description, "Full job description should be preserved before copywriting.");
assert(beautyDraft.skillUseTrace.invocationOrder.findIndex((item: string) => item.includes("brand_research:brand-research")) <
  beautyDraft.skillUseTrace.invocationOrder.findIndex((item: string) => item.includes("cover_letter_drafting:proposal-copywriting")),
  "Brand fact pack should be built before proposal-copywriting.");
assert(beautyDraft.brandFactPack.researchNeeded, "Brand fact pack should mark research needed for brand/site clues.");
assert(beautyDraft.copyStrategy, "copy_strategy should exist.");
assert(beautyDraft.proofStrategy, "proof_strategy should exist.");

assert.throws(
  () => buildApplicationDraft(scored({ description: "" })),
  /Full job description is required/,
  "Drafting should fail if no job description is available."
);

assert.throws(
  () => buildCopywritingDraft({
    job: beauty,
    profile: { hourlyRate: 100 },
    intelligence: beautyDraft.jobIntelligence,
    brandFactPack: buildBrandFactPack({ job: beauty, skill: loadBrandResearchSkill() }),
    proofPoints: [],
    portfolioItems: [],
    skill: { ...loadProposalCopywritingSkill(), markdown: "" },
  }),
  /proposal-copywriting skill must be loaded/,
  "Drafting should fail if proposal-copywriting skill is missing."
);

const gardening = scored({
  title: "Gardening ecommerce CRM lifecycle help",
  description: "A gardening store needs CRM lifecycle help for seeds, plants, seasonal care education, replenishment, and Klaviyo flows.",
  category: "Gardening",
  skills: ["Klaviyo", "CRM", "Email Marketing"],
});
const gardeningProposal = buildApplicationDraft(gardening).proposalText.toLowerCase();
assert(indexOfRequired(gardeningProposal, /season/, "Gardening season/customer logic") < indexOfRequired(gardeningProposal, /flow|klaviyo/, "flow/tool reference"), "Gardening proposal should use season/customer logic before flow names.");

const beautyProposal = beautyDraft.proposalText.toLowerCase();
const beautyLogicIndex = indexOfRequired(beautyProposal, /trust|routine|replenishment/, "Beauty trust/routine/replenishment logic");
const beautyProofIndex = indexOfRequired(beautyProposal, /share relevant|relevant work|proof/, "Beauty proof mention");
assert(beautyLogicIndex < beautyProofIndex, "Beauty proposal should use trust/routine/replenishment logic before proof.");

const design = scored({
  title: "Email design system for Shopify campaigns",
  description: "We need email design help for Shopify campaigns and Klaviyo templates. The work should improve hierarchy, offer clarity, mobile reading, CTA placement, and conversion.",
  category: "Email Design",
  skills: ["Figma", "Klaviyo", "Email Design"],
});
const designProposal = buildApplicationDraft(design).proposalText.toLowerCase();
const hierarchyIndex = indexOfRequired(designProposal, /hierarchy|conversion/, "Email design hierarchy/conversion logic");
const designToolIndex = designProposal.indexOf("figma") >= 0 ? designProposal.indexOf("figma") : designProposal.indexOf("klaviyo");
assert(designToolIndex === -1 || hierarchyIndex < designToolIndex, "Email design proposal should use hierarchy/conversion logic before design-tool claims.");

const gateBase = {
  job: beauty,
  copyStrategy: beautyDraft.copyStrategy,
  brandFactPack: beautyDraft.brandFactPack,
  skillLoaded: true,
  fullJobDescriptionRead: true,
  copyStrategyCreated: true,
  finalSubmitManual: true,
  proofVerificationState: "planned",
};
assert(evaluateDraftQualityGate({ ...gateBase, proposalText: "I am a Klaviyo expert with years of experience. Send me the store URL." }).issues.some((issue) => issue.code === "generic_expert_opener"), "Generic opener should fail quality gate.");
assert(evaluateDraftQualityGate({ ...gateBase, proposalText: `${beautyDraft.proposalText}\n\njust adding noise.` }).issues.some((issue) => issue.code === "banned_noise_phrase"), "Banned noise phrase should fail quality gate.");
assert(evaluateDraftQualityGate({ ...gateBase, proposalText: `${beautyDraft.proposalText}\n\nSend me the store URL and I can point to the first retention fixes I would make.` }).issues.some((issue) => issue.code === "store_url_punt_cta"), "Store URL punt CTA should fail quality gate.");
assert(evaluateDraftQualityGate({
  ...gateBase,
  proposalText: `${beautyDraft.proposalText}\n\nRelevant background: Klaviyo and DTC lifecycle.\nTo answer the application notes directly: Rate: $35/hr.\nAdditional relevant example: Truly Beauty.`,
}).issues.some((issue) => issue.code === "internal_scaffold_labels"), "Internal proof/application-note scaffolding should fail quality gate.");
assert(evaluateDraftQualityGate({ ...gateBase, proposalText: `${beautyDraft.proposalText}\n\nThis ends...` }).issues.some((issue) => issue.code === "truncated_or_incomplete"), "Truncated ellipsis should fail quality gate.");
assert(evaluateDraftQualityGate({ ...gateBase, proposalText: `${beautyDraft.proposalText}\n\nI attached the proof file for review.` }).issues.some((issue) => issue.code === "unverified_proof_claim"), "Unverified proof claim should fail quality gate.");
assert(evaluateDraftQualityGate({
  ...gateBase,
  proposalText: "Steve here,\n\nThe opportunity for 10.00Fixed-priceIntermediateI here is conversion can leak when visual hierarchy is unclear.",
}).issues.some((issue) => issue.code === "parsed_page_noise_as_client"), "Parsed budget/page noise must fail quality gate.");
assert(evaluateDraftQualityGate({
  ...gateBase,
  proposalText: "Steve here,\n\nThe opportunity for upwork.com here is customer moments may not be mapped clearly enough.",
}).issues.some((issue) => issue.code === "parsed_page_noise_as_client"), "Upwork domain must not be treated as the client.");
assert(evaluateDraftQualityGate({
  ...gateBase,
  proposalText: `${beautyDraft.proposalText}\n\nI can share relevant work like Screenshot 42 if you want to see proof.`,
}).issues.some((issue) => issue.code === "weak_or_unverified_proof_reference"), "Vague screenshot proof references must fail quality gate.");

const noisyCapturedJob = scored({
  title: "Email Marketing | Klaviyo Expert| Mailchimp |Omnisend| Ecommerce Flows - Digital Marketing",
  description: "Skills Email Marketing | Klaviyo Expert| Mailchimp |Omnisend| Ecommerce Flows Posted 4 hours ago Worldwide Summary We are seeking an experienced email marketing expert to enhance our ecommerce flows using Klaviyo, Mailchimp, and Omnisend. The ideal candidate will have a strong background in creating and optimizing email campaigns to boost customer engagement and conversion rates. Responsibilities include designing email templates, managing subscriber lists, and analyzing campaign performance to provide actionable insights. $10.00 Fixed-price Intermediate I am looking for a mix of experience and value.",
  category: "Email Marketing",
  skills: ["Klaviyo", "Mailchimp", "Omnisend", "Customer Retention", "Copywriting"],
});
const noisyDraft = buildApplicationDraft(noisyCapturedJob);
assert(!/10\.00|fixed-priceintermediate|upwork\.com|Screenshot\s*\d+|general retention portfolio/i.test(noisyDraft.proposalText), `Noisy captured proposal should not leak parsed page noise or vague proof references:\n${noisyDraft.proposalText}`);
assert(/klaviyo/i.test(noisyDraft.proposalText), `Noisy captured proposal should mention the requested Klaviyo scope:\n${noisyDraft.proposalText}`);
assert(/mailchimp/i.test(noisyDraft.proposalText), `Noisy captured proposal should mention the requested Mailchimp scope:\n${noisyDraft.proposalText}`);
assert(/omnisend/i.test(noisyDraft.proposalText), `Noisy captured proposal should mention the requested Omnisend scope:\n${noisyDraft.proposalText}`);
assert(/engagement/i.test(noisyDraft.proposalText), `Noisy captured proposal should mention the requested engagement goal:\n${noisyDraft.proposalText}`);
assert(!/design case studies|figma|visual hierarchy/i.test(noisyDraft.proposalText), `Lifecycle/platform email proposal should not drift into design-proof copy:\n${noisyDraft.proposalText}`);
assert(/Hangaritas|£21,681\.29|173%/i.test(noisyDraft.proposalText), `Lifecycle/platform email proposal should use the selected one-proof artifact instead of generic credentials:\n${noisyDraft.proposalText}`);
assert(!/Klaviyo Silver Partner with 8\+ years/i.test(noisyDraft.proposalText), `Proposal body should not use credential-first proof when a matched proof artifact exists:\n${noisyDraft.proposalText}`);
assert(noisyDraft.draftQualityGate.ready, `Noisy captured proposal should pass after removing parsed page noise. Issues: ${JSON.stringify(noisyDraft.draftQualityGate.issues)}`);

assert(evaluateDraftQualityGate({
  ...gateBase,
  job: noisyCapturedJob,
  proposalText: "Steve here,\n\nThe opportunity here is conversion can leak when campaigns and flows are not tied to customer moments.\n\nThe customer is deciding whether the offer, timing, and next step feel relevant enough to act on.\n\nIf it makes sense, we can start with the first few customer moments you want the work to improve.",
}).issues.some((issue) => issue.code === "missing_requested_platform_specificity"), "Drafts must fail when they omit explicitly requested Klaviyo/Mailchimp/Omnisend platform scope.");

beauty.applicationDraft = beautyDraft;
markJobSeen(beauty, true);
const planResult = buildBrowserApplyPlan(beauty.id);
assert(planResult.plan?.stopBeforeSubmit === true, "Browser apply plan should keep final submit manual.");
assert(planResult.plan?.finalPreparationDiagnostics.stopBeforeSubmit === true, "Final-prep diagnostics should keep final submit manual.");
assert(beautyDraft.draftQualityGate.finalSubmitManual, "Draft quality gate should preserve manual final submit.");

async function runAsyncAssertions(): Promise<void> {
  let searchCalls = 0;
  const webResearchProvider = {
    name: "mock-search",
    isAvailable: () => true,
    search: async (input: any) => {
      searchCalls += 1;
      assert(input.query.includes("glowroutine.com") || input.query.includes("GlowRoutine"), "Search query should use the visible brand/site clue.");
      return [
        {
          title: "Unsafe local source",
          url: "https://127.0.0.1/private",
          snippet: "This local source must not be retained.",
          provider: "mock-search",
        },
        {
          title: "GlowRoutine skincare routines",
          url: "https://glowroutine.com/pages/about",
          snippet: "GlowRoutine sells skincare routines and education for customers comparing products, building trust, and replenishing at the right moment.",
          provider: "mock-search",
        },
      ];
    },
  };
  const researchedDraft = await buildApplicationDraftWithResearch(beauty, { brandResearchProvider: webResearchProvider });
  assert.equal(searchCalls, 1, "Brand/category job should call the configured web research provider once.");
  assert.equal(researchedDraft.brandFactPack.webResearchStatus, "succeeded", "Brand fact pack should record successful web research.");
  assert.equal(researchedDraft.brandFactPack.webResearchProvider, "mock-search", "Brand fact pack should record the provider.");
  assert.equal(researchedDraft.skillUseTrace.brandResearchProvider, "mock-search", "Skill trace should record the research provider.");
  assert.equal(researchedDraft.skillUseTrace.brandResearchSourceCount, 1, "Skill trace should record source count.");
  assert(researchedDraft.brandFactPack.sourceDetails.some((source: any) => source.url === "https://glowroutine.com/pages/about"), "Fact pack should retain safe source details.");
  assert(!researchedDraft.brandFactPack.sourceDetails.some((source: any) => /127\.0\.0\.1|localhost/i.test(source.url)), "Fact pack should filter unsafe local source details.");
  assert(researchedDraft.brandFactPack.sources.includes("https://glowroutine.com/pages/about"), "Fact pack should retain source URL.");
  assert(researchedDraft.brandFactPack.proofAngle.toLowerCase().includes("trust"), "Beauty fact pack should carry a proof angle from customer logic.");

  const noClueScored = scored({
    title: "Need help writing short emails",
    description: "Need a few account emails rewritten. No brand, website, product, platform, or category details are available yet.",
    category: "",
    skills: ["Email Writing"],
  });
  const callsBeforeNoClue = searchCalls;
  const noClueDraft = await buildApplicationDraftWithResearch(noClueScored, { brandResearchProvider: webResearchProvider });
  assert.equal(searchCalls, callsBeforeNoClue, "No-clue job should not call the web research provider.");
  assert.equal(noClueDraft.brandFactPack.webResearchStatus, "not_applicable", "No-clue job should mark web research not applicable.");

  const unavailableDraft = await buildApplicationDraftWithResearch(beauty, {
    brandResearchProvider: createMockBrandResearchProvider([]),
  });
  assert.equal(unavailableDraft.brandFactPack.webResearchStatus, "failed", "Empty provider results should be recorded as failed.");
  assert(unavailableDraft.brandFactPack.assumptions.some((item: string) => /Web research skipped|source-backed web facts/i.test(item)), "Failed research should record internal assumptions.");
  assert.equal(unavailableDraft.draftQualityGate.ready, true, "Explained research fallback should not block an otherwise safe draft.");

  const disabledDraft = await buildApplicationDraftWithResearch(beauty, {
    brandResearchProvider: {
      name: "mock-disabled",
      isAvailable: () => false,
      search: async () => {
        throw new Error("should not be called");
      },
    },
  });
  assert.equal(disabledDraft.brandFactPack.webResearchStatus, "not_configured", "Disabled provider should be recorded as not configured.");
  assert(disabledDraft.brandFactPack.assumptions.some((item: string) => /not configured/i.test(item)), "Disabled provider should record an internal assumption.");

  console.log("skill runtime tests passed");
}

runAsyncAssertions().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
