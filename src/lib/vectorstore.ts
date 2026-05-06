// Per-notebook embedded vector store. The user requested LanceDB or
// similar — LanceDB's npm package needs native bindings that don't
// reliably load under Deno's npm compat layer, so we use LangChain's
// MemoryVectorStore and persist it as JSON next to the project.
//
// The shape of this module is deliberately tiny so swapping in
// @lancedb/lancedb later is a single-file change: callers only see
// `getStore`, `addDocumentsBulk`, `similaritySearch`, and `dropStore`.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
// In LangChain.js v1.x, MemoryVectorStore lives in @langchain/classic.
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import type { Embeddings } from "@langchain/core/embeddings";
import { dataDir } from "./paths.ts";

function vectorsDir(): string {
  return join(dataDir(), "vectors");
}

interface SerialisedVector {
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

async function loadSerialised(
  notebookId: string,
): Promise<SerialisedVector[]> {
  const path = join(vectorsDir(), `${notebookId}.json`);
  try {
    const txt = await readFile(path, "utf8");
    return JSON.parse(txt) as SerialisedVector[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function persist(
  notebookId: string,
  vectors: SerialisedVector[],
): Promise<void> {
  await mkdir(vectorsDir(), { recursive: true });
  const path = join(vectorsDir(), `${notebookId}.json`);
  await writeFile(path, JSON.stringify(vectors), "utf8");
}

/** Build (and pre-load) a vector store for the given notebook. */
export async function getStore(
  notebookId: string,
  embeddings: Embeddings,
): Promise<MemoryVectorStore> {
  const store = new MemoryVectorStore(embeddings);
  const saved = await loadSerialised(notebookId);
  store.memoryVectors = saved.map((v) => ({
    content: v.content,
    embedding: v.embedding,
    metadata: v.metadata,
  }));
  return store;
}

/**
 * Embed `docs` in batches and persist the resulting vectors. The store
 * is loaded from disk once at the start and persisted once at the end —
 * an earlier per-batch read+write cycle was O(n²) on the serialised
 * JSON size and stalled multi-megabyte stores. Batches run with bounded
 * concurrency (default 3 in flight) so the embedding API gets pipelined
 * instead of waiting on round-trip latency between every batch.
 *
 * Crash-safety trade-off: a mid-ingest crash now loses the whole run
 * instead of keeping partial progress; ingest is idempotent so the
 * user just re-uploads.
 */
export async function addDocumentsBulk(
  notebookId: string,
  embeddings: Embeddings,
  docs: Document[],
  batchSize: number,
  onBatch?: (batchIdx: number, totalBatches: number, batchMs: number) => void,
  onProgress?: (done: number, total: number) => Promise<void> | void,
  concurrency = 3,
): Promise<number> {
  const store = await getStore(notebookId, embeddings);
  const totalBatches = Math.ceil(docs.length / batchSize);
  let done = 0;
  let nextBatch = 0;
  if (onProgress) await onProgress(0, docs.length);

  const total = docs.length;
  const workerCount = Math.max(1, Math.min(concurrency, totalBatches));

  async function worker(): Promise<void> {
    while (true) {
      const myBatch = nextBatch++;
      if (myBatch >= totalBatches) return;
      const start = myBatch * batchSize;
      const batch = docs.slice(start, start + batchSize);
      const t0 = Date.now();
      await store.addDocuments(batch);
      done += batch.length;
      onBatch?.(myBatch + 1, totalBatches, Date.now() - t0);
      if (onProgress) await onProgress(done, total);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  await persist(
    notebookId,
    store.memoryVectors.map((v) => ({
      content: v.content,
      embedding: v.embedding,
      metadata: v.metadata,
    })),
  );
  return docs.length;
}

/** Run a similarity search. */
export async function similaritySearch(
  notebookId: string,
  embeddings: Embeddings,
  query: string,
  k = 4,
): Promise<Document[]> {
  const store = await getStore(notebookId, embeddings);
  if (store.memoryVectors.length === 0) return [];
  return await store.similaritySearch(query, k);
}

/** Delete a notebook's vector store on disk. */
export async function dropStore(notebookId: string): Promise<void> {
  const path = join(vectorsDir(), `${notebookId}.json`);
  try {
    await rm(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * Drop every chunk that was indexed from a particular source. We rewrite
 * the on-disk JSON without those vectors. (MemoryVectorStore exposes no
 * delete API, so we operate on the serialised form directly.)
 */
export async function removeSource(
  notebookId: string,
  sourceId: string,
): Promise<number> {
  const saved = await loadSerialised(notebookId);
  const kept = saved.filter((v) => {
    const meta = v.metadata as { sourceId?: string };
    return meta?.sourceId !== sourceId;
  });
  if (kept.length === saved.length) return 0;
  await persist(notebookId, kept);
  return saved.length - kept.length;
}
