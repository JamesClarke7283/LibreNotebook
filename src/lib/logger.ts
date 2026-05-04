// Centralised logging on top of @std/log.
//
// Usage:
//
//     import { getLogger } from "../lib/logger.ts";
//     const log = getLogger("youtube");
//     log.info("yt-dlp ok", { id, title });
//     log.warn("subtitles failed", { stderr });
//
// One module-level logger writes to the console at $LOG_LEVEL (default
// INFO) and — unless $LOG_FILE=0 — also to .data/librenotebook.log
// (rotates at 5 MB). Test runners that don't want a log file on disk
// should set LOG_FILE=0.

import * as log from "@std/log";
import { bgRed, blue, dim, gray, red, yellow } from "@std/fmt/colors";

const VALID_LEVELS = new Set(["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"]);

const envLevel = (Deno.env.get("LOG_LEVEL") ?? "INFO").toUpperCase();
const LEVEL = VALID_LEVELS.has(envLevel) ? envLevel : "INFO";

function colorise(level: string): string {
  switch (level) {
    case "DEBUG":
      return dim(level.padEnd(5));
    case "INFO":
      return blue(level.padEnd(5));
    case "WARN":
      return yellow(level.padEnd(5));
    case "ERROR":
      return red(level.padEnd(5));
    case "CRITICAL":
      return bgRed(level.padEnd(5));
    default:
      return level.padEnd(5);
  }
}

function fmt(record: log.LogRecord): string {
  const time = new Date(record.datetime).toISOString().slice(11, 19);
  const lvl = colorise(record.levelName);
  const scope = gray(`[${(record.loggerName ?? "default").padEnd(12)}]`);
  let ctx = "";
  if (record.args.length > 0 && record.args[0] !== undefined) {
    try {
      ctx = " " + dim(JSON.stringify(record.args[0]));
    } catch {
      ctx = " " + dim(String(record.args[0]));
    }
  }
  return `${dim(time)} ${lvl} ${scope} ${record.msg}${ctx}`;
}

const handlers: Record<string, log.BaseHandler> = {
  console: new log.ConsoleHandler(LEVEL as log.LevelName, {
    formatter: fmt,
    useColors: true,
  }),
};

// Resolve the file path without importing paths.ts (which would
// create a logger ↔ paths ↔ env-config cycle). This duplicates a
// small fragment of paths.ts, but the logger has to boot before
// anything else.
function logFilePath(): string {
  const override = Deno.env.get("LIBRENOTEBOOK_DATA_DIR")?.trim();
  if (override) return `${override}/librenotebook.log`;
  // deno-lint-ignore no-explicit-any
  const home = (Deno.env.get("HOME") ?? "") as string;
  const xdg = Deno.env.get("XDG_DATA_HOME");
  if (xdg) return `${xdg}/librenotebook/librenotebook.log`;
  return `${home}/.local/share/librenotebook/librenotebook.log`;
}

const enableFile = (Deno.env.get("LOG_FILE") ?? "1") !== "0";
if (enableFile) {
  try {
    const filename = logFilePath();
    const dir = filename.substring(0, filename.lastIndexOf("/"));
    Deno.mkdirSync(dir, { recursive: true });
    handlers.file = new log.RotatingFileHandler(LEVEL as log.LevelName, {
      filename,
      maxBytes: 5_000_000,
      maxBackupCount: 3,
      formatter: (record) => {
        // Plain-text formatter for the file handler (no ANSI colours).
        const time = new Date(record.datetime).toISOString();
        const ctx =
          record.args.length > 0 && record.args[0] !== undefined
            ? " " + JSON.stringify(record.args[0])
            : "";
        return `${time} ${record.levelName.padEnd(5)} [${
          record.loggerName ?? "default"
        }] ${record.msg}${ctx}`;
      },
    });
  } catch {
    // File logging is best-effort; never let it break startup.
  }
}

const loggerHandlers = Object.keys(handlers);
log.setup({
  handlers,
  loggers: {
    default: { level: LEVEL as log.LevelName, handlers: loggerHandlers },
  },
});

export interface ScopedLogger {
  debug(msg: string, ctx?: unknown): void;
  info(msg: string, ctx?: unknown): void;
  warn(msg: string, ctx?: unknown): void;
  error(msg: string, ctx?: unknown): void;
}

const cache = new Map<string, ScopedLogger>();

/** Get a scoped logger. Scopes are namespaces; pass e.g. "youtube". */
export function getLogger(scope: string): ScopedLogger {
  const cached = cache.get(scope);
  if (cached) return cached;
  // @std/log keys loggers by name; we register a child logger lazily.
  log.setup({
    handlers,
    loggers: {
      default: { level: LEVEL as log.LevelName, handlers: loggerHandlers },
      [scope]: { level: LEVEL as log.LevelName, handlers: loggerHandlers },
    },
  });
  const lg = log.getLogger(scope);
  const wrap: ScopedLogger = {
    debug: (m, c) => lg.debug(m, c),
    info: (m, c) => lg.info(m, c),
    warn: (m, c) => lg.warn(m, c),
    error: (m, c) => lg.error(m, c),
  };
  cache.set(scope, wrap);
  return wrap;
}
