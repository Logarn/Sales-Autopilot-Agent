#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_files=(
  "docs/CONTABO_RUNBOOK.md"
  "deploy/systemd/upwork-agent-browser-session.service"
  "deploy/systemd/upwork-agent-lead-engine.service"
  "deploy/systemd/upwork-agent-slack-socket.service"
  "deploy/systemd/upwork-agent-health.service"
  "deploy/systemd/upwork-agent-health.timer"
  "scripts/validate-promotion.sh"
  "scripts/validate-contabo-env.sh"
  "scripts/preflight-contabo.sh"
  "scripts/start-browser-session.sh"
  "scripts/check-browser-session.sh"
  "scripts/production-smoke.sh"
)

missing_files=()
for path in "${required_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    missing_files+=("$path")
  fi
done

if (( ${#missing_files[@]} > 0 )); then
  printf 'Missing required deployment files:\n' >&2
  printf '  - %s\n' "${missing_files[@]}" >&2
  exit 1
fi

for script in scripts/validate-promotion.sh scripts/validate-contabo-env.sh scripts/preflight-contabo.sh scripts/start-browser-session.sh scripts/check-browser-session.sh scripts/production-smoke.sh; do
  if [[ ! -x "$script" ]]; then
    echo "Script is not executable: $script" >&2
    exit 1
  fi
  bash -n "$script"
done

node <<'NODE'
const fs = require('node:fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const required = ['validate:promotion', 'validate:contabo-env', 'preflight:contabo', 'slack:socket', 'browser:session:service', 'browser:session:check', 'production:smoke'];
const missing = required.filter((name) => !pkg.scripts || !pkg.scripts[name]);
if (missing.length) {
  console.error('Missing package.json scripts:', missing.join(', '));
  process.exit(1);
}
NODE

node <<'NODE'
const fs = require('node:fs');

function requireText(path, checks) {
  const text = fs.readFileSync(path, 'utf8');
  for (const [label, pattern] of checks) {
    if (!pattern.test(text)) {
      console.error(`${path} failed check: ${label}`);
      process.exit(1);
    }
  }
  return text;
}

const browserService = requireText('deploy/systemd/upwork-agent-browser-session.service', [
  ['runs as upwork-agent', /^User=upwork-agent$/m],
  ['uses display :1', /^Environment=DISPLAY=:1$/m],
  ['uses browser session wrapper', /^ExecStart=\/usr\/bin\/env bash scripts\/start-browser-session\.sh$/m],
  ['loads deployment env file', /^EnvironmentFile=-\/opt\/upwork-agent\/app\/\.env$/m],
]);
if (/DISPLAY=:0/.test(browserService)) {
  console.error('Browser session service must not use DISPLAY=:0.');
  process.exit(1);
}

const leadService = requireText('deploy/systemd/upwork-agent-lead-engine.service', [
  ['orders after browser session', /^After=.*upwork-agent-browser-session\.service.*$/m],
  ['requires browser session', /^Requires=upwork-agent-browser-session\.service$/m],
]);

requireText('scripts/start-browser-session.sh', [
  ['starts VNC localhost-only', /-localhost yes/],
  ['defaults to display :1', /DISPLAY="\$\{DISPLAY:-:1\}"/],
  ['checks CDP before launching Chrome', /cdp_reachable/],
]);

const secretPattern = new RegExp(['xoxb', 'xapp', 'sk'].map((prefix) => `${prefix}-`).join('|'));
if (secretPattern.test(browserService + leadService)) {
  console.error('Service files must not contain secrets.');
  process.exit(1);
}
NODE

forbidden_tracked=(
  ".env"
  ".codex/"
  ".gc/"
  ".runtime/"
  "dist/"
  "data/"
  ".DS_Store"
  "b79788f-combined-agent-engine.patch"
  "TEST_PROJECT_AUDIT_2026-05-23.md"
  "CONTABO_DEPLOYMENT_PLAN.md"
  "CONTABO_DEPLOYMENT_TASK_BRIEF.md"
  ".beads/"
)

tracked_violations=()
for path in "${forbidden_tracked[@]}"; do
  if git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
    tracked_violations+=("$path")
  fi
done

if (( ${#tracked_violations[@]} > 0 )); then
  printf 'Forbidden tracked runtime or local artifacts detected:\n' >&2
  printf '  - %s\n' "${tracked_violations[@]}" >&2
  exit 1
fi

bash scripts/validate-contabo-env.sh

echo "Contabo preflight checks passed."
