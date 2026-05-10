import { BROWSER_WORKER_ENABLED, SCHEDULER_INTERVAL_MS, validateRequiredConfig } from "./config";
import { closeDb } from "./db";
import { runHealthCheck } from "./health";
import { writeHeartbeat } from "./heartbeat";
import { logger } from "./logger";
import { runBrowserWorker } from "./browserWorker";
import { runPipeline, startupHealthCheck } from "./index";

interface SchedulerJob {
  name: string;
  run: () => Promise<void>;
  enabled?: () => boolean;
}

let stopping = false;
const runningJobs = new Set<string>();
let timer: NodeJS.Timeout | null = null;
let tickPromise: Promise<void> | null = null;

async function runJob(job: SchedulerJob): Promise<void> {
  if (stopping || job.enabled?.() === false) {
    return;
  }
  if (runningJobs.has(job.name)) {
    logger.warn(`Skipping scheduler job ${job.name}; previous run is still active.`);
    return;
  }

  runningJobs.add(job.name);
  writeHeartbeat({ worker: job.name, status: "running", metadata: { source: "scheduler" } });
  try {
    await job.run();
    writeHeartbeat({ worker: job.name, status: "success", metadata: { source: "scheduler" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeHeartbeat({ worker: job.name, status: "error", error: message, metadata: { source: "scheduler" } });
    logger.error(`Scheduler job ${job.name} failed: ${message}`);
  } finally {
    runningJobs.delete(job.name);
  }
}

function buildJobs(): SchedulerJob[] {
  return [
    {
      name: "pipeline",
      run: async () => {
        await runPipeline("scheduler");
      },
    },
    {
      name: "browser-worker",
      enabled: () => BROWSER_WORKER_ENABLED,
      run: runBrowserWorker,
    },
    {
      name: "health-check",
      run: async () => {
        const report = await runHealthCheck({ alert: true });
        logger.info(`Health check complete. status=${report.status} findings=${report.findings.length}`);
      },
    },
  ];
}

async function tick(jobs: SchedulerJob[]): Promise<void> {
  if (stopping) {
    return;
  }
  for (const job of jobs) {
    if (stopping) {
      return;
    }
    await runJob(job);
  }
}

function scheduleNext(jobs: SchedulerJob[]): void {
  if (stopping) {
    return;
  }
  timer = setTimeout(() => {
    tickPromise = tick(jobs).finally(() => scheduleNext(jobs));
  }, SCHEDULER_INTERVAL_MS);
}

export async function startScheduler(): Promise<void> {
  const jobs = buildJobs();
  logger.info(`Starting scheduler loop. intervalMs=${SCHEDULER_INTERVAL_MS}`);
  await startupHealthCheck({ sendSlackStartup: true });
  tickPromise = tick(jobs);
  scheduleNext(jobs);
}

export async function stopScheduler(): Promise<void> {
  stopping = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await tickPromise;
}

function setupShutdown(): void {
  const shutdown = async (signal: string) => {
    if (stopping) {
      return;
    }
    logger.info(`Received ${signal}. Stopping scheduler...`);
    await stopScheduler();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

if (require.main === module) {
  setupShutdown();
  validateRequiredConfig();
  startScheduler().catch((error: unknown) => {
    logger.error(`Fatal scheduler error: ${error instanceof Error ? error.message : String(error)}`);
    closeDb();
    process.exitCode = 1;
  });
}
