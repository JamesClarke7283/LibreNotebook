// Fullscreen popover that displays a "ready" infographic's Mermaid
// diagram. Mounted inside StudioPanel and toggled by the studio item
// click handler. Click outside (backdrop) and Esc both dismiss it.
//
// Downloads are exposed on the studio item's kebab menu rather than
// here so users don't have to open the viewer to grab a PNG/SVG.

import { useEffect } from "preact/hooks";
import { MermaidView } from "./MermaidView.tsx";

interface Props {
  open: boolean;
  title: string;
  mermaid: string | null;
  onClose: () => void;
}

export function InfographicViewer(
  { open, title, mermaid, onClose }: Props,
) {
  // Esc dismisses; only attached while open so background pages still
  // get their own Esc handlers.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div
        class="fixed inset-0 z-40 bg-black/85 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || "Infographic"}
        class="fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none"
      >
        <div
          class="pointer-events-auto w-full max-w-[95vw] max-h-[95vh] bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <header class="flex items-center justify-between px-5 py-3 border-b border-zinc-800/60">
            <h3 class="font-medium text-zinc-100 truncate pr-4">
              {title || "Infographic"}
            </h3>
            <button
              type="button"
              onClick={onClose}
              class="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400"
              aria-label="Close"
            >
              ✕
            </button>
          </header>
          <div class="flex-1 overflow-auto scroll-thin p-6 flex items-center justify-center bg-zinc-950">
            {mermaid
              ? (
                <div class="w-full [&_svg]:max-w-full [&_svg]:max-h-[80vh] [&_svg]:h-auto">
                  <MermaidView code={mermaid} />
                </div>
              )
              : <p class="text-sm text-zinc-500">No diagram available.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
