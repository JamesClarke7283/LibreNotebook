// Inline-editable notebook title for the notebook-detail page header.
// Click the title → it swaps in an <input>; press Enter (or blur) to
// save, Esc to cancel. PATCH /api/notebooks/:id persists the change and
// `document.title` updates so the OS-level Neutralino window title bar
// follows along.

import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";

interface Props {
  notebookId: string;
  initial: string;
}

export function NotebookTitleEdit({ notebookId, initial }: Props) {
  const title = useSignal(initial);
  const draft = useSignal(initial);
  const editing = useSignal(false);
  const error = useSignal<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `${title.value} — LibreNotebook`;
  }, [title.value]);

  function startEdit() {
    draft.value = title.value;
    error.value = null;
    editing.value = true;
    queueMicrotask(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
  }

  function cancelEdit() {
    draft.value = title.value;
    editing.value = false;
    error.value = null;
  }

  async function saveEdit() {
    const next = draft.value.trim();
    if (!next) {
      error.value = "Title cannot be empty";
      return;
    }
    if (next === title.value) {
      editing.value = false;
      return;
    }
    const previous = title.value;
    // Optimistic update.
    title.value = next;
    editing.value = false;
    try {
      const res = await fetch(`/api/notebooks/${notebookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
    } catch (err) {
      // Roll back on failure.
      title.value = previous;
      error.value = err instanceof Error ? err.message : String(err);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  if (editing.value) {
    return (
      <span class="inline-flex flex-col gap-0.5">
        <input
          ref={inputRef}
          value={draft.value}
          onInput={(e) =>
            (draft.value = (e.currentTarget as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
          onBlur={() => void saveEdit()}
          class="bg-zinc-900 border border-zinc-700 rounded-md px-2 py-0.5 text-lg font-medium text-zinc-100 outline-none focus:border-zinc-400 max-w-[40ch]"
        />
        {error.value && (
          <span class="text-[10px] text-red-400">{error.value}</span>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      title="Click to rename"
      class="text-lg font-medium truncate max-w-[40ch] text-left text-zinc-100 hover:text-white px-2 py-0.5 -mx-2 rounded-md hover:bg-zinc-800/60"
    >
      {title.value}
    </button>
  );
}
