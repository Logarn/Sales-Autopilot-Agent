import * as path from "node:path";
import {
  BROWSER_CDP_URL,
  BROWSER_CHROME_EXECUTABLE_PATH,
  BROWSER_HEADLESS,
  BROWSER_USER_DATA_DIR,
} from "./config";
import { acquireBrowserSession, findChromeExecutable, PlaywrightChromiumLike, PlaywrightContextLike } from "./browserSessionControl";
import { BrowserSessionInspection, inspectBrowserSession } from "./browserSessionInspector";

async function loadChromium(): Promise<PlaywrightChromiumLike> {
  const mod = (await import("playwright")) as { chromium?: PlaywrightChromiumLike };
  if (!mod.chromium) {
    throw new Error("Playwright chromium is unavailable.");
  }
  return mod.chromium;
}

export async function withBrowserCdpContext<T>(run: (context: PlaywrightContextLike) => Promise<T>): Promise<T> {
  const chromium = await loadChromium();
  const handle = await acquireBrowserSession(chromium, {
    mode: "cdp",
    cdpUrl: BROWSER_CDP_URL,
    userDataDir: path.resolve(process.cwd(), BROWSER_USER_DATA_DIR),
    chromeExecutablePath: BROWSER_CHROME_EXECUTABLE_PATH ? path.resolve(process.cwd(), BROWSER_CHROME_EXECUTABLE_PATH) : findChromeExecutable(),
    headless: BROWSER_HEADLESS,
  });
  try {
    return await run(handle.context);
  } finally {
    await handle.close();
  }
}

export async function inspectLiveBrowserSessionFromCdp(options: { includeStoredSessionState?: boolean } = {}): Promise<BrowserSessionInspection> {
  return withBrowserCdpContext((context) => inspectBrowserSession(context, options));
}
