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

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  AudioIcon,
  FlashcardsIcon,
  InfographicIcon,
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
  { label: "Flashcards", Icon: FlashcardsIcon, key: "flashcards", accent: "violet" },
  { label: "Quiz", Icon: QuizIcon, key: "quiz", accent: "rose" },
  { label: "Infographic", Icon: InfographicIcon, key: "infographic", accent: "yellow" },
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
  globalThis.dispatchEvent(
    new CustomEvent("librenotebook:studio-action", { detail: { key } }),
  );
}

export function StudioPanel({ notebookId, initialItems }: Props) {
  const note = useSignal("");
  const editing = useSignal(false);
  const items = useSignal<StudioItem[]>(initialItems);

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
    // Listen for the InfographicModal "started" signal so we begin polling
    // even if the page wasn't already polling.
    function onStarted() {
      // Force a refresh now and start polling.
      tick();
    }
    globalThis.addEventListener("librenotebook:studio-started", onStarted);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      globalThis.removeEventListener(
        "librenotebook:studio-started",
        onStarted,
      );
    };
  }, [notebookId]);

  return (
    <section class="rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-col min-h-[70vh]">
      <header class="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <h2 class="text-zinc-100 font-medium">Studio</h2>
        <button
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
              {items.value.map((it) => <StudioItemCard key={it.id} item={it} />)}
            </ul>
          )
          : editing.value
          ? (
            <div class="flex-1 flex flex-col items-center justify-center text-center text-zinc-400">
              <textarea
                value={note.value}
                onInput={(e) =>
                  (note.value = (e.currentTarget as HTMLTextAreaElement).value)}
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
    </section>
  );
}

function StudioItemCard({ item }: { item: StudioItem }) {
  const generating = item.status === "generating";
  const failed = item.status === "failed";
  const ago = relativeTime(item.createdAt);

  function onClick() {
    if (item.status !== "ready") return;
    globalThis.dispatchEvent(
      new CustomEvent("librenotebook:open-studio-item", {
        detail: { id: item.id },
      }),
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={!generating && !failed ? false : true /* generating cards are inert; failed clickable to retry later */}
        class={`w-full flex items-center gap-3 rounded-lg bg-zinc-900 border border-zinc-800 ${
          generating ? "opacity-95" : "hover:border-zinc-600 hover:bg-zinc-800"
        } px-3 py-2 text-left`}
      >
        <span
          class={`inline-flex w-9 h-9 rounded-md items-center justify-center ${
            failed
              ? "bg-red-500/15 text-red-300"
              : "bg-yellow-500/15 text-yellow-300"
          }`}
        >
          {generating
            ? <SparklesIcon size={16} class="animate-spin" />
            : <InfographicIcon size={16} />}
        </span>
        <span class="flex-1 min-w-0">
          <span class="block text-sm text-zinc-100 truncate">
            {item.title}
          </span>
          <span class="block text-[11px] text-zinc-500 truncate">
            {generating
              ? `based on ${item.basedOnSources} source${
                item.basedOnSources === 1 ? "" : "s"
              }${item.iteration ? ` · iter ${item.iteration}/3` : ""}`
              : failed
              ? `failed${item.error ? ` · ${item.error.slice(0, 40)}` : ""}`
              : `based on ${item.basedOnSources} source${
                item.basedOnSources === 1 ? "" : "s"
              } · ${ago}`}
          </span>
        </span>
        <span class="text-zinc-500 shrink-0">
          <MoreVerticalIcon size={14} />
        </span>
      </button>
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
