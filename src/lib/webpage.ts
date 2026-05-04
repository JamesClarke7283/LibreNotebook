// Webpage ingest via Mozilla's Readability (the same algorithm Firefox
// Reader View uses). We hand the page HTML to Readability, take its
// cleaned article content, extract embedded images alongside, and turn
// the article HTML into plain text suitable for embedding.
//
// Images are downloaded to the source's images/ folder so the chat
// pipeline can attach them to the LLM request when the model is
// vision-capable.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceImage } from "./types.ts";

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

export interface WebpageExtract {
  title: string;
  content: string;
  byline?: string;
  excerpt?: string;
  images: SourceImage[];
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
  pageUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  let absolute: string;
  try {
    absolute = new URL(imgUrl, pageUrl).href;
  } catch {
    return null;
  }
  if (!/^https?:/.test(absolute)) return null;
  let res: Response;
  try {
    res = await fetch(absolute, {
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
  // 1. Fetch the page.
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; LibreNotebook/0.1; +https://librenotebook.local)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();

  // 2. Parse the page DOM and run Readability on it.
  const { document } = parseHTML(html);
  // Readability is destructive — pass it the parsed doc directly.
  const article = new Readability(document).parse();
  if (!article || !article.content) {
    throw new Error(
      "This page didn't yield any readable content (try saving the article text manually instead).",
    );
  }

  // 3. Walk the cleaned article HTML for images and turn the rest into
  //    plain text.
  const { document: articleDoc } = parseHTML(article.content);
  const imgEls = Array.from(
    articleDoc.querySelectorAll("img") as NodeListOf<Element>,
  );

  await mkdir(imagesOutDir, { recursive: true });
  const images: SourceImage[] = [];
  let savedCount = 0;
  for (let i = 0; i < imgEls.length && savedCount < MAX_IMAGES; i++) {
    const el = imgEls[i];
    const src = el.getAttribute("src") ?? el.getAttribute("data-src") ?? "";
    const alt = el.getAttribute("alt") ?? undefined;
    if (!src) continue;
    const dl = await downloadImage(src, url);
    if (!dl) continue;
    const filename = imageFilename(savedCount, src, dl.contentType);
    await writeFile(join(imagesOutDir, filename), dl.bytes);
    let absoluteSrc = src;
    try {
      absoluteSrc = new URL(src, url).href;
    } catch { /* keep original */ }
    images.push({
      filename,
      page: 1,
      width: 0,
      height: 0,
      src: absoluteSrc,
      alt,
    });
    savedCount += 1;
  }

  // Prefer Readability's pre-cleaned plain-text. Fall back to walking
  // the article HTML when textContent is missing (older Readability
  // builds occasionally skipped it).
  const rawText = (article as { textContent?: string }).textContent ??
    ((articleDoc.body as Element | null)?.textContent ?? "") ??
    ((articleDoc.documentElement as Element | null)?.textContent ?? "");
  const text = rawText.replace(/\s+/g, " ").trim();

  return {
    title: article.title?.trim() || url,
    content: text,
    byline: article.byline ?? undefined,
    excerpt: article.excerpt ?? undefined,
    images,
  };
}
