// Probes a specific model on the configured server, returning vision
// capability and (for Ollama) the maximum context window. The Onboarding
// form calls this when the user picks/types a model so the form can
// auto-fill the vision flag and the "Auto" context-window choice.

import { define } from "../../utils.ts";

interface Body {
  provider: "openai" | "ollama";
  baseUrl: string;
  apiKey?: string;
  model: string;
}

function parseBody(x: unknown): Body | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.provider !== "openai" && o.provider !== "ollama") return null;
  if (typeof o.baseUrl !== "string" || !o.baseUrl) return null;
  if (typeof o.model !== "string" || !o.model) return null;
  if (o.apiKey !== undefined && typeof o.apiKey !== "string") return null;
  return {
    provider: o.provider,
    baseUrl: o.baseUrl,
    model: o.model,
    apiKey: typeof o.apiKey === "string" ? o.apiKey : undefined,
  };
}

interface OllamaShowResponse {
  capabilities?: string[];
  details?: { families?: string[] };
  model_info?: Record<string, unknown>;
}

async function probeOllama(
  baseUrl: string,
  model: string,
): Promise<{
  hasVision: boolean;
  contextLength: number | null;
  visionAuto: true;
}> {
  const res = await fetch(baseUrl.replace(/\/+$/, "") + "/api/show", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const json = await res.json() as OllamaShowResponse;
  const caps = (json.capabilities ?? []).map((c) => c.toLowerCase());
  // Newer Ollama exposes "vision" in capabilities; older builds carried a
  // CLIP family alongside the language family. Honour both.
  const fams = (json.details?.families ?? []).map((f) => f.toLowerCase());
  const hasVision = caps.includes("vision") ||
    fams.includes("clip") ||
    fams.includes("mllama");

  let contextLength: number | null = null;
  for (const [k, v] of Object.entries(json.model_info ?? {})) {
    if (k.endsWith(".context_length") && typeof v === "number") {
      contextLength = v;
      break;
    }
  }

  return { hasVision, contextLength, visionAuto: true };
}

export const handler = define.handlers({
  async POST(ctx) {
    let raw: unknown;
    try {
      raw = await ctx.req.json();
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" });
    }
    const body = parseBody(raw);
    if (!body) {
      return Response.json({ ok: false, error: "Invalid request body" });
    }
    if (body.provider === "openai") {
      // No standard vision discovery for OpenAI-compatible servers; the
      // user toggles it manually.
      return Response.json({
        ok: true,
        visionAuto: false,
        hasVision: null,
        contextLength: null,
      });
    }
    try {
      const out = await probeOllama(body.baseUrl, body.model);
      return Response.json({ ok: true, ...out });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly =
        /ECONNREFUSED|Connection refused|client error \(Connect\)/.test(msg)
          ? `Could not reach ${body.baseUrl} — is the server running?`
          : msg;
      return Response.json({ ok: false, error: friendly });
    }
  },
});
