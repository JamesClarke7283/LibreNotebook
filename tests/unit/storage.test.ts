// Storage CRUD against a temp dataDir so we don't pollute the real
// per-user platformdir. Each test imports storage.ts fresh after
// pointing $LIBRENOTEBOOK_DATA_DIR somewhere new.

import { assertEquals, assert } from "jsr:@std/assert@^1";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function freshStorage() {
  const url = new URL("../../src/lib/storage.ts", import.meta.url).href +
    `?t=${Date.now()}-${Math.random()}`;
  return await import(url);
}

async function withTempData<T>(fn: () => Promise<T>): Promise<T> {
  const tmp = await mkdtemp(join(tmpdir(), "ln-storage-"));
  const prevData = Deno.env.get("LIBRENOTEBOOK_DATA_DIR");
  const prevMulti = Deno.env.get("MULTI_USER");
  Deno.env.set("LIBRENOTEBOOK_DATA_DIR", tmp);
  Deno.env.delete("MULTI_USER");
  try {
    return await fn();
  } finally {
    if (prevData === undefined) Deno.env.delete("LIBRENOTEBOOK_DATA_DIR");
    else Deno.env.set("LIBRENOTEBOOK_DATA_DIR", prevData);
    if (prevMulti !== undefined) Deno.env.set("MULTI_USER", prevMulti);
    await rm(tmp, { recursive: true, force: true });
  }
}

Deno.test("notebooks: create, list, update, delete round-trip", async () => {
  await withTempData(async () => {
    const s = await freshStorage();
    assertEquals(await s.listNotebooks(), []);
    const nb = await s.createNotebook("Test");
    assert(nb.id);
    assertEquals(nb.title, "Test");
    assertEquals(nb.sourceCount, 0);

    const list = await s.listNotebooks();
    assertEquals(list.length, 1);

    const renamed = await s.updateNotebook(nb.id, { title: "Renamed" });
    assertEquals(renamed?.title, "Renamed");

    await s.deleteNotebook(nb.id);
    assertEquals(await s.listNotebooks(), []);
  });
});

Deno.test("sources: add increments notebook.sourceCount, delete decrements", async () => {
  await withTempData(async () => {
    const s = await freshStorage();
    const nb = await s.createNotebook("Sources test");
    const src = await s.addSource({
      notebookId: nb.id,
      name: "Pasted",
      kind: "text",
      content: "Hello world.",
      status: "pending",
    });
    assert(src.id);
    let updated = await s.getNotebook(nb.id);
    assertEquals(updated?.sourceCount, 1);

    await s.deleteSource(nb.id, src.id);
    updated = await s.getNotebook(nb.id);
    assertEquals(updated?.sourceCount, 0);
    assertEquals(await s.listSources(nb.id), []);
  });
});

Deno.test("messages: addMessage appends with id+createdAt", async () => {
  await withTempData(async () => {
    const s = await freshStorage();
    const nb = await s.createNotebook("Msg test");
    const m1 = await s.addMessage({
      notebookId: nb.id,
      role: "user",
      content: "Hi",
    });
    const m2 = await s.addMessage({
      notebookId: nb.id,
      role: "assistant",
      content: "Hello!",
    });
    assert(m1.id);
    assert(m2.id);
    assert(m1.createdAt <= m2.createdAt);
    const list = await s.listMessages(nb.id);
    assertEquals(list.length, 2);
    assertEquals(list[0].role, "user");
    assertEquals(list[1].role, "assistant");
  });
});

Deno.test("studio items: add, update, delete cycle", async () => {
  await withTempData(async () => {
    const s = await freshStorage();
    const nb = await s.createNotebook("Studio");
    const item = await s.addStudioItem({
      notebookId: nb.id,
      kind: "infographic",
      title: "Generating…",
      status: "generating",
      basedOnSources: 5,
      iteration: 1,
    });
    assert(item.id);
    assertEquals(item.status, "generating");

    const ready = await s.updateStudioItem(nb.id, item.id, {
      status: "ready",
      mermaid: "flowchart TD A-->B",
      title: "Final",
    });
    assertEquals(ready?.status, "ready");
    assertEquals(ready?.title, "Final");

    const list = await s.listStudioItems(nb.id);
    assertEquals(list.length, 1);

    await s.deleteStudioItem(nb.id, item.id);
    assertEquals(await s.listStudioItems(nb.id), []);
  });
});

Deno.test("settings: getSettings returns null when nothing saved", async () => {
  await withTempData(async () => {
    const s = await freshStorage();
    assertEquals(await s.getSettings(), null);
  });
});

Deno.test("settings: env LLM preset merges with stored", async () => {
  await withTempData(async () => {
    const prev = Deno.env.get("LLM_BASE_URL");
    Deno.env.set("LLM_BASE_URL", "https://env-only.example.com/v1");
    Deno.env.set("LLM_MODEL", "env-model");
    try {
      const s = await freshStorage();
      const got = await s.getSettings();
      assert(got, "env preset should yield a non-null settings object");
      assertEquals(got!.llm.baseUrl, "https://env-only.example.com/v1");
      assertEquals(got!.llm.model, "env-model");
    } finally {
      if (prev === undefined) Deno.env.delete("LLM_BASE_URL");
      else Deno.env.set("LLM_BASE_URL", prev);
      Deno.env.delete("LLM_MODEL");
    }
  });
});
