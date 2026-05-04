// Shared test harness. Boots `deno task dev` (unless BASE_URL is set
// to a running server) and provides a withPage() helper that hands a
// Puppeteer Page to a callback and tears it down on exit.
//
// Why both `puppeteer` and `puppeteer-core`?
//
//   `npm:puppeteer` runs a postinstall that downloads a Chromium build
//   into the cache. Deno's npm cache doesn't always run postinstalls,
//   so when the bundled Chromium is missing we fall back to
//   `npm:puppeteer-core` + a system Chrome at $CHROME_PATH (default
//   /usr/bin/google-chrome / chromium / chromium-browser).
//
// Run a single spec:
//   deno task test tests/01_onboarding.test.ts
// Run against an already-running dev:
//   BASE_URL=http://localhost:5173 deno task test
// Force the system browser:
//   CHROME_PATH=/usr/bin/google-chrome-stable deno task test

// deno-lint-ignore-file no-explicit-any

const BASE_URL_ENV = Deno.env.get("BASE_URL");
const CHROME_PATH_ENV = Deno.env.get("CHROME_PATH");

let serverChild: Deno.ChildProcess | null = null;
let serverBaseUrl = BASE_URL_ENV ?? "http://localhost:5173";

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url + "/onboarding", {
        signal: AbortSignal.timeout(2_000),
      });
      if (res.status >= 200 && res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Dev server didn't come up at ${url} within ${timeoutMs}ms`);
}

export async function startServer(): Promise<string> {
  if (BASE_URL_ENV) {
    // Caller said "I've already started it"; just verify reachability.
    await waitForServer(BASE_URL_ENV);
    return BASE_URL_ENV;
  }
  if (serverChild) return serverBaseUrl;

  // Spawn `deno task dev` and pipe its output for failures.
  const cmd = new Deno.Command("deno", {
    args: ["task", "dev"],
    env: { LOG_FILE: "0", LOG_LEVEL: "WARN" },
    stdout: "piped",
    stderr: "piped",
  });
  serverChild = cmd.spawn();
  await waitForServer(serverBaseUrl);
  return serverBaseUrl;
}

export async function stopServer(): Promise<void> {
  if (!serverChild) return;
  try {
    serverChild.kill("SIGTERM");
  } catch {
    // already dead
  }
  try {
    await serverChild.status;
  } catch {
    // ignore
  }
  serverChild = null;
}

let _puppeteer: any | null = null;
async function getPuppeteer(): Promise<any> {
  if (_puppeteer) return _puppeteer;
  if (CHROME_PATH_ENV) {
    const mod = await import("puppeteer-core");
    _puppeteer = mod.default ?? mod;
    return _puppeteer;
  }
  try {
    const mod = await import("puppeteer");
    _puppeteer = mod.default ?? mod;
    return _puppeteer;
  } catch {
    const mod = await import("puppeteer-core");
    _puppeteer = mod.default ?? mod;
    return _puppeteer;
  }
}

function findSystemChrome(): string | null {
  const candidates = [
    CHROME_PATH_ENV ?? "",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ].filter((p) => p.length > 0);
  for (const p of candidates) {
    try {
      const stat = Deno.statSync(p);
      if (stat.isFile) return p;
    } catch {
      // not present
    }
  }
  return null;
}

export interface TestPage {
  page: any;
  baseUrl: string;
}

export async function withPage<T>(fn: (ctx: TestPage) => Promise<T>): Promise<T> {
  const baseUrl = await startServer();
  const puppeteer = await getPuppeteer();
  const launchOpts: Record<string, unknown> = {
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  };
  if (CHROME_PATH_ENV || !("connect" in puppeteer && "launch" in puppeteer && _bundledChromiumLikely(puppeteer))) {
    const chrome = findSystemChrome();
    if (chrome) launchOpts.executablePath = chrome;
  }
  const browser = await puppeteer.launch(launchOpts);
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15_000);
    return await fn({ page, baseUrl });
  } finally {
    await browser.close().catch(() => {});
  }
}

function _bundledChromiumLikely(p: any): boolean {
  // The full puppeteer module exports `executablePath()` at the top
  // level; puppeteer-core does not. Use that as a probe.
  return typeof p.executablePath === "function";
}
