import { ApifyUpworkSource } from "./apifySource";
import { ManualJobSource } from "./manualSource";
import { JobSource } from "./types";

export function getEnabledJobSources(): JobSource[] {
  return [new ApifyUpworkSource(), new ManualJobSource()];
}

export * from "./types";
