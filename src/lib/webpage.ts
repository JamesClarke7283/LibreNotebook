// Webpage ingest via Mozilla's Readability (the same algorithm Firefox
// Reader View uses). We hand the page HTML to Readability, take its
// cleaned article content, extract embedded images alongside, and turn
// the article HTML into plain text suitable for embedding.
//
// Images are downloaded to the source's images/ folder so the chat
// pipeline can attach them to the LLM request when the model is
// vision-capable.
//
// The actual Readability + linkedom call is exposed as a pure
// `parseReadable(html, baseUrl)` helper so unit tests can run without
// network. `extractWebpage(url, ...)` wraps it with the fetch +
// image-download side effects.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceImage } from "./types.ts";
import { getLogger } from "./logger.ts";

const log = getLogger("webpage");

// Bring in @mozilla/readability and linkedom dynamically — both pull in
// browser-shaped APIs that we don't want in Vite's SSR module graph at
// transform time.
// deno-lint-ignore no-explicit-any
const readabilityMod: any = await import("@mozilla/readability");
const Readability = readabilityMod.Readability ?? readabilityMod.default;
// deno-lint-ignore no-explicit-any
const linkedomMod: any = await import("linkedom");
const parseHTML = linkedomMod.parseHTML ?? linkedomMod.default?.parseHTML;

const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 4_000_000; // 4 MB per image
/** Below this many readable characters we treat the page as
 *  Readability-failed and either fall back to the body's textContent
 *  or surface a helpful error. */
const MIN_READABLE_CHARS = 50;

export interface WebpageExtract {
  title: string;
  content: string;
  byline?: string;
  excerpt?: string;
  images: SourceImage[];
}

/** Pure parsed-page output — no I/O. `imageRefs` are the absolute
 *  source URLs found inside the article's images; the caller is
 *  responsible for downloading them if it wants to keep them on disk. */
export interface ReadableParsed {
  title: string;
  content: string;
  byline?: string;
  excerpt?: string;
  imageRefs: Array<{ src: string; alt?: string }>;
}

/**
 * Run Mozilla Readability on raw HTML. Pure function — testable
 * without network. Returns null if the page yielded no useful content.
 */
export function parseReadable(
  html: string,
  baseUrl: string,
): ReadableParsed | null {
  const { document } = parseHTML(html);
  // Readability mutates its input; pass the parsed doc directly.
  const article = new Readability(document).parse();

  // Helper: build plain text from the page DOM as a last-resort
  // fallback (Readability sometimes returns null on JS-heavy pages
  // with valid <article>/<main>/<body> content the user *did* see).
  const fallbackText = (() => {
    const main = document.querySelector("article") ??
      document.querySelector("main") ??
      document.body ??
      document.documentElement;
    return ((main?.textContent ?? "") as string).replace(/\s+/g, " ").trim();
  })();

  if (!article || !article.content) {
    if (fallbackText.length >= MIN_READABLE_CHARS) {
      const titleEl = document.querySelector("title") as
        | { textContent?: string }
        | null;
      return {
        title: (titleEl?.textContent ?? baseUrl).trim() || baseUrl,
        content: fallbackText,
        imageRefs: [],
      };
    }
    return null;
  }

  // Walk the cleaned article's images.
  const { document: articleDoc } = parseHTML(article.content);
  const imgEls = Array.from(
    articleDoc.querySelectorAll("img") as NodeListOf<Element>,
  );
  const imageRefs: Array<{ src: string; alt?: string }> = [];
  for (const el of imgEls) {
    const src = el.getAttribute("src") ?? el.getAttribute("data-src") ?? "";
    if (!src) continue;
    let absolute = src;
    try {
      absolute = new URL(src, baseUrl).href;
    } catch { /* keep relative */ }
    imageRefs.push({
      src: absolute,
      alt: el.getAttribute("alt") ?? undefined,
    });
  }

  // Prefer Readability's pre-cleaned plain-text. Fall back to walking
  // the article HTML when textContent is missing (older Readability
  // builds occasionally skipped it). Last resort: the page-wide
  // fallback we computed above.
  const rawText = (article as { textContent?: string }).textContent ??
    (articleDoc.body as { textContent?: string } | null)?.textContent ??
    (articleDoc.documentElement as { textContent?: string } | null)
      ?.textContent ??
    "";
  const cleaned = rawText.replace(/\s+/g, " ").trim();
  const content = cleaned.length >= MIN_READABLE_CHARS ? cleaned : fallbackText;

  if (content.length < MIN_READABLE_CHARS) return null;

  return {
    title: article.title?.trim() || baseUrl,
    content,
    byline: article.byline ?? undefined,
    excerpt: article.excerpt ?? undefined,
    imageRefs,
  };
}

/** Decide a sensible filename from a URL + content-type. */
function imageFilename(idx: number, url: string, ct: string): string {
  const lower = url.toLowerCase();
  const ext = ct.includes("png")
    ? "png"
    : ct.includes("jpeg") || ct.includes("jpg")
    ? "jpg"
    : ct.includes("webp")
    ? "webp"
    : ct.includes("gif")
    ? "gif"
    : ct.includes("svg")
    ? "svg"
    : (lower.match(/\.(png|jpe?g|webp|gif|svg)(?:\?|$)/)?.[1] ?? "png")
      .replace("jpeg", "jpg");
  return `img-${idx + 1}.${ext}`;
}

async function downloadImage(
  imgUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!/^https?:/.test(imgUrl)) return null;
  let res: Response;
  try {
    res = await fetch(imgUrl, {
      headers: { "User-Agent": "LibreNotebook/0.1 (+webpage-extract)" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.startsWith("image/")) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) return null;
  return { bytes: buf, contentType: ct };
}

export async function extractWebpage(
  url: string,
  imagesOutDir: string,
): Promise<WebpageExtract> {
  // 1. Fetch the page. The User-Agent is shaped to look like a real
  //    browser — many sites 403 the obvious-bot agents.
  log.info("fetching", { url });
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/123.0.0.0 Safari/537.36 LibreNotebook/0.1",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(
      `Could not fetch ${url}: ${res.status} ${res.statusText}. ` +
        `If the site requires JavaScript or login, save the article text manually.`,
    );
  }
  const html = await res.text();
  log.info("fetched", { url, bytes: html.length, elapsedMs: Date.now() - t0 });

  // 2. Run Readability on it (pure step — also covered by the unit test
  //    in tests/unit/webpage.test.ts).
  const parsed = parseReadable(html, url);
  if (!parsed) {
    throw new Error(
      "Readability couldn't extract a readable article from this page. " +
        "It may be JavaScript-rendered or blocked behind a login. " +
        "Try saving the article text manually.",
    );
  }

  // 3. Download the images Readability surfaced.
  await mkdir(imagesOutDir, { recursive: true });
  const images: SourceImage[] = [];
  let savedCount = 0;
  for (let i = 0; i < parsed.imageRefs.length && savedCount < MAX_IMAGES; i++) {
    const ref = parsed.imageRefs[i];
    const dl = await downloadImage(ref.src);
    if (!dl) continue;
    const filename = imageFilename(savedCount, ref.src, dl.contentType);
    await writeFile(join(imagesOutDir, filename), dl.bytes);
    images.push({
      filename,
      page: 1,
      width: 0,
      height: 0,
      src: ref.src,
      alt: ref.alt,
    });
    savedCount += 1;
  }

  log.info("Readability extracted", {
    url,
    title: parsed.title,
    chars: parsed.content.length,
    images: images.length,
  });

  return {
    title: parsed.title,
    content: parsed.content,
    byline: parsed.byline,
    excerpt: parsed.excerpt,
    images,
  };
}
