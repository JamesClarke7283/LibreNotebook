// PDF extraction via Mozilla's pdfjs-dist (Node-compatible legacy build).
//
// We extract two things per PDF:
//   1. Text  — concatenated from each page via getTextContent()
//   2. Images — embedded image XObjects, surfaced through pdfjs's
//      page.objs cache. Each image is encoded as PNG (using pngjs) and
//      written under .data/notebooks/<id>/images/<sourceId>/.
//
// We deliberately ignore bitmaps with `kind` values we don't know how to
// safely encode (mostly the obscure 1bpp greyscale variants); those are
// rare in modern PDFs.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
// deno-lint-ignore no-explicit-any
const pdfjsModule: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
const pdfjs = pdfjsModule.default ?? pdfjsModule;
const { PNG } = await import("pngjs");
import type { SourceImage } from "./types.ts";

// pdfjs always wants a workerSrc — even with the main-thread fallback it
// dynamic-imports the worker module to keep the same code paths. Point
// at the symlinked path under node_modules so it resolves at runtime.
{
  const workerPath = join(
    Deno.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs",
  );
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  }
}

/** Bitmap kinds emitted by pdfjs (see src/shared/util.js). */
const ImageKind = { GRAYSCALE_1BPP: 1, RGB_24BPP: 2, RGBA_32BPP: 3 } as const;

interface ExtractResult {
  text: string;
  pageCount: number;
  images: SourceImage[];
}

interface PdfImage {
  width: number;
  height: number;
  // RGB(A) interleaved or 1bpp packed.
  data: Uint8Array | Uint8ClampedArray;
  kind: number;
}

/**
 * Convert a pdfjs image bitmap into a PNG buffer using pngjs. Returns null
 * if the bitmap kind is one we don't handle (rare).
 */
function bitmapToPng(img: PdfImage): Buffer | null {
  if (
    img.kind !== ImageKind.RGB_24BPP &&
    img.kind !== ImageKind.RGBA_32BPP
  ) {
    return null;
  }
  const png = new PNG({ width: img.width, height: img.height });
  if (img.kind === ImageKind.RGBA_32BPP) {
    png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  } else {
    // RGB → RGBA (pngjs needs 4 bytes per pixel).
    const out = Buffer.alloc(img.width * img.height * 4);
    for (let i = 0, o = 0; i < img.data.length; i += 3, o += 4) {
      out[o] = img.data[i];
      out[o + 1] = img.data[i + 1];
      out[o + 2] = img.data[i + 2];
      out[o + 3] = 0xff;
    }
    png.data = out;
  }
  return PNG.sync.write(png);
}

export async function extractPdf(
  bytes: Uint8Array,
  imagesOutDir?: string,
): Promise<ExtractResult> {
  // pdfjs mutates the buffer; pass a copy.
  const data = bytes.slice();
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];
  const images: SourceImage[] = [];

  if (imagesOutDir) await mkdir(imagesOutDir, { recursive: true });

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);

    // Text.
    try {
      const tc = await page.getTextContent();
      const txt = (tc.items as Array<{ str?: string }>)
        .map((it) => it.str ?? "")
        .filter((s) => s.length > 0)
        .join(" ");
      pageTexts.push(txt);
    } catch {
      pageTexts.push("");
    }

    // Images.
    if (imagesOutDir) {
      try {
        const ops = await page.getOperatorList();
        let imgIdx = 0;
        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          if (
            fn !== pdfjs.OPS.paintImageXObject &&
            fn !== pdfjs.OPS.paintInlineImageXObject
          ) continue;
          const objId = ops.argsArray[i][0] as string;
          let bitmap: PdfImage | undefined;
          try {
            bitmap = await new Promise<PdfImage>((resolve, reject) => {
              try {
                page.objs.get(objId, (img: PdfImage) => resolve(img));
              } catch (err) {
                reject(err);
              }
            });
          } catch {
            continue;
          }
          if (!bitmap || !bitmap.data) continue;
          const png = bitmapToPng(bitmap);
          if (!png) continue;
          imgIdx += 1;
          const filename = `page-${p}-img-${imgIdx}.png`;
          await writeFile(join(imagesOutDir, filename), png);
          images.push({
            filename,
            page: p,
            width: bitmap.width,
            height: bitmap.height,
          });
        }
      } catch {
        // Image extraction is best-effort.
      }
    }

    page.cleanup();
  }
  await pdf.cleanup();
  await pdf.destroy();

  return {
    text: pageTexts.join("\n\n"),
    pageCount: pdf.numPages,
    images,
  };
}
