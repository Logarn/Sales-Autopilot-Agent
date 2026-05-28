#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing production env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

run() {
  echo "==> $*"
  "$@"
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env value: $key" >&2
    exit 1
  fi
}

check_service_active() {
  local service="$1"
  if ! command -v systemctl >/dev/null 2>&1 || [[ ! -d /run/systemd/system ]]; then
    echo "systemd unavailable here; skipped ${service}."
    return 0
  fi
  systemctl is-active --quiet "$service"
  echo "${service}: active"
}

require_env SLACK_BOT_TOKEN
require_env SLACK_APP_TOKEN
require_env DISCOVERY_SLACK_CHANNEL_ID
require_env SLACK_ALLOWED_CHANNEL_IDS

run bash scripts/validate-contabo-env.sh "$ENV_FILE"
run check_service_active upwork-agent-browser-session.service
run bash scripts/check-browser-session.sh --wait
run check_service_active upwork-agent-slack-socket.service
run check_service_active upwork-agent-health.timer

if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]] && systemctl is-active --quiet upwork-agent-lead-engine.service; then
  echo "upwork-agent-lead-engine.service: active"
else
  run npm run -s agent:run-once:dry
fi

run npm run -s browser:tool -- session.check
run npm run -s health
run npx tsx src/browserSafetyGuard.test.ts

echo "Production smoke passed."
