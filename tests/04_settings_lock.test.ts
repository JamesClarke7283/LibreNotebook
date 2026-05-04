// Puppeteer: when LLM_BASE_URL + LLM_MODEL are set in the server's
// environment, the onboarding form renders the LLM block as locked
// (a "Preset via .env" pill appears) and the corresponding fieldset
// carries the `disabled` attribute.
//
// We boot a *dedicated* dev server with the env vars in place so the
// SSR handler at /onboarding sees the lock state — the lock check
// happens server-side, not via a client-side fetch.

import { startServer, stopServer, withPage } from "./setup.ts";
import { assert } from "jsr:@std/assert@^1";

Deno.test({
  name: "onboarding form locks LLM block when env-pinned",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await stopServer();
    const baseUrl = await startServer({
      LLM_BASE_URL: "https://locked.example.com/v1",
      LLM_MODEL: "gpt-locked",
      LLM_API_KEY: "sk-locked",
      LLM_PROVIDER: "openai",
    });

    await withPage(async ({ page }) => {
      await page.goto(`${baseUrl}/onboarding`, { waitUntil: "networkidle2" });

      const text = await page.evaluate(() => document.body.textContent ?? "");
      assert(
        text.includes("Preset via") || text.includes(".env"),
        "expected the env-lock pill to appear",
      );

      const llmDisabled = await page.evaluate(() => {
        const fieldsets = Array.from(document.querySelectorAll("fieldset"));
        const llm = fieldsets.find((f) =>
          (f.textContent ?? "").includes("Chat / LLM model")
        );
        return llm?.hasAttribute("disabled") ?? false;
      });
      assert(llmDisabled, "LLM <fieldset> should be disabled");
    });

    await stopServer();
  },
});
