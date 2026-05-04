// Unit tests for src/lib/version.ts.

import { assert, assertMatch } from "jsr:@std/assert@^1";
import { getVersion } from "../../src/lib/version.ts";

Deno.test("getVersion returns a semver-shaped string", () => {
  const v = getVersion();
  assert(typeof v === "string" && v.length > 0, "version should be non-empty");
  // Loose check: dotted numbers, e.g. "0.1.0".
  assertMatch(v, /^\d+\.\d+\.\d+/);
});

Deno.test("getVersion is cached on subsequent calls", () => {
  const a = getVersion();
  const b = getVersion();
  assert(a === b, "successive calls should return the identical string");
});
