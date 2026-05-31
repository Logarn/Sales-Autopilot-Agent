#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

CRON_ENV="$TMP_DIR/cron.env"
cat >"$CRON_ENV" <<'ENV'
CRON_SCHEDULE=*/5 * * * *
DAILY_SUMMARY_CRON=0 8 * * *
BROWSER_CDP_URL=http://127.0.0.1:9222
BROWSER_USER_DATA_DIR=/opt/upwork-agent/shared/browser-profile
ENV

exports="$(node scripts/dotenv-export.js "$CRON_ENV")"
eval "$exports"

if [[ "$CRON_SCHEDULE" != "*/5 * * * *" ]]; then
  echo "CRON_SCHEDULE was not loaded as a literal dotenv value." >&2
  exit 1
fi
if [[ "$DAILY_SUMMARY_CRON" != "0 8 * * *" ]]; then
  echo "DAILY_SUMMARY_CRON was not loaded as a literal dotenv value." >&2
  exit 1
fi

if grep -R -n -E '(^|[[:space:]])(source|\.)[[:space:]]+["'\'']?\$?\{?ENV_FILE|(^|[[:space:]])(source|\.)[[:space:]]+["'\'']?\.env' \
  scripts/start-browser-session.sh scripts/check-browser-session.sh scripts/production-smoke.sh; then
  echo "Browser-session shell scripts must not source dotenv files directly." >&2
  exit 1
fi

if ! ENV_FILE=.env.example npm run -s production:smoke >"$TMP_DIR/template-smoke.out" 2>"$TMP_DIR/template-smoke.err"; then
  cat "$TMP_DIR/template-smoke.out"
  cat "$TMP_DIR/template-smoke.err" >&2
  echo "ENV_FILE=.env.example production smoke should parse dotenv safely and pass template checks." >&2
  exit 1
fi

if ! grep -q "template check passed" "$TMP_DIR/template-smoke.out"; then
  cat "$TMP_DIR/template-smoke.out"
  echo "Template production smoke did not report template-only validation." >&2
  exit 1
fi

if ENV_FILE="$TMP_DIR/missing.env" npm run -s production:smoke >"$TMP_DIR/missing.out" 2>"$TMP_DIR/missing.err"; then
  echo "Production smoke should fail when ENV_FILE is missing." >&2
  exit 1
fi
if ! grep -q "Missing production env file" "$TMP_DIR/missing.err"; then
  cat "$TMP_DIR/missing.err" >&2
  echo "Missing env failure should be explicit and should not execute env text." >&2
  exit 1
fi

if ! grep -q "flock -n" scripts/start-browser-session.sh; then
  echo "Browser-session service must use flock to guard duplicate starts." >&2
  exit 1
fi
if ! grep -q "chrome_session_running" scripts/start-browser-session.sh; then
  echo "Browser-session service must check for an existing Chrome session." >&2
  exit 1
fi
if ! grep -q -- "--user-data-dir" scripts/start-browser-session.sh || ! grep -q -- "--remote-debugging-port" scripts/start-browser-session.sh; then
  echo "Duplicate Chrome check must match both profile and CDP port." >&2
  exit 1
fi

echo "browser session shell script tests passed"
