// Placeholder for `frontendLibrary.devCommand` in neutralino.config.json.
// The real Vite dev server is started by `scripts/start-app.ts` *before*
// the Neutralino window opens, so `neu run` no longer needs to spawn
// (and free-port-kill) its own copy. This script just stays alive so
// neu sees a long-running devCommand and doesn't bail.
//
// Implementation note: a top-level `await new Promise(() => {})` would
// hang for the same reason but Deno's deadlock detector aborts with
// "Top-level await promise never resolved". A no-op `setInterval`
// keeps the event loop legitimately busy with a periodic timer task,
// which Deno is happy to schedule indefinitely.

setInterval(() => {}, 1 << 30);

