// Unit tests for src/lib/paths.ts.
//
// We isolate each test inside a temp $HOME (or $LIBRENOTEBOOK_DATA_DIR
// override) and reset the cached base after every case so subsequent
// asserts see fresh resolution.

import { assertEquals, assert, assertStringIncludes } from "jsr:@std/assert@^1";
import { join } from "node:path";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

async function withTempEnv(env: Record<string, string | null>, fn: () => Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) previous[k] = Deno.env.get(k);
  for (const [k, v] of Object.entries(env)) {
    if (v === null) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    // Re-import paths.ts so the module-level cache is reset.
    const url = new URL("../../src/lib/paths.ts", import.meta.url).href +
      `?t=${Date.now()}-${Math.random()}`;
    await import(url);
    await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

Deno.test("baseDataDir honours $LIBRENOTEBOOK_DATA_DIR override", async () => {
  const override = await mkdtemp(join(tmpdir(), "ln-paths-"));
  try {
    await withTempEnv({ LIBRENOTEBOOK_DATA_DIR: override }, async () => {
      const url = new URL("../../src/lib/paths.ts", import.meta.url).href +
        `?t=${Date.now()}-${Math.random()}`;
      const { baseDataDir } = await import(url);
      assertEquals(baseDataDir(), override);
    });
  } finally {
    await rm(override, { recursive: true, force: true });
  }
});

Deno.test("baseDataDir falls back to XDG_DATA_HOME on Linux", async () => {
  const fakeXdg = await mkdtemp(join(tmpdir(), "ln-xdg-"));
  try {
    await withTempEnv(
      { LIBRENOTEBOOK_DATA_DIR: null, XDG_DATA_HOME: fakeXdg },
      async () => {
        const url = new URL("../../src/lib/paths.ts", import.meta.url).href +
          `?t=${Date.now()}-${Math.random()}`;
        const { baseDataDir } = await import(url);
        const resolved = baseDataDir();
        // On non-Linux this test would assert different — skip there.
        if (Deno.build.os === "linux") {
          assertEquals(resolved, join(fakeXdg, "librenotebook"));
        }
      },
    );
  } finally {
    await rm(fakeXdg, { recursive: true, force: true });
  }
});

Deno.test("dataDir mirrors baseDataDir when MULTI_USER is unset", async () => {
  const override = await mkdtemp(join(tmpdir(), "ln-single-"));
  try {
    await withTempEnv(
      { LIBRENOTEBOOK_DATA_DIR: override, MULTI_USER: null },
      async () => {
        const url = new URL("../../src/lib/paths.ts", import.meta.url).href +
          `?t=${Date.now()}-${Math.random()}`;
        const { baseDataDir, dataDir } = await import(url);
        assertEquals(dataDir(), baseDataDir());
      },
    );
  } finally {
    await rm(override, { recursive: true, force: true });
  }
});

Deno.test("dataDir scopes to /users/anon under MULTI_USER without a session", async () => {
  const override = await mkdtemp(join(tmpdir(), "ln-multi-"));
  try {
    await withTempEnv(
      { LIBRENOTEBOOK_DATA_DIR: override, MULTI_USER: "1" },
      async () => {
        const url = new URL("../../src/lib/paths.ts", import.meta.url).href +
          `?t=${Date.now()}-${Math.random()}`;
        const { dataDir } = await import(url);
        assertStringIncludes(dataDir(), "users");
        assertStringIncludes(dataDir(), "anon");
      },
    );
  } finally {
    await rm(override, { recursive: true, force: true });
  }
});

Deno.test("migrateLegacyDataDir moves a non-empty .data into the platform dir", async () => {
  const target = await mkdtemp(join(tmpdir(), "ln-target-"));
  // Need to drop `target` so the migration considers it 'empty' (it
  // tries to readdir; ENOENT is fine).
  await rm(target, { recursive: true, force: true });

  const projectRoot = await mkdtemp(join(tmpdir(), "ln-proj-"));
  const legacy = join(projectRoot, ".data");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "marker.txt"), "hello", "utf8");

  const origCwd = Deno.cwd();
  Deno.chdir(projectRoot);

  try {
    await withTempEnv({ LIBRENOTEBOOK_DATA_DIR: target }, async () => {
      const url = new URL("../../src/lib/paths.ts", import.meta.url).href +
        `?t=${Date.now()}-${Math.random()}`;
      const { migrateLegacyDataDir } = await import(url);
      await migrateLegacyDataDir();

      const targetEntries = await readdir(target);
      assert(
        targetEntries.includes("marker.txt"),
        "marker.txt should have moved into the platform dir",
      );

      // Legacy dir should be gone.
      let legacyExists = true;
      try {
        await readdir(legacy);
      } catch {
        legacyExists = false;
      }
      assert(!legacyExists, "legacy .data should be gone after migration");
    });
  } finally {
    Deno.chdir(origCwd);
    await rm(projectRoot, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

Deno.test("migrateLegacyDataDir is a no-op when target is non-empty", async () => {
  const target = await mkdtemp(join(tmpdir(), "ln-target-"));
  await writeFile(join(target, "preexisting.txt"), "x", "utf8");

  const projectRoot = await mkdtemp(join(tmpdir(), "ln-proj-"));
  const legacy = join(projectRoot, ".data");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "marker.txt"), "hello", "utf8");

  const origCwd = Deno.cwd();
  Deno.chdir(projectRoot);

  try {
    await withTempEnv({ LIBRENOTEBOOK_DATA_DIR: target }, async () => {
      const url = new URL("../../src/lib/paths.ts", import.meta.url).href +
        `?t=${Date.now()}-${Math.random()}`;
      const { migrateLegacyDataDir } = await import(url);
      await migrateLegacyDataDir();
      const entries = await readdir(target);
      assert(!entries.includes("marker.txt"), "shouldn't have migrated over a populated target");
    });
  } finally {
    Deno.chdir(origCwd);
    await rm(projectRoot, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});
