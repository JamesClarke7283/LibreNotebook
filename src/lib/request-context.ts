// AsyncLocalStorage-backed request context.
//
// In multi-user mode the auth middleware extracts a user id from the
// session cookie and runs the rest of the request inside `withUser()`.
// Storage helpers (paths.ts → dataDir()) read the userId via
// `getUserId()` so file paths transparently get scoped to the right
// user without us threading the id through every call.

import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  userId: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getUserId(): string | null {
  return storage.getStore()?.userId ?? null;
}

export function withUser<T>(
  userId: string | null,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return storage.run({ userId }, fn);
}
