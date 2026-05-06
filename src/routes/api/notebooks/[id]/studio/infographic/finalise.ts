// POST /api/notebooks/:id/studio/infographic/finalise
//
// Body: { jobId }
//
// Wraps up the iteration loop by flipping the studio item to "ready"
// with the latest Mermaid. The /refine background task auto-finalises
// when the model emits DONE: yes (so a closed browser doesn't strand
// the result), so this route is idempotent — if the item is already
// "ready" we return it as-is.
//
// Diagrams live on the studio item (not in chat history). The
// fullscreen InfographicViewer surfaces them when the user clicks the
// ready card.

import { define } from "../../../../../../utils.ts";
import {
  getStudioItem,
  updateStudioItem,
} from "../../../../../../lib/storage.ts";
import { deriveTitle } from "../../../../../../lib/infographic.ts";
import { deleteJob, readJob } from "../../../../../../lib/jobs.ts";
import { getLogger } from "../../../../../../lib/logger.ts";

const log = getLogger("infographic-finalise");

export const handler = define.handlers({
  async POST(ctx) {
    const notebookId = ctx.params.id;
    let body: { jobId?: string };
    try {
      body = await ctx.req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const jobId = String(body.jobId ?? "");
    if (!jobId) return new Response("Missing jobId", { status: 400 });

    const job = await readJob(notebookId, jobId);

    // Idempotency path: the bg refine task may have already finalised
    // when the model emitted DONE: yes. The job file is deleted on
    // auto-finalise so a missing job is a graceful "already done".
    if (!job) {
      log.info("finalise: job already deleted (auto-finalised path)", {
        notebookId,
        jobId,
      });
      return Response.json({ ok: true, alreadyFinalised: true });
    }

    const item = await getStudioItem(notebookId, job.studioItemId);
    if (item?.status === "ready") {
      log.info("finalise: studio item already ready (idempotent no-op)", {
        notebookId,
        jobId,
        studioItemId: item.id,
      });
      await deleteJob(notebookId, jobId).catch(() => {});
      return Response.json({
        ok: true,
        alreadyFinalised: true,
        studioItem: item,
      });
    }

    const last = job.history[job.history.length - 1];
    if (!last) return new Response("Empty job", { status: 500 });

    const title = deriveTitle(last.mermaid, job.params);
    const studioItem = await updateStudioItem(notebookId, job.studioItemId, {
      status: "ready",
      mermaid: last.mermaid,
      title,
      inFlight: false,
    });

    await deleteJob(notebookId, jobId).catch(() => {});

    return Response.json({ ok: true, studioItem });
  },
});
