// POST /api/notebooks/:id/studio/infographic/start
//
// Body: { language, orientation, style, detail, description }
//
// Generates the *first* Mermaid diagram from the user's customise-form
// inputs and the notebook's source context. Inserts a Studio item with
// status "generating" so the right-pane card appears immediately, and a
// job record so subsequent /refine and /finalise calls can pick up
// state. Returns { jobId, studioItemId, iteration: 1, mermaid }.

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
import { createJob } from "../../../../../../lib/jobs.ts";
import { getLogger } from "../../../../../../lib/logger.ts";

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

    // Insert the studio item up-front so the right pane shows the
    // "Generating infographic… based on N sources" card immediately.
    const item = await addStudioItem({
      notebookId,
      kind: "infographic",
      title: "Generating infographic…",
      status: "generating",
      basedOnSources: nb.sourceCount,
      iteration: 1,
    });

    let mermaid: string;
    try {
      mermaid = await generateInitialMermaid(settings, notebookId, params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateStudioItem(notebookId, item.id, {
        status: "failed",
        error: msg,
      });
      return Response.json({ ok: false, error: msg }, { status: 502 });
    }

    const job = await createJob({
      notebookId,
      studioItemId: item.id,
      params,
      history: [{ iter: 1, mermaid }],
    });

    return Response.json({
      jobId: job.id,
      studioItemId: item.id,
      iteration: 1,
      mermaid,
    }, { status: 202 });
  },
});
