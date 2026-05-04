// Add a source to a notebook. Body is one of:
//   { kind: "text", name: string, content: string }
//   { kind: "url",  url:  string }
// On success the source is persisted, then ingested into the per-notebook
// vector store.

import { define } from "../../../../utils.ts";
import { addSource, getSettings } from "../../../../lib/storage.ts";
import { fetchUrlText, ingestSource } from "../../../../lib/ingest.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const settings = await getSettings();
    if (!settings) {
      return new Response("Configure providers first", { status: 412 });
    }
    const notebookId = ctx.params.id;
    let body: Record<string, unknown>;
    try {
      body = await ctx.req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    let name = "";
    let content = "";
    let kind: "text" | "url" = "text";

    if (body.kind === "text") {
      kind = "text";
      name = typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : "Pasted text";
      content = typeof body.content === "string" ? body.content : "";
      if (!content.trim()) {
        return new Response("Empty text", { status: 400 });
      }
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

    const created = await addSource({ notebookId, name, kind, content });

    // Fire-and-await ingestion. We could background it, but doing it
    // inline gives the user a clearer signal: the request returns once
    // the source is searchable.
    try {
      await ingestSource(settings, created);
    } catch (err) {
      // Source is saved but unindexed — surface a soft warning.
      return new Response(
        JSON.stringify({
          ...created,
          warning: `Indexed without embeddings: ${
            err instanceof Error ? err.message : String(err)
          }`,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(created), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  },
});
