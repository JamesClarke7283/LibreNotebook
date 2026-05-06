// Right pane: Studio. Top half is the palette of generation tiles
// (Audio, Slide deck, Mind Map, Reports, Flashcards, Quiz, Infographic,
// Data table). Below the palette we show the running list of generated
// "studio items" (currently only infographics produce these — they appear
// as cards while generating, e.g. "Generating infographic… based on N
// sources" — and flip to "ready" with a clickable title once finished).
//
// Tile clicks dispatch a window-level CustomEvent so the InfographicModal
// (mounted inside ChatPanel) can react without us threading callbacks
// through Fresh's island boundaries.

import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  AudioIcon,
  FlashcardsIcon,
  InfographicIcon,
  LoaderIcon,
  MindMapIcon,
  MoreVerticalIcon,
  NoteIcon,
  QuizIcon,
  ReportIcon,
  SidebarIcon,
  SlideIcon,
  SparklesIcon,
  TableIcon,
} from "../components/Icons.tsx";
import type { StudioItem } from "../lib/types.ts";
import { getLogger } from "../lib/client-logger.ts";
import {
  downloadBlob,
  renderMermaidToSvg,
  safeFilenameStem,
  svgStringToPng,
} from "../lib/mermaid-client.ts";
import { InfographicViewer } from "./InfographicViewer.tsx";

const clientLog = getLogger("studio-panel");

type IconCmp = (p: { size?: number; class?: string }) => preact.JSX.Element;
type Accent =
  | "amber"
  | "blue"
  | "emerald"
  | "cyan"
  | "violet"
  | "rose"
  | "yellow"
  | "teal";

interface Props {
  notebookId: string;
  initialItems: StudioItem[];
}

const TILES: {
  label: string;
  Icon: IconCmp;
  key: string;
  accent: Accent;
}[] = [
  { label: "Audio…", Icon: AudioIcon, key: "audio", accent: "amber" },
  { label: "Slide deck", Icon: SlideIcon, key: "slides", accent: "blue" },
  { label: "Mind Map", Icon: MindMapIcon, key: "mindmap", accent: "emerald" },
  { label: "Reports", Icon: ReportIcon, key: "reports", accent: "cyan" },
  {
    label: "Flashcards",
    Icon: FlashcardsIcon,
    key: "flashcards",
    accent: "violet",
  },
  { label: "Quiz", Icon: QuizIcon, key: "quiz", accent: "rose" },
  {
    label: "Infographic",
    Icon: InfographicIcon,
    key: "infographic",
    accent: "yellow",
  },
  { label: "Data table", Icon: TableIcon, key: "datatable", accent: "teal" },
];

const ACCENT_ICON_BG: Record<Accent, string> = {
  amber: "bg-amber-500/15 text-amber-300",
  blue: "bg-blue-500/15 text-blue-300",
  emerald: "bg-emerald-500/15 text-emerald-300",
  cyan: "bg-cyan-500/15 text-cyan-300",
  violet: "bg-violet-500/15 text-violet-300",
  rose: "bg-rose-500/15 text-rose-300",
  yellow: "bg-yellow-500/15 text-yellow-300",
  teal: "bg-teal-500/15 text-teal-300",
};

function dispatchStudioAction(key: string) {
  clientLog.debug("studio tile click", { key });
  globalThis.dispatchEvent(
    new CustomEvent("librenotebook:studio-action", { detail: { key } }),
  );
}

export function StudioPanel({ notebookId, initialItems }: Props) {
  const note = useSignal("");
  const editing = useSignal(false);
  const items = useSignal<StudioItem[]>(initialItems);
  // Currently-open infographic in the fullscreen viewer. Null means no
  // viewer is open. The InfographicModal dispatches an open event after
  // a successful generation so the viewer surfaces the result without
  // the user having to click the studio card themselves.
  const viewerItem = useSignal<StudioItem | null>(null);

  /** Optimistic remove + DELETE; rolls back on error. Mirrors the
   *  SourcesPanel pattern. */
  async function deleteItem(itemId: string) {
    const prev = items.value;
    items.value = prev.filter((i) => i.id !== itemId);
    try {
      const res = await fetch(
        `/api/notebooks/${notebookId}/studio/${itemId}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      // Roll back the optimistic remove if the server refused.
      items.value = prev;
    }
  }

  function openViewer(item: StudioItem) {
    if (item.kind !== "infographic") return;
    viewerItem.value = item;
  }

  /** Render `mermaid` → SVG/PNG and trigger a browser download. Used
   *  by both the kebab-menu downloads and (potentially) future viewer
   *  toolbar buttons. */
  async function downloadDiagram(
    item: StudioItem,
    format: "svg" | "png",
  ): Promise<void> {
    if (!item.mermaid) return;
    const stem = safeFilenameStem(item.title || "infographic");
    try {
      const svg = await renderMermaidToSvg(item.mermaid);
      if (format === "svg") {
        downloadBlob(
          new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
          `${stem}.svg`,
        );
      } else {
        const png = await svgStringToPng(svg);
        downloadBlob(png, `${stem}.png`);
      }
    } catch (err) {
      clientLog.error("studio download failed", {
        itemId: item.id,
        format,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Poll while any item is still generating.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function tick() {
      try {
        const res = await fetch(`/api/notebooks/${notebookId}/studio`);
        if (res.ok && !cancelled) {
          items.value = await res.json();
        }
      } catch {
        // ignore
      }
      if (cancelled) return;
      if (items.value.some((i) => i.status === "generating")) {
        timer = setTimeout(tick, 2_000) as unknown as number;
      }
    }
    if (items.value.some((i) => i.status === "generating")) tick();
    // Listen for the InfographicModal "started" signal so we begin
    // polling even if the page wasn't already polling. The
    // `start` route can take 30s+ (it runs the initial LLM
    // generation) but the studio item is created in storage in the
    // first ~10ms — we just need to poll repeatedly until we see
    // it. 12 attempts × 500ms ≈ 6s, well past the addStudioItem
    // commit window.
    async function onStarted() {
      for (let attempt = 0; attempt < 12; attempt++) {
        if (cancelled) return;
        await tick();
        if (items.value.some((i) => i.status === "generating")) return;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    globalThis.addEventListener("librenotebook:studio-started", onStarted);

    // InfographicModal dispatches this once the bg iteration loop
    // finishes successfully — we resolve the studio item locally (or
    // refetch /studio if it isn't in our list yet, e.g. just after
    // server-side auto-finalise) and pop the fullscreen viewer.
    async function onOpenViewer(e: Event) {
      const detail = (e as CustomEvent<{ studioItemId: string }>).detail;
      if (!detail?.studioItemId) return;
      let found = items.value.find((i) => i.id === detail.studioItemId);
      if (!found) {
        try {
          const res = await fetch(
            `/api/notebooks/${notebookId}/studio/${detail.studioItemId}`,
          );
          if (res.ok) found = await res.json() as StudioItem;
        } catch {
          // ignore — viewer just won't open
        }
      }
      if (found) openViewer(found);
    }
    globalThis.addEventListener(
      "librenotebook:open-infographic-viewer",
      onOpenViewer,
    );

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      globalThis.removeEventListener(
        "librenotebook:studio-started",
        onStarted,
      );
      globalThis.removeEventListener(
        "librenotebook:open-infographic-viewer",
        onOpenViewer,
      );
    };
  }, [notebookId]);

  return (
    <section class="rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-col min-h-[70vh]">
      <header class="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <h2 class="text-zinc-100 font-medium">Studio</h2>
        <button
          type="button"
          class="p-1.5 rounded hover:bg-zinc-800 text-zinc-400"
          aria-label="Toggle sidebar"
        >
          <SidebarIcon size={16} />
        </button>
      </header>

      <div class="p-4 grid grid-cols-3 gap-2">
        {TILES.map(({ label, Icon, key, accent }) => (
          <button
            key={key}
            type="button"
            onClick={() => dispatchStudioAction(key)}
            class="flex flex-col items-start gap-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800 p-3 text-left text-zinc-200"
          >
            <span
              class={`inline-flex w-7 h-7 rounded-md items-center justify-center ${
                ACCENT_ICON_BG[accent]
              }`}
            >
              <Icon size={14} />
            </span>
            <span class="text-[11px] leading-tight">{label}</span>
          </button>
        ))}
      </div>

      <div class="flex-1 px-4 pb-4 flex flex-col">
        {items.value.length > 0
          ? (
            <ul class="space-y-2">
              {items.value.map((it) => (
                <StudioItemCard
                  key={it.id}
                  item={it}
                  onOpen={() => openViewer(it)}
                  onDownload={(format) => downloadDiagram(it, format)}
                  onDelete={() => deleteItem(it.id)}
                />
              ))}
            </ul>
          )
          : editing.value
          ? (
            <div class="flex-1 flex flex-col items-center justify-center text-center text-zinc-400">
              <textarea
                value={note.value}
                onInput={(
                  e,
                ) => (note.value =
                  (e.currentTarget as HTMLTextAreaElement).value)}
                rows={6}
                placeholder="Note…"
                class="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
              />
              <button
                type="button"
                onClick={() => (editing.value = false)}
                class="mt-3 text-xs text-zinc-300 hover:text-white"
              >
                Save note
              </button>
            </div>
          )
          : (
            <div class="flex-1 flex flex-col items-center justify-center text-center text-zinc-400">
              <SparklesIcon size={22} class="text-zinc-500 mb-2" />
              <p class="text-sm font-medium text-zinc-300">
                Studio output will be saved here.
              </p>
              <p class="text-xs mt-2 max-w-xs">
                After adding sources, click any tile above to generate an
                infographic, slide deck, study guide and more!
              </p>
            </div>
          )}
      </div>

      <div class="p-3 border-t border-zinc-800/60">
        <button
          type="button"
          onClick={() => (editing.value = !editing.value)}
          class="w-full inline-flex items-center justify-center gap-2 rounded-full bg-zinc-100 text-zinc-900 hover:bg-white py-1.5 text-sm"
        >
          <NoteIcon size={14} />
          <span>{editing.value ? "Cancel" : "Add note"}</span>
        </button>
      </div>

      <InfographicViewer
        open={viewerItem.value !== null}
        title={viewerItem.value?.title ?? ""}
        mermaid={viewerItem.value?.mermaid ?? null}
        onClose={() => (viewerItem.value = null)}
      />
    </section>
  );
}

function StudioItemCard(
  { item, onOpen, onDownload, onDelete }: {
    item: StudioItem;
    onOpen: () => void;
    onDownload: (format: "svg" | "png") => void;
    onDelete: () => void;
  },
) {
  const generating = item.status === "generating";
  const failed = item.status === "failed";
  const ready = item.status === "ready";
  const canDownload = ready && item.kind === "infographic" && !!item.mermaid;
  // SSR + first client paint render `createdAbs`; after mount the
  // useRelativeTime hook flips `ago` to "5m ago". Both renders agree on
  // the same text node, so Preact never sees a hydration mismatch.
  const ago = useRelativeTime(item.createdAt);
  const createdAbs = formatAbsolute(item.createdAt);
  const menuOpen = useSignal(false);
  const statusOpen = useSignal(false);
  const confirming = useSignal(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  // Close the menu when the user clicks/taps outside of it. Capture-phase
  // is no longer strictly necessary (the row is no longer one big
  // interactive container), but it's harmless and keeps behaviour
  // consistent with other popovers in the app.
  useEffect(() => {
    if (!menuOpen.value) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) {
        menuOpen.value = false;
        confirming.value = false;
      }
    }
    document.addEventListener("mousedown", onDocClick, true);
    return () => document.removeEventListener("mousedown", onDocClick, true);
  }, [menuOpen.value]);

  // Same outside-click dismiss for the status popover.
  useEffect(() => {
    if (!statusOpen.value) return;
    function onDocClick(e: MouseEvent) {
      if (!statusRef.current) return;
      if (!statusRef.current.contains(e.target as Node)) {
        statusOpen.value = false;
      }
    }
    document.addEventListener("mousedown", onDocClick, true);
    return () => document.removeEventListener("mousedown", onDocClick, true);
  }, [statusOpen.value]);

  function onCardClick() {
    clientLog.debug("studio card click", {
      id: item.id,
      status: item.status,
      title: item.title,
    });
    if (item.status === "ready") {
      onOpen();
      return;
    }
    // Generating / failed cards open a small status popover instead
    // of a full modal so the chat surface isn't disturbed.
    statusOpen.value = !statusOpen.value;
  }

  function onDownloadClick(format: "svg" | "png") {
    clientLog.debug("studio download click", { id: item.id, format });
    menuOpen.value = false;
    confirming.value = false;
    onDownload(format);
  }

  function onMenuClick(e: Event) {
    // preventDefault is defensive — `type="button"` already opts out of
    // form submission. No stopPropagation needed: the kebab is now a
    // sibling of the title button, not nested inside it, so there's no
    // parent click handler to suppress.
    e.preventDefault();
    clientLog.debug("studio kebab click", {
      id: item.id,
      nextOpen: !menuOpen.value,
    });
    menuOpen.value = !menuOpen.value;
    confirming.value = false;
  }

  function onDeleteClick(e: Event) {
    e.preventDefault();
    clientLog.debug("studio delete click", {
      id: item.id,
      confirming: confirming.value,
    });
    if (confirming.value) {
      menuOpen.value = false;
      confirming.value = false;
      onDelete();
    } else {
      confirming.value = true;
      setTimeout(() => (confirming.value = false), 2_500);
    }
  }

  // Hover styles live on the non-interactive flex container so the whole
  // row reacts to hover regardless of which child the cursor is over.
  const rowClasses =
    `flex items-center gap-3 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 transition ${
      item.status === "ready"
        ? "hover:border-zinc-600 hover:bg-zinc-800"
        : "hover:border-zinc-700"
    }`;

  // `flex-1 min-w-0` is required for the inner `truncate` classes to
  // actually truncate — flex items default to `min-width: auto`, which
  // refuses to shrink below the content's intrinsic width.
  const titleBtnClasses =
    "flex-1 min-w-0 flex items-center gap-3 text-left bg-transparent border-0 p-0 outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 rounded-lg";

  // Bigger click target than the original p-1 size-14 (matches the kebabs
  // in ChatPanel and NotebookGrid which use p-1.5 size-16). 22×22 was too
  // easy to miss; 28×28 is the project's standard hit area.
  const kebabClasses =
    `p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${
      menuOpen.value ? "text-zinc-200 bg-zinc-800" : ""
    }`;

  const iconWrapClasses =
    `inline-flex w-9 h-9 rounded-md items-center justify-center shrink-0 ${
      failed ? "bg-red-500/15 text-red-300" : "bg-yellow-500/15 text-yellow-300"
    }`;

  return (
    <li class="relative">
      <div class={rowClasses}>
        <button
          type="button"
          onClick={onCardClick}
          // Advertise the status popover for non-ready items; for ready
          // items the click opens a modal that lives outside this DOM,
          // so we deliberately omit aria-haspopup/expanded there.
          aria-haspopup={generating || failed ? "dialog" : undefined}
          aria-expanded={generating || failed ? statusOpen.value : undefined}
          class={titleBtnClasses}
        >
          <span class={iconWrapClasses}>
            {generating
              ? <LoaderIcon size={16} class="animate-spin" />
              : <InfographicIcon size={16} />}
          </span>
          <span class="flex-1 min-w-0">
            <span class="block text-sm text-zinc-100 truncate">
              {item.title}
            </span>
            <span class="block text-[11px] text-zinc-500 truncate">
              {generating
                ? (
                  <>
                    based on {item.basedOnSources}{" "}
                    source{item.basedOnSources === 1 ? "" : "s"}
                    {item.iteration ? ` · iter ${item.iteration}/7` : ""}
                    {item.inFlight ? " · thinking…" : ""}
                  </>
                )
                : failed
                ? `failed${item.error ? ` · ${item.error.slice(0, 40)}` : ""}`
                : (
                  <>
                    based on {item.basedOnSources}{" "}
                    source{item.basedOnSources === 1 ? "" : "s"} ·{" "}
                    <time dateTime={item.createdAt}>{ago ?? createdAbs}</time>
                  </>
                )}
            </span>
            {generating && (
              <span
                class="block mt-1 h-1 rounded-full bg-zinc-800 overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={7}
                aria-valuenow={item.iteration ?? 0}
                aria-label="Iteration progress"
              >
                <span
                  class={`block h-1 transition-all ${
                    item.inFlight
                      ? "bg-yellow-300/70 animate-pulse"
                      : "bg-yellow-300"
                  }`}
                  style={`width: ${
                    Math.min(100, ((item.iteration ?? 0) / 7) * 100)
                  }%`}
                />
              </span>
            )}
          </span>
        </button>

        <button
          type="button"
          onClick={onMenuClick}
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen.value}
          class={kebabClasses}
        >
          <MoreVerticalIcon size={16} />
        </button>
      </div>

      {menuOpen.value && (
        <div
          ref={menuRef}
          role="menu"
          class="absolute right-2 top-12 z-20 min-w-[10rem] rounded-md border border-zinc-700 bg-zinc-900 shadow-lg py-1 text-sm"
        >
          {canDownload && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => onDownloadClick("png")}
                class="block w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 hover:text-white"
              >
                Download PNG
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => onDownloadClick("svg")}
                class="block w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-800 hover:text-white"
              >
                Download SVG
              </button>
              <div class="my-1 border-t border-zinc-800" role="separator" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={onDeleteClick}
            class={`block w-full text-left px-3 py-1.5 ${
              confirming.value
                ? "text-red-300 bg-red-500/10"
                : "text-zinc-200 hover:bg-zinc-800 hover:text-red-300"
            }`}
          >
            {confirming.value ? "Click again to confirm" : "Delete"}
          </button>
        </div>
      )}

      {
        /* Status popover for non-ready items: shows iteration progress
          (or the failure reason) inline next to the card without
          taking over the chat surface. */
      }
      {statusOpen.value && (generating || failed) && (
        <div
          ref={statusRef}
          role="dialog"
          aria-label={generating
            ? "Generation in progress"
            : "Generation failed"}
          class="absolute right-0 left-0 top-full mt-1 z-20 rounded-md border border-zinc-700 bg-zinc-900 shadow-xl p-3 text-xs"
        >
          {generating
            ? (
              <>
                <p class="text-zinc-200 font-medium mb-1">
                  Generating in progress
                </p>
                <p class="text-zinc-400 leading-relaxed">
                  Iteration {item.iteration ?? 1}{" "}
                  of up to 7. The model decides when to stop — earlier passes
                  commonly finish at iteration 3–5. Check the logs for live
                  progress.
                </p>
              </>
            )
            : (
              <>
                <p class="text-red-300 font-medium mb-1">Generation failed</p>
                <p class="text-zinc-400 leading-relaxed break-words">
                  {item.error ?? "No error message recorded."}
                </p>
                <p class="text-zinc-500 mt-2">
                  Click the Infographic tile to retry, or use the ⋮ menu to
                  delete this item.
                </p>
              </>
            )}
        </div>
      )}
    </li>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const ms = Date.now() - t;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Stable absolute timestamp used as the SSR / first-paint fallback for
 *  `<time>`. Locale is pinned to en-US so the server (Deno) and the
 *  browser produce byte-identical strings — otherwise a German browser
 *  hydrating an en-US-rendered string trips a text-node mismatch. */
function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Hydration-safe relative time. Returns null on SSR and on the very
 *  first client paint, so the caller can render an absolute fallback
 *  inside `<time>`. After mount we flip to "5m ago" and re-tick every
 *  30 s so the value stays fresh while the page is open. */
function useRelativeTime(iso: string): string | null {
  const rel = useSignal<string | null>(null);
  useEffect(() => {
    rel.value = relativeTime(iso);
    const t = setInterval(() => {
      rel.value = relativeTime(iso);
    }, 30_000);
    return () => clearInterval(t);
  }, [iso]);
  return rel.value;
}
