// DELETE /api/notebooks/:id/sources/:sid — remove a source plus its
// indexed chunks and any extracted images.

import { define } from "../../../../../utils.ts";
import { deleteSource, getSource } from "../../../../../lib/storage.ts";
import { removeSource as removeFromVectors } from "../../../../../lib/vectorstore.ts";

export const handler = define.handlers({
  async DELETE(ctx) {
    const { id: notebookId, sid: sourceId } = ctx.params;
    const existing = await getSource(notebookId, sourceId);
    if (!existing) return new Response("Not found", { status: 404 });
    // Vector cleanup first; if it fails we still want the user-facing
    // record gone, so swallow errors.
    try {
      await removeFromVectors(notebookId, sourceId);
    } catch {
      // best-effort
    }
    await deleteSource(notebookId, sourceId);
    return new Response(null, { status: 204 });
  },
});
