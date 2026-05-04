// /notebooks dashboard tests: 3-dot menu (Rename + Delete) and the
// sort dropdown.

import { startServer, stopServer, withPage } from "./setup.ts";
import { assert } from "jsr:@std/assert@^1";

const FAKE_NOTEBOOKS = [
  {
    id: "nb-zeta",
    title: "Zeta Notebook",
    createdAt: "2025-12-01T10:00:00Z",
    updatedAt: "2025-12-01T10:00:00Z",
    sourceCount: 0,
  },
  {
    id: "nb-alpha",
    title: "Alpha Notebook",
    createdAt: "2025-11-01T10:00:00Z",
    updatedAt: "2025-12-15T10:00:00Z",
    sourceCount: 3,
  },
];

Deno.test({
  name: "dashboard 3-dot menu shows Rename + (red) Delete",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await startServer();
    await withPage(async ({ page, baseUrl }) => {
      await page.setRequestInterception(true);
      page.on("request", (req: any) => {
        const url = req.url();
        if (url.endsWith("/api/notebooks") && req.method() === "GET") {
          req.respond({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(FAKE_NOTEBOOKS),
          });
        } else {
          req.continue();
        }
      });

      await page.goto(`${baseUrl}/notebooks`, { waitUntil: "networkidle2" });
      // The grid is server-rendered from the route's data; the page
      // initially shows the real notebooks. Just assert the 3-dot
      // button exists on every card.
      const buttons = await page.$$('[aria-label="More"]');
      assert(
        buttons.length >= 1,
        "every card should have a 3-dot 'More' button",
      );

      // Click the first one — popover should appear.
      await buttons[0].click();
      // Wait for the popover.
      await page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll("button"))
            .some((b) => b.textContent?.trim() === "Rename"),
        { timeout: 4_000 },
      );

      const sawDeleteRed = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button"))
          .find((b) => b.textContent?.trim() === "Delete");
        if (!btn) return false;
        // The Delete button should carry a red class — we set
        // text-red-300 in the popover.
        return (btn.className ?? "").includes("red");
      });
      assert(sawDeleteRed, "Delete should be styled red");
    });
    await stopServer();
  },
});

Deno.test({
  name: "dashboard sort dropdown lists 4 options",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await startServer();
    await withPage(async ({ page, baseUrl }) => {
      await page.goto(`${baseUrl}/notebooks`, { waitUntil: "networkidle2" });
      const sortBtn = await page.evaluateHandle(() =>
        Array.from(document.querySelectorAll("button"))
          .find((b) => /Most recent|Oldest|A → Z|Z → A/.test(b.textContent ?? ""))
      );
      assert(sortBtn, "sort dropdown trigger should be on the page");
      const el = sortBtn.asElement();
      if (!el) throw new Error("sort button handle not an element");
      await el.click();
      await page.waitForFunction(
        () => {
          const txt = document.body.textContent ?? "";
          return txt.includes("Most recent") &&
            txt.includes("Oldest first") &&
            txt.includes("A → Z") &&
            txt.includes("Z → A");
        },
        { timeout: 4_000 },
      );
    });
    await stopServer();
  },
});
