#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VALIDATION_TMP="$(mktemp -d "${TMPDIR:-/tmp}/upwork-promotion-validation.XXXXXX")"
cleanup() {
  rm -rf "$VALIDATION_TMP"
}
trap cleanup EXIT

# Promotion validation must never mutate production state or post into real Slack.
# Keep runtime .env untouched; these exports only apply to this validation process.
export DB_PATH="$VALIDATION_TMP/jobs.db"
export BROWSER_USER_DATA_DIR="$VALIDATION_TMP/browser-profile"
export BROWSER_ARTIFACT_DIR="$VALIDATION_TMP/artifacts"
export AGENT_ENGINE_STATE_PATH="$VALIDATION_TMP/agent-engine-state.json"
export SLACK_CHANNEL_WEBHOOK_URL=""
export SLACK_BOT_TOKEN=""
export SLACK_APP_TOKEN=""
export SLACK_SIGNING_SECRET=""
export SLACK_SOCKET_MODE_ENABLED=false
export SLACK_DELAY_MS=0
export SLACK_RETRY_ATTEMPTS=1
export LLM_NORMALIZATION_ENABLED=false
export JOB_INTELLIGENCE_ENABLED=false
export SLACK_COPY_LLM_ENABLED=false
export BRAND_RESEARCH_PROVIDER=disabled
export MEMORI_ENABLED=false
export BROWSER_SEARCH_ENABLED=false
export DISCOVERY_SCHEDULER_ENABLED=false
export AGENT_ENGINE_ENABLED=false
export BROWSER_DRY_RUN=true

run() {
  echo "==> $*"
  "$@"
}

run npm run build
run bash scripts/browser-session-scripts.test.sh
run npm run test:capture
run npm run test:slack-socket
run npx tsx src/soul.test.ts
run npx tsx src/slackThreadBrain.test.ts
run npx tsx src/slackConversationBrain.test.ts
run npx tsx src/slackReasoningGateway.test.ts
run npx tsx src/salesLearningMemory.test.ts
run npx tsx src/agenticMemory.test.ts
run npx tsx src/salesLearningRetrieval.test.ts
run npx tsx src/memoryConsolidation.test.ts
run npx tsx src/salesLearningSignals.test.ts
run npx tsx src/salesLearningInsights.test.ts
run npx tsx src/selfImprovementLoop.test.ts
run npx tsx src/selfImprovementEvalVersioning.test.ts
run npx tsx src/selfLearningVerifierEvalHarness.test.ts
run npx tsx src/slackConversationPlanner.test.ts
run npx tsx src/leadDecision.test.ts
run npx tsx src/platformEligibility.test.ts
run npx tsx src/proofAvailability.test.ts
run npx tsx src/proofAssets.test.ts
run npx tsx src/proofPlanOverrides.test.ts
run npx tsx src/slackPacketV3.test.ts
run npx tsx src/slackSocket.test.ts
run npx tsx src/browserDiscoveryTool.test.ts
run npx tsx src/browserIncidentDedupe.test.ts
run npx tsx src/browserApply.test.ts
run npx tsx src/leadEngine.test.ts
run npx tsx src/health.test.ts
run npx tsx src/controlledWorkerLoop.test.ts
run npx tsx src/connectsStrategy.test.ts
run npx tsx src/llm/provider.test.ts
run npx tsx src/slackCopywriter.test.ts
run npx tsx src/critic.test.ts
run npx tsx src/intelligenceScoring.test.ts
run npx tsx src/jobIntelligenceParser.test.ts
run npx tsx src/discoveryScheduler.test.ts
run npx tsx src/e2eDryRun.test.ts

echo "Promotion validation passed."
