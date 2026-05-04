// Per-notebook embedded vector store. The user requested LanceDB or
// similar — LanceDB's npm package needs native bindings that don't
// reliably load under Deno's npm compat layer, so we use LangChain's
// MemoryVectorStore and persist it as JSON next to the project.
//
// The shape of this module is deliberately tiny so swapping in
// @lancedb/lancedb later is a single-file change: callers only see
// `getStore`, `addDocuments`, `similaritySearch`, and `dropStore`.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
// In LangChain.js v1.x, MemoryVectorStore lives in @langchain/classic.
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import type { Embeddings } from "@langchain/core/embeddings";

const DATA_DIR = join(Deno.cwd(), ".data", "vectors");

interface SerialisedVector {
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

async function loadSerialised(
  notebookId: string,
): Promise<SerialisedVector[]> {
  const path = join(DATA_DIR, `${notebookId}.json`);
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
  await mkdir(DATA_DIR, { recursive: true });
  const path = join(DATA_DIR, `${notebookId}.json`);
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

/** Add documents and persist. Returns the number of chunks added. */
export async function addDocuments(
  notebookId: string,
  embeddings: Embeddings,
  docs: Document[],
): Promise<number> {
  const store = await getStore(notebookId, embeddings);
  await store.addDocuments(docs);
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
  const path = join(DATA_DIR, `${notebookId}.json`);
  try {
    await rm(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
