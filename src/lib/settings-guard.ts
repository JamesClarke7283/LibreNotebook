// Centralised "is the app fully configured?" check. Both the LLM and the
// embedding provider need a base URL and a model. Having this in one
// place keeps the route gates honest as the settings shape evolves.

import type { AppSettings } from "./types.ts";

export function isFullyConfigured(s: AppSettings | null): boolean {
  if (!s) return false;
  const { llm, embedding } = s;
  if (!llm || !llm.baseUrl?.trim() || !llm.model?.trim()) return false;
  if (!embedding || !embedding.baseUrl?.trim() || !embedding.model?.trim()) {
    return false;
  }
  return true;
}
