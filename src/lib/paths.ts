// Cross-platform user-data directory ("platformdirs"-style).
//
//   Linux  : $XDG_DATA_HOME/librenotebook  (default ~/.local/share/librenotebook)
//   macOS  : ~/Library/Application Support/librenotebook
//   Windows: %APPDATA%\librenotebook (or %LOCALAPPDATA%)
//
// Override at runtime with $LIBRENOTEBOOK_DATA_DIR (handy for Docker
// volumes and tests).

import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { getLogger } from "./logger.ts";
import { getUserId } from "./request-context.ts";

const log = getLogger("paths");

// Inline copy of multiUserEnabled() to avoid a circular dep
// (logger → paths → env-config → logger). Reads $MULTI_USER directly.
function isMultiUser(): boolean {
  const v = Deno.env.get("MULTI_USER")?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

let cachedBase: string | null = null;
let migrated = false;

/** App-global data directory (auth DB, app-wide settings). Always
 *  returns the same path regardless of multi-user mode. */
export function baseDataDir(): string {
  if (cachedBase) return cachedBase;

  const override = Deno.env.get("LIBRENOTEBOOK_DATA_DIR");
  if (override && override.trim()) {
    cachedBase = override.trim();
    return cachedBase;
  }

  const home = homedir();
  const p = platform();
  if (p === "win32") {
    const appdata = Deno.env.get("APPDATA") ?? join(home, "AppData", "Roaming");
    cachedBase = join(appdata, "librenotebook");
  } else if (p === "darwin") {
    cachedBase = join(home, "Library", "Application Support", "librenotebook");
  } else {
    const xdg = Deno.env.get("XDG_DATA_HOME") ?? join(home, ".local", "share");
    cachedBase = join(xdg, "librenotebook");
  }
  return cachedBase;
}

/**
 * Per-request data directory.
 *
 * - Single-user mode: same as baseDataDir().
 * - Multi-user mode + authenticated request: <base>/users/<userId>
 * - Multi-user mode + anonymous request: <base>/anon (auth-protected
 *   routes will 401 before this is hit, but pages like /signin still
 *   run code that touches storage).
 *
 * The userId comes from a request-scoped AsyncLocalStorage that the
 * auth middleware populates on every API request.
 */
export function dataDir(): string {
  const base = baseDataDir();
  if (!isMultiUser()) return base;
  const uid = getUserId();
  return join(base, "users", uid ?? "anon");
}

/**
 * One-shot migration: if the legacy project-relative `./.data/` exists
 * and the canonical user-data dir is empty (or missing), move the
 * legacy contents into place. Idempotent — sets a process-level flag
 * so subsequent calls are no-ops.
 */
export async function migrateLegacyDataDir(): Promise<void> {
  if (migrated) return;
  migrated = true;
  const target = dataDir();
  const legacy = join(Deno.cwd(), ".data");
  try {
    const legacyStat = await stat(legacy);
    if (!legacyStat.isDirectory()) return;
  } catch {
    return; // no legacy dir to migrate
  }
  let targetEmpty = true;
  try {
    const contents = await readdir(target);
    targetEmpty = contents.length === 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // doesn't exist yet — fine to migrate into it
    } else {
      throw err;
    }
  }
  if (!targetEmpty) {
    log.debug("legacy .data exists alongside non-empty platform dir; skipping migration", {
      legacy,
      target,
    });
    return;
  }
  await mkdir(target, { recursive: true });
  // Move the .data tree under the platform dir. We rename when
  // possible (single rename = atomic) and fall back to a recursive
  // copy on cross-device boundaries.
  try {
    await rename(legacy, target);
    log.info("migrated legacy ./.data → platform dir", { from: legacy, to: target });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      // Cross-device — manual copy + remove. (Rare on home dirs but
      // happens with Docker bind mounts.)
      await copyDirRecursive(legacy, target);
      await Deno.remove(legacy, { recursive: true });
      log.info("migrated legacy ./.data → platform dir (cross-device)", {
        from: legacy,
        to: target,
      });
    } else {
      throw err;
    }
  }
}

async function copyDirRecursive(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(s, d);
    } else {
      await Deno.copyFile(s, d);
    }
  }
}
