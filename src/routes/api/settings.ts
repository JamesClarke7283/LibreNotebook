// GET / POST settings. Settings store both LLM and embedding provider
// configurations.

import { define } from "../../utils.ts";
import type { AppSettings, ProviderConfig } from "../../lib/types.ts";
import { getSettings, saveSettings } from "../../lib/storage.ts";

function isProviderConfig(x: unknown): x is ProviderConfig {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    (o.provider === "openai" || o.provider === "ollama") &&
    typeof o.baseUrl === "string" && o.baseUrl.length > 0 &&
    typeof o.model === "string" && o.model.length > 0 &&
    (o.apiKey === undefined || typeof o.apiKey === "string")
  );
}

export const handler = define.handlers({
  async GET() {
    const s = await getSettings();
    return new Response(JSON.stringify(s), {
      headers: { "Content-Type": "application/json" },
    });
  },
  async POST(ctx) {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return new Response("Expected { llm, embedding }", { status: 400 });
    }
    const { llm, embedding } = body as Record<string, unknown>;
    if (!isProviderConfig(llm) || !isProviderConfig(embedding)) {
      return new Response("Invalid provider config", { status: 400 });
    }
    const settings: AppSettings = {
      llm,
      embedding,
      configuredAt: new Date().toISOString(),
    };
    await saveSettings(settings);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  },
});
