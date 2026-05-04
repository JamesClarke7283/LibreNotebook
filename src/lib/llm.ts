// Builds a LangChain chat model from an AppSettings record. Both OpenAI-
// compatible servers and Ollama are supported via the same interface.

import { ChatOpenAI } from "@langchain/openai";
import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ProviderConfig } from "./types.ts";

export function buildChatModel(cfg: ProviderConfig): BaseChatModel {
  if (cfg.provider === "ollama") {
    return new ChatOllama({
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      // Ollama doesn't need an API key, but pass through if user supplied one
      // (some hosted Ollama proxies require it).
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : undefined,
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
