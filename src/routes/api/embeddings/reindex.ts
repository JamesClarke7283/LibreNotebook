// Wipe every notebook's vector store and re-embed all sources from
// scratch. Used when the user changes the embedding model — the existing
// vectors are no longer comparable, so we rebuild.
//
// POST → 202 with { reindexing: N }   (count of sources queued)
// GET  → { active: bool, current, total }   aggregate progress
//
// The actual work happens in the background.

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { define } from "../../../utils.ts";
import {
  getSettings,
  listNotebooks,
  listSources,
  updateSource,
} from "../../../lib/storage.ts";
import { ingestSource } from "../../../lib/ingest.ts";
import { dataDir } from "../../../lib/paths.ts";
import type { AppSettings, NotebookSource } from "../../../lib/types.ts";

function vectorsDir(): string {
  return join(dataDir(), "vectors");
}

async function wipeVectors(): Promise<void> {
  let files: string[] = [];
  try {
    files = await readdir(vectorsDir());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    await rm(join(vectorsDir(), f), { force: true });
  }
}

async function reindexAll(settings: AppSettings): Promise<void> {
  // 1. Wipe existing vectors.
  await wipeVectors();

  // 2. Mark every source pending.
  const notebooks = await listNotebooks();
  const all: NotebookSource[] = [];
  for (const nb of notebooks) {
    const ss = await listSources(nb.id);
    for (const s of ss) {
      all.push(s);
      await updateSource(nb.id, s.id, {
        status: "pending",
        progress: { current: 0, total: 0 },
        error: undefined,
      });
    }
  }

  // 3. Re-ingest sequentially. Sequential keeps the embedding server
  // from being overloaded; the UI shows the queue draining via polling.
  for (const s of all) {
    try {
      await ingestSource(settings, s, async (current, total) => {
        await updateSource(s.notebookId, s.id, {
          progress: { current, total },
        });
      });
      await updateSource(s.notebookId, s.id, { status: "ready" });
    } catch (err) {
      await updateSource(s.notebookId, s.id, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function kickOff(settings: AppSettings): void {
  reindexAll(settings).catch(() => {});
}

async function aggregateProgress(): Promise<{
  active: boolean;
  current: number;
  total: number;
  pendingCount: number;
}> {
  const notebooks = await listNotebooks();
  let current = 0;
  let total = 0;
  let pendingCount = 0;
  for (const nb of notebooks) {
    const ss = await listSources(nb.id);
    for (const s of ss) {
      const p = s.progress ?? { current: 0, total: 0 };
      current += p.current;
      total += p.total;
      if (s.status === "pending") pendingCount += 1;
    }
  }
  return { active: pendingCount > 0, current, total, pendingCount };
}

export const handler = define.handlers({
  async GET() {
    return Response.json(await aggregateProgress());
  },
  async POST() {
    const settings = await getSettings();
    if (!settings) {
      return new Response("No settings configured", { status: 412 });
    }
    // Count what's about to be queued.
    const notebooks = await listNotebooks();
    let queued = 0;
    for (const nb of notebooks) queued += (await listSources(nb.id)).length;
    kickOff(settings);
    return Response.json({ reindexing: queued }, { status: 202 });
  },
});
