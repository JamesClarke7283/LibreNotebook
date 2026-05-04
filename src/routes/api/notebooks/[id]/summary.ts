// /api/notebooks/:id/summary
//
//   GET  → snapshot of the notebook's summary state (summary + suggested
//          questions + status + error).
//   POST → kick off (re)generation in the background. Marks the notebook
//          summaryStatus="generating" and returns 202 immediately.
//
// The page handler at /notebooks/:id auto-fires this POST the first time
// a notebook with sources is opened.

import { define } from "../../../../utils.ts";
import {
  getNotebook,
  getSettings,
  updateNotebook,
} from "../../../../lib/storage.ts";
import { generateSummaryAndQuestions } from "../../../../lib/summary.ts";

async function generateInBackground(notebookId: string): Promise<void> {
  const settings = await getSettings();
  if (!settings) {
    await updateNotebook(notebookId, {
      summaryStatus: "failed",
      summaryError: "No provider settings configured.",
    });
    return;
  }
  try {
    const result = await generateSummaryAndQuestions(settings, notebookId);
    if (!result) {
      // No sources — nothing to summarise. Reset to idle.
      await updateNotebook(notebookId, {
        summaryStatus: "idle",
        summaryError: undefined,
      });
      return;
    }
    await updateNotebook(notebookId, {
      summary: result.summary,
      suggestedQuestions: result.suggestedQuestions,
      summaryGeneratedAt: new Date().toISOString(),
      summaryStatus: "idle",
      summaryError: undefined,
    });
  } catch (err) {
    await updateNotebook(notebookId, {
      summaryStatus: "failed",
      summaryError: err instanceof Error ? err.message : String(err),
    });
  }
}

export const handler = define.handlers({
  async GET(ctx) {
    const nb = await getNotebook(ctx.params.id);
    if (!nb) return new Response("Not found", { status: 404 });
    return Response.json({
      summary: nb.summary ?? null,
      suggestedQuestions: nb.suggestedQuestions ?? [],
      summaryGeneratedAt: nb.summaryGeneratedAt ?? null,
      summaryStatus: nb.summaryStatus ?? "idle",
      summaryError: nb.summaryError ?? null,
    });
  },

  async POST(ctx) {
    const id = ctx.params.id;
    const nb = await getNotebook(id);
    if (!nb) return new Response("Not found", { status: 404 });
    if (nb.summaryStatus === "generating") {
      return Response.json({ ok: true, alreadyGenerating: true });
    }
    await updateNotebook(id, {
      summaryStatus: "generating",
      summaryError: undefined,
    });
    queueMicrotask(() => {
      generateInBackground(id).catch(() => {});
    });
    return Response.json({ ok: true }, { status: 202 });
  },
});
