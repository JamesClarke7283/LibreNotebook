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
    await ingestSource(settings, source, async (current, total) => {
      await updateSource(source.notebookId, source.id, {
        progress: { current, total },
      });
    });
    await updateSource(source.notebookId, source.id, {
      status: "ready",
      // Keep last progress so the UI can show 100% on the final tick.
    });
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

    // The JSON path (text / url) only ever fills these three; the PDF
    // path returns early with its own response.
    let kind: SourceKind;
    let name: string;
    let content: string;

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
        // Create the source record first so we own its real id, then
        // extract straight into the canonical images folder. (Old flow
        // used two UUIDs + Deno.rename, which silently broke for PDFs
        // with no embedded images.)
        const created = await addSource({
          notebookId,
          name: file.name,
          kind: "pdf",
          content: "",
          images: [],
          status: "pending",
        });
        const result = await extractPdf(
          bytes,
          imagesDir(notebookId, created.id),
        );
        const final = await updateSource(notebookId, created.id, {
          content: result.text,
          images: result.images,
          pageCount: result.pageCount,
        }) ?? created;
        kickOffIngest(final);
        return Response.json(final, { status: 202 });
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
