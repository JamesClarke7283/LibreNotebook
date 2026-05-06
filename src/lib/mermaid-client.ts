// Client-side Mermaid loader + SVG/PNG export helpers. Lives in lib/
// (not islands/) so multiple islands — MermaidView, InfographicModal,
// InfographicViewer, StudioPanel kebab downloads — all share one
// lazy-loaded mermaid module instance.
//
// Mermaid ships a fat ESM bundle so we lazy-load it on first use.
// `mermaid` is listed in vite.config.ts `ssr.external`, so this module
// is only ever evaluated client-side; the dynamic `import("mermaid…")`
// also keeps it out of the SSR graph.

export type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;

/** Lazy-load the mermaid module. The initialize() call is idempotent
 *  but only fires on first import. */
export function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    // Use mermaid's standalone min ESM bundle directly. The package's
    // default `import "mermaid"` resolves to dist/mermaid.core.mjs,
    // whose ./chunks/* re-exports trip Vite's dev-mode SSR runtime
    // ("Importing binding name 'default' cannot be resolved"). The
    // single-file `mermaid.esm.min.mjs` bundle is self-contained.
    mermaidPromise = import("mermaid/dist/mermaid.esm.min.mjs").then(
      (mod) => {
        // deno-lint-ignore no-explicit-any
        const m = ((mod as any).default ?? mod) as MermaidApi;
        m.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        });
        return m;
      },
    );
  }
  return mermaidPromise;
}

/** Render a Mermaid block to an SVG XML string. Useful when we need
 *  the SVG without mounting a viewer (e.g. download from the kebab
 *  menu without opening the popover). */
export async function renderMermaidToSvg(code: string): Promise<string> {
  const m = await loadMermaid();
  const id = `mer-${Math.random().toString(36).slice(2)}`;
  const { svg } = await m.render(id, code);
  return svg;
}

/** Mermaid usually emits an SVG with `style="max-width: …"` but without
 *  explicit `width`/`height` attributes — when you point an `<img>` at
 *  that SVG the natural size collapses to 0×0 and the resulting PNG is
 *  blank. Inject explicit pixel dimensions derived from `viewBox`
 *  before rasterising so the canvas has something concrete to draw. */
function withExplicitDimensions(svg: string): {
  svg: string;
  width: number;
  height: number;
} {
  const tagMatch = svg.match(/<svg\b([^>]*)>/i);
  if (!tagMatch) return { svg, width: 1280, height: 720 };
  const attrs = tagMatch[1];

  // Numeric (px) width/height already set?
  const widthMatch = attrs.match(/\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i);
  const heightMatch = attrs.match(/\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i);
  let width = widthMatch ? parseFloat(widthMatch[1]) : 0;
  let height = heightMatch ? parseFloat(heightMatch[1]) : 0;

  if (!width || !height) {
    const viewBox = attrs.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
    if (viewBox) {
      const parts = viewBox[1].trim().split(/\s+|,/).map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        width = parts[2];
        height = parts[3];
      }
    }
  }

  if (!width || !height) {
    width = 1280;
    height = 720;
  }

  // 2× scale gives a PNG that doesn't look soft on retina screens, but
  // cap so a sprawling Mermaid diagram doesn't produce a 30 MP image.
  const MAX = 4096;
  let scale = 2;
  if (width * scale > MAX || height * scale > MAX) {
    scale = Math.min(MAX / width, MAX / height);
  }
  const finalW = Math.max(1, Math.round(width * scale));
  const finalH = Math.max(1, Math.round(height * scale));

  // Drop any existing width/height attrs (numeric or `100%`) and inject
  // ours. Order: keep the original tag's other attrs intact.
  const cleanedAttrs = attrs
    .replace(/\swidth\s*=\s*["'][^"']*["']/i, "")
    .replace(/\sheight\s*=\s*["'][^"']*["']/i, "");
  const newSvg = svg.replace(
    tagMatch[0],
    `<svg width="${finalW}" height="${finalH}"${cleanedAttrs}>`,
  );
  return { svg: newSvg, width: finalW, height: finalH };
}

/** Convert an SVG XML string to a PNG Blob. Uses OffscreenCanvas where
 *  available for a slight perf win over the main-thread canvas path. */
export async function svgStringToPng(svg: string): Promise<Blob> {
  const sized = withExplicitDimensions(svg);
  const blob = new Blob([sized.svg], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("SVG image failed to load"));
      i.src = url;
    });
    // Prefer the explicit dimensions we baked in; fall back to whatever
    // the browser computed.
    const w = Math.max(1, Math.floor(sized.width || img.width || 1280));
    const h = Math.max(1, Math.floor(sized.height || img.height || 720));
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#0b0f14";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return await canvas.convertToBlob({ type: "image/png" });
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error("toBlob failed")),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Trigger a browser download for the given Blob without leaving an
 *  anchor in the DOM. Filename should already include the extension. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Pick a safe filename stem from a studio item title. Strips path
 *  separators, control chars, and trims to a reasonable length. */
export function safeFilenameStem(raw: string): string {
  const cleaned = raw
    // deno-lint-ignore no-control-regex
    .replace(/[\\/\0-\x1f\x7f]/g, "")
    .replace(/[<>:"|?*]/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || "infographic";
}
