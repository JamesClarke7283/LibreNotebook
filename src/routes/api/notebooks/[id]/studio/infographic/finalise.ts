// POST /api/notebooks/:id/studio/infographic/finalise
//
// Body: { jobId }
//
// Wraps up the iteration loop: appends the final Mermaid as an
// assistant chat message (so the diagram appears in the conversation
// stream just like a normal reply), flips the studio item to "ready"
// with the derived title, and cleans up the job file.

import { define } from "../../../../../../utils.ts";
import {
  addMessage,
  updateStudioItem,
} from "../../../../../../lib/storage.ts";
import { deriveTitle } from "../../../../../../lib/infographic.ts";
import { deleteJob, readJob } from "../../../../../../lib/jobs.ts";

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
    if (!job) return new Response("Job not found", { status: 404 });
    const last = job.history[job.history.length - 1];
    if (!last) return new Response("Empty job", { status: 500 });

    const title = deriveTitle(last.mermaid, job.params);

    // Append as an assistant chat message containing the fenced
    // mermaid block — ChatPanel's MessageBubble extracts it and
    // renders the SVG via MermaidView.
    const message = await addMessage({
      notebookId,
      role: "assistant",
      content:
        `Here's the infographic you requested:\n\n` +
        "```mermaid\n" + last.mermaid + "\n```",
    });

    const studioItem = await updateStudioItem(notebookId, job.studioItemId, {
      status: "ready",
      mermaid: last.mermaid,
      title,
      messageId: message.id,
    });

    await deleteJob(notebookId, jobId).catch(() => {});

    return Response.json({ ok: true, message, studioItem });
  },
});
