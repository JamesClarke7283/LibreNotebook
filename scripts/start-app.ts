// Pre-warm the Vite dev server before opening the Neutralino window.
//
// Default `neu run` flow: spawn the dev command, then more-or-less
// immediately open the WebKit window pointing at `devUrl`. On a cold
// start Vite needs a couple of seconds to bind 5173, so the window
// shows a "Could not connect" page until the user hits refresh. This
// wrapper:
//
//   1. Frees port 5173 if a stale Vite is holding it.
//   2. Spawns Vite ourselves and polls the dev URL until it responds.
//   3. Hands off to `neu run`, whose own (now-redundant) Vite spawn
//      fails harmlessly on `strictPort: true` while ours serves the
//      window from the first paint.
//
// Cleanup: SIGINT / process exit kills the Vite child so we don't
// leak a server after the window closes.

const PORT = 5173;
const READY_TIMEOUT_MS = 30_000;
const POLL_MS = 200;

async function freePort(): Promise<void> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "scripts/free-port.ts", String(PORT)],
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await cmd.output();
  if (code !== 0) {
    console.error(`start-app: free-port failed (exit ${code})`);
    Deno.exit(code);
  }
}

async function waitForVite(): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1_000);
      const res = await fetch(`http://127.0.0.1:${PORT}/`, {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      // Any HTTP response means Vite is listening and responding —
      // even a 404 or 500 is "the server is up." Network-level
      // failures throw and land in the catch.
      if (res.status >= 200) return true;
    } catch {
      // Not yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false;
}

await freePort();

console.error("start-app: starting Vite…");
const vite = new Deno.Command(Deno.execPath(), {
  args: ["run", "-A", "npm:vite"],
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

// Make sure Vite dies with us under any exit path.
const cleanup = () => {
  try {
    vite.kill("SIGTERM");
  } catch {
    // already dead — fine
  }
};
Deno.addSignalListener("SIGINT", () => {
  cleanup();
  Deno.exit(130);
});
Deno.addSignalListener("SIGTERM", () => {
  cleanup();
  Deno.exit(143);
});
globalThis.addEventListener("unload", cleanup);

console.error(`start-app: waiting for Vite on :${PORT}…`);
const ready = await waitForVite();
if (!ready) {
  console.error(`start-app: Vite didn't become ready in ${READY_TIMEOUT_MS}ms`);
  cleanup();
  Deno.exit(1);
}
console.error("start-app: Vite is up — launching Neutralino window.");

const neu = new Deno.Command("npx", {
  args: ["-y", "@neutralinojs/neu", "run"],
  stdout: "inherit",
  stderr: "inherit",
  env: { ...Deno.env.toObject(), MULTI_USER: "0" },
}).spawn();

const status = await neu.status;
cleanup();
Deno.exit(status.code);
