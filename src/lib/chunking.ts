// Smart chunking for embedding ingestion.
//
// SOTA-ish chunking is mostly about (a) sizing chunks to the embedding
// model's context, not a hard-coded character count, and (b) breaking
// on semantically meaningful boundaries (paragraphs > sentences > words
// > characters) instead of mid-word.
//
// We probe the embedding model's max input tokens at runtime — Ollama
// via `/api/show` (mirrors the LLM lookup in llm.ts), OpenAI-compat
// via a known-models table — then size each chunk at 75% of that
// budget so the boundary tokens + special tokens the embedder injects
// don't push us over the cliff. Fallback is 512 tokens (BERT-class).
//
// The actual splitter is LangChain's RecursiveCharacterTextSplitter
// with a `lengthFunction` set to a tiktoken-counted token count. That
// gives us the natural-boundary preference of the recursive splitter
// AND a hard token budget — the best of both worlds without
// authoring a splitter from scratch.

import {
  RecursiveCharacterTextSplitter,
  type TextSplitter,
} from "@langchain/textsplitters";
import { getEncoding } from "js-tiktoken";
import { getLogger } from "./logger.ts";
import type { ProviderConfig } from "./types.ts";

const log = getLogger("chunking");

// ---------------------------------------------------------------- caches

const ollamaEmbedCtxCache = new Map<string, number>();

// ---------------------------------------------------------------- defaults

/** Safe lower bound: roughly the smallest practical embedder
 *  (some BERT-class models are 256). */
const MIN_CHUNK_TOKENS = 128;
/** Upper bound: very large chunks degrade retrieval (the "lost in the
 *  middle" effect). 1500 tokens is the sweet spot most retrieval
 *  benchmarks (BEIR, MTEB) reward. */
const MAX_CHUNK_TOKENS = 1_500;
/** Fraction of the embedder's context we'll fill. The remaining 25%
 *  buffers boundary words + special tokens injected by the embedder. */
const CONTEXT_FILL_RATIO = 0.75;
/** Overlap as a fraction of chunk size, clamped to a sane range. */
const OVERLAP_RATIO = 0.12;
const OVERLAP_MIN = 50;
const OVERLAP_MAX = 200;

/** Conservative default for unknown embedders. Most BERT-class and
 *  smaller transformer embedders cap at 512 tokens. */
const FALLBACK_CONTEXT = 512;

/** Known max-input-tokens for OpenAI-compat embedding models. Falls
 *  back to OPENAI_DEFAULT for unknown models on an OpenAI-compat
 *  endpoint. */
const OPENAI_EMBEDDING_LIMITS: Record<string, number> = {
  // OpenAI
  "text-embedding-ada-002": 8_191,
  "text-embedding-3-small": 8_191,
  "text-embedding-3-large": 8_191,
  // Voyage AI
  "voyage-2": 4_000,
  "voyage-large-2": 16_000,
  "voyage-code-2": 16_000,
  "voyage-3": 32_000,
  "voyage-3-lite": 32_000,
  "voyage-3-large": 32_000,
  // Cohere
  "embed-english-v3.0": 512,
  "embed-multilingual-v3.0": 512,
  "embed-english-light-v3.0": 512,
  // Google
  "text-embedding-004": 2_048,
  "text-multilingual-embedding-002": 2_048,
  // Mistral
  "mistral-embed": 8_192,
};
const OPENAI_DEFAULT = 8_191;

// ---------------------------------------------------------------- ollama probe

/** Hit Ollama's /api/show for the embedding model and pull
 *  `model_info.<family>.context_length`. Cached per (baseUrl, model).
 *  Returns null if the call fails or the field is missing. */
async function fetchOllamaEmbeddingContext(
  baseUrl: string,
  model: string,
): Promise<number | null> {
  const cacheKey = `${baseUrl}|${model}`;
  const cached = ollamaEmbedCtxCache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(
      baseUrl.replace(/\/+$/, "") + "/api/show",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!res.ok) return null;
    const json = await res.json() as {
      model_info?: Record<string, unknown>;
    };
    const info = json.model_info ?? {};
    // The key is `<family>.context_length`, e.g. "bert.context_length",
    // "nomic_bert.context_length", "qwen3.context_length".
    for (const [k, v] of Object.entries(info)) {
      if (k.endsWith(".context_length") && typeof v === "number") {
        ollamaEmbedCtxCache.set(cacheKey, v);
        return v;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- public API

/**
 * Resolve the embedding model's max input tokens. Used to size chunks
 * so the embedder never sees a request that overflows its context
 * (which most providers respond to by either truncating silently or
 * erroring).
 */
export async function getEmbeddingContextLength(
  cfg: ProviderConfig,
): Promise<number> {
  if (cfg.provider === "ollama") {
    const ctx = await fetchOllamaEmbeddingContext(cfg.baseUrl, cfg.model);
    if (ctx) {
      log.debug("ollama embedding context probed", { model: cfg.model, ctx });
      return ctx;
    }
    log.warn(
      "ollama embedding context unknown — falling back",
      { model: cfg.model, fallback: FALLBACK_CONTEXT },
    );
    return FALLBACK_CONTEXT;
  }
  // OpenAI-compatible.
  const known = OPENAI_EMBEDDING_LIMITS[cfg.model];
  if (known) return known;
  log.debug(
    "unknown openai-compat embedder — using default ctx",
    { model: cfg.model, fallback: OPENAI_DEFAULT },
  );
  return OPENAI_DEFAULT;
}

/**
 * Compute the target chunk size (in tokens) given the embedder's
 * available context. Clamped to [MIN_CHUNK_TOKENS, MAX_CHUNK_TOKENS]
 * so we don't produce one-sentence chunks for tiny embedders or
 * one-page chunks for huge embedders (both hurt retrieval).
 */
export function computeChunkSize(contextTokens: number): number {
  const target = Math.floor(contextTokens * CONTEXT_FILL_RATIO);
  return Math.max(MIN_CHUNK_TOKENS, Math.min(MAX_CHUNK_TOKENS, target));
}

/**
 * Compute chunk overlap (in tokens). Sized as a fraction of the chunk
 * itself so smaller chunks get proportionally less overlap.
 */
export function computeChunkOverlap(chunkSizeTokens: number): number {
  const overlap = Math.floor(chunkSizeTokens * OVERLAP_RATIO);
  return Math.max(OVERLAP_MIN, Math.min(OVERLAP_MAX, overlap));
}

/**
 * Build a token-aware text splitter that respects an embedding model's
 * context window. Uses cl100k_base (the OpenAI tokenizer) as a
 * universal length estimator — close enough for Ollama models too,
 * since most modern tokenizers produce token counts within ~10-15% of
 * each other for English text. The recursive splitter prefers
 * paragraph > sentence > word > character boundaries, so chunks land
 * on natural semantic breaks whenever the budget permits.
 */
export function buildSmartSplitter(opts: {
  /** Embedding model's max input tokens. Use `getEmbeddingContextLength`
   *  to probe this at runtime. */
  contextTokens: number;
  /** Hint that the source content is markdown — uses a splitter with
   *  markdown-aware separators (`#`, `##`, code fences, lists). */
  mimeType?: "markdown" | "plain";
}): TextSplitter {
  const chunkSize = computeChunkSize(opts.contextTokens);
  const chunkOverlap = computeChunkOverlap(chunkSize);

  // cl100k_base is a good universal length estimator. We don't need
  // exact tokenisation parity with the embedder — we just need the
  // chunk size budget to be in roughly the same ballpark.
  const enc = getEncoding("cl100k_base");
  const lengthFunction = (s: string): number => enc.encode(s).length;

  log.debug("smart splitter built", {
    contextTokens: opts.contextTokens,
    chunkSize,
    chunkOverlap,
    mimeType: opts.mimeType ?? "plain",
  });

  if (opts.mimeType === "markdown") {
    return RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize,
      chunkOverlap,
      lengthFunction,
    });
  }
  return new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    lengthFunction,
  });
}
