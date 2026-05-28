#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "${ENV_FILE:-.env}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE:-.env}"
  set +a
fi

export DISPLAY="${DISPLAY:-:1}"
export BROWSER_CDP_URL="${BROWSER_CDP_URL:-http://127.0.0.1:9222}"
export BROWSER_USER_DATA_DIR="${BROWSER_USER_DATA_DIR:-/opt/upwork-agent/shared/browser-profile}"
export BROWSER_START_URL="${BROWSER_START_URL:-https://www.upwork.com/nx/find-work/best-matches/}"

VNC_GEOMETRY="${VNC_GEOMETRY:-1920x1080}"
VNC_DEPTH="${VNC_DEPTH:-24}"
MONITOR_INTERVAL="${BROWSER_SESSION_MONITOR_INTERVAL_SEC:-30}"

log() {
  printf '%s %s\n' "$(date -Is)" "$*"
}

display_number() {
  local value="${DISPLAY#:}"
  printf '%s\n' "${value%%.*}"
}

cdp_reachable() {
  node -e '
    const url = new URL("/json/version", process.env.BROWSER_CDP_URL || "http://127.0.0.1:9222");
    fetch(url).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1));
  ' >/dev/null 2>&1
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

  mkdir -p "$BROWSER_USER_DATA_DIR"
  log "CDP is not reachable at ${BROWSER_CDP_URL}; starting Chrome on ${DISPLAY}."
  npm run -s browser:session
}

last_state=""
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
