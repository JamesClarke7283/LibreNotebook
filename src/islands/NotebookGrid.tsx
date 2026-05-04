// Interactive notebook grid. Renders the "Create new notebook" tile at
// the top-left and the saved notebooks after it. Each card has a 3-dot
// popover with **Rename** (inline edit) and **Delete** (red, with
// confirm). The grid also owns the sort dropdown — it's an island, so
// the sort state can drive the visible card order without touching the
// surrounding server-rendered page.
//
// Sort options: Most recent / Oldest first / A → Z / Z → A.

import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { Notebook } from "../lib/types.ts";
import {
  ChevronDownIcon,
  FileIcon,
  MoreVerticalIcon,
  PlusIcon,
} from "../components/Icons.tsx";

interface Props {
  initial: Notebook[];
}

type SortKey = "recent" | "oldest" | "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = {
  recent: "Most recent",
  oldest: "Oldest first",
  asc: "A → Z",
  desc: "Z → A",
};

function applySort(list: Notebook[], key: SortKey): Notebook[] {
  const out = [...list];
  switch (key) {
    case "recent":
      out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      break;
    case "oldest":
      out.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      break;
    case "asc":
      out.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "desc":
      out.sort((a, b) => b.title.localeCompare(a.title));
      break;
  }
  return out;
}

export function NotebookGrid({ initial }: Props) {
  const notebooks = useSignal<Notebook[]>(initial);
  const creating = useSignal(false);
  const error = useSignal<string | null>(null);
  const sort = useSignal<SortKey>("recent");

  async function createNotebook() {
    if (creating.value) return;
    creating.value = true;
    error.value = null;
    try {
      const res = await fetch("/api/notebooks", { method: "POST" });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      const nb: Notebook = await res.json();
      globalThis.location.href = `/notebooks/${nb.id}`;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      creating.value = false;
    }
  }

  function patchNotebook(id: string, patch: Partial<Notebook>) {
    notebooks.value = notebooks.value.map((n) =>
      n.id === id ? { ...n, ...patch } : n
    );
  }

  function removeNotebook(id: string) {
    notebooks.value = notebooks.value.filter((n) => n.id !== id);
  }

  const sorted = applySort(notebooks.value, sort.value);

  return (
    <>
      <div class="flex items-center justify-end mb-4">
        <SortDropdown
          value={sort.value}
          onChange={(k) => (sort.value = k)}
        />
      </div>

      {error.value && (
        <div class="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-md px-3 py-2 mb-4">
          {error.value}
        </div>
      )}

      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        <button
          type="button"
          onClick={createNotebook}
          disabled={creating.value}
          class="group rounded-2xl bg-zinc-900/40 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 transition aspect-[3/2.4] flex flex-col items-center justify-center text-zinc-300 disabled:opacity-50"
        >
          <span class="w-12 h-12 rounded-full bg-zinc-700/70 group-hover:bg-zinc-600 grid place-items-center mb-3 text-zinc-100">
            <PlusIcon size={22} />
          </span>
          <span class="text-base">
            {creating.value ? "Creating…" : "Create new notebook"}
          </span>
        </button>

        {sorted.map((nb) => (
          <NotebookCard
            key={nb.id}
            nb={nb}
            onRenamed={(title) => patchNotebook(nb.id, { title })}
            onDeleted={() => removeNotebook(nb.id)}
          />
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
//  Sort dropdown
// ---------------------------------------------------------------------------

function SortDropdown(
  { value, onChange }: { value: SortKey; onChange: (k: SortKey) => void },
) {
  const open = useSignal(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open.value) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        open.value = false;
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  });

  return (
    <div ref={wrapRef} class="relative">
      <button
        type="button"
        onClick={() => (open.value = !open.value)}
        class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-zinc-800 text-zinc-200 text-sm hover:bg-zinc-800"
      >
        <span>{SORT_LABELS[value]}</span>
        <ChevronDownIcon size={14} />
      </button>
      {open.value && (
        <ul class="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg bg-zinc-950 border border-zinc-800 shadow-xl py-1">
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <li key={k}>
              <button
                type="button"
                onClick={() => {
                  onChange(k);
                  open.value = false;
                }}
                class={`w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-800 ${
                  k === value ? "text-zinc-100" : "text-zinc-300"
                }`}
              >
                {SORT_LABELS[k]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Card with 3-dot popover (Rename + Delete)
// ---------------------------------------------------------------------------

interface CardProps {
  nb: Notebook;
  onRenamed: (title: string) => void;
  onDeleted: () => void;
}

function NotebookCard({ nb, onRenamed, onDeleted }: CardProps) {
  const menuOpen = useSignal(false);
  const renaming = useSignal(false);
  const draftTitle = useSignal(nb.title);
  const error = useSignal<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close popover on outside click.
  useEffect(() => {
    if (!menuOpen.value) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        menuOpen.value = false;
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  });

  // Auto-focus the rename input when it appears.
  useEffect(() => {
    if (renaming.value) {
      queueMicrotask(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      });
    }
  }, [renaming.value]);

  function startRename(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    draftTitle.value = nb.title;
    renaming.value = true;
    menuOpen.value = false;
  }

  function cancelRename() {
    draftTitle.value = nb.title;
    renaming.value = false;
    error.value = null;
  }

  async function saveRename() {
    const next = draftTitle.value.trim();
    if (!next) {
      error.value = "Title cannot be empty";
      return;
    }
    if (next === nb.title) {
      renaming.value = false;
      return;
    }
    // Optimistic.
    onRenamed(next);
    renaming.value = false;
    try {
      const res = await fetch(`/api/notebooks/${nb.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
    } catch (err) {
      // Roll back on failure.
      onRenamed(nb.title);
      error.value = err instanceof Error ? err.message : String(err);
    }
  }

  async function deleteNotebook(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    menuOpen.value = false;
    const ok = globalThis.confirm(
      `Delete "${nb.title}"?\n\n` +
        "This permanently removes the notebook, its sources, images, " +
        "chat history, and embeddings. This cannot be undone.",
    );
    if (!ok) return;
    // Optimistic remove; rollback by re-adding if the request fails.
    onDeleted();
    try {
      const res = await fetch(`/api/notebooks/${nb.id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(await res.text() || `HTTP ${res.status}`);
      }
    } catch (err) {
      // Best-effort rollback would require knowing the parent; for now
      // surface a global alert. The user can refresh to resync.
      globalThis.alert(
        `Couldn't delete: ${
          err instanceof Error ? err.message : String(err)
        }. Refresh to resync.`,
      );
    }
  }

  const created = new Date(nb.createdAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // Wrap in a div (not <a>) so the inline rename input doesn't try to
  // navigate. Card-level click delegates to navigation when not renaming
  // and the popover isn't open.
  function onCardClick(e: MouseEvent) {
    if (renaming.value || menuOpen.value) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input")) return;
    globalThis.location.href = `/notebooks/${nb.id}`;
  }

  return (
    <div
      ref={wrapRef}
      onClick={onCardClick}
      class="relative block rounded-2xl bg-zinc-800/60 border border-zinc-800 hover:border-zinc-600 transition aspect-[3/2.4] p-5 flex flex-col text-zinc-100 cursor-pointer"
    >
      <div class="flex items-start justify-between">
        <FileIcon size={22} class="text-zinc-300" />
        <button
          type="button"
          class="p-1 rounded-full hover:bg-zinc-700 text-zinc-400"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            menuOpen.value = !menuOpen.value;
          }}
          aria-label="More"
        >
          <MoreVerticalIcon size={16} />
        </button>
      </div>

      {menuOpen.value && (
        <ul class="absolute right-3 top-12 z-20 w-40 rounded-lg bg-zinc-950 border border-zinc-800 shadow-xl py-1">
          <li>
            <button
              type="button"
              onClick={startRename}
              class="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Rename
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={deleteNotebook}
              class="w-full text-left px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/40 hover:text-red-200"
            >
              Delete
            </button>
          </li>
        </ul>
      )}

      <div class="mt-auto">
        {renaming.value
          ? (
            <input
              ref={inputRef}
              value={draftTitle.value}
              onInput={(e) =>
                (draftTitle.value = (e.currentTarget as HTMLInputElement).value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              onBlur={() => void saveRename()}
              class="w-full bg-zinc-900 border border-zinc-600 rounded-md px-2 py-1 text-lg font-medium leading-tight text-zinc-100 outline-none focus:border-zinc-400"
            />
          )
          : (
            <h3 class="text-lg font-medium leading-tight line-clamp-2">
              {nb.title}
            </h3>
          )}
        {error.value && (
          <p class="text-[10px] text-red-400 mt-1">{error.value}</p>
        )}
        <p class="text-xs text-zinc-400 mt-2">
          {created} · {nb.sourceCount}{" "}
          {nb.sourceCount === 1 ? "source" : "sources"}
        </p>
      </div>
    </div>
  );
}
