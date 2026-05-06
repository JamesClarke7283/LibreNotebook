// GET /api/notebooks/:id/studio — list the notebook's studio items
// (newest first). The right-pane StudioPanel polls this while any item
// is in `status === "generating"`.
//
// Auto-recovers studio items orphaned by a server restart: anything
// stuck in "generating" longer than 10 minutes (well past our 180 s LLM
// invoke timeout, with headroom for slow Ollama models that may take
// 5+ min for a single iteration of a 7-iteration loop) is flipped to
// "failed" so the perpetual spinner disappears. Each iteration's bg
// task bumps the studio item's updatedAt, so live runs heartbeat
// against this sweep. User clicks the Infographic tile to retry on
// failure.

import { define } from "../../../../utils.ts";
import { listStudioItems, updateStudioItem } from "../../../../lib/storage.ts";
import { getLogger } from "../../../../lib/logger.ts";

const log = getLogger("studio-route");

const STALE_MS = 10 * 60 * 1000;

export const handler = define.handlers({
  async GET(ctx) {
    const notebookId = ctx.params.id;
    const items = await listStudioItems(notebookId);
    const now = Date.now();
    const recovered: typeof items = [];
    for (const item of items) {
      if (item.status !== "generating") {
        recovered.push(item);
        continue;
      }
      const updatedAt = Date.parse(item.updatedAt);
      if (Number.isNaN(updatedAt) || now - updatedAt > STALE_MS) {
        log.warn("studio GET detected stale item — marking failed", {
          notebookId,
          itemId: item.id,
          kind: item.kind,
          updatedAt: item.updatedAt,
        });
        const failed = await updateStudioItem(notebookId, item.id, {
          status: "failed",
          error: "Server restarted before completion",
        });
        recovered.push(failed ?? item);
      } else {
        recovered.push(item);
      }
    }
    return Response.json(recovered);
  },
});
