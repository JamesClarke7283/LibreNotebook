import { App, staticFiles } from "fresh";
import { type State } from "./utils.ts";
import { getLogger } from "./lib/logger.ts";
import { loadEnv, multiUserEnabled } from "./lib/env-config.ts";
import { getSessionUserId } from "./lib/auth.ts";
import { withUser } from "./lib/request-context.ts";
import { recoverStuckJobs } from "./lib/recovery.ts";

const log = getLogger("http");

// Load .env into Deno.env before any other module has a chance to read
// settings. Top-level await is fine in Deno modules.
await loadEnv();

// Recover jobs orphaned by the previous server lifetime (notebooks
// stuck in "generating" status, infographic studio items mid-flight,
// etc.). Best-effort — if it fails we still let the server boot.
try {
  await recoverStuckJobs();
} catch (err) {
  log.warn("startup recovery failed", {
    error: err instanceof Error ? err.message : String(err),
  });
}

// Routes the auth middleware lets through anonymously. Everything else
// 401s (for /api/*) or redirects to /signin (for pages).
const ANON_PATHS = [
  "/signin",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/api/auth/", // Better Auth handler
  "/favicon", // png + svg
  "/icon.svg",
];
function isAnonPath(pathname: string): boolean {
  return ANON_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

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

// Auth + user-context middleware (multi-user mode only). When the user
// has a valid session we run the rest of the request inside
// withUser(userId), so storage helpers transparently scope by user.
// Without a session we let anon paths through and bounce / 401 the rest.
app.use(async (ctx) => {
  if (!multiUserEnabled()) return ctx.next();
  const url = new URL(ctx.req.url);
  const userId = await getSessionUserId(ctx.req);
  if (userId) {
    return withUser(userId, () => ctx.next());
  }
  if (isAnonPath(url.pathname)) return ctx.next();
  if (url.pathname.startsWith("/api/")) {
    return new Response("Sign in required", { status: 401 });
  }
  // Page request → bounce to /signin with the original path stashed.
  const next = encodeURIComponent(url.pathname + url.search);
  return new Response(null, {
    status: 302,
    headers: { Location: `/signin?next=${next}` },
  });
});

app.use(staticFiles());

// Include file-system based routes here.
app.fsRoutes();
