// POST /api/notebooks/:id/studio/infographic/refine
//
// multipart/form-data body: jobId, image (PNG of current rendering)
//
// Asks the LLM to critique its previous Mermaid and emit an improved
// one. If the LLM has vision support, we send the rendered image
// alongside the text prompt; otherwise it's a text-only loop.
//
// Always reports `done: true` once the job has accumulated >=3 history
// entries — even if the model thinks it's converged. The client uses
// this to know when to call /finalise.

import { define } from "../../../../../../utils.ts";
import {
  getSettings,
  updateStudioItem,
} from "../../../../../../lib/storage.ts";
import { refineMermaid } from "../../../../../../lib/infographic.ts";
import { readJob, writeJob } from "../../../../../../lib/jobs.ts";
import { getLogger } from "../../../../../../lib/logger.ts";

const log = getLogger("infographic-refine");
const MIN_ITERATIONS = 3;

export const handler = define.handlers({
  async POST(ctx) {
    const notebookId = ctx.params.id;
    log.info("infographic refine POST received", { notebookId });
    const settings = await getSettings();
    if (!settings) return new Response("No settings", { status: 412 });

    const ct = ctx.req.headers.get("content-type") ?? "";
    let jobId = "";
    let imageDataUrl: string | null = null;

    if (ct.startsWith("multipart/form-data")) {
      const form = await ctx.req.formData();
      jobId = String(form.get("jobId") ?? "");
      const file = form.get("image");
      if (file instanceof File) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const base64 = btoa(
          // Convert to a binary string (chunk to avoid call-stack limits).
          chunkedToBinary(bytes),
        );
        imageDataUrl = `data:${file.type || "image/png"};base64,${base64}`;
      }
    } else {
      try {
        const body = await ctx.req.json() as { jobId?: string };
        jobId = String(body.jobId ?? "");
      } catch {
        return new Response("Invalid body", { status: 400 });
      }
    }
    if (!jobId) return new Response("Missing jobId", { status: 400 });

    const job = await readJob(notebookId, jobId);
    if (!job) return new Response("Job not found", { status: 404 });

    const last = job.history[job.history.length - 1];
    if (!last) return new Response("Empty job history", { status: 500 });

    const nextIter = job.history.length + 1;
    log.info("refine start", {
      notebookId,
      jobId,
      iter: nextIter,
      hasImage: imageDataUrl !== null,
      currentMermaidChars: last.mermaid.length,
    });
    const t0 = Date.now();
    let mermaid: string;
    try {
      mermaid = await refineMermaid(
        settings,
        job.params,
        last.mermaid,
        imageDataUrl,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("refine failed", {
        notebookId,
        jobId,
        iter: nextIter,
        elapsedMs: Date.now() - t0,
        error: msg,
      });
      await updateStudioItem(notebookId, job.studioItemId, {
        status: "failed",
        error: msg,
      });
      return Response.json({ ok: false, error: msg }, { status: 502 });
    }
    log.info("refine done", {
      notebookId,
      jobId,
      iter: nextIter,
      elapsedMs: Date.now() - t0,
      mermaidChars: mermaid.length,
    });

    job.history.push({ iter: nextIter, mermaid });
    await writeJob(job);

    await updateStudioItem(notebookId, job.studioItemId, {
      iteration: job.history.length,
    });

    return Response.json({
      iteration: job.history.length,
      mermaid,
      done: job.history.length >= MIN_ITERATIONS,
    });
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
