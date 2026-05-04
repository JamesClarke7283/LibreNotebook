// Unit tests for src/lib/env-config.ts: env presets and lock state.

import { assertEquals, assert } from "jsr:@std/assert@^1";

const KEYS = [
  "LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL",
  "LLM_HAS_VISION", "LLM_NUM_CTX",
  "EMBEDDING_PROVIDER", "EMBEDDING_BASE_URL", "EMBEDDING_API_KEY", "EMBEDDING_MODEL",
  "MULTI_USER",
  "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM",
];

function snapshot(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of KEYS) out[k] = Deno.env.get(k);
  return out;
}
function restore(s: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
}
function clearAll() {
  for (const k of KEYS) Deno.env.delete(k);
}
async function freshImport() {
  const url = new URL("../../src/lib/env-config.ts", import.meta.url).href +
    `?t=${Date.now()}-${Math.random()}`;
  return await import(url);
}

Deno.test("envLlmConfig returns null when LLM_BASE_URL/MODEL not set", async () => {
  const snap = snapshot();
  clearAll();
  try {
    const { envLlmConfig } = await freshImport();
    assertEquals(envLlmConfig(), null);
  } finally {
    restore(snap);
  }
});

Deno.test("envLlmConfig parses a full OpenAI preset", async () => {
  const snap = snapshot();
  clearAll();
  Deno.env.set("LLM_PROVIDER", "openai");
  Deno.env.set("LLM_BASE_URL", "https://api.openai.com/v1");
  Deno.env.set("LLM_API_KEY", "sk-test");
  Deno.env.set("LLM_MODEL", "gpt-4o-mini");
  Deno.env.set("LLM_HAS_VISION", "true");
  try {
    const { envLlmConfig } = await freshImport();
    const cfg = envLlmConfig()!;
    assertEquals(cfg.provider, "openai");
    assertEquals(cfg.baseUrl, "https://api.openai.com/v1");
    assertEquals(cfg.apiKey, "sk-test");
    assertEquals(cfg.model, "gpt-4o-mini");
    assertEquals(cfg.hasVision, true);
  } finally {
    restore(snap);
  }
});

Deno.test("envLlmConfig parses Ollama with numCtx auto / int", async () => {
  const snap = snapshot();
  clearAll();
  Deno.env.set("LLM_PROVIDER", "ollama");
  Deno.env.set("LLM_BASE_URL", "http://localhost:11434");
  Deno.env.set("LLM_MODEL", "llama3.1");
  Deno.env.set("LLM_NUM_CTX", "auto");
  try {
    let { envLlmConfig } = await freshImport();
    assertEquals(envLlmConfig()!.numCtx, "auto");

    Deno.env.set("LLM_NUM_CTX", "8192");
    ({ envLlmConfig } = await freshImport());
    assertEquals(envLlmConfig()!.numCtx, 8192);

    Deno.env.set("LLM_NUM_CTX", "not-a-number");
    ({ envLlmConfig } = await freshImport());
    assertEquals(envLlmConfig()!.numCtx, undefined);
  } finally {
    restore(snap);
  }
});

Deno.test("envEmbeddingConfig returns null without BASE_URL+MODEL", async () => {
  const snap = snapshot();
  clearAll();
  try {
    const { envEmbeddingConfig } = await freshImport();
    assertEquals(envEmbeddingConfig(), null);
  } finally {
    restore(snap);
  }
});

Deno.test("envLockState reflects which providers are pinned", async () => {
  const snap = snapshot();
  clearAll();
  Deno.env.set("LLM_BASE_URL", "https://x");
  Deno.env.set("LLM_MODEL", "m");
  try {
    const { envLockState } = await freshImport();
    const locks = envLockState();
    assertEquals(locks.llm, true);
    assertEquals(locks.embedding, false);
  } finally {
    restore(snap);
  }
});

Deno.test("multiUserEnabled is truthy/falsy as expected", async () => {
  const snap = snapshot();
  clearAll();
  try {
    let { multiUserEnabled } = await freshImport();
    assertEquals(multiUserEnabled(), false);

    for (const v of ["1", "true", "yes", "TRUE", "Yes"]) {
      Deno.env.set("MULTI_USER", v);
      ({ multiUserEnabled } = await freshImport());
      assertEquals(multiUserEnabled(), true, `expected true for "${v}"`);
    }
    for (const v of ["0", "false", "no", ""]) {
      Deno.env.set("MULTI_USER", v);
      ({ multiUserEnabled } = await freshImport());
      assertEquals(multiUserEnabled(), false, `expected false for "${v}"`);
    }
  } finally {
    restore(snap);
  }
});

Deno.test("envSmtpConfig requires at minimum SMTP_HOST", async () => {
  const snap = snapshot();
  clearAll();
  try {
    let { envSmtpConfig } = await freshImport();
    assertEquals(envSmtpConfig(), null);

    Deno.env.set("SMTP_HOST", "smtp.example.com");
    Deno.env.set("SMTP_USER", "x@example.com");
    ({ envSmtpConfig } = await freshImport());
    const s = envSmtpConfig()!;
    assertEquals(s.host, "smtp.example.com");
    assertEquals(s.port, 587, "default port should be 587");
    assert(s.from.includes("x@example.com") || s.from.includes("smtp.example.com"));
  } finally {
    restore(snap);
  }
});
