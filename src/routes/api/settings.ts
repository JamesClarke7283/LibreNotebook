// GET / POST settings. Settings store both LLM and embedding provider
// configurations.

import { define } from "../../utils.ts";
import type {
  AppSettings,
  LlmProviderConfig,
  ProviderConfig,
} from "../../lib/types.ts";
import { getSettings, saveSettings } from "../../lib/storage.ts";
import { envLockState } from "../../lib/env-config.ts";

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

function isLlmProviderConfig(x: unknown): x is LlmProviderConfig {
  if (!isProviderConfig(x)) return false;
  const o = x as unknown as Record<string, unknown>;
  if (typeof o.hasVision !== "boolean") return false;
  if (
    o.numCtx !== undefined && o.numCtx !== "auto" &&
    !(typeof o.numCtx === "number" && Number.isFinite(o.numCtx) && o.numCtx > 0)
  ) return false;
  return true;
}

export const handler = define.handlers({
  async GET() {
    const s = await getSettings();
    const locks = envLockState();
    // Surface the lock alongside the settings so the onboarding form
    // can render the env-provided fields read-only.
    return new Response(JSON.stringify({ settings: s, locks }), {
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
    if (!isLlmProviderConfig(llm) || !isProviderConfig(embedding)) {
      return new Response("Invalid provider config", { status: 400 });
    }
    // If the operator has locked a provider via .env, refuse silent
    // overwrites. The form should already disable those inputs but a
    // direct API caller could still try.
    const locks = envLockState();
    const final: AppSettings = {
      llm: locks.llm ? (await getSettings())!.llm : llm,
      embedding: locks.embedding ? (await getSettings())!.embedding : embedding,
      configuredAt: new Date().toISOString(),
    };
    await saveSettings(final);
    return new Response(JSON.stringify({ ok: true, locks }), {
      headers: { "Content-Type": "application/json" },
    });
  },
});
