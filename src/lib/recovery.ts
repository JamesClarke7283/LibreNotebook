// Boot-time recovery for jobs orphaned by a previous server lifetime.
//
// Two failure modes the user can see across a restart:
//
//   1. Notebook stuck with summaryStatus="generating" forever.
//      We re-kick generateSummaryAndQuestions — the user gets a fresh
//      summary on the next page load without having to do anything.
//
//   2. Studio item (currently only infographics) stuck with
//      status="generating" forever. We mark it failed with a clear
//      error so the perpetual spinner disappears. We don't auto-rekick
//      because the infographic refine loop is driven client-side
//      (InfographicModal polling /refine); without an open browser
//      tab there's no driver. The user clicks the Infographic tile
//      again to retry.
//
// Called once at server boot from src/main.ts after loadEnv().

import {
  getSettings,
  listNotebooks,
  listStudioItems,
  updateNotebook,
  updateStudioItem,
} from "./storage.ts";
import { generateSummaryAndQuestions } from "./summary.ts";
import { getLogger } from "./logger.ts";

const log = getLogger("recovery");

export async function recoverStuckJobs(): Promise<void> {
  const t0 = Date.now();
  let summariesRekicked = 0;
  let studioItemsFailed = 0;

  let notebooks;
  try {
    notebooks = await listNotebooks();
  } catch (err) {
    log.warn("recovery: listNotebooks failed — skipping", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (notebooks.length === 0) {
    log.debug("recovery: no notebooks");
    return;
  }
  log.info("recovery: scanning", { notebooks: notebooks.length });

  // We need settings to re-kick summary generation. If settings are
  // missing (fresh install pre-onboarding) just mark stuck summaries
  // as failed instead of trying to regenerate.
  const settings = await getSettings();

  for (const nb of notebooks) {
    // ---- summary
    if (nb.summaryStatus === "generating") {
      if (settings) {
        log.info("recovery: re-kicking stuck summary", { notebookId: nb.id });
        // Reset the started-at timestamp so the route's stale-detection
        // doesn't immediately re-restart it.
        await updateNotebook(nb.id, {
          summaryStatus: "generating",
          summaryStartedAt: new Date().toISOString(),
          summaryError: undefined,
        });
        // Fire and forget. Errors are caught + logged inside the
        // generation routine; we don't await so boot stays fast.
        queueMicrotask(() => {
          generateSummaryAndQuestions(settings, nb.id)
            .then(async (result) => {
              if (result) {
                await updateNotebook(nb.id, {
                  summary: result.summary,
                  suggestedQuestions: result.suggestedQuestions,
                  summaryGeneratedAt: new Date().toISOString(),
                  summaryStatus: "idle",
                  summaryError: undefined,
                });
                log.info("recovery: summary regenerated", {
                  notebookId: nb.id,
                });
              } else {
                await updateNotebook(nb.id, {
                  summaryStatus: "idle",
                  summaryError: undefined,
                });
              }
            })
            .catch(async (err) => {
              const msg = err instanceof Error ? err.message : String(err);
              log.warn("recovery: summary regeneration failed", {
                notebookId: nb.id,
                error: msg,
              });
              await updateNotebook(nb.id, {
                summaryStatus: "failed",
                summaryError: msg,
              });
            });
        });
        summariesRekicked++;
      } else {
        log.warn(
          "recovery: stuck summary but no settings — marking failed",
          { notebookId: nb.id },
        );
        await updateNotebook(nb.id, {
          summaryStatus: "failed",
          summaryError: "Server restarted before completion (no settings)",
        });
      }
    }

    // ---- studio items
    let items;
    try {
      items = await listStudioItems(nb.id);
    } catch {
      continue;
    }
    for (const item of items) {
      if (item.status !== "generating") continue;
      log.info("recovery: marking stuck studio item failed", {
        notebookId: nb.id,
        itemId: item.id,
        kind: item.kind,
      });
      await updateStudioItem(nb.id, item.id, {
        status: "failed",
        error: "Server restarted before completion",
      });
      studioItemsFailed++;
    }
  }

  log.info("recovery: done", {
    notebooks: notebooks.length,
    summariesRekicked,
    studioItemsFailed,
    elapsedMs: Date.now() - t0,
  });
}
