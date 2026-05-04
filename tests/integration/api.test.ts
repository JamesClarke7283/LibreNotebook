// Integration tests against a live dev server. Single-user mode (no
// MULTI_USER). Each test pins LIBRENOTEBOOK_DATA_DIR to a tempdir so
// the user's real notebooks don't get touched.
//
// We boot the server once for the whole file (sanitizeOps is off so
// the lingering child process doesn't fail leak detection).

import { assert, assertEquals } from "jsr:@std/assert@^1";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer, stopServer } from "../setup.ts";

let baseUrl = "";
let tempData = "";
const created: string[] = [];

async function setup() {
  if (baseUrl) return;
  tempData = await mkdtemp(join(tmpdir(), "ln-it-"));
  // The dev-server child needs the override too — pass it through.
  baseUrl = await startServer({ LIBRENOTEBOOK_DATA_DIR: tempData });
}

async function teardown() {
  for (const id of created) {
    await fetch(`${baseUrl}/api/notebooks/${id}`, { method: "DELETE" }).catch(
      () => {},
    );
  }
  await stopServer();
  if (tempData) await rm(tempData, { recursive: true, force: true });
}

Deno.test({
  name: "API: notebooks CRUD",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    await setup();

    let id = "";
    await t.step("POST creates a notebook", async () => {
      const res = await fetch(`${baseUrl}/api/notebooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "API integration nb" }),
      });
      assertEquals(res.status, 201);
      const nb = await res.json();
      assert(nb.id);
      id = nb.id;
      created.push(id);
      assertEquals(nb.title, "API integration nb");
    });

    await t.step("GET /api/notebooks lists it", async () => {
      const res = await fetch(`${baseUrl}/api/notebooks`);
      assertEquals(res.status, 200);
      const list = await res.json();
      assert(Array.isArray(list));
      assert(list.some((n: { id: string }) => n.id === id));
    });

    await t.step("PATCH renames", async () => {
      const res = await fetch(`${baseUrl}/api/notebooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed via API" }),
      });
      assertEquals(res.status, 200);
      const nb = await res.json();
      assertEquals(nb.title, "Renamed via API");
    });

    await t.step("PATCH refuses an empty title", async () => {
      const res = await fetch(`${baseUrl}/api/notebooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "   " }),
      });
      assertEquals(res.status, 400);
      await res.body?.cancel();
    });

    await t.step("DELETE removes it", async () => {
      const res = await fetch(`${baseUrl}/api/notebooks/${id}`, {
        method: "DELETE",
      });
      assertEquals(res.status, 204);
      const get = await fetch(`${baseUrl}/api/notebooks/${id}`);
      assertEquals(get.status, 404);
      await get.body?.cancel();
      // Already deleted; drop from teardown list.
      const idx = created.indexOf(id);
      if (idx >= 0) created.splice(idx, 1);
    });
  },
});

Deno.test({
  name: "API: settings GET returns shape with locks",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await setup();
    const res = await fetch(`${baseUrl}/api/settings`);
    assertEquals(res.status, 200);
    const body = await res.json();
    assert("settings" in body && "locks" in body, "shape: { settings, locks }");
    assert(typeof body.locks.llm === "boolean");
    assert(typeof body.locks.embedding === "boolean");
  },
});

Deno.test({
  name: "API: test-connection surfaces friendly errors",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await setup();
    // Localhost on a port nothing's listening on → connection refused
    // → friendly mapped error.
    const res = await fetch(`${baseUrl}/api/test-connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "ollama",
        baseUrl: "http://127.0.0.1:1",
      }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, false);
    assert(typeof body.error === "string" && body.error.length > 0);
  },
});

Deno.test({
  name: "API: sources POST text + GET list + DELETE",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    await setup();
    let nbId = "";
    let srcId = "";

    await t.step("create notebook", async () => {
      const res = await fetch(`${baseUrl}/api/notebooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Sources API" }),
      });
      const nb = await res.json();
      nbId = nb.id;
      created.push(nbId);
    });

    await t.step("POST text source returns 202", async () => {
      const res = await fetch(`${baseUrl}/api/notebooks/${nbId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "text",
          name: "API Note",
          content: "Cats are mammals. Dogs bark.",
        }),
      });
      // 202 in single-user mode (or 412 if no settings — also acceptable).
      assert(res.status === 202 || res.status === 412);
      if (res.status === 202) {
        const src = await res.json();
        srcId = src.id;
        assertEquals(src.kind, "text");
        assertEquals(src.status, "pending");
      } else {
        await res.body?.cancel();
      }
    });

    if (srcId) {
      await t.step("GET sources list contains it", async () => {
        const res = await fetch(`${baseUrl}/api/notebooks/${nbId}/sources`);
        assertEquals(res.status, 200);
        const list = await res.json();
        assert(list.some((s: { id: string }) => s.id === srcId));
      });

      await t.step("DELETE removes it", async () => {
        const res = await fetch(
          `${baseUrl}/api/notebooks/${nbId}/sources/${srcId}`,
          { method: "DELETE" },
        );
        assertEquals(res.status, 204);
      });
    }
  },
});

Deno.test({
  name: "teardown",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await teardown();
  },
});
