#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# Smoke validation must never consume live browser actions or post fixture alerts
# into the operator Slack channel. Use production config paths where harmless,
# but isolate mutable state and disable Slack transports for this dry run.
export DB_PATH="$TMP_DIR/jobs.db"
export AGENT_ENGINE_STATE_PATH="$TMP_DIR/agent-engine-state.json"
export SLACK_CHANNEL_WEBHOOK_URL=""
export SLACK_BOT_TOKEN=""
export SLACK_APP_TOKEN=""
export DISCOVERY_SLACK_CHANNEL_ID=""
export SLACK_SOCKET_MODE_ENABLED="false"
export SLACK_COPY_LLM_ENABLED="false"
export BROWSER_DRY_RUN="true"

npm run -s agent:run-once:dry
