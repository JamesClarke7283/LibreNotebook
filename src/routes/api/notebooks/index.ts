// POST: create a new notebook. GET: list notebooks (currently unused —
// pages render server-side from storage directly).

import { define } from "../../../utils.ts";
import { createNotebook, listNotebooks } from "../../../lib/storage.ts";

export const handler = define.handlers({
  async GET() {
    const notebooks = await listNotebooks();
    return new Response(JSON.stringify(notebooks), {
      headers: { "Content-Type": "application/json" },
    });
  },
  async POST(ctx) {
    let title = "Untitled notebook";
    try {
      const body = await ctx.req.json() as { title?: string };
      if (body && typeof body.title === "string" && body.title.trim()) {
        title = body.title.trim();
      }
    } catch {
      // Empty body is fine.
    }
    const nb = await createNotebook(title);
    return new Response(JSON.stringify(nb), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  },
});
