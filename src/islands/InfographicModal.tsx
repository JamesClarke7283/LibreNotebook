// Customise-Infographic modal. Slides over the chat pane when the user
// clicks the Infographic tile in StudioPanel. Once the user clicks
// Generate, runs the start → refine* → finalise loop client-side,
// posting the rendered PNG back to the server each iteration so the
// LLM (when vision-capable) can see what it just produced.

import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { ChatMessage } from "../lib/types.ts";
import { MermaidView } from "./MermaidView.tsx";

interface Props {
  notebookId: string;
  open: boolean;
  onClose: () => void;
  /** Called when the loop has produced its final assistant chat message. */
  onFinalised: (message: ChatMessage) => void;
}

const LANGUAGES = [
  "English", "Español", "Français", "Deutsch", "Italiano", "Português",
  "中文", "日本語", "한국어",
];

const STYLES = [
  "Auto-select",
  "Sketch note",
  "Kawaii",
  "Professional",
  "Scientific",
  "Anime",
  "Retro",
  "Minimal",
];

const STYLE_BG: Record<string, string> = {
  "Auto-select": "from-indigo-900/40 to-indigo-700/20",
  "Sketch note": "from-zinc-900 to-zinc-700/40",
  "Kawaii": "from-pink-900/40 to-pink-600/20",
  "Professional": "from-amber-900/30 to-amber-700/20",
  "Scientific": "from-cyan-900/40 to-cyan-700/20",
  "Anime": "from-violet-900/40 to-violet-700/20",
  "Retro": "from-rose-900/40 to-rose-700/20",
  "Minimal": "from-zinc-800 to-zinc-600/30",
};

export function InfographicModal(
  { notebookId, open, onClose, onFinalised }: Props,
) {
  const language = useSignal("English");
  const orientation = useSignal<"Landscape" | "Portrait" | "Square">(
    "Landscape",
  );
  const style = useSignal("Auto-select");
  const detail = useSignal<"Concise" | "Standard" | "Detailed">("Standard");
  const description = useSignal("");

  // Generation state.
  const phase = useSignal<"form" | "running" | "error">("form");
  const iteration = useSignal(0);
  const totalIterations = 3;
  const currentMermaid = useSignal<string | null>(null);
  const errorMsg = useSignal<string | null>(null);

  // Hidden render target so we can ratch SVG → PNG between iterations.
  const renderedSvg = useRef<SVGElement | null>(null);
  const svgResolve = useRef<((svg: SVGElement) => void) | null>(null);

  function waitForSvg(): Promise<SVGElement> {
    if (renderedSvg.current) return Promise.resolve(renderedSvg.current);
    return new Promise((resolve) => {
      svgResolve.current = (svg) => {
        renderedSvg.current = svg;
        resolve(svg);
        svgResolve.current = null;
      };
    });
  }

  useEffect(() => {
    if (!open) {
      // Reset on close.
      phase.value = "form";
      iteration.value = 0;
      currentMermaid.value = null;
      errorMsg.value = null;
      renderedSvg.current = null;
    }
  }, [open]);

  async function generate() {
    phase.value = "running";
    iteration.value = 1;
    errorMsg.value = null;
    currentMermaid.value = null;
    renderedSvg.current = null;

    try {
      // 1. Start
      const startRes = await fetch(
        `/api/notebooks/${notebookId}/studio/infographic/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language: language.value,
            orientation: orientation.value,
            style: style.value,
            detail: detail.value,
            description: description.value,
          }),
        },
      );
      if (!startRes.ok) throw new Error(await startRes.text() || "Start failed");
      const startData = await startRes.json() as {
        jobId: string;
        studioItemId: string;
        iteration: number;
        mermaid: string;
      };
      // Tell StudioPanel a new generating item exists.
      globalThis.dispatchEvent(new CustomEvent("librenotebook:studio-started"));

      currentMermaid.value = startData.mermaid;
      iteration.value = startData.iteration;

      let done = false;
      let mermaid = startData.mermaid;
      while (!done) {
        // Wait for the just-mounted MermaidView to finish rendering.
        renderedSvg.current = null;
        const svg = await waitForSvg();
        let imgBlob: Blob | null = null;
        try {
          imgBlob = await svgElementToPng(svg);
        } catch {
          imgBlob = null;
        }

        const fd = new FormData();
        fd.append("jobId", startData.jobId);
        if (imgBlob) {
          fd.append("image", imgBlob, "rendered.png");
        }
        const ref = await fetch(
          `/api/notebooks/${notebookId}/studio/infographic/refine`,
          { method: "POST", body: fd },
        );
        if (!ref.ok) throw new Error(await ref.text() || "Refine failed");
        const refData = await ref.json() as {
          iteration: number;
          mermaid: string;
          done: boolean;
        };
        mermaid = refData.mermaid;
        currentMermaid.value = mermaid;
        iteration.value = refData.iteration;
        done = refData.done;
      }

      const fin = await fetch(
        `/api/notebooks/${notebookId}/studio/infographic/finalise`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: startData.jobId }),
        },
      );
      if (!fin.ok) throw new Error(await fin.text() || "Finalise failed");
      const finData = await fin.json() as { message: ChatMessage };

      onFinalised(finData.message);
    } catch (err) {
      errorMsg.value = err instanceof Error ? err.message : String(err);
      phase.value = "error";
    }
  }

  if (!open) return null;

  return (
    <div class="absolute inset-0 z-30 bg-zinc-950/95 backdrop-blur-sm border border-zinc-800 rounded-xl flex flex-col">
      <header class="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60">
        <div class="flex items-center gap-2 text-zinc-100">
          <span class="inline-flex w-7 h-7 rounded-md bg-yellow-500/15 text-yellow-300 items-center justify-center text-sm">
            ✦
          </span>
          <h3 class="font-medium">Customise infographic</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          class="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      {phase.value === "form" && (
        <div class="flex-1 overflow-y-auto scroll-thin px-5 py-5 space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <span class="block text-sm text-zinc-200 mb-2">Choose language</span>
              <select
                value={language.value}
                onChange={(e) =>
                  (language.value =
                    (e.currentTarget as HTMLSelectElement).value)}
                class="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
              >
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <span class="block text-sm text-zinc-200 mb-2">Choose orientation</span>
              <div class="inline-flex rounded-full bg-zinc-900 border border-zinc-800 p-1">
                {(["Landscape", "Portrait", "Square"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => (orientation.value = o)}
                    class={`px-3 py-1.5 rounded-full text-xs ${
                      orientation.value === o
                        ? "bg-zinc-100 text-zinc-900"
                        : "text-zinc-300 hover:text-white"
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <span class="block text-sm text-zinc-200 mb-2">Choose visual style</span>
            <div class="flex gap-3 overflow-x-auto scroll-thin pb-2">
              {STYLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => (style.value = s)}
                  class={`shrink-0 w-32 rounded-xl border ${
                    style.value === s
                      ? "border-zinc-100 ring-2 ring-zinc-100/40"
                      : "border-zinc-800 hover:border-zinc-600"
                  } overflow-hidden text-left`}
                >
                  <div
                    class={`h-20 bg-gradient-to-br ${
                      STYLE_BG[s] ?? "from-zinc-900 to-zinc-700/30"
                    } flex items-center justify-center text-2xl text-zinc-200`}
                  >
                    {s === "Sketch note"
                      ? "✏️"
                      : s === "Kawaii"
                      ? "🐙"
                      : s === "Professional"
                      ? "📊"
                      : s === "Scientific"
                      ? "🚀"
                      : s === "Anime"
                      ? "✨"
                      : s === "Retro"
                      ? "📺"
                      : s === "Minimal"
                      ? "▢"
                      : "🎨"}
                  </div>
                  <div class="px-3 py-2 text-xs text-zinc-200">{s}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span class="block text-sm text-zinc-200 mb-2">Level of detail</span>
            <div class="inline-flex rounded-full bg-zinc-900 border border-zinc-800 p-1">
              {(["Concise", "Standard", "Detailed"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => (detail.value = d)}
                  class={`px-3 py-1.5 rounded-full text-xs ${
                    detail.value === d
                      ? "bg-zinc-100 text-zinc-900"
                      : "text-zinc-300 hover:text-white"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span class="block text-sm text-zinc-200 mb-2">
              Describe the infographic that you want to create
            </span>
            <textarea
              value={description.value}
              onInput={(e) =>
                (description.value =
                  (e.currentTarget as HTMLTextAreaElement).value)}
              rows={3}
              placeholder="Guide the style, colour or focus: 'Use a blue colour theme and highlight the 3 key stats'."
              class="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            />
          </div>

          <div class="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              class="px-4 py-2 rounded-full border border-zinc-700 text-zinc-200 text-sm hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={generate}
              class="px-5 py-2 rounded-full bg-blue-500 text-white text-sm font-medium hover:bg-blue-400"
            >
              Generate
            </button>
          </div>
        </div>
      )}

      {phase.value === "running" && (
        <div class="flex-1 overflow-y-auto scroll-thin px-5 py-5">
          <div class="text-center text-zinc-300 mb-4">
            <p class="text-sm">
              Refining diagram ({iteration.value}/{totalIterations})…
            </p>
            <div class="mx-auto mt-2 w-48 h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                class="h-1 bg-yellow-400 transition-all"
                style={`width: ${
                  Math.min(100, (iteration.value / totalIterations) * 100)
                }%`}
              />
            </div>
          </div>
          {currentMermaid.value && (
            <MermaidView
              code={currentMermaid.value}
              onRendered={(svg) => {
                if (svgResolve.current) svgResolve.current(svg);
                else renderedSvg.current = svg;
              }}
            />
          )}
        </div>
      )}

      {phase.value === "error" && (
        <div class="flex-1 px-5 py-5">
          <div class="rounded-lg bg-red-950/40 border border-red-900/60 p-3 text-sm text-red-200">
            <p class="font-medium mb-1">Generation failed</p>
            <p class="text-xs">{errorMsg.value}</p>
          </div>
          <div class="flex items-center justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={onClose}
              class="px-4 py-2 rounded-full border border-zinc-700 text-zinc-200 text-sm hover:bg-zinc-800"
            >
              Close
            </button>
            <button
              type="button"
              onClick={generate}
              class="px-5 py-2 rounded-full bg-blue-500 text-white text-sm font-medium hover:bg-blue-400"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Convert a rendered SVG element to a PNG Blob via OffscreenCanvas
 * (or a regular HTMLCanvasElement on browsers that lack OffscreenCanvas).
 */
async function svgElementToPng(svg: SVGElement): Promise<Blob> {
  const xml = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("SVG image failed to load"));
      i.src = url;
    });
    const w = Math.max(1, Math.floor(img.width || 1280));
    const h = Math.max(1, Math.floor(img.height || 720));
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
