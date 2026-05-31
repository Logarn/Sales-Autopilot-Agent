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

WAIT_MODE="${1:-}"
WAIT_SECONDS="${BROWSER_SESSION_WAIT_SECONDS:-60}"
SLEEP_SECONDS=3

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

chrome_session_running() {
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
      return 0
    fi
  done < <(pgrep -u "$(id -u)" -f -- "--remote-debugging-port=${port}" 2>/dev/null || true)
  return 1
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

assert_localhost_cdp

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

if chrome_session_running || cdp_reachable; then
  echo "Chrome/CDP process: ok"
else
  echo "Chrome/CDP process: not detected" >&2
  exit 1
fi

npm run -s browser:cdp:check
echo "Browser session check passed."
