import { HEALTH_ALERT_COOLDOWN_MS, HEARTBEAT_STALE_AFTER_MS } from "./config";
import { closeDb, getHealthAlertLastSent, listBrowserActions, recordHealthAlertSent } from "./db";
import { HeartbeatRecord, readHeartbeats, readStaleHeartbeats, writeHeartbeat } from "./heartbeat";
import { logger } from "./logger";
import { sendHealthAlert } from "./slack";
import { formatBrowserSessionStatus, getBrowserSessionStatus } from "./browserSession";

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
      message: `Browser action #${action.id} requires attention: ${action.lastError}; retry: npm run browser:retry -- --id ${action.id}`,
    })),
  ];
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
    ...browserStateFindings(),
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
