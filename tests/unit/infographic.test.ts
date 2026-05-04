// Unit tests for src/lib/infographic.ts pure helpers.

import { assertEquals } from "jsr:@std/assert@^1";
import { deriveTitle, extractMermaid } from "../../src/lib/infographic.ts";

Deno.test("extractMermaid: pulls a fenced ```mermaid block", () => {
  const reply = "Here you go:\n\n```mermaid\nflowchart TD\n  A-->B\n```\n";
  assertEquals(extractMermaid(reply), "flowchart TD\n  A-->B");
});

Deno.test("extractMermaid: falls back to a generic fenced block", () => {
  const reply = "```\nflowchart LR\n  X-->Y\n```";
  assertEquals(extractMermaid(reply), "flowchart LR\n  X-->Y");
});

Deno.test("extractMermaid: strips fences when no language tag", () => {
  const reply = "flowchart TD\n  Q-->R";
  assertEquals(extractMermaid(reply), "flowchart TD\n  Q-->R");
});

Deno.test("deriveTitle: uses mindmap root when present", () => {
  const code = "mindmap\n  Root of the diagram\n    Branch A\n";
  const got = deriveTitle(code, {
    language: "English",
    orientation: "Landscape",
    style: "Auto-select",
    detail: "Standard",
    description: "",
  });
  assertEquals(got, "Root of the diagram");
});

Deno.test("deriveTitle: falls back to user description (truncated)", () => {
  const longDesc = "Compare B-Tree vs LSM-Tree write paths in detail with " +
    "every nuance covered to a depth of 60+ characters easily.";
  const got = deriveTitle("flowchart TD", {
    language: "English",
    orientation: "Landscape",
    style: "Auto-select",
    detail: "Standard",
    description: longDesc,
  });
  // 60 chars + "…" ellipsis
  assertEquals(got.endsWith("…"), true);
  assertEquals(got.length <= 61, true);
});

Deno.test("deriveTitle: uses a node label when no description", () => {
  const code = `flowchart TD
    A["Storage Engines"] --> B[Trees]
  `;
  const got = deriveTitle(code, {
    language: "English",
    orientation: "Landscape",
    style: "Auto-select",
    detail: "Standard",
    description: "",
  });
  assertEquals(got, "Storage Engines");
});

Deno.test("deriveTitle: ultimate fallback is 'Infographic'", () => {
  // No node labels in this code, no description either.
  const got = deriveTitle("graph", {
    language: "English",
    orientation: "Landscape",
    style: "Auto-select",
    detail: "Standard",
    description: "",
  });
  assertEquals(got, "Infographic");
});
