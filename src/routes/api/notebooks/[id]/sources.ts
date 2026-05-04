// Source endpoints for a notebook.
//
//   GET   /api/notebooks/:id/sources           → list sources (UI poll)
//   POST  /api/notebooks/:id/sources           → add a source
//
// POST body shape depends on Content-Type:
//   application/json + { kind: "text", name, content }
//   application/json + { kind: "url", url }
//   multipart/form-data + file=<.pdf>          → kind: "pdf"
//
// In all cases the source record is created immediately with
// status="pending", returned with HTTP 202, and embedded in the
// background. The UI polls until status flips to "ready" / "failed".

import { define } from "../../../../utils.ts";
import {
  addSource,
  getSettings,
  imagesDir,
  listSources,
  updateSource,
} from "../../../../lib/storage.ts";
import { fetchUrlText, ingestSource } from "../../../../lib/ingest.ts";
import { extractPdf } from "../../../../lib/pdf.ts";
import type { NotebookSource, SourceKind } from "../../../../lib/types.ts";

async function ingestInBackground(
  source: NotebookSource,
): Promise<void> {
  const settings = await getSettings();
  if (!settings) {
    await updateSource(source.notebookId, source.id, {
      status: "failed",
      error: "No provider settings configured.",
    });
    return;
  }
  try {
    await ingestSource(settings, source);
    await updateSource(source.notebookId, source.id, { status: "ready" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSource(source.notebookId, source.id, {
      status: "failed",
      error: msg,
    });
  }
}

function kickOffIngest(source: NotebookSource): void {
  // Detach: catch all so an unhandled rejection doesn't crash the runtime.
  ingestInBackground(source).catch(() => {});
}

export const handler = define.handlers({
  async GET(ctx) {
    const sources = await listSources(ctx.params.id);
    return Response.json(sources);
  },

  async POST(ctx) {
    const settings = await getSettings();
    if (!settings) {
      return new Response("Configure providers first", { status: 412 });
    }
    const notebookId = ctx.params.id;
    const ct = ctx.req.headers.get("content-type") ?? "";

    let kind: SourceKind;
    let name: string;
    let content: string;
    let images: NotebookSource["images"];
    let pageCount: number | undefined;

    try {
      if (ct.startsWith("multipart/form-data")) {
        const form = await ctx.req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return new Response("Missing file", { status: 400 });
        }
        if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
          return new Response("Only PDF uploads are supported.", {
            status: 415,
          });
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        kind = "pdf";
        name = file.name;
        // Pre-create the source ID by writing first with a placeholder,
        // because extractPdf wants to know where to drop images. We
        // generate a UUID up-front, then add the source with that id.
        const sourceId = crypto.randomUUID();
        const imgDir = imagesDir(notebookId, sourceId);
        const result = await extractPdf(bytes, imgDir);
        content = result.text;
        images = result.images;
        pageCount = result.pageCount;
        // We can't pass the pre-chosen id into addSource cleanly; instead
        // update the source record's id manually below.
        const created = await addSource({
          notebookId,
          name,
          kind,
          content,
          images,
          pageCount,
          status: "pending",
        });
        // The image folder was written under `sourceId` but the source
        // got a different generated id from addSource. Re-link by
        // moving the folder. (We do this rather than pre-allocating a
        // matching id to keep addSource's contract simple.)
        if (images && images.length > 0 && created.id !== sourceId) {
          await Deno.rename(
            imgDir,
            imagesDir(notebookId, created.id),
          ).catch(() => {});
        }
        kickOffIngest(created);
        return Response.json(created, { status: 202 });
      }

      // JSON path.
      const body = await ctx.req.json() as Record<string, unknown>;
      if (body.kind === "text") {
        kind = "text";
        name = typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : "Pasted text";
        content = typeof body.content === "string" ? body.content : "";
        if (!content.trim()) return new Response("Empty text", { status: 400 });
      } else if (body.kind === "url") {
        kind = "url";
        const url = typeof body.url === "string" ? body.url.trim() : "";
        if (!url) return new Response("Missing url", { status: 400 });
        try {
          content = await fetchUrlText(url);
        } catch (err) {
          return new Response(
            err instanceof Error ? err.message : String(err),
            { status: 502 },
          );
        }
        name = url;
      } else {
        return new Response("Unknown kind", { status: 400 });
      }
    } catch (err) {
      return new Response(
        err instanceof Error ? err.message : String(err),
        { status: 400 },
      );
    }

    const created = await addSource({
      notebookId,
      name,
      kind,
      content,
      status: "pending",
    });
    kickOffIngest(created);
    return Response.json(created, { status: 202 });
  },
});
