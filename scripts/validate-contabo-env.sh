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

if [[ "$(basename "$ENV_FILE")" == ".env.example" ]]; then
  MODE="template"
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

production_slack_keys=(
  SLACK_BOT_TOKEN
  SLACK_APP_TOKEN
  SLACK_SOCKET_MODE_ENABLED
  SLACK_INBOUND_MODE
  DISCOVERY_SLACK_CHANNEL_ID
  SLACK_ALLOWED_CHANNEL_IDS
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

is_truthy() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

list_contains_id() {
  local list="$1"
  local expected="$2"
  local item
  IFS=',|' read -r -a items <<< "$list"
  for item in "${items[@]}"; do
    item="${item#"${item%%[![:space:]]*}"}"
    item="${item%"${item##*[![:space:]]}"}"
    if [[ "$item" == "$expected" ]]; then
      return 0
    fi
  done
  return 1
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

if [[ "$MODE" != "template" ]]; then
  missing_slack=()
  empty_slack=()
  for key in "${production_slack_keys[@]}"; do
    if ! grep -q -E "^${key}=" "$ENV_FILE"; then
      missing_slack+=("$key")
      continue
    fi
    value="$(value_for "$key")"
    if [[ -z "$value" ]]; then
      empty_slack+=("$key")
    fi
  done

  if (( ${#missing_slack[@]} > 0 )); then
    printf 'Missing required Slack Web API / Socket Mode keys in %s:\n' "$ENV_FILE" >&2
    printf '  - %s\n' "${missing_slack[@]}" >&2
    exit 1
  fi

  if (( ${#empty_slack[@]} > 0 )); then
    printf 'Empty required Slack Web API / Socket Mode values in %s:\n' "$ENV_FILE" >&2
    printf '  - %s\n' "${empty_slack[@]}" >&2
    exit 1
  fi

  socket_enabled="$(value_for SLACK_SOCKET_MODE_ENABLED)"
  if is_truthy "$socket_enabled"; then
    inbound_mode="$(value_for SLACK_INBOUND_MODE)"
    if [[ "$inbound_mode" != "socket_mode" ]]; then
      echo "SLACK_INBOUND_MODE must be socket_mode when SLACK_SOCKET_MODE_ENABLED=true." >&2
      exit 1
    fi

    discovery_channel="$(value_for DISCOVERY_SLACK_CHANNEL_ID)"
    allowed_channels="$(value_for SLACK_ALLOWED_CHANNEL_IDS)"
    if ! list_contains_id "$allowed_channels" "$discovery_channel"; then
      echo "DISCOVERY_SLACK_CHANNEL_ID must be included in SLACK_ALLOWED_CHANNEL_IDS when Socket Mode is enabled." >&2
      exit 1
    fi
  fi
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
  if [[ "$session_mode" != "cdp" ]]; then
    echo "Production Contabo env must use BROWSER_SESSION_MODE=cdp." >&2
    exit 1
  fi

  cdp_url="$(value_for BROWSER_CDP_URL)"
  case "$cdp_url" in
    http://127.0.0.1:9222|http://localhost:9222) ;;
    *)
      echo "Production Contabo env must keep BROWSER_CDP_URL on localhost port 9222." >&2
      exit 1
      ;;
  esac

  if start_url="$(value_for BROWSER_START_URL)"; then
    if [[ "$start_url" != https://www.upwork.com/nx/find-work/best-matches* ]]; then
      echo "Production Contabo env must start Chrome on the Upwork Best Matches URL." >&2
      exit 1
    fi
  fi

  browser_profile="$(value_for BROWSER_USER_DATA_DIR)"
  if [[ "$browser_profile" != /opt/upwork-agent/shared/browser-profile ]]; then
    echo "Production Contabo env must use BROWSER_USER_DATA_DIR=/opt/upwork-agent/shared/browser-profile." >&2
    exit 1
  fi

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
