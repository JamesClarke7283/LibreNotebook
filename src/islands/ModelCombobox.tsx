// Searchable model dropdown. The user can:
//   - type freely (the input stays the source of truth, so unknown
//     model IDs are still accepted),
//   - filter the suggestion list by what they've typed,
//   - click a suggestion to commit it.
//
// `options` is the list returned by /api/test-connection. When empty the
// component degrades to a plain text input.

import { useEffect, useRef, useState } from "preact/hooks";
import { ChevronDownIcon, SearchIcon } from "../components/Icons.tsx";

interface Props {
  value: string;
  onInput: (v: string) => void;
  options: string[];
  placeholder?: string;
}

export function ModelCombobox(props: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = props.value.trim().toLowerCase();
  const filtered = q
    ? props.options.filter((m) => m.toLowerCase().includes(q))
    : props.options;
  const showSuggestions = open && props.options.length > 0;

  return (
    <div ref={wrapRef} class="relative">
      <div class="flex items-center rounded-lg bg-zinc-950 border border-zinc-800 focus-within:border-zinc-500">
        <span class="pl-3 text-zinc-500">
          <SearchIcon size={14} />
        </span>
        <input
          type="text"
          value={props.value}
          placeholder={props.placeholder}
          onFocus={() => setOpen(true)}
          onInput={(e) => {
            props.onInput((e.currentTarget as HTMLInputElement).value);
            setOpen(true);
          }}
          // Suppress the form's implicit submit-on-Enter; close the
          // dropdown instead.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setOpen(false);
            }
          }}
          class="flex-1 bg-transparent px-2 py-2 text-sm text-zinc-100 outline-none"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={props.options.length === 0}
          class="px-2 py-2 text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
          aria-label="Toggle model list"
        >
          <ChevronDownIcon size={14} />
        </button>
      </div>

      {showSuggestions && (
        <ul class="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto scroll-thin rounded-lg bg-zinc-900 border border-zinc-800 shadow-xl py-1">
          {filtered.length === 0
            ? (
              <li class="px-3 py-2 text-xs text-zinc-500">
                No matches — typed value will be used.
              </li>
            )
            : (
              filtered.map((m) => (
                <li key={m}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      // Use mousedown to fire before the input blur.
                      e.preventDefault();
                      props.onInput(m);
                      setOpen(false);
                    }}
                    class={`w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-800 ${
                      m === props.value ? "text-zinc-100" : "text-zinc-300"
                    }`}
                  >
                    {m}
                  </button>
                </li>
              ))
            )}
        </ul>
      )}
    </div>
  );
}
