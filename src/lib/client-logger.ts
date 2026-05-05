// Client-side logger that mirrors src/lib/logger.ts's `ScopedLogger`
// shape so islands can do `import { getLogger } from "../lib/client-logger.ts"`
// and use the same call sites the server uses.
//
// Threshold comes from `globalThis.__LIBRENOTEBOOK_LOG_LEVEL__`, which
// _app.tsx inlines from the server-side `LOG_LEVEL` env var. If the
// global is missing (e.g. during a misconfigured SSR snapshot, or in
// a test harness) we default to "INFO" — same as the server logger.
//
// Format mimics the server output as closely as the browser console
// permits:
//
//   16:24:07 DEBUG [studio-panel ] menu click {itemId: "abc"}
//
// We use `%c` to colour the level + scope tags. Output goes to the
// matching console method (debug → console.debug, info → console.info,
// warn → console.warn, error → console.error), so DevTools log-level
// filtering works the way users expect.
//
// We deliberately keep this file tiny and dependency-free so it can
// safely live in the client bundle. The server logger imports
// @std/log + a RotatingFileHandler + Deno filesystem APIs that we do
// NOT want shipped to the browser, hence the separate module.

const VALID_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
type Level = typeof VALID_LEVELS[number];

const LEVEL_RANK: Record<Level, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

function readThreshold(): Level {
  // deno-lint-ignore no-explicit-any
  const raw = (globalThis as any).__LIBRENOTEBOOK_LOG_LEVEL__;
  const norm = typeof raw === "string" ? raw.toUpperCase() : "INFO";
  // CRITICAL is a server-only level; map it to ERROR on the client
  // so a `LOG_LEVEL=CRITICAL` setting on the server still produces a
  // sensible threshold here rather than silently defaulting to INFO.
  if (norm === "CRITICAL") return "ERROR";
  return (VALID_LEVELS as readonly string[]).includes(norm)
    ? (norm as Level)
    : "INFO";
}

const THRESHOLD = readThreshold();

const STYLES: Record<Level, string> = {
  DEBUG: "color:#888",
  INFO: "color:#5a9bd6",
  WARN: "color:#d4a13c",
  ERROR: "color:#d65a5a;font-weight:bold",
};

const SCOPE_STYLE = "color:#888";

function nowHHMMSS(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function emit(level: Level, scope: string, msg: string, ctx?: unknown): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[THRESHOLD]) return;
  const t = nowHHMMSS();
  const lvl = level.padEnd(5);
  const sc = `[${scope.padEnd(12)}]`;
  // Single template + %c placeholders so the colours land on the
  // tags only, not on the message body or the structured ctx.
  const tpl = `${t} %c${lvl}%c %c${sc}%c ${msg}`;
  const args: unknown[] = [
    tpl,
    STYLES[level],
    "",
    SCOPE_STYLE,
    "",
  ];
  if (ctx !== undefined) args.push(ctx);
  switch (level) {
    case "DEBUG":
      console.debug(...(args as [unknown, ...unknown[]]));
      break;
    case "INFO":
      console.info(...(args as [unknown, ...unknown[]]));
      break;
    case "WARN":
      console.warn(...(args as [unknown, ...unknown[]]));
      break;
    case "ERROR":
      console.error(...(args as [unknown, ...unknown[]]));
      break;
  }
}

export interface ClientLogger {
  debug(msg: string, ctx?: unknown): void;
  info(msg: string, ctx?: unknown): void;
  warn(msg: string, ctx?: unknown): void;
  error(msg: string, ctx?: unknown): void;
}

const cache = new Map<string, ClientLogger>();

/** Get a scoped client logger. Mirrors `getLogger()` from
 *  src/lib/logger.ts so call sites read the same on either side of
 *  the network. */
export function getLogger(scope: string): ClientLogger {
  const cached = cache.get(scope);
  if (cached) return cached;
  const lg: ClientLogger = {
    debug: (m, c) => emit("DEBUG", scope, m, c),
    info: (m, c) => emit("INFO", scope, m, c),
    warn: (m, c) => emit("WARN", scope, m, c),
    error: (m, c) => emit("ERROR", scope, m, c),
  };
  cache.set(scope, lg);
  return lg;
}
