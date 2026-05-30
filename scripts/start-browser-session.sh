#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

load_dotenv_if_present() {
  local env_file="${ENV_FILE:-.env}"
  if [[ -f "$env_file" ]]; then
    local exports
    exports="$(node scripts/dotenv-export.js "$env_file")"
    if [[ -n "$exports" ]]; then
      eval "$exports"
    fi
  fi
}

load_dotenv_if_present

export DISPLAY="${DISPLAY:-:1}"
export BROWSER_CDP_URL="${BROWSER_CDP_URL:-http://127.0.0.1:9222}"
export BROWSER_USER_DATA_DIR="${BROWSER_USER_DATA_DIR:-/opt/upwork-agent/shared/browser-profile}"
export BROWSER_START_URL="${BROWSER_START_URL:-https://www.upwork.com/nx/find-work/best-matches/}"

VNC_GEOMETRY="${VNC_GEOMETRY:-1920x1080}"
VNC_DEPTH="${VNC_DEPTH:-24}"
MONITOR_INTERVAL="${BROWSER_SESSION_MONITOR_INTERVAL_SEC:-30}"
MONITOR_LOCK_FILE="${BROWSER_SESSION_LOCK_FILE:-${BROWSER_USER_DATA_DIR%/}/browser-session.lock}"
CHROME_START_LOCK_FILE="${BROWSER_CHROME_LOCK_FILE:-${BROWSER_USER_DATA_DIR%/}/chrome-start.lock}"

log() {
  printf '%s %s\n' "$(date -Is)" "$*"
}

display_number() {
  local value="${DISPLAY#:}"
  printf '%s\n' "${value%%.*}"
}

assert_localhost_cdp() {
  node <<'NODE'
const raw = process.env.BROWSER_CDP_URL || "http://127.0.0.1:9222";
let parsed;
try {
  parsed = new URL(raw);
} catch (error) {
  console.error(`Invalid BROWSER_CDP_URL: ${raw}`);
  process.exit(1);
}
const host = parsed.hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
  console.error(`BROWSER_CDP_URL must stay localhost-only; got ${raw}`);
  process.exit(1);
}
NODE
}

abs_path() {
  node -e 'const path = require("node:path"); console.log(path.resolve(process.argv[1] || ""));' "$1"
}

cdp_port() {
  node -e '
    try {
      const url = new URL(process.env.BROWSER_CDP_URL || "http://127.0.0.1:9222");
      console.log(url.port || "9222");
    } catch {
      console.log("9222");
    }
  '
}

cdp_reachable() {
  node -e '
    const url = new URL("/json/version", process.env.BROWSER_CDP_URL || "http://127.0.0.1:9222");
    fetch(url).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1));
  ' >/dev/null 2>&1
}

chrome_session_pids() {
  local user_data_dir port pid args
  user_data_dir="$(abs_path "$BROWSER_USER_DATA_DIR")"
  port="$(cdp_port)"
  if ! command -v pgrep >/dev/null 2>&1; then
    return 1
  fi
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    if [[ "$args" == *"--remote-debugging-port=${port}"* && "$args" == *"--user-data-dir=${user_data_dir}"* ]]; then
      printf '%s\n' "$pid"
    fi
  done < <(pgrep -u "$(id -u)" -f -- "--remote-debugging-port=${port}" 2>/dev/null || true)
}

chrome_session_running() {
  [[ -n "$(chrome_session_pids | head -n 1)" ]]
}

acquire_monitor_lock() {
  mkdir -p "$(dirname "$MONITOR_LOCK_FILE")" "$BROWSER_USER_DATA_DIR"
  exec 9>"$MONITOR_LOCK_FILE"
  if ! flock -n 9; then
    log "Another browser-session monitor already holds ${MONITOR_LOCK_FILE}; exiting without starting Chrome."
    exit 0
  fi
}

vnc_command() {
  if command -v vncserver >/dev/null 2>&1; then
    command -v vncserver
    return 0
  fi
  if command -v tigervncserver >/dev/null 2>&1; then
    command -v tigervncserver
    return 0
  fi
  return 1
}

vnc_running() {
  local display
  display="$(display_number)"
  [[ -S "/tmp/.X11-unix/X${display}" ]] && return 0
  pgrep -u "$(id -u)" -f "(Xtigervnc|Xvnc|tigervnc).*:${display}( |$)" >/dev/null 2>&1
}

start_vnc_if_needed() {
  if vnc_running; then
    return 0
  fi

  local cmd
  if ! cmd="$(vnc_command)"; then
    log "VNC server command not found. Install tigervnc-standalone-server."
    return 1
  fi

  mkdir -p "$HOME/.vnc" "$(dirname "$BROWSER_USER_DATA_DIR")" "$BROWSER_USER_DATA_DIR"
  log "Starting VNC on ${DISPLAY} bound to localhost."
  "$cmd" "$DISPLAY" -localhost yes -geometry "$VNC_GEOMETRY" -depth "$VNC_DEPTH"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    vnc_running && return 0
    sleep 1
  done
  log "VNC did not become ready on ${DISPLAY}."
  return 1
}

start_chrome_if_needed() {
  if cdp_reachable; then
    return 0
  fi

  if chrome_session_running; then
    log "Chrome is already running with ${BROWSER_USER_DATA_DIR} and $(cdp_port) debugging port, but CDP is not reachable yet; not starting a duplicate."
    return 0
  fi

  mkdir -p "$BROWSER_USER_DATA_DIR"
  exec 8>"$CHROME_START_LOCK_FILE"
  if ! flock -n 8; then
    log "Chrome start lock is held at ${CHROME_START_LOCK_FILE}; not starting a duplicate."
    return 0
  fi

  if cdp_reachable; then
    return 0
  fi
  if chrome_session_running; then
    log "Chrome appeared while waiting for the start lock; not starting a duplicate."
    return 0
  fi

  log "CDP is not reachable at ${BROWSER_CDP_URL}; starting Chrome on ${DISPLAY}."
  npm run -s browser:session
}

last_state=""
assert_localhost_cdp
acquire_monitor_lock

while true; do
  start_vnc_if_needed
  start_chrome_if_needed

  if cdp_reachable; then
    if [[ "$last_state" != "healthy" ]]; then
      log "Browser CDP is healthy at ${BROWSER_CDP_URL}."
    fi
    last_state="healthy"
  else
    last_state="starting"
    log "Browser CDP is still unavailable; retrying shortly."
  fi

  sleep "$MONITOR_INTERVAL"
done
