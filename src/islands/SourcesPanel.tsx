// Left pane of the notebook detail view. Lists existing sources with
// per-source status (pending / ready / failed) and lets the user add new
// ones via paste-text, fetch-URL, or PDF upload. Sources can also be
// deleted. The "Search the web" feature shown in NotebookLM is omitted.

import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { NotebookSource } from "../lib/types.ts";
import {
  ArrowRightIcon,
  FileIcon,
  PlusIcon,
  SidebarIcon,
} from "../components/Icons.tsx";

interface Props {
  notebookId: string;
  initial: NotebookSource[];
}

type Mode = "text" | "url" | "pdf";

const POLL_MS = 1500;

export function SourcesPanel({ notebookId, initial }: Props) {
  const sources = useSignal<NotebookSource[]>(initial);
  const showAdd = useSignal(false);
  const mode = useSignal<Mode>("text");
  const name = useSignal("");
  const text = useSignal("");
  const url = useSignal("");
  const file = useSignal<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = useSignal(false);
  const error = useSignal<string | null>(null);

  // Poll for status while any source is "pending".
  const pollTimer = useRef<number | undefined>(undefined);
  function schedulePoll() {
    if (pollTimer.current !== undefined) return;
    pollTimer.current = setTimeout(async () => {
      pollTimer.current = undefined;
      try {
        const res = await fetch(`/api/notebooks/${notebookId}/sources`);
        if (res.ok) {
          const fresh: NotebookSource[] = await res.json();
          sources.value = fresh;
        }
      } catch {
        // ignore — try again next tick
      }
      if (sources.value.some((s) => s.status === "pending")) schedulePoll();
    }, POLL_MS) as unknown as number;
  }
  useEffect(() => {
    if (sources.value.some((s) => s.status === "pending")) schedulePoll();
    return () => {
      if (pollTimer.current !== undefined) clearTimeout(pollTimer.current);
    };
  });

  function reset() {
    name.value = "";
    text.value = "";
    url.value = "";
    file.value = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit() {
    error.value = null;
    busy.value = true;
    try {
      let res: Response;
      if (mode.value === "pdf") {
        if (!file.value) {
          throw new Error("Pick a PDF file first.");
        }
        const fd = new FormData();
        fd.append("file", file.value);
        res = await fetch(`/api/notebooks/${notebookId}/sources`, {
          method: "POST",
          body: fd,
        });
      } else {
        const body = mode.value === "text"
          ? {
            kind: "text",
            name: name.value.trim() || "Pasted text",
            content: text.value,
          }
          : { kind: "url", url: url.value.trim() };
        res = await fetch(`/api/notebooks/${notebookId}/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      const created: NotebookSource = await res.json();
      sources.value = [...sources.value, created];
      reset();
      showAdd.value = false;
      schedulePoll();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      busy.value = false;
    }
  }

  async function deleteSource(id: string) {
    // Optimistic remove.
    const prev = sources.value;
    sources.value = sources.value.filter((s) => s.id !== id);
    try {
      const res = await fetch(
        `/api/notebooks/${notebookId}/sources/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Roll back on failure.
      sources.value = prev;
      error.value = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <section class="rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-col min-h-[70vh]">
      <header class="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <h2 class="text-zinc-100 font-medium">Sources</h2>
        <button class="p-1.5 rounded hover:bg-zinc-800 text-zinc-400" aria-label="Toggle sidebar">
          <SidebarIcon size={16} />
        </button>
      </header>

      <div class="p-4 space-y-3">
        <button
          type="button"
          onClick={() => (showAdd.value = !showAdd.value)}
          class="w-full inline-flex items-center justify-center gap-2 rounded-full border border-zinc-700 hover:bg-zinc-800 py-2 text-sm text-zinc-100"
        >
          <PlusIcon size={16} />
          <span>Add sources</span>
        </button>

        {showAdd.value && (
          <div class="rounded-lg border border-zinc-800 p-3 space-y-3">
            <div class="inline-flex rounded-full bg-zinc-800 p-1 text-xs">
              <ModeTab
                label="Paste text"
                active={mode.value === "text"}
                onClick={() => (mode.value = "text")}
              />
              <ModeTab
                label="Fetch URL"
                active={mode.value === "url"}
                onClick={() => (mode.value = "url")}
              />
              <ModeTab
                label="Upload PDF"
                active={mode.value === "pdf"}
                onClick={() => (mode.value = "pdf")}
              />
            </div>

            {mode.value === "text" && (
              <>
                <input
                  placeholder="Source name (optional)"
                  value={name.value}
                  onInput={(e) =>
                    (name.value = (e.currentTarget as HTMLInputElement).value)}
                  class="w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                />
                <textarea
                  placeholder="Paste text…"
                  value={text.value}
                  onInput={(e) =>
                    (text.value =
                      (e.currentTarget as HTMLTextAreaElement).value)}
                  rows={6}
                  class="w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                />
              </>
            )}

            {mode.value === "url" && (
              <input
                placeholder="https://example.com/article"
                value={url.value}
                onInput={(e) =>
                  (url.value = (e.currentTarget as HTMLInputElement).value)}
                class="w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-500"
              />
            )}

            {mode.value === "pdf" && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const f = (e.currentTarget as HTMLInputElement).files?.[0];
                    file.value = f ?? null;
                  }}
                  class="block w-full text-xs text-zinc-300 file:mr-3 file:rounded-full file:border-0 file:bg-zinc-100 file:text-zinc-900 file:px-3 file:py-1.5 file:text-xs file:cursor-pointer hover:file:bg-white"
                />
                {file.value && (
                  <p class="text-[11px] text-zinc-500 mt-1">
                    {file.value.name} ·{" "}
                    {(file.value.size / 1024).toFixed(0)} KB
                  </p>
                )}
                <p class="text-[11px] text-zinc-500 mt-1">
                  Text and embedded images will be extracted via Mozilla's PDF.js.
                </p>
              </div>
            )}

            {error.value && (
              <div class="text-xs text-red-400">{error.value}</div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={busy.value}
              class="w-full inline-flex items-center justify-center gap-2 rounded-full bg-zinc-100 text-zinc-900 hover:bg-white py-1.5 text-sm disabled:opacity-50"
            >
              {busy.value
                ? "Uploading…"
                : (
                  <>
                    Add source
                    <ArrowRightIcon size={14} />
                  </>
                )}
            </button>
          </div>
        )}
      </div>

      <div class="flex-1 overflow-y-auto scroll-thin px-4 pb-4">
        {sources.value.length === 0
          ? (
            <div class="flex flex-col items-center justify-center text-center py-12 text-zinc-400">
              <FileIcon size={28} class="text-zinc-600 mb-3" />
              <p class="text-sm font-medium text-zinc-300">
                Saved sources will appear here
              </p>
              <p class="text-xs mt-2 max-w-xs">
                Click Add sources above to add text snippets, fetch a URL, or
                upload a PDF.
              </p>
            </div>
          )
          : (
            <ul class="space-y-2">
              {sources.value.map((s) => (
                <SourceItem
                  key={s.id}
                  source={s}
                  onDelete={() => deleteSource(s.id)}
                />
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}

function SourceItem(
  { source, onDelete }: {
    source: NotebookSource;
    onDelete: () => void;
  },
) {
  const confirming = useSignal(false);

  function onClickDelete(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (confirming.value) {
      onDelete();
    } else {
      confirming.value = true;
      setTimeout(() => (confirming.value = false), 2_500);
    }
  }

  return (
    <li class="flex items-start gap-2 px-3 py-2 rounded-md bg-zinc-800/40 border border-zinc-800 group">
      <SourceLeadIcon source={source} />
      <div class="min-w-0 flex-1">
        <p class="text-sm text-zinc-100 truncate">{source.name}</p>
        <div class="flex items-center gap-2 mt-0.5">
          <span class="text-[10px] uppercase tracking-wide text-zinc-500">
            {source.kind}
            {source.pageCount ? ` · ${source.pageCount}p` : ""}
            {source.images && source.images.length > 0
              ? ` · ${source.images.length} img`
              : ""}
          </span>
          <StatusBadge source={source} />
        </div>
      </div>
      <button
        type="button"
        onClick={onClickDelete}
        title={confirming.value ? "Click again to confirm" : "Delete source"}
        class={`p-1 rounded text-xs opacity-0 group-hover:opacity-100 focus:opacity-100 transition ${
          confirming.value
            ? "text-red-400 opacity-100"
            : "text-zinc-400 hover:text-red-400"
        }`}
      >
        {confirming.value ? "Confirm" : "✕"}
      </button>
    </li>
  );
}

/**
 * Build a Google s2 favicon URL for a source whose name is a URL. Returns
 * null on parse failure (so the caller can fall back to the file icon).
 */
function urlFavicon(url: string): string | null {
  try {
    return `https://www.google.com/s2/favicons?sz=32&domain=${
      encodeURIComponent(new URL(url).hostname)
    }`;
  } catch {
    return null;
  }
}

function SourceLeadIcon({ source }: { source: NotebookSource }) {
  const fav = source.kind === "url" ? urlFavicon(source.name) : null;
  if (fav) {
    return (
      <img
        src={fav}
        alt=""
        width={16}
        height={16}
        class="mt-0.5 shrink-0 rounded-sm"
        onError={(e) => {
          // Hide the broken image and let the next render show the
          // fallback (we don't currently re-render, but most browsers
          // will keep a 16×16 transparent placeholder which is fine).
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return <FileIcon size={16} class="text-zinc-400 mt-0.5 shrink-0" />;
}

function StatusBadge({ source }: { source: NotebookSource }) {
  if (source.status === "pending") {
    const p = source.progress;
    const pct = p && p.total > 0
      ? Math.min(100, Math.round((p.current / p.total) * 100))
      : null;
    return (
      <span class="inline-flex items-center gap-1.5 text-[10px] text-zinc-300">
        <Spinner />
        <span>embedding{pct !== null ? ` ${pct}%` : "…"}</span>
        {pct !== null && (
          <span class="inline-block w-12 h-1 rounded-full bg-zinc-800 overflow-hidden">
            <span
              class="block h-1 bg-emerald-400 transition-all"
              style={`width: ${pct}%`}
            />
          </span>
        )}
      </span>
    );
  }
  if (source.status === "failed") {
    return (
      <span
        class="text-[10px] text-red-400"
        title={source.error ?? "Embedding failed"}
      >
        failed
      </span>
    );
  }
  return (
    <span class="text-[10px] text-emerald-400">ready</span>
  );
}

function Spinner() {
  return (
    <svg
      class="animate-spin"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function ModeTab(
  { label, active, onClick }: {
    label: string;
    active: boolean;
    onClick: () => void;
  },
) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={`px-3 py-1 rounded-full transition ${
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-300 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
