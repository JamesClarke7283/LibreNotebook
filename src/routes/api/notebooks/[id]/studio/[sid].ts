// /api/notebooks/:id/studio/:sid
//
//   DELETE → drop one studio item (infographic, audio, report, …) from
//            the notebook. Idempotent: returns 204 even if the item was
//            already gone. The chat-side message that hosts the rendered
//            artefact (for infographic items) is left untouched so the
//            chat history stays coherent — only the right-pane card
//            disappears.

import { define } from "../../../../../utils.ts";
import {
  deleteStudioItem,
  getNotebook,
  getStudioItem,
} from "../../../../../lib/storage.ts";
import { getLogger } from "../../../../../lib/logger.ts";

const log = getLogger("studio-delete");

export const handler = define.handlers({
  async DELETE(ctx) {
    const { id: notebookId, sid: itemId } = ctx.params;
    const nb = await getNotebook(notebookId);
    if (!nb) return new Response("Notebook not found", { status: 404 });

    const existing = await getStudioItem(notebookId, itemId);
    if (existing) {
      await deleteStudioItem(notebookId, itemId);
      log.info("studio item deleted", {
        notebookId,
        itemId,
        kind: existing.kind,
        status: existing.status,
      });
    }
    // Idempotent — never 404 on already-gone items.
    return new Response(null, { status: 204 });
  },
});
