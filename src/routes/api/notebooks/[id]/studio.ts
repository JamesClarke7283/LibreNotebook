// GET /api/notebooks/:id/studio — list the notebook's studio items
// (newest first). The right-pane StudioPanel polls this while any item
// is in `status === "generating"`.

import { define } from "../../../../utils.ts";
import { listStudioItems } from "../../../../lib/storage.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const items = await listStudioItems(ctx.params.id);
    return Response.json(items);
  },
});
