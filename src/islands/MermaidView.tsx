// Client-side renderer for a Mermaid block. Used both inside chat
// messages (when the assistant emits a ```mermaid fenced block) and by
// InfographicModal during the iteration loop, where it also needs the
// rendered SVG so it can ship a PNG back to the server.
//
// Mermaid is heavy (d3 + dagre + parser) so it's lazy-loaded on first
// mount.

import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";

type Mermaid = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<Mermaid> | null = null;
function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const m = (mod.default ?? mod) as Mermaid;
      m.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      });
      return m;
    });
  }
  return mermaidPromise;
}

interface Props {
  code: string;
  /** Called once with the mounted <svg> element (used by InfographicModal
   *  to capture the diagram as a PNG for the next iteration). */
  onRendered?: (svg: SVGElement) => void;
}

export function MermaidView({ code, onRendered }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const error = useSignal<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    error.value = null;
    (async () => {
      try {
        const m = await loadMermaid();
        const id = `mer-${Math.random().toString(36).slice(2)}`;
        const { svg } = await m.render(id, code);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        const svgEl = ref.current.querySelector("svg");
        if (svgEl && onRendered) onRendered(svgEl as SVGElement);
      } catch (err) {
        if (!cancelled) {
          error.value = err instanceof Error ? err.message : String(err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error.value) {
    return (
      <div class="my-2 rounded-lg border border-red-900/60 bg-red-950/30 p-3">
        <p class="text-xs text-red-300 mb-2">
          Mermaid render failed: {error.value}
        </p>
        <pre class="text-[11px] text-red-200 whitespace-pre-wrap overflow-x-auto">
          {code}
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      class="my-2 rounded-lg bg-zinc-950/80 border border-zinc-800 p-3 [&_svg]:w-full [&_svg]:h-auto"
    />
  );
}
