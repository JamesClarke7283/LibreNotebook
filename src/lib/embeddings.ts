// Builds a LangChain Embeddings instance from settings. Mirrors the LLM
// factory: OpenAI-compatible or Ollama.

import { OllamaEmbeddings } from "@langchain/ollama";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { Embeddings } from "@langchain/core/embeddings";
import type { ProviderConfig } from "./types.ts";

export function buildEmbeddings(cfg: ProviderConfig): Embeddings {
  if (cfg.provider === "ollama") {
    return new OllamaEmbeddings({
      baseUrl: cfg.baseUrl,
      model: cfg.model,
    });
  }
  return new OpenAIEmbeddings({
    model: cfg.model,
    apiKey: cfg.apiKey ?? "no-key",
    configuration: { baseURL: cfg.baseUrl },
  });
}
