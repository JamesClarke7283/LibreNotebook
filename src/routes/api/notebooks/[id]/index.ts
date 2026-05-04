// /api/notebooks/:id
//
//   GET    → return the notebook record (used as a thin server probe)
//   PATCH  → rename. Body: { title: string }. Trims, refuses empty,
//            returns the updated record.
//
// (DELETE is intentionally not exposed yet — drop a notebook by deleting
// its directory under .data/ for now.)

import { define } from "../../../../utils.ts";
import { getNotebook, updateNotebook } from "../../../../lib/storage.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const nb = await getNotebook(ctx.params.id);
    if (!nb) return new Response("Not found", { status: 404 });
    return Response.json(nb);
  },

  async PATCH(ctx) {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return new Response("Expected { title }", { status: 400 });
    }
    const { title } = body as { title?: unknown };
    if (typeof title !== "string") {
      return new Response("Title must be a string", { status: 400 });
    }
    const trimmed = title.trim();
    if (!trimmed) {
      return new Response("Title cannot be empty", { status: 400 });
    }
    const updated = await updateNotebook(ctx.params.id, { title: trimmed });
    if (!updated) return new Response("Not found", { status: 404 });
    return Response.json(updated);
  },
});
