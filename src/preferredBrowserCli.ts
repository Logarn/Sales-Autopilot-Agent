import { closeDb } from "./db";
import { checkPreferredBrowserStatus, startPreferredBrowser } from "./preferredBrowser";

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "--start") {
    const result = await startPreferredBrowser();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.started ? 0 : 1;
    return;
  }

  if (mode === "--check") {
    const result = await checkPreferredBrowserStatus();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.readyForDiscovery ? 0 : 2;
    return;
  }

  process.stderr.write("Usage: preferredBrowserCli.ts --start|--check\n");
  process.exitCode = 1;
}

if (require.main === module) {
  main()
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
