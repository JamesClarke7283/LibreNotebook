// Source ingestion: chunk raw text and add it to the per-notebook vector
// store. Embedding is done in small batches so the caller can report
// progress as it advances.

import { Document } from "@langchain/core/documents";
import { buildEmbeddings } from "./embeddings.ts";
import { buildSmartSplitter, getEmbeddingContextLength } from "./chunking.ts";
import { addDocumentsBulk } from "./vectorstore.ts";
import { getLogger } from "./logger.ts";
import type { AppSettings, NotebookSource } from "./types.ts";

const log = getLogger("ingest");

/** Embedding batch size. Bigger = fewer round-trips. 16 lets a typical
 *  ~50-chunk PDF complete in 3 batches; concurrency in addDocumentsBulk
 *  pipelines those round-trips so the wall-clock time is dominated by
 *  the slowest single batch, not their sum. */
const BATCH = 16;

export async function ingestSource(
  settings: AppSettings,
  source: NotebookSource,
  onProgress?: (current: number, total: number) => Promise<void> | void,
): Promise<number> {
  // Build a per-source splitter sized to the embedding model's actual
  // context window. Doing this here (not at module load) means Ollama
  // model swaps in the onboarding UI take effect on the next ingest
  // without a restart.
  const contextTokens = await getEmbeddingContextLength(settings.embedding);
  const splitter = buildSmartSplitter({ contextTokens });
  log.info("ingest start", {
    sourceId: source.id,
    sourceName: source.name,
    contentChars: source.content.length,
    embeddingModel: settings.embedding.model,
    embeddingContextTokens: contextTokens,
  });
  const splitStart = Date.now();
  const chunks = await splitter.splitText(source.content);
  log.info("ingest split done", {
    sourceId: source.id,
    chunks: chunks.length,
    elapsedMs: Date.now() - splitStart,
  });
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
  if (total === 0) {
    log.info("ingest empty — no chunks to embed", { sourceId: source.id });
    return 0;
  }

  const embeddings = buildEmbeddings(settings.embedding);
  const embedStart = Date.now();
  const written = await addDocumentsBulk(
    source.notebookId,
    embeddings,
    docs,
    BATCH,
    (batchIdx, totalBatches, batchMs) => {
      log.info("ingest embed batch done", {
        sourceId: source.id,
        batch: `${batchIdx}/${totalBatches}`,
        elapsedMs: batchMs,
      });
    },
    onProgress,
  );
  log.info("ingest done", {
    sourceId: source.id,
    chunks: written,
    embedElapsedMs: Date.now() - embedStart,
  });
  return written;
}

/** Fetch a URL and return the (very rough) plain-text body. */
export async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "LibreNotebook/0.1 (+https://librenotebook.local)",
    },
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
