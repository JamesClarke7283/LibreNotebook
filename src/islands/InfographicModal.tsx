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
  "English",
  "Español",
  "Français",
  "Deutsch",
  "Italiano",
  "Português",
  "中文",
  "日本語",
  "한국어",
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
  /** Defensive ceiling — matches the server's MAX_ITERATIONS so the
   *  progress bar has a meaningful denominator while we wait for the
   *  model to say `DONE: yes`. */
  const maxIterations = useSignal(7);
  const currentMermaid = useSignal<string | null>(null);
  const renderError = useSignal<string | null>(null);
  const errorMsg = useSignal<string | null>(null);

  // Hidden render target so we can ratch SVG → PNG between iterations.
  type WaitResult = { svg: SVGElement | null; error: string | null };
  const renderedSvg = useRef<SVGElement | null>(null);
  const svgResolve = useRef<((r: WaitResult) => void) | null>(null);

  /** Wait for the MermaidView to either render successfully (SVG ready)
   *  or fail to render (syntax error in LLM output). EITHER outcome
   *  resolves so the generation loop keeps moving — without the error
   *  branch a bad diagram on iteration 1 used to deadlock the loop
   *  forever (waitForSvg never resolved). */
  function waitForRender(): Promise<WaitResult> {
    if (renderedSvg.current) {
      return Promise.resolve({ svg: renderedSvg.current, error: null });
    }
    return new Promise((resolve) => {
      svgResolve.current = (r) => {
        if (r.svg) renderedSvg.current = r.svg;
        resolve(r);
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
      renderError.value = null;
      errorMsg.value = null;
      renderedSvg.current = null;
    }
  }, [open]);

  // Close on Escape (popover semantics).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
      if (!startRes.ok) {
        throw new Error(await startRes.text() || "Start failed");
      }
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
      renderError.value = null;

      let done = false;
      while (!done) {
        // Wait for the just-mounted MermaidView to either render OR
        // fail. Both paths resolve so the loop keeps moving even on
        // syntax errors in LLM output.
        renderedSvg.current = null;
        const r = await waitForRender();
        let imgBlob: Blob | null = null;
        if (r.svg) {
          try {
            imgBlob = await svgElementToPng(r.svg);
          } catch {
            imgBlob = null;
          }
        } else if (r.error) {
          // No image to feed back; the next refine call will get a
          // text-only critique. The model sees its own broken output
          // in the `Current Mermaid` block and tends to fix syntax on
          // the next pass.
          renderError.value = r.error;
        }

        const fd = new FormData();
        fd.append("jobId", startData.jobId);
        if (imgBlob) {
          fd.append("image", imgBlob, "rendered.png");
        }
        // When the previous iteration's Mermaid failed to render,
        // forward the actual error string so the next refine pass
        // can quote it back to the model. Without this the model
        // sees its broken output but doesn't know what's wrong.
        if (r.error) {
          fd.append("renderError", r.error);
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
          modelDoneVerdict: boolean | null;
          maxIterations: number;
        };
        currentMermaid.value = refData.mermaid;
        iteration.value = refData.iteration;
        if (typeof refData.maxIterations === "number") {
          maxIterations.value = refData.maxIterations;
        }
        renderError.value = null;
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
      // Auto-close once the chat message has landed — the user
      // doesn't need to dismiss anything; the new diagram is now in
      // the chat history and the studio item is `ready`.
      onClose();
    } catch (err) {
      errorMsg.value = err instanceof Error ? err.message : String(err);
      phase.value = "error";
    }
  }

  if (!open) return null;

  function onBackdropClick() {
    onClose();
  }

  // While `phase === "running"` the user shouldn't be locked out of
  // the chat — the studio item card already shows iteration progress
  // as the "loading bar on the asset". Render only the hidden
  // MermaidView (off-screen so the SVG → PNG capture still works for
  // the vision feedback loop) and skip the backdrop / centered card.
  if (phase.value === "running") {
    return (
      <div
        aria-hidden="true"
        class="fixed pointer-events-none"
        style="left: -9999px; top: -9999px; width: 1280px; height: 720px;"
      >
        {currentMermaid.value && (
          <MermaidView
            code={currentMermaid.value}
            onRendered={(svg) => {
              if (svgResolve.current) {
                svgResolve.current({ svg, error: null });
              } else renderedSvg.current = svg;
            }}
            onError={(msg) => {
              if (svgResolve.current) {
                svgResolve.current({ svg: null, error: msg });
              }
            }}
          />
        )}
      </div>
    );
  }

  return (
    <>
      {
        /* Backdrop. Click closes — running phase has its own non-modal
          rendering (above) so we never see the backdrop while the
          generation loop is actively churning. */
      }
      <div
        class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onBackdropClick}
        aria-hidden="true"
      />
      {/* Centered popover card. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Customise infographic"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
      >
        <div
          class="pointer-events-auto w-full max-w-2xl max-h-[88vh] bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
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
                  <span class="block text-sm text-zinc-200 mb-2">
                    Choose language
                  </span>
                  <select
                    value={language.value}
                    onChange={(
                      e,
                    ) => (language.value =
                      (e.currentTarget as HTMLSelectElement).value)}
                    class="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span class="block text-sm text-zinc-200 mb-2">
                    Choose orientation
                  </span>
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
                <span class="block text-sm text-zinc-200 mb-2">
                  Choose visual style
                </span>
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
                <span class="block text-sm text-zinc-200 mb-2">
                  Level of detail
                </span>
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
                  onInput={(
                    e,
                  ) => (description.value =
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

          {
            /* The "running" phase no longer renders a visible block here.
              The hidden MermaidView used to capture the SVG → PNG for
              the vision feedback loop is mounted off-screen above
              (before the backdrop) so the user can keep using the chat
              while the loop churns. Studio-item card iteration N/M is
              the visible progress indicator. */
          }

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
      </div>
    </>
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
