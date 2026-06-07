#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

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
run npx tsx src/slackConversationPlanner.test.ts
run npx tsx src/leadDecision.test.ts
run npx tsx src/platformEligibility.test.ts
run npx tsx src/proofAvailability.test.ts
run npx tsx src/proofAssets.test.ts
run npx tsx src/proofPlanOverrides.test.ts
run npx tsx src/slackPacketV3.test.ts
run npx tsx src/slackSocket.test.ts
run npx tsx src/browserDiscoveryTool.test.ts
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
