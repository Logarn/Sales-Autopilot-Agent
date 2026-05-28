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

for script in scripts/validate-promotion.sh scripts/validate-contabo-env.sh scripts/preflight-contabo.sh; do
  if [[ ! -x "$script" ]]; then
    echo "Script is not executable: $script" >&2
    exit 1
  fi
done

node <<'NODE'
const fs = require('node:fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const required = ['validate:promotion', 'validate:contabo-env', 'preflight:contabo', 'slack:socket'];
const missing = required.filter((name) => !pkg.scripts || !pkg.scripts[name]);
if (missing.length) {
  console.error('Missing package.json scripts:', missing.join(', '));
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
