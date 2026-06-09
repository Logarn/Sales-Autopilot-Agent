#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

EXPECTED_REMOTE="https://github.com/Logarn/upwork-autonomous-agent.git"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
REPORT_PATH=""
LOCAL_TEMPLATE=0
PULL_ORIGIN_MAIN=0
INSTALL_DEPS=0
MANAGE_SERVICES=0
START_LEAD_ENGINE=0
RUN_PROMOTION=1

steps=()
statuses=()
details=()

usage() {
  cat <<'USAGE'
Usage: scripts/mayor-production-check.sh [options]

Options:
  --env FILE              Env file to validate. Defaults to .env.
  --report FILE           Write a markdown report.
  --local-template        Allow non-main branch and use .env.example-style checks.
  --pull-origin-main      Fetch and fast-forward current main from origin/main.
  --install               Run npm ci after pulling origin/main.
  --manage-services       Stop/start production systemd services.
  --start-lead-engine     Start lead-engine service after all gates pass.
  --skip-promotion        Skip npm run validate:promotion.
  -h, --help              Show this help.

Production mode is strict: it requires origin remote, branch main, clean git
status, and HEAD equal to origin/main before service start. It never deploys a
feature branch. Local template mode is for CI/developer validation only.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_FILE="$2"
      shift 2
      ;;
    --report)
      REPORT_PATH="$2"
      shift 2
      ;;
    --local-template)
      LOCAL_TEMPLATE=1
      shift
      ;;
    --pull-origin-main)
      PULL_ORIGIN_MAIN=1
      shift
      ;;
    --install)
      INSTALL_DEPS=1
      shift
      ;;
    --manage-services)
      MANAGE_SERVICES=1
      shift
      ;;
    --start-lead-engine)
      START_LEAD_ENGINE=1
      shift
      ;;
    --skip-promotion)
      RUN_PROMOTION=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$LOCAL_TEMPLATE" -eq 1 && "$PULL_ORIGIN_MAIN" -eq 1 ]]; then
  echo "--local-template cannot be combined with --pull-origin-main." >&2
  exit 2
fi
if [[ "$LOCAL_TEMPLATE" -ne 1 && "$PULL_ORIGIN_MAIN" -eq 1 && "$MANAGE_SERVICES" -ne 1 ]]; then
  echo "--pull-origin-main requires --manage-services in production mode so write-capable services stop before update." >&2
  exit 2
fi

record() {
  steps+=("$1")
  statuses+=("$2")
  details+=("$3")
}

sanitize() {
  sed -E \
    -e 's/(xox[baprs]-)[A-Za-z0-9-]+/\1[redacted]/g' \
    -e 's/(xapp-)[A-Za-z0-9-]+/\1[redacted]/g' \
    -e 's/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/\1[redacted]/g' \
    -e 's/((API|APP|BOT|TOKEN|SECRET|KEY)[A-Z0-9_ -]*=)[^[:space:]]+/\1[redacted]/Ig'
}

run_step() {
  local label="$1"
  shift
  local tmp
  tmp="$(mktemp)"
  printf '==> %s\n' "$label"
  if "$@" >"$tmp" 2>&1; then
    record "$label" "ok" "$*"
    rm -f "$tmp"
    return 0
  fi

  record "$label" "failed" "$*"
  printf 'Step failed: %s\n' "$label" >&2
  tail -n 25 "$tmp" | sanitize >&2
  rm -f "$tmp"
  return 1
}

note_step() {
  printf '==> %s: %s\n' "$1" "$2"
  record "$1" "$2" "$3"
}

write_report() {
  [[ -n "$REPORT_PATH" ]] || return 0
  mkdir -p "$(dirname "$REPORT_PATH")"
  {
    printf '# Mayor Production Check Report\n\n'
    printf -- '- generated_at: `%s`\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')"
    printf -- '- repo: `%s`\n' "$ROOT_DIR"
    printf -- '- env_file: `%s`\n' "$ENV_FILE"
    printf -- '- local_template: `%s`\n' "$LOCAL_TEMPLATE"
    printf -- '- manage_services: `%s`\n' "$MANAGE_SERVICES"
    printf -- '- start_lead_engine: `%s`\n\n' "$START_LEAD_ENGINE"
    printf '| Gate | Status | Detail |\n'
    printf '| --- | --- | --- |\n'
    local i
    for i in "${!steps[@]}"; do
      printf '| %s | %s | `%s` |\n' "${steps[$i]}" "${statuses[$i]}" "${details[$i]//|/ }"
    done
    printf '\nFinal submit remains manual. Secrets are not printed by this report.\n'
  } > "$REPORT_PATH"
}

finish() {
  local code=$?
  write_report || true
  if [[ $code -eq 0 ]]; then
    printf 'Mayor production check completed.\n'
    [[ -n "$REPORT_PATH" ]] && printf 'Report: %s\n' "$REPORT_PATH"
  fi
  exit "$code"
}
trap finish EXIT

systemctl_available() {
  command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]
}

service_step() {
  local action="$1"
  local service="$2"
  if [[ "$MANAGE_SERVICES" -ne 1 ]]; then
    note_step "service ${action} ${service}" "skipped" "run with --manage-services"
    return 0
  fi
  if ! systemctl_available; then
    echo "systemd is not available in this environment." >&2
    return 1
  fi
  run_step "service ${action} ${service}" systemctl "$action" "$service"
}

template_env() {
  [[ "$LOCAL_TEMPLATE" -eq 1 ]] || [[ "$(basename "$ENV_FILE")" == ".env.example" ]]
}

verify_repo_gate() {
  local origin branch status
  origin="$(git remote get-url origin)"
  if [[ "$origin" != "$EXPECTED_REMOTE" ]]; then
    echo "Unexpected origin remote: $origin" >&2
    exit 1
  fi
  record "origin remote" "ok" "$origin"

  run_step "fetch origin/main" git fetch origin main

  branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
  status="$(git status --short)"

  if [[ "$LOCAL_TEMPLATE" -eq 1 ]]; then
    note_step "origin/main branch gate" "skipped" "local template mode on ${branch:-detached} at $(git rev-parse HEAD)"
    return 0
  fi

  if [[ "$branch" != "main" ]]; then
    echo "Refusing production check from non-main branch: ${branch:-detached}" >&2
    exit 1
  fi
  if [[ -n "$status" ]]; then
    echo "Refusing production check with dirty git status." >&2
    git status --short >&2
    exit 1
  fi

  record "production branch clean" "ok" "$branch"
}

sync_origin_main() {
  local head origin_main

  if [[ "$LOCAL_TEMPLATE" -eq 1 ]]; then
    note_step "pull merged origin/main only" "skipped" "local template mode"
    return 0
  fi

  if [[ "$PULL_ORIGIN_MAIN" -eq 1 ]]; then
    run_step "pull merged origin/main only" git pull --ff-only origin main
  else
    note_step "pull merged origin/main only" "skipped" "run with --pull-origin-main"
  fi

  head="$(git rev-parse HEAD)"
  origin_main="$(git rev-parse origin/main)"

  if [[ "$head" != "$origin_main" ]]; then
    echo "HEAD is not origin/main. Run with --pull-origin-main after reviewing the target SHA." >&2
    exit 1
  fi
  record "origin/main branch gate" "ok" "$head"
}

verify_repo_gate

service_step stop upwork-agent-lead-engine.service
service_step stop upwork-agent-slack-socket.service
sync_origin_main

if [[ "$INSTALL_DEPS" -eq 1 ]]; then
  run_step "install dependencies" npm ci
else
  note_step "install dependencies" "skipped" "run with --install"
fi

run_step "build" npm run build
if [[ "$RUN_PROMOTION" -eq 1 ]]; then
  run_step "promotion validation" npm run validate:promotion
else
  note_step "promotion validation" "skipped" "run without --skip-promotion for production"
fi
if template_env; then
  run_step "proof assets" npx tsx src/proofAssets.test.ts
else
  run_step "proof assets" npm run proof:check
fi
run_step "env validation" bash scripts/validate-contabo-env.sh "$ENV_FILE"
run_step "contabo preflight" env ENV_FILE="$ENV_FILE" npm run preflight:contabo

service_step start upwork-agent-browser-session.service

if template_env; then
  note_step "browser session check" "skipped" "template env has no live browser session"
else
  run_step "browser session check" env ENV_FILE="$ENV_FILE" npm run browser:session:check
fi

service_step start upwork-agent-slack-socket.service
run_step "production smoke" env ENV_FILE="$ENV_FILE" npm run production:smoke

if template_env; then
  note_step "controlled dry run" "skipped" "template env has no live credentials"
else
  run_step "controlled dry run" env ENV_FILE="$ENV_FILE" npm run agent:run-once:dry
fi

if [[ "$START_LEAD_ENGINE" -eq 1 ]]; then
  if [[ "$MANAGE_SERVICES" -ne 1 ]]; then
    echo "--start-lead-engine requires --manage-services." >&2
    exit 1
  fi
  if template_env; then
    echo "Refusing to start lead engine with a template env." >&2
    exit 1
  fi
  service_step start upwork-agent-lead-engine.service
else
  note_step "service start upwork-agent-lead-engine.service" "skipped" "run with --start-lead-engine after clean gates"
fi
