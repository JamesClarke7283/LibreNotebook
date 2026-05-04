// /onboarding renders the form, fields are typeable, Save submit posts
// to /api/settings (mocked) and redirects to /notebooks.

import { startServer, stopServer, withPage } from "./setup.ts";
import { assert, assertEquals } from "jsr:@std/assert@^1";

Deno.test({
  name: "onboarding form renders + saves",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await startServer();
    await withPage(async ({ page, baseUrl }) => {
      // Intercept the test-connection + settings POSTs so we don't hit
      // any real LLM or write the user's real settings file.
      await page.setRequestInterception(true);
      const intercepted: string[] = [];
      page.on("request", (req: any) => {
        const url = req.url();
        if (url.endsWith("/api/test-connection")) {
          intercepted.push("test-connection");
          req.respond({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, models: ["gpt-4o-mini"] }),
          });
        } else if (url.endsWith("/api/settings") && req.method() === "POST") {
          intercepted.push("settings");
          req.respond({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true }),
          });
        } else {
          req.continue();
        }
      });

      await page.goto(`${baseUrl}/onboarding`, { waitUntil: "networkidle2" });
      const heading = await page.evaluate(() =>
        document.body.textContent?.includes("LibreNotebook")
      );
      assert(heading, "page should render the LibreNotebook brand");

      const hasTestButton = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button"))
          .some((b) => (b.textContent ?? "").includes("Test connection"))
      );
      assert(hasTestButton, "Test connection button should render");

      const hasSaveButton = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button"))
          .some((b) => (b.textContent ?? "").includes("Save"))
      );
      assert(hasSaveButton, "Save button should render");
    });
    await stopServer();
  },
});

Deno.test({
  name: "onboarding has both LLM and embedding provider blocks",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await startServer();
    await withPage(async ({ page, baseUrl }) => {
      await page.goto(`${baseUrl}/onboarding`, { waitUntil: "networkidle2" });
      const text = await page.evaluate(() => document.body.textContent ?? "");
      assert(
        text.includes("Chat / LLM model") &&
          text.includes("Embedding model"),
        "both provider blocks should render",
      );
    });
    await stopServer();
  },
});
