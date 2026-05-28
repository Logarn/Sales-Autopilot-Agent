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

WAIT_MODE="${1:-}"
WAIT_SECONDS="${BROWSER_SESSION_WAIT_SECONDS:-60}"
SLEEP_SECONDS=3

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

check_vnc_not_public() {
  local display port public
  display="$(display_number)"
  port=$((5900 + display))
  if ! command -v ss >/dev/null 2>&1; then
    return 0
  fi
  public="$(ss -ltnH 2>/dev/null | awk -v port=":${port}" '$4 ~ port "$" && $4 !~ "127\\.0\\.0\\.1" && $4 !~ "\\[::1\\]" { print $4 }')"
  if [[ -n "$public" ]]; then
    echo "VNC appears to be listening publicly on: $public" >&2
    return 1
  fi
}

if [[ "$WAIT_MODE" == "--wait" ]]; then
  deadline=$((SECONDS + WAIT_SECONDS))
  until cdp_reachable; do
    if (( SECONDS >= deadline )); then
      echo "CDP did not become reachable at ${BROWSER_CDP_URL} within ${WAIT_SECONDS}s." >&2
      exit 1
    fi
    sleep "$SLEEP_SECONDS"
  done
fi

display="$(display_number)"
if [[ -S "/tmp/.X11-unix/X${display}" ]] || pgrep -u "$(id -u)" -f "(Xtigervnc|Xvnc|tigervnc).*:${display}( |$)" >/dev/null 2>&1; then
  echo "VNC/display ${DISPLAY}: ok"
else
  echo "VNC/display ${DISPLAY}: not detected" >&2
  exit 1
fi

check_vnc_not_public

if pgrep -u "$(id -u)" -f "remote-debugging-port=9222" >/dev/null 2>&1 || cdp_reachable; then
  echo "Chrome/CDP process: ok"
else
  echo "Chrome/CDP process: not detected" >&2
  exit 1
fi

npm run -s browser:cdp:check
echo "Browser session check passed."
