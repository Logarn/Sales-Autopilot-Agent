import { AGENT_ENGINE_QUEUE_CAP, HEALTH_ALERT_COOLDOWN_MS, HEARTBEAT_STALE_AFTER_MS, LLM_NORMALIZATION_ENABLED } from "./config";
import { closeDb, getHealthAlertLastSent, getSlackQueueStats, listBrowserActions, recordHealthAlertSent } from "./db";
import { HeartbeatRecord, readHeartbeats, readStaleHeartbeats, writeHeartbeat } from "./heartbeat";
import { getLlmProviderConfig } from "./llm/provider";
import { logger } from "./logger";
import { sendHealthAlert } from "./slack";
import { formatBrowserSessionStatus, getBrowserSessionStatus } from "./browserSession";
import { readLatestState } from "./leadEngine";

type HealthSeverity = "ok" | "warning" | "critical";

export interface HealthFinding {
  key: string;
  severity: Exclude<HealthSeverity, "ok">;
  message: string;
}

export interface HealthReport {
  generatedAt: string;
  status: HealthSeverity;
  heartbeats: HeartbeatRecord[];
  staleHeartbeats: HeartbeatRecord[];
  findings: HealthFinding[];
}

function browserStateFindings(): HealthFinding[] {
  const session = getBrowserSessionStatus();
  const sessionFindings: HealthFinding[] = session.blocked
    ? [
        {
          key: "browser-session-state",
          severity: session.state === "browser_session_unhealthy" ? "critical" : "warning",
          message: `Browser session requires attention: ${formatBrowserSessionStatus(session)}`,
        },
      ]
    : [];
  const paused = listBrowserActions("paused", 50);
  return [
    ...sessionFindings,
    ...paused
    .filter((action) => {
      const error = (action.lastError ?? "").toLowerCase();
      return ["login_required", "two_factor_required", "captcha_or_security_challenge", "browser_unavailable"].some((state) =>
        error.includes(state)
      );
    })
    .map((action) => ({
      key: `browser-action-${action.id}`,
      severity: "warning" as const,
      message: `A browser step requires attention: ${action.lastError}. Clear the visible remote Chrome issue, then reply “retry” in the relevant Slack thread. Ask for debug details if you need the raw action id.`,
    })),
  ];
}

function queueFindings(): HealthFinding[] {
  const pending = listBrowserActions("pending", 1000);
  const slackQueue = getSlackQueueStats();
  const findings: HealthFinding[] = [];
  if (pending.length >= AGENT_ENGINE_QUEUE_CAP) {
    findings.push({
      key: "browser-action-backpressure",
      severity: "warning",
      message: `Browser action queue is backed up (${pending.length} pending). Let the worker drain or inspect stuck actions before discovery adds more.`,
    });
  }
  if (slackQueue.count > 0) {
    findings.push({
      key: "slack-posting-backed-up",
      severity: slackQueue.maxAttempts >= 3 ? "critical" : "warning",
      message: `Slack posting is backed up (${slackQueue.count} queued message(s), max attempts ${slackQueue.maxAttempts}). Check Slack webhook credentials/network, then run the Slack queue flush.`,
    });
  }
  return findings;
}

function llmProviderFindings(): HealthFinding[] {
  if (!LLM_NORMALIZATION_ENABLED) return [];
  const config = getLlmProviderConfig();
  if (config.apiKey.trim() && config.model.trim() && config.baseUrl.trim()) return [];
  return [{
    key: "llm-provider-unavailable",
    severity: "warning",
    message: `LLM provider ${config.provider} is enabled but unavailable. Set the provider key/model/base URL or disable LLM normalization until credentials are ready.`,
  }];
}

function leadEngineFindings(): HealthFinding[] {
  const state = readLatestState();
  if (!state) return [];
  const findings: HealthFinding[] = [];
  if (state.status === "paused" && state.stoppedReason !== "agent_engine_disabled") {
    findings.push({
      key: "lead-engine-paused",
      severity: "warning",
      message: `Lead engine is paused: ${state.stoppedReason}. Check browser/session state and rerun npm run agent:run-once:dry after fixing it.`,
    });
  }
  if (state.status === "degraded") {
    findings.push({
      key: "lead-engine-degraded",
      severity: "warning",
      message: `Lead engine is degraded: ${state.stoppedReason}${state.discoveryError ? ` (${state.discoveryError})` : ""}.`,
    });
  }
  if (state.queueBackpressure) {
    findings.push({
      key: "lead-engine-backpressure",
      severity: "warning",
      message: `Lead engine skipped discovery because the queue is backed up (${state.queuePendingBefore} pending before cycle).`,
    });
  }
  return findings;
}

export function buildHealthReport(now = new Date()): HealthReport {
  const heartbeats = readHeartbeats();
  const staleHeartbeats = readStaleHeartbeats(HEARTBEAT_STALE_AFTER_MS, now);
  const findings: HealthFinding[] = [
    ...staleHeartbeats.map((heartbeat) => ({
      key: `stale-${heartbeat.worker}`,
      severity: "critical" as const,
      message: `Worker ${heartbeat.worker} is stale. Last update: ${heartbeat.updatedAt}`,
    })),
    ...heartbeats
      .filter((heartbeat) => heartbeat.status === "error")
      .map((heartbeat) => ({
        key: `worker-error-${heartbeat.worker}`,
        severity: "critical" as const,
        message: `Worker ${heartbeat.worker} last errored: ${heartbeat.lastError ?? "unknown error"}`,
      })),
    ...browserStateFindings(),
    ...queueFindings(),
    ...llmProviderFindings(),
    ...leadEngineFindings(),
  ];

  return {
    generatedAt: now.toISOString(),
    status: findings.some((finding) => finding.severity === "critical")
      ? "critical"
      : findings.length > 0
        ? "warning"
        : "ok",
    heartbeats,
    staleHeartbeats,
    findings,
  };
}

export async function runHealthCheck(options: { alert?: boolean } = {}): Promise<HealthReport> {
  writeHeartbeat({ worker: "health-check", status: "running" });
  const report = buildHealthReport();
  writeHeartbeat({
    worker: "health-check",
    status: report.status === "critical" ? "error" : "success",
    error: report.status === "critical" ? `${report.findings.length} health finding(s)` : null,
    metadata: { status: report.status, findings: report.findings.length },
  });

  if (options.alert) {
    await sendConservativeHealthAlerts(report);
  }
  return report;
}

export async function sendConservativeHealthAlerts(report: HealthReport, now = Date.now()): Promise<void> {
  for (const finding of report.findings) {
    const previous = getHealthAlertLastSent(finding.key);
    if (previous && now - Date.parse(previous) < HEALTH_ALERT_COOLDOWN_MS) {
      continue;
    }
    const sent = await sendHealthAlert(finding.message, finding.severity);
    if (sent) {
      recordHealthAlertSent(finding.key, new Date(now));
    }
  }
}

export function printHealthReport(report: HealthReport): void {
  console.log(`Health: ${report.status.toUpperCase()} @ ${report.generatedAt}`);
  console.log(`Heartbeats: ${report.heartbeats.length}; stale: ${report.staleHeartbeats.length}`);
  for (const heartbeat of report.heartbeats) {
    console.log(
      `- ${heartbeat.worker}: ${heartbeat.status} updated=${heartbeat.updatedAt} runs=${heartbeat.runCount} successes=${heartbeat.successCount} errors=${heartbeat.errorCount}`
    );
  }
  if (report.findings.length > 0) {
    console.log("Findings:");
    for (const finding of report.findings) {
      console.log(`- [${finding.severity}] ${finding.message}`);
    }
  }
}

if (require.main === module) {
  runHealthCheck({ alert: process.argv.includes("--alert") })
    .then((report) => {
      printHealthReport(report);
      process.exitCode = report.status === "critical" ? 2 : 0;
    })
    .catch((error: unknown) => {
      logger.error(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
