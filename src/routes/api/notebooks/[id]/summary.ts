// /api/notebooks/:id/summary
//
//   GET  → snapshot of the notebook's summary state (summary + suggested
//          questions + status + error). Auto-recovers stale "generating"
//          jobs that a server restart left orphaned: if the notebook has
//          been "generating" longer than STALE_MS we mark it failed and
//          immediately re-kick generation in the background.
//   POST → kick off (re)generation in the background. Marks the notebook
//          summaryStatus="generating" + summaryStartedAt=now and returns
//          202 immediately. If a stale "generating" job is already
//          recorded, we re-kick rather than bailing.
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
import { getLogger } from "../../../../lib/logger.ts";

const log = getLogger("summary-route");

/** A "generating" job older than this is treated as orphaned (the server
 *  restarted, the LLM hung past the 3-minute invoke timeout, etc.).
 *  Set to 5 minutes — comfortably longer than the 180s invoke timeout
 *  so we don't accidentally kill a slow but live job. */
const STALE_MS = 5 * 60 * 1000;

function isStale(startedAt: string | undefined): boolean {
  if (!startedAt) return true; // missing timestamp ⇒ orphaned by definition
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > STALE_MS;
}

async function generateInBackground(notebookId: string): Promise<void> {
  log.info("summary background task starting", { notebookId });
  const settings = await getSettings();
  if (!settings) {
    log.warn("summary aborted — no provider settings", { notebookId });
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
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("summary background task failed", { notebookId, error: msg });
    await updateNotebook(notebookId, {
      summaryStatus: "failed",
      summaryError: msg,
    });
  }
}

export const handler = define.handlers({
  async GET(ctx) {
    const id = ctx.params.id;
    const nb = await getNotebook(id);
    if (!nb) return new Response("Not found", { status: 404 });

    // Stale recovery: if the notebook is "generating" but the start
    // timestamp is missing or older than STALE_MS, the previous job
    // was orphaned (server restart, hard timeout). Mark failed and
    // re-kick — the next poll will see the fresh job.
    if (
      nb.summaryStatus === "generating" &&
      isStale(nb.summaryStartedAt)
    ) {
      log.warn("summary GET detected stale job — auto-restarting", {
        notebookId: id,
        startedAt: nb.summaryStartedAt,
      });
      await updateNotebook(id, {
        summaryStatus: "generating",
        summaryStartedAt: new Date().toISOString(),
        summaryError: undefined,
      });
      queueMicrotask(() => {
        generateInBackground(id).catch((err) => {
          log.error("summary background task uncaught", {
            notebookId: id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });
    }

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
    log.info("summary POST received", { notebookId: id });
    const nb = await getNotebook(id);
    if (!nb) return new Response("Not found", { status: 404 });
    // Only bail when there's a *live* generation in flight. A stale
    // "generating" record (from a crashed server) should re-kick.
    if (
      nb.summaryStatus === "generating" &&
      !isStale(nb.summaryStartedAt)
    ) {
      log.info("summary POST: already generating — skipping", {
        notebookId: id,
        startedAt: nb.summaryStartedAt,
      });
      return Response.json({ ok: true, alreadyGenerating: true });
    }
    await updateNotebook(id, {
      summaryStatus: "generating",
      summaryStartedAt: new Date().toISOString(),
      summaryError: undefined,
    });
    log.info("summary POST scheduling background task", { notebookId: id });
    queueMicrotask(() => {
      generateInBackground(id).catch((err) => {
        log.error("summary background task uncaught", {
          notebookId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
    return Response.json({ ok: true }, { status: 202 });
  },
});
