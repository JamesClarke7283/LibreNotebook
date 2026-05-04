// /api/notebooks/:id/sources/:sid
//   GET    → return the full source record (used by the citation drawer)
//   DELETE → remove a source plus its indexed chunks and extracted images

import { define } from "../../../../../utils.ts";
import { deleteSource, getSource } from "../../../../../lib/storage.ts";
import { removeSource as removeFromVectors } from "../../../../../lib/vectorstore.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const { id: notebookId, sid: sourceId } = ctx.params;
    const source = await getSource(notebookId, sourceId);
    if (!source) return new Response("Not found", { status: 404 });
    return Response.json(source);
  },

  async DELETE(ctx) {
    const { id: notebookId, sid: sourceId } = ctx.params;
    const existing = await getSource(notebookId, sourceId);
    if (!existing) return new Response("Not found", { status: 404 });
    try {
      await removeFromVectors(notebookId, sourceId);
    } catch {
      // best-effort
    }
    await deleteSource(notebookId, sourceId);
    return new Response(null, { status: 204 });
  },
});
