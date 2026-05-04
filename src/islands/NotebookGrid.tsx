// Interactive notebook grid. Renders the "Create new notebook" tile at the
// top-left and the saved notebooks after it. Creating a notebook hits the
// API and navigates to the new notebook's detail page.

import { useSignal } from "@preact/signals";
import type { Notebook } from "../lib/types.ts";
import {
  FileIcon,
  MoreVerticalIcon,
  PlusIcon,
} from "../components/Icons.tsx";

interface Props {
  initial: Notebook[];
}

export function NotebookGrid({ initial }: Props) {
  const notebooks = useSignal<Notebook[]>(initial);
  const creating = useSignal(false);
  const error = useSignal<string | null>(null);

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

  return (
    <>
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

        {notebooks.value.map((nb) => <NotebookCard key={nb.id} nb={nb} />)}
      </div>
    </>
  );
}

function NotebookCard({ nb }: { nb: Notebook }) {
  const created = new Date(nb.createdAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <a
      href={`/notebooks/${nb.id}`}
      class="block rounded-2xl bg-zinc-800/60 border border-zinc-800 hover:border-zinc-600 transition aspect-[3/2.4] p-5 flex flex-col text-zinc-100"
    >
      <div class="flex items-start justify-between">
        <FileIcon size={22} class="text-zinc-300" />
        <button
          type="button"
          class="p-1 rounded-full hover:bg-zinc-700 text-zinc-400"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          aria-label="More"
        >
          <MoreVerticalIcon size={16} />
        </button>
      </div>
      <div class="mt-auto">
        <h3 class="text-lg font-medium leading-tight line-clamp-2">
          {nb.title}
        </h3>
        <p class="text-xs text-zinc-400 mt-2">
          {created} · {nb.sourceCount}{" "}
          {nb.sourceCount === 1 ? "source" : "sources"}
        </p>
      </div>
    </a>
  );
}
