import { App, staticFiles } from "fresh";
import { type State } from "./utils.ts";
import { getLogger } from "./lib/logger.ts";

const log = getLogger("http");

export const app = new App<State>();

// Permissive CORS for /api/* — fixes the "Fetch API cannot load …
// access control checks" message that Neutralino's WebKit2GTK webview
// raises when its computed origin differs from Vite's dev origin.
// LibreNotebook is a localhost-only desktop app; widening CORS is fine
// here. (When deploying behind a public proxy, lock this down.)
app.use(async (ctx) => {
  const res = await ctx.next();
  const url = new URL(ctx.req.url);
  if (url.pathname.startsWith("/api/")) {
    res.headers.set("Access-Control-Allow-Origin", "*");
    res.headers.set("Access-Control-Allow-Methods", "*");
    res.headers.set("Access-Control-Allow-Headers", "*");
  }
  return res;
});

// Request logging — method + path + status + duration.
app.use(async (ctx) => {
  const t0 = performance.now();
  const url = new URL(ctx.req.url);
  const res = await ctx.next();
  // Skip the noisy Vite virtual modules + asset requests.
  if (
    !url.pathname.startsWith("/@") &&
    !url.pathname.startsWith("/node_modules") &&
    !url.pathname.startsWith("/src/")
  ) {
    const dt = (performance.now() - t0).toFixed(0);
    log.info(`${ctx.req.method} ${url.pathname} ${res.status} ${dt}ms`);
  }
  return res;
});

app.use(staticFiles());

// Include file-system based routes here.
app.fsRoutes();
