// POST /api/notebooks/:id/studio/infographic/start
//
// Body: { language, orientation, style, detail, description }
//
// Inserts a Studio item with status "generating", creates an empty job,
// and fires the initial Mermaid generation as a background task. Returns
// 202 immediately with { jobId, studioItemId, iteration: 0 } so the
// client never holds an open HTTP request through the long LLM call —
// it polls the studio item for the iteration's settled mermaid.

import { define } from "../../../../../../utils.ts";
import {
  addStudioItem,
  getNotebook,
  getSettings,
  updateStudioItem,
} from "../../../../../../lib/storage.ts";
import {
  generateInitialMermaid,
  type InfographicParams,
} from "../../../../../../lib/infographic.ts";
import { createJob, readJob, writeJob } from "../../../../../../lib/jobs.ts";
import { getLogger } from "../../../../../../lib/logger.ts";
import type { AppSettings } from "../../../../../../lib/types.ts";

const log = getLogger("infographic-start");

function parseParams(x: unknown): InfographicParams | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.language !== "string") return null;
  if (
    o.orientation !== "Landscape" && o.orientation !== "Portrait" &&
    o.orientation !== "Square"
  ) return null;
  if (typeof o.style !== "string") return null;
  if (
    o.detail !== "Concise" && o.detail !== "Standard" && o.detail !== "Detailed"
  ) return null;
  if (typeof o.description !== "string") return null;
  return {
    language: o.language,
    orientation: o.orientation,
    style: o.style,
    detail: o.detail,
    description: o.description,
  };
}

async function runInitialInBackground(
  settings: AppSettings,
  notebookId: string,
  studioItemId: string,
  jobId: string,
  params: InfographicParams,
): Promise<void> {
  try {
    const mermaid = await generateInitialMermaid(settings, notebookId, params);
    const job = await readJob(notebookId, jobId);
    if (!job) {
      log.warn("infographic initial bg: job vanished mid-run", {
        notebookId,
        studioItemId,
        jobId,
      });
      return;
    }
    job.history.push({ iter: 1, mermaid });
    await writeJob(job);
    await updateStudioItem(notebookId, studioItemId, {
      iteration: 1,
      mermaid,
      modelDoneVerdict: null,
      inFlight: false,
    });
    log.info("infographic initial bg done", {
      notebookId,
      studioItemId,
      jobId,
      mermaidChars: mermaid.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("infographic initial bg failed", {
      notebookId,
      studioItemId,
      jobId,
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
    log.info("infographic start POST received", { notebookId });
    const settings = await getSettings();
    if (!settings) return new Response("No settings", { status: 412 });
    const nb = await getNotebook(notebookId);
    if (!nb) return new Response("Notebook not found", { status: 404 });

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const params = parseParams(body);
    if (!params) return new Response("Invalid params", { status: 400 });

    // Empty job up-front — the bg task pushes to its history when the
    // initial mermaid lands, and subsequent /refine calls keep appending.
    const job = await createJob({
      notebookId,
      studioItemId: "", // patched below once we have the item id
      params,
      history: [],
    });

    const item = await addStudioItem({
      notebookId,
      kind: "infographic",
      title: "Generating infographic…",
      status: "generating",
      basedOnSources: nb.sourceCount,
      iteration: 0,
      jobId: job.id,
      inFlight: true,
      modelDoneVerdict: null,
    });

    // Now that we have the studio item id, link it back into the job
    // record so /refine and the bg task can find each other.
    job.studioItemId = item.id;
    await writeJob(job);

    queueMicrotask(() => {
      runInitialInBackground(settings, notebookId, item.id, job.id, params)
        .catch((err) => {
          log.error("infographic initial bg uncaught", {
            notebookId,
            studioItemId: item.id,
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    });

    return Response.json({
      jobId: job.id,
      studioItemId: item.id,
      iteration: 0,
    }, { status: 202 });
  },
});
