// Source ingestion: chunk raw text and add it to the per-notebook vector
// store. Embedding is done in small batches so the caller can report
// progress as it advances.

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { buildEmbeddings } from "./embeddings.ts";
import { addDocuments } from "./vectorstore.ts";
import type { AppSettings, NotebookSource } from "./types.ts";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1_000,
  chunkOverlap: 150,
});

/** Embedding batch size. Smaller = smoother progress, more HTTP overhead. */
const BATCH = 4;

export async function ingestSource(
  settings: AppSettings,
  source: NotebookSource,
  onProgress?: (current: number, total: number) => Promise<void> | void,
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

  const total = docs.length;
  if (onProgress) await onProgress(0, total);
  if (total === 0) return 0;

  const embeddings = buildEmbeddings(settings.embedding);
  let done = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    await addDocuments(source.notebookId, embeddings, batch);
    done += batch.length;
    if (onProgress) await onProgress(done, total);
  }
  return done;
}

/** Fetch a URL and return the (very rough) plain-text body. */
export async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "LibreNotebook/0.1 (+https://librenotebook.local)" },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
