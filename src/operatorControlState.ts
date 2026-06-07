import * as fs from "node:fs";
import * as path from "node:path";
import { DB_PATH } from "./config";

export interface HuntingControlState {
  huntingPaused: boolean;
  reason: string | null;
  updatedAt: string;
}

const DEFAULT_STATE: HuntingControlState = {
  huntingPaused: false,
  reason: null,
  updatedAt: new Date(0).toISOString(),
};

function controlStatePath(): string {
  return path.join(path.dirname(path.resolve(process.cwd(), DB_PATH)), "operator-control-state.json");
}

export function readHuntingControlState(): HuntingControlState {
  const filePath = controlStatePath();
  if (!fs.existsSync(filePath)) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<HuntingControlState>;
    return {
      huntingPaused: parsed.huntingPaused === true,
      reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function setHuntingPaused(paused: boolean, reason: string | null = null, now = new Date()): HuntingControlState {
  const state: HuntingControlState = {
    huntingPaused: paused,
    reason: paused ? reason ?? "Paused from Slack." : null,
    updatedAt: now.toISOString(),
  };
  const filePath = controlStatePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export function isHuntingPaused(): boolean {
  return readHuntingControlState().huntingPaused;
}
