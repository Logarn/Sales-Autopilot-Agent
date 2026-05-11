import {
  BROWSER_CDP_URL,
  BROWSER_CHROME_EXECUTABLE_PATH,
  BROWSER_USER_DATA_DIR,
} from "./config";
import {
  checkCdpEndpoint,
  findChromeExecutable,
  startPersistentChromeSession,
} from "./browserSessionControl";

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "--start") {
    const result = await startPersistentChromeSession({
      chromeExecutablePath: BROWSER_CHROME_EXECUTABLE_PATH || findChromeExecutable(),
      userDataDir: BROWSER_USER_DATA_DIR,
      cdpUrl: BROWSER_CDP_URL,
      startUrl: "https://www.upwork.com",
    });
    console.log(result.message);
    process.exitCode = result.started ? 0 : 1;
    return;
  }

  if (mode === "--check") {
    const result = await checkCdpEndpoint(BROWSER_CDP_URL);
    if (!result.reachable) {
      console.error(`CDP unavailable at ${BROWSER_CDP_URL}: ${result.error ?? "unknown error"}`);
      process.exitCode = 1;
      return;
    }
    console.log(`CDP reachable at ${BROWSER_CDP_URL}`);
    console.log(`Browser: ${result.browserVersion ?? "unknown"}`);
    console.log(`WebSocket: ${result.websocketDebuggerUrl ?? "missing"}`);
    return;
  }

  console.log("Usage:");
  console.log("  npm run browser:session");
  console.log("  npm run browser:cdp:check");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
