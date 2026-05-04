// Puppeteer: /signin and /signup pages render the AuthForm and post
// to the right endpoints. We mock the auth handler so this runs
// without a real Better Auth instance attached.

import { startServer, stopServer, withPage } from "./setup.ts";
import { assert } from "jsr:@std/assert@^1";

const ENABLED = Deno.env.get("MULTI_USER")?.toLowerCase() === "1" ||
  Deno.env.get("MULTI_USER")?.toLowerCase() === "true";

Deno.test({
  name: "/signin renders the form (multi-user mode)",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await startServer();
    await withPage(async ({ page, baseUrl }) => {
      await page.goto(`${baseUrl}/signin`, { waitUntil: "networkidle2" });
      const text = await page.evaluate(() => document.body.textContent ?? "");
      assert(text.includes("Sign in"), "/signin page should render the heading");
      const hasEmail = await page.evaluate(() =>
        Boolean(document.querySelector('input[type="email"]'))
      );
      const hasPassword = await page.evaluate(() =>
        Boolean(document.querySelector('input[type="password"]'))
      );
      assert(hasEmail && hasPassword, "form should expose email + password");
    });
    await stopServer();
  },
});

Deno.test({
  name: "/signup posts to /api/auth/sign-up/email (multi-user mode)",
  ignore: !ENABLED,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await startServer();
    await withPage(async ({ page, baseUrl }) => {
      await page.setRequestInterception(true);
      let captured = "";
      page.on("request", (req: any) => {
        const url = req.url();
        if (url.includes("/api/auth/sign-up/email") && req.method() === "POST") {
          captured = req.postData() ?? "";
          req.respond({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true }),
          });
        } else {
          req.continue();
        }
      });

      await page.goto(`${baseUrl}/signup`, { waitUntil: "networkidle2" });
      await page.evaluate(() => {
        const set = (sel: string, val: string) => {
          const el = document.querySelector(sel) as HTMLInputElement | null;
          if (el) {
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              "value",
            )?.set;
            setter?.call(el, val);
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
        };
        set('input[type="email"]', "test@example.com");
        set('input[type="password"]', "supersecret");
      });
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button"))
          .find((b) => /Create account|Sign up/i.test(b.textContent ?? ""));
        (btn as HTMLButtonElement | undefined)?.click();
      });
      // Wait briefly for the request to be intercepted.
      await new Promise((r) => setTimeout(r, 1000));
      assert(captured.includes("test@example.com"), "form should post the email");
    });
    await stopServer();
  },
});
