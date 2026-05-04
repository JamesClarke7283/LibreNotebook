// Left pane of the notebook detail view. Lists existing sources and lets
// the user add new ones via paste-text or URL fetch. The "Search the web"
// feature shown in NotebookLM is intentionally omitted.

import { useSignal } from "@preact/signals";
import type { NotebookSource } from "../lib/types.ts";
import { ArrowRightIcon, FileIcon, PlusIcon, SidebarIcon } from "../components/Icons.tsx";

interface Props {
  notebookId: string;
  initial: NotebookSource[];
}

export function SourcesPanel({ notebookId, initial }: Props) {
  const sources = useSignal<NotebookSource[]>(initial);
  const showAdd = useSignal(false);
  const mode = useSignal<"text" | "url">("text");
  const name = useSignal("");
  const text = useSignal("");
  const url = useSignal("");
  const busy = useSignal(false);
  const error = useSignal<string | null>(null);

  async function submit() {
    error.value = null;
    busy.value = true;
    try {
      const body = mode.value === "text"
        ? { kind: "text", name: name.value.trim() || "Pasted text", content: text.value }
        : { kind: "url", url: url.value.trim() };
      const res = await fetch(`/api/notebooks/${notebookId}/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      const created: NotebookSource = await res.json();
      sources.value = [...sources.value, created];
      name.value = "";
      text.value = "";
      url.value = "";
      showAdd.value = false;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      busy.value = false;
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
            </div>

            {mode.value === "text"
              ? (
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
                      (text.value = (e.currentTarget as HTMLTextAreaElement).value)}
                    rows={6}
                    class="w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                  />
                </>
              )
              : (
                <input
                  placeholder="https://example.com/article"
                  value={url.value}
                  onInput={(e) =>
                    (url.value = (e.currentTarget as HTMLInputElement).value)}
                  class="w-full rounded-md bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                />
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
                ? "Indexing…"
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
                Click Add sources above to add text snippets or fetch a URL.
              </p>
            </div>
          )
          : (
            <ul class="space-y-2">
              {sources.value.map((s) => (
                <li
                  key={s.id}
                  class="flex items-start gap-2 px-3 py-2 rounded-md bg-zinc-800/40 border border-zinc-800"
                >
                  <FileIcon size={16} class="text-zinc-400 mt-0.5 shrink-0" />
                  <div class="min-w-0">
                    <p class="text-sm text-zinc-100 truncate">{s.name}</p>
                    <p class="text-[10px] uppercase tracking-wide text-zinc-500">
                      {s.kind}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
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
