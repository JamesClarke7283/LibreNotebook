// Source ingestion: chunk raw text and add it to the per-notebook vector
// store. Kept separate from rag.ts so that sources can be ingested
// asynchronously (the route returns immediately while ingestion runs).

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { buildEmbeddings } from "./embeddings.ts";
import { addDocuments } from "./vectorstore.ts";
import type { AppSettings, NotebookSource } from "./types.ts";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1_000,
  chunkOverlap: 150,
});

export async function ingestSource(
  settings: AppSettings,
  source: NotebookSource,
): Promise<number> {
  const chunks = await splitter.splitText(source.content);
  const docs = chunks.map((chunk, idx) =>
    new Document({
      pageContent: chunk,
      metadata: {
        sourceId: source.id,
        sourceName: source.name,
        chunkIndex: idx,
      },
    })
  );
  const embeddings = buildEmbeddings(settings.embedding);
  return await addDocuments(source.notebookId, embeddings, docs);
}

/** Fetch a URL and return the (very rough) plain-text body. */
export async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "LibreNotebook/0.1 (+https://librenotebook.local)" },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  // Strip scripts/styles, then tags, then collapse whitespace.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
