// Unit tests for src/lib/settings-guard.ts.

import { assertEquals } from "jsr:@std/assert@^1";
import { isFullyConfigured } from "../../src/lib/settings-guard.ts";

Deno.test("isFullyConfigured returns false for null / undefined", () => {
  assertEquals(isFullyConfigured(null), false);
});

Deno.test("isFullyConfigured needs both LLM and embedding base+model", () => {
  assertEquals(
    isFullyConfigured({
      llm: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        hasVision: false,
      },
      embedding: { provider: "openai", baseUrl: "", model: "" },
      configuredAt: "2025-01-01",
    }),
    false,
    "missing embedding should fail",
  );

  assertEquals(
    isFullyConfigured({
      llm: { provider: "openai", baseUrl: "", model: "", hasVision: false },
      embedding: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
      },
      configuredAt: "2025-01-01",
    }),
    false,
    "missing LLM should fail",
  );

  assertEquals(
    isFullyConfigured({
      llm: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        hasVision: false,
      },
      embedding: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
      },
      configuredAt: "2025-01-01",
    }),
    true,
    "both populated should succeed",
  );
});
