// Unit tests for the Mozilla Readability wrapper. The parseReadable()
// helper is pure — no network, no filesystem — so we can feed it
// synthetic HTML and verify the title / text / image refs come out
// the way the extractor expects.

import { parseReadable } from "../../src/lib/webpage.ts";
import { assert, assertEquals } from "jsr:@std/assert@^1";

const ARTICLE_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <title>The Sky Is Blue (Wikipedia)</title>
    <meta name="author" content="Test Author">
  </head>
  <body>
    <header><nav><a href="/">Home</a></nav></header>
    <article>
      <h1>Why the sky appears blue</h1>
      <p>The sky appears blue to a human observer because air molecules
      scatter the shorter wavelengths of sunlight more strongly than the
      longer wavelengths. This is called Rayleigh scattering, named
      after the British physicist Lord Rayleigh, who first explained it
      mathematically in the 1870s. The same effect causes sunsets to
      appear red.</p>
      <p>At twilight, the sunlight passes through more of the atmosphere
      before reaching the observer's eye, so most of the blue light is
      scattered away and the red wavelengths dominate.</p>
      <figure>
        <img src="/images/spectrum.png" alt="Visible-light spectrum">
        <figcaption>Visible-light spectrum.</figcaption>
      </figure>
      <p>Other planets with different atmospheres exhibit different sky
      colours: Mars's thin atmosphere scatters less, leaving the sky
      pinkish during the day and bluish at sunset.</p>
    </article>
    <footer>© 2026</footer>
  </body>
</html>
`;

Deno.test("parseReadable extracts title, content, and image refs", () => {
  const result = parseReadable(ARTICLE_HTML, "https://example.com/sky");
  assert(result, "expected non-null parsed result");
  assert(
    result.title.toLowerCase().includes("sky"),
    `expected title to mention sky, got ${result.title}`,
  );
  assert(
    result.content.includes("Rayleigh scattering"),
    "expected article body to include 'Rayleigh scattering'",
  );
  assert(
    result.content.length > 200,
    `expected article body to be at least 200 chars, got ${result.content.length}`,
  );
  // The footer copyright should NOT survive Readability's cleaning.
  assert(
    !result.content.includes("© 2026"),
    "Readability should strip footer/nav noise",
  );
  // Image refs are absolutised against the base URL.
  assertEquals(result.imageRefs.length, 1);
  assertEquals(
    result.imageRefs[0].src,
    "https://example.com/images/spectrum.png",
  );
  assertEquals(result.imageRefs[0].alt, "Visible-light spectrum");
});

Deno.test("parseReadable returns null for a page with no readable content", () => {
  const result = parseReadable(
    "<!doctype html><html><body><div></div></body></html>",
    "https://example.com/empty",
  );
  assertEquals(result, null);
});

Deno.test("parseReadable falls back to body text when Readability gives up", () => {
  // Some pages don't satisfy Readability's heuristics (no <article>,
  // no scoring beats threshold). We should still surface readable
  // text from <main> or <body> instead of failing outright.
  const html = `
    <!doctype html>
    <html><head><title>Notes page</title></head>
    <body>
      <main>
        <p>This is a long-enough piece of plain text content that
        Readability's heuristic might still fail because it lacks the
        article-shaped scoring signals it normally relies on, but the
        fallback to <main>/<body> textContent should still produce a
        useful chunk of text for the embedding pipeline. The threshold
        is fifty characters which we comfortably exceed here.</p>
      </main>
    </body></html>
  `;
  const result = parseReadable(html, "https://example.com/notes");
  assert(result, "expected fallback result");
  assert(
    result.content.includes("fallback"),
    "expected fallback path to surface main/body text",
  );
});

Deno.test("parseReadable resolves relative image src against the base URL", () => {
  const html = `
    <!doctype html>
    <html><head><title>X</title></head><body>
    <article>
      <h1>Heading</h1>
      <p>${"Long enough article body to satisfy Readability. ".repeat(20)}</p>
      <img src="../assets/diagram.svg" alt="Diagram">
      <img src="https://cdn.example.com/banner.jpg" alt="Banner">
    </article>
    </body></html>
  `;
  const result = parseReadable(html, "https://example.com/blog/post.html");
  assert(result, "expected parsed result");
  const srcs = result.imageRefs.map((r) => r.src).sort();
  assert(srcs.includes("https://example.com/assets/diagram.svg"));
  assert(srcs.includes("https://cdn.example.com/banner.jpg"));
});
