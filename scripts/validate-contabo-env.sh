#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_FILE="${ENV_FILE:-}"
if [[ $# -gt 0 ]]; then
  ENV_FILE="$1"
fi

if [[ -z "$ENV_FILE" ]]; then
  if [[ -f "$ROOT_DIR/.env" ]]; then
    ENV_FILE="$ROOT_DIR/.env"
    MODE="deployment"
  else
    ENV_FILE="$ROOT_DIR/.env.example"
    MODE="template"
  fi
else
  MODE="custom"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

required_keys=(
  SLACK_CHANNEL_WEBHOOK_URL
  APIFY_API_TOKEN
  DB_PATH
  PROFILE_CONFIG_PATH
  PORTFOLIO_CONFIG_PATH
  CONNECTS_RULES_CONFIG_PATH
  MANUAL_JOBS_CONFIG_PATH
  SAVED_SEARCHES_CONFIG_PATH
  LLM_PROVIDER
  LLM_MODEL
  BROWSER_SESSION_MODE
  BROWSER_CDP_URL
  BROWSER_USER_DATA_DIR
  BROWSER_ARTIFACT_DIR
  AGENT_ENGINE_STATE_PATH
  HEARTBEAT_STALE_AFTER_MS
  HEALTH_ALERT_COOLDOWN_MS
)

path_keys=(
  DB_PATH
  PROFILE_CONFIG_PATH
  PORTFOLIO_CONFIG_PATH
  CONNECTS_RULES_CONFIG_PATH
  MANUAL_JOBS_CONFIG_PATH
  SAVED_SEARCHES_CONFIG_PATH
  BROWSER_USER_DATA_DIR
  BROWSER_ARTIFACT_DIR
  AGENT_ENGINE_STATE_PATH
)

value_for() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  printf '%s\n' "${line#*=}"
}

missing=()
for key in "${required_keys[@]}"; do
  if ! grep -q -E "^${key}=" "$ENV_FILE"; then
    missing+=("$key")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'Missing required env keys in %s:\n' "$ENV_FILE" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi

session_mode="$(value_for BROWSER_SESSION_MODE)"
case "$session_mode" in
  cdp|launch) ;;
  *)
    echo "BROWSER_SESSION_MODE must be 'cdp' or 'launch'." >&2
    exit 1
    ;;
esac

for key in "${path_keys[@]}"; do
  value="$(value_for "$key")"
  if [[ -z "$value" ]]; then
    echo "$key must not be empty." >&2
    exit 1
  fi
done

if [[ "$MODE" != "template" ]]; then
  contabo_warnings=()
  for key in DB_PATH BROWSER_USER_DATA_DIR BROWSER_ARTIFACT_DIR AGENT_ENGINE_STATE_PATH; do
    value="$(value_for "$key")"
    if [[ "$value" != /opt/upwork-agent/* ]]; then
      contabo_warnings+=("$key")
    fi
  done

  if (( ${#contabo_warnings[@]} > 0 )); then
    printf 'Warning: these keys are not using /opt/upwork-agent paths in %s:\n' "$ENV_FILE" >&2
    printf '  - %s\n' "${contabo_warnings[@]}" >&2
  fi
fi

echo "Validated env template: $ENV_FILE ($MODE mode)"
echo "Required keys are present and path variables are configured."
