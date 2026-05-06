// POST /api/notebooks/:id/studio/infographic/refine
//
// multipart/form-data body: jobId, image (PNG of current rendering),
//                           renderError (optional)
//
// Asks the LLM to critique its previous Mermaid and emit an improved
// one — runs in a background task so the HTTP request returns in <100 ms
// instead of holding the connection open for the 90+ s LLM call. The
// client polls the studio item to discover when the new iteration's
// mermaid is settled (`inFlight` flips back to false). When the model
// signals `DONE: yes` (or we hit MAX_ITERATIONS) the background task
// also auto-finalises the studio item to status "ready" so a closed
// browser at the last iteration still records the result. The diagram
// itself lives on the studio item (not in chat history) — the
// fullscreen InfographicViewer surfaces it when the user clicks the
// ready card.

import { define } from "../../../../../../utils.ts";
import {
  getSettings,
  getStudioItem,
  updateStudioItem,
} from "../../../../../../lib/storage.ts";
import {
  deriveTitle,
  refineMermaid,
} from "../../../../../../lib/infographic.ts";
import { deleteJob, readJob, writeJob } from "../../../../../../lib/jobs.ts";
import { getLogger } from "../../../../../../lib/logger.ts";
import type { AppSettings } from "../../../../../../lib/types.ts";

const log = getLogger("infographic-refine");

/** Hard ceiling on refinement passes. The model decides when to stop
 *  via `DONE: yes` in its output, but if it never converges we cap
 *  the loop here so a stubborn model doesn't iterate indefinitely. */
const MAX_ITERATIONS = 7;

async function runRefineInBackground(
  settings: AppSettings,
  notebookId: string,
  studioItemId: string,
  jobId: string,
  imageDataUrl: string | null,
  renderError: string | null,
): Promise<void> {
  const t0 = Date.now();
  try {
    const job = await readJob(notebookId, jobId);
    if (!job) {
      log.warn("refine bg: job vanished mid-run", {
        notebookId,
        studioItemId,
        jobId,
      });
      await updateStudioItem(notebookId, studioItemId, {
        status: "failed",
        error: "Job state lost",
        inFlight: false,
      });
      return;
    }
    const last = job.history[job.history.length - 1];
    if (!last) {
      log.warn("refine bg: empty job history", {
        notebookId,
        studioItemId,
        jobId,
      });
      await updateStudioItem(notebookId, studioItemId, {
        status: "failed",
        error: "Empty job history",
        inFlight: false,
      });
      return;
    }
    const nextIter = job.history.length + 1;
    log.info("refine bg start", {
      notebookId,
      studioItemId,
      jobId,
      iter: nextIter,
      hasImage: imageDataUrl !== null,
      hasRenderError: renderError !== null,
      currentMermaidChars: last.mermaid.length,
    });

    const result = await refineMermaid(
      settings,
      job.params,
      last.mermaid,
      imageDataUrl,
      renderError,
    );

    job.history.push({ iter: nextIter, mermaid: result.mermaid });
    await writeJob(job);

    const done = result.done === true || job.history.length >= MAX_ITERATIONS;

    log.info("refine bg done", {
      notebookId,
      studioItemId,
      jobId,
      iter: nextIter,
      elapsedMs: Date.now() - t0,
      mermaidChars: result.mermaid.length,
      modelDoneVerdict: result.done,
      done,
    });

    if (done) {
      // Auto-finalise: flip the studio item to "ready" and store the
      // final mermaid on it. No chat message is created — the diagram
      // surfaces via the InfographicViewer when the user clicks the
      // ready card.
      const title = deriveTitle(result.mermaid, job.params);
      await updateStudioItem(notebookId, studioItemId, {
        status: "ready",
        iteration: job.history.length,
        mermaid: result.mermaid,
        modelDoneVerdict: result.done,
        title,
        inFlight: false,
      });
      await deleteJob(notebookId, jobId).catch(() => {});
    } else {
      await updateStudioItem(notebookId, studioItemId, {
        iteration: job.history.length,
        mermaid: result.mermaid,
        modelDoneVerdict: result.done,
        inFlight: false,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("refine bg failed", {
      notebookId,
      studioItemId,
      jobId,
      elapsedMs: Date.now() - t0,
      error: msg,
    });
    await updateStudioItem(notebookId, studioItemId, {
      status: "failed",
      error: msg,
      inFlight: false,
    });
  }
}

export const handler = define.handlers({
  async POST(ctx) {
    const notebookId = ctx.params.id;
    log.info("infographic refine POST received", { notebookId });
    const settings = await getSettings();
    if (!settings) return new Response("No settings", { status: 412 });

    const ct = ctx.req.headers.get("content-type") ?? "";
    let jobId = "";
    let imageDataUrl: string | null = null;
    let renderError: string | null = null;

    if (ct.startsWith("multipart/form-data")) {
      const form = await ctx.req.formData();
      jobId = String(form.get("jobId") ?? "");
      const file = form.get("image");
      if (file instanceof File) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const base64 = btoa(chunkedToBinary(bytes));
        imageDataUrl = `data:${file.type || "image/png"};base64,${base64}`;
      }
      const errField = form.get("renderError");
      if (typeof errField === "string" && errField.length > 0) {
        renderError = errField.slice(0, 800);
      }
    } else {
      try {
        const body = await ctx.req.json() as {
          jobId?: string;
          renderError?: string;
        };
        jobId = String(body.jobId ?? "");
        if (typeof body.renderError === "string" && body.renderError.length) {
          renderError = body.renderError.slice(0, 800);
        }
      } catch {
        return new Response("Invalid body", { status: 400 });
      }
    }
    if (!jobId) return new Response("Missing jobId", { status: 400 });

    const job = await readJob(notebookId, jobId);
    if (!job) return new Response("Job not found", { status: 404 });
    if (job.history.length === 0) {
      return new Response("Initial generation not finished yet", {
        status: 409,
      });
    }

    const item = await getStudioItem(notebookId, job.studioItemId);
    if (!item) return new Response("Studio item not found", { status: 404 });
    if (item.status !== "generating") {
      return new Response(
        `Studio item is ${item.status}, refine cannot proceed`,
        { status: 409 },
      );
    }
    // Guard against a client double-fire while the previous iteration's
    // bg task is still thinking.
    if (item.inFlight === true) {
      return new Response("A refinement is already in flight", { status: 409 });
    }

    await updateStudioItem(notebookId, job.studioItemId, { inFlight: true });

    queueMicrotask(() => {
      runRefineInBackground(
        settings,
        notebookId,
        job.studioItemId,
        jobId,
        imageDataUrl,
        renderError,
      ).catch((err) => {
        log.error("refine bg uncaught", {
          notebookId,
          studioItemId: job.studioItemId,
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    return Response.json({
      jobId,
      studioItemId: job.studioItemId,
      iteration: job.history.length + 1,
      maxIterations: MAX_ITERATIONS,
    }, { status: 202 });
  },
});

function chunkedToBinary(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return s;
}
