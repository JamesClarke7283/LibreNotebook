// Better Auth configuration. Lazily constructed so single-user mode
// (MULTI_USER unset) doesn't pay the cost of opening the auth DB.
//
// Storage: an in-memory adapter (better-auth/adapters/memory) backed by
// a JSON file at <baseDataDir>/auth-db.json. The file is written on a
// 1s debounce after any mutation. We use the memory adapter rather
// than better-sqlite3 because the latter's npm-compat shim under Deno
// trips a "Cannot add property SqliteError, object is not extensible"
// error during dynamic-import probing.
//
// Email: when SMTP is configured, sign-up triggers a verification
// email and "forgot password" sends a reset link. Without SMTP the
// auth handler still works for password-only flows.

import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { baseDataDir } from "./paths.ts";
import { multiUserEnabled } from "./env-config.ts";
import { sendEmail } from "./email.ts";
import { getLogger } from "./logger.ts";

const log = getLogger("auth");

// deno-lint-ignore no-explicit-any
let cachedAuth: any | null = null;
let initFailed = false;

function authDbPath(): string {
  return join(baseDataDir(), "auth-db.json");
}

// deno-lint-ignore no-explicit-any
async function loadAuthDb(): Promise<Record<string, any[]>> {
  try {
    const txt = await readFile(authDbPath(), "utf8");
    return JSON.parse(txt);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

// deno-lint-ignore no-explicit-any
function startPersistLoop(db: Record<string, any[]>): void {
  let dirty = false;
  const proxy = new Proxy(db, {
    set(target, prop, value) {
      target[prop as string] = value;
      dirty = true;
      return true;
    },
  });
  // Mutate memoryAdapter's array-of-rows in place — wrap each table's
  // array with a Proxy so push/pop/etc. dirty the snapshot too.
  for (const k of Object.keys(db)) {
    db[k] = wrapArray(db[k], () => (dirty = true));
  }
  Object.setPrototypeOf(db, Object.getPrototypeOf(proxy));

  setInterval(async () => {
    if (!dirty) return;
    dirty = false;
    try {
      await writeFile(authDbPath(), JSON.stringify(db, null, 2), "utf8");
    } catch (err) {
      log.warn("auth-db persist failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, 1_000);
}

// deno-lint-ignore no-explicit-any
function wrapArray<T extends any[]>(arr: T, onChange: () => void): T {
  return new Proxy(arr, {
    set(target, prop, value) {
      // deno-lint-ignore no-explicit-any
      (target as any)[prop] = value;
      onChange();
      return true;
    },
    deleteProperty(target, prop) {
      // deno-lint-ignore no-explicit-any
      delete (target as any)[prop];
      onChange();
      return true;
    },
  });
}

// deno-lint-ignore no-explicit-any
export async function getAuth(): Promise<any | null> {
  if (cachedAuth) return cachedAuth;
  if (initFailed) return null;
  if (!multiUserEnabled()) return null;
  try {
    await mkdir(baseDataDir(), { recursive: true });

    const dbState = await loadAuthDb();
    startPersistLoop(dbState);

    const baseUrl = Deno.env.get("BETTER_AUTH_URL") ??
      `http://${Deno.env.get("HOST") ?? "127.0.0.1"}:${
        Deno.env.get("PORT") ?? "5173"
      }`;
    const secret = Deno.env.get("BETTER_AUTH_SECRET") ??
      "dev-only-secret-change-me";

    cachedAuth = betterAuth({
      database: memoryAdapter(dbState),
      baseURL: baseUrl,
      secret,
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
        async sendResetPassword({ user, url }) {
          await sendEmail({
            to: user.email,
            subject: "Reset your LibreNotebook password",
            text:
              `Click the link below to reset your password:\n\n${url}\n\n` +
              `If you didn't ask for this, ignore this email.`,
          });
        },
      },
      emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,
        async sendVerificationEmail({ user, url }) {
          await sendEmail({
            to: user.email,
            subject: "Verify your LibreNotebook account",
            text: `Welcome! Confirm your email here:\n\n${url}\n`,
          });
        },
      },
    });
    log.info("Better Auth initialised");
    return cachedAuth;
  } catch (err) {
    initFailed = true;
    log.error("Better Auth failed to initialise", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Resolve the user id for an incoming request, or null when nobody is
 * signed in (or auth isn't enabled).
 */
export async function getSessionUserId(req: Request): Promise<string | null> {
  const auth = await getAuth();
  if (!auth) return null;
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}
