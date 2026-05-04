// Source endpoints for a notebook.
//
//   GET   /api/notebooks/:id/sources           → list sources (UI poll)
//   POST  /api/notebooks/:id/sources           → add a source
//
// POST body shape depends on Content-Type:
//   application/json + { kind: "text", name, content }
//   application/json + { kind: "url", url }     // YouTube URLs are
//                                                  detected automatically
//                                                  and become kind:"youtube"
//   multipart/form-data + file=<.pdf>           → kind: "pdf"
//
// All paths follow the same dance: addSource(status:"pending") first so
// we own the real source id, run the kind-specific extractor straight
// into imagesDir(notebookId, created.id), then updateSource() with
// extracted text + images. The UI polls until status flips to
// "ready" / "failed".

import { define } from "../../../../utils.ts";
import {
  addSource,
  getSettings,
  imagesDir,
  listSources,
  updateSource,
} from "../../../../lib/storage.ts";
import { ingestSource } from "../../../../lib/ingest.ts";
import { extractPdf } from "../../../../lib/pdf.ts";
import { extractWebpage } from "../../../../lib/webpage.ts";
import { extractYouTubeTranscript, isYouTubeUrl } from "../../../../lib/youtube.ts";
import type { NotebookSource } from "../../../../lib/types.ts";

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

    // ---- multipart: PDF upload ----
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

    // ---- JSON: text / url / youtube ----
    let body: Record<string, unknown>;
    try {
      body = await ctx.req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (body.kind === "text") {
      const name = typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : "Pasted text";
      const content = typeof body.content === "string" ? body.content : "";
      if (!content.trim()) return new Response("Empty text", { status: 400 });
      const created = await addSource({
        notebookId,
        name,
        kind: "text",
        content,
        status: "pending",
      });
      kickOffIngest(created);
      return Response.json(created, { status: 202 });
    }

    if (body.kind === "url") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url) return new Response("Missing url", { status: 400 });

      // Detect YouTube by hostname and route to the transcript
      // extractor; everything else goes through Readability.
      if (isYouTubeUrl(url)) {
        const placeholder = await addSource({
          notebookId,
          name: url, // updated to title once extracted
          kind: "youtube",
          content: "",
          status: "pending",
        });
        try {
          const yt = await extractYouTubeTranscript(url);
          const final = await updateSource(notebookId, placeholder.id, {
            name: yt.title,
            content: yt.content,
          }) ?? placeholder;
          kickOffIngest(final);
          return Response.json(final, { status: 202 });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await updateSource(notebookId, placeholder.id, {
            status: "failed",
            error: msg,
          });
          return new Response(msg, { status: 502 });
        }
      }

      // Generic webpage via Mozilla Readability.
      const placeholder = await addSource({
        notebookId,
        name: url,
        kind: "url",
        content: "",
        images: [],
        status: "pending",
      });
      try {
        const page = await extractWebpage(
          url,
          imagesDir(notebookId, placeholder.id),
        );
        const final = await updateSource(notebookId, placeholder.id, {
          name: page.title,
          content: page.content,
          images: page.images,
        }) ?? placeholder;
        kickOffIngest(final);
        return Response.json(final, { status: 202 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await updateSource(notebookId, placeholder.id, {
          status: "failed",
          error: msg,
        });
        return new Response(msg, { status: 502 });
      }
    }

    return new Response("Unknown kind", { status: 400 });
  },
});
