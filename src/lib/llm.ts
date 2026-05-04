// Builds a LangChain chat model from an LlmProviderConfig. Both
// OpenAI-compatible servers and Ollama are supported.
//
// For Ollama, `numCtx` controls the context window:
//   - undefined  → leave it to Ollama's default (small, ~2048)
//   - "auto"     → ask /api/show for the model's max context_length and use it
//   - number     → pass through verbatim
//
// The "auto" lookup is cached in-process per (baseUrl, model) so we don't
// re-query Ollama on every chat turn.

import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getLogger } from "./logger.ts";
import type { LlmProviderConfig } from "./types.ts";

const log = getLogger("llm");
const ollamaCtxCache = new Map<string, number>();

/** Probe Ollama for a model's max context window. Returns null on failure. */
export async function fetchOllamaContextLength(
  baseUrl: string,
  model: string,
): Promise<number | null> {
  const cacheKey = `${baseUrl}|${model}`;
  const cached = ollamaCtxCache.get(cacheKey);
  if (cached !== undefined) {
    log.debug("ollama llm ctx cache hit", { model, ctx: cached });
    return cached;
  }
  log.info("ollama /api/show probe start", { baseUrl, model });
  const t0 = Date.now();
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
    if (!res.ok) {
      log.warn("ollama /api/show non-OK", {
        model,
        status: res.status,
        elapsedMs: Date.now() - t0,
      });
      return null;
    }
    const json = await res.json() as {
      model_info?: Record<string, unknown>;
    };
    const info = json.model_info ?? {};
    // The key is `<family>.context_length`, e.g. "gemma3.context_length".
    for (const [k, v] of Object.entries(info)) {
      if (k.endsWith(".context_length") && typeof v === "number") {
        ollamaCtxCache.set(cacheKey, v);
        log.info("ollama /api/show probe done", {
          model,
          ctx: v,
          elapsedMs: Date.now() - t0,
        });
        return v;
      }
    }
    log.warn("ollama /api/show: no context_length field found", {
      model,
      keys: Object.keys(info),
    });
    return null;
  } catch (err) {
    log.warn("ollama /api/show probe failed", {
      model,
      elapsedMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function buildChatModel(
  cfg: LlmProviderConfig,
): Promise<BaseChatModel> {
  if (cfg.provider === "ollama") {
    let numCtx: number | undefined;
    if (cfg.numCtx === "auto") {
      const detected = await fetchOllamaContextLength(cfg.baseUrl, cfg.model);
      if (detected) numCtx = detected;
    } else if (typeof cfg.numCtx === "number") {
      numCtx = cfg.numCtx;
    }
    return new ChatOllama({
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      numCtx,
      headers: cfg.apiKey
        ? { Authorization: `Bearer ${cfg.apiKey}` }
        : undefined,
    });
  }
  // OpenAI-compatible.
  return new ChatOpenAI({
    model: cfg.model,
    apiKey: cfg.apiKey ?? "no-key",
    configuration: { baseURL: cfg.baseUrl },
    streaming: true,
  });
}
