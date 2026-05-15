import * as fs from "node:fs";
import * as path from "node:path";
import { CONNECTS_RULES_CONFIG_PATH, PORTFOLIO_CONFIG_PATH, PROFILE_CONFIG_PATH } from "./config";
import { ConnectsRules, FreelancerProfile, PortfolioLibrary } from "./types";

const defaultProfile: FreelancerProfile = {
  name: "Freelancer",
  title: "Specialist",
  niche: "High-quality freelance work",
  hourlyRate: 0,
  location: "Remote",
  summary: "Experienced specialist focused on practical outcomes.",
  skills: [],
  preferredIndustries: [],
  avoidIndustries: [],
  preferredJobTypes: [],
  avoidJobTypes: [],
  proofPoints: [],
  voice: {
    tone: ["direct", "conversational"],
    openingStyle: "Open with the client's actual problem.",
    ctaStyle: "End with a clear next step.",
    lengthPreference: "120-190 words.",
    bannedPhrases: [],
    preferredPhrases: [],
  },
};

const defaultPortfolio: PortfolioLibrary = { items: [] };

const defaultConnectsRules: ConnectsRules = {
  maxRequiredPerJob: 50,
  idealBoostMin: 10,
  idealBoostMax: 30,
  maxBoost: 50,
  dailyCap: 75,
  weeklyCap: 225,
  neverBidMax: true,
  requireApprovalAbove: 30,
  targetBoostRank: 3,
  skipIfTopBidAbove: 50,
};

function readJsonFile<T>(filePath: string, fallback: T): T {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    return fallback;
  }
  const raw = fs.readFileSync(resolved, "utf8");
  return JSON.parse(raw) as T;
}

export function loadFreelancerProfile(): FreelancerProfile {
  return readJsonFile<FreelancerProfile>(PROFILE_CONFIG_PATH, defaultProfile);
}

export function loadPortfolioLibrary(): PortfolioLibrary {
  return readJsonFile<PortfolioLibrary>(PORTFOLIO_CONFIG_PATH, defaultPortfolio);
}

export function loadConnectsRules(): ConnectsRules {
  return readJsonFile<ConnectsRules>(CONNECTS_RULES_CONFIG_PATH, defaultConnectsRules);
}
