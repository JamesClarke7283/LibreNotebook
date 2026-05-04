// Probes a provider URL: does it respond, and what models can we list?
//
// Body: { provider: "openai" | "ollama", baseUrl: string, apiKey?: string }
// 200 → { ok: true, models: string[] }
// 200 → { ok: false, error: string }   (so the client can render the error
//        nicely without dealing with non-2xx).

import { define } from "../../utils.ts";

interface Body {
  provider: "openai" | "ollama";
  baseUrl: string;
  apiKey?: string;
}

function parseBody(x: unknown): Body | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.provider !== "openai" && o.provider !== "ollama") return null;
  if (typeof o.baseUrl !== "string" || !o.baseUrl) return null;
  if (o.apiKey !== undefined && typeof o.apiKey !== "string") return null;
  return {
    provider: o.provider,
    baseUrl: o.baseUrl,
    apiKey: typeof o.apiKey === "string" ? o.apiKey : undefined,
  };
}

async function listOpenAIModels(
  baseUrl: string,
  apiKey?: string,
): Promise<string[]> {
  // Strip trailing slash, append /models. Honour servers that already
  // include the version path (e.g. https://api.openai.com/v1).
  const url = baseUrl.replace(/\/+$/, "") + "/models";
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(
      `${res.status} ${res.statusText}${
        res.status === 401 ? " — check API key" : ""
      }`,
    );
  }
  const json = await res.json() as { data?: Array<{ id?: string }> };
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((x): x is string => typeof x === "string")
    .sort();
}

async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const url = baseUrl.replace(/\/+$/, "") + "/api/tags";
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const json = await res.json() as { models?: Array<{ name?: string }> };
  return (json.models ?? [])
    .map((m) => m.name)
    .filter((x): x is string => typeof x === "string")
    .sort();
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
    try {
      const models = body.provider === "ollama"
        ? await listOllamaModels(body.baseUrl)
        : await listOpenAIModels(body.baseUrl, body.apiKey);
      return Response.json({ ok: true, models });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Map common low-level fetch errors to user-friendly text.
      const friendly = /ECONNREFUSED|Connection refused|client error \(Connect\)/.test(msg)
        ? `Could not reach ${body.baseUrl} — is the server running?`
        : /timeout|TimedOut|Timeout/.test(msg)
        ? `Timed out reaching ${body.baseUrl}`
        : msg;
      return Response.json({ ok: false, error: friendly });
    }
  },
});
