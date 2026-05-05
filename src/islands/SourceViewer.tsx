// Right-hand drawer that opens when a citation is clicked. Fetches the
// full source content and renders it with the cited chunk highlighted
// (so the user can see the chunk in context).

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { Citation, NotebookSource } from "../lib/types.ts";

interface Props {
  notebookId: string;
  citation: Citation | null;
  onClose: () => void;
}

export function SourceViewer({ notebookId, citation, onClose }: Props) {
  const source = useSignal<NotebookSource | null>(null);
  const error = useSignal<string | null>(null);
  const loading = useSignal(false);

  useEffect(() => {
    if (!citation) return;
    const c = citation;
    source.value = null;
    error.value = null;
    loading.value = true;
    fetch(`/api/notebooks/${notebookId}/sources/${c.sourceId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json() as NotebookSource;
      })
      .then((s) => (source.value = s))
      .catch((
        err,
      ) => (error.value = err instanceof Error ? err.message : String(err)))
      .finally(() => (loading.value = false));
  }, [citation?.sourceId, citation?.index]);

  // Close on Escape.
  useEffect(() => {
    if (!citation) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [citation]);

  if (!citation) return null;

  return (
    <>
      {/* Click-outside backdrop. */}
      <div
        class="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label={`Citation ${citation.index} from ${citation.sourceName}`}
        class="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[480px] bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col"
      >
        <header class="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-800">
          <div class="min-w-0">
            <p class="text-[10px] uppercase tracking-wide text-emerald-400 mb-1">
              Citation [{citation.index}]
            </p>
            <h3 class="text-zinc-100 font-medium truncate">
              {citation.sourceName}
            </h3>
            {source.value?.kind === "pdf" && source.value.pageCount && (
              <p class="text-[11px] text-zinc-500 mt-0.5">
                PDF · {source.value.pageCount}{" "}
                {source.value.pageCount === 1 ? "page" : "pages"}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            class="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div class="flex-1 overflow-y-auto scroll-thin px-5 py-4">
          {loading.value && (
            <p class="text-sm text-zinc-400">
              Loading source…
            </p>
          )}
          {error.value && <p class="text-sm text-red-400">{error.value}</p>}
          {source.value && (
            <HighlightedContent
              fullText={source.value.content}
              chunk={citation.content}
              ranges={citation.ranges}
            />
          )}
        </div>

        <footer class="px-5 py-3 border-t border-zinc-800 text-[11px] text-zinc-500">
          Highlighted span shows the chunk that grounded this citation.
        </footer>
      </aside>
    </>
  );
}

/**
 * Render `fullText` with multi-span highlighting. The cited chunk is
 * shown with a soft outer highlight; sentences within the chunk that
 * the assistant's answer quoted verbatim get a stronger inner
 * highlight. Falls back to whole-chunk highlighting when ranges are
 * absent (older messages, fully paraphrased answers).
 */
function HighlightedContent(
  { fullText, chunk, ranges }: {
    fullText: string;
    chunk: string;
    ranges?: Array<{ start: number; end: number }>;
  },
) {
  const chunkStart = locateChunk(fullText, chunk);
  if (chunkStart < 0) {
    // Couldn't locate the chunk in the source — show the chunk on its
    // own at the top (with inner highlights), then the full source
    // below for context.
    return (
      <div class="space-y-4">
        <div class="rounded-lg bg-emerald-950/40 border border-emerald-800/50 p-3">
          <p class="text-[10px] uppercase tracking-wide text-emerald-300 mb-1">
            Cited chunk
          </p>
          <p class="text-sm text-emerald-100 whitespace-pre-wrap leading-relaxed">
            {ranges && ranges.length > 0
              ? renderWithInnerHighlights(chunk, ranges, "inner-strong")
              : chunk}
          </p>
        </div>
        <div>
          <p class="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
            Full source
          </p>
          <p class="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
            {fullText}
          </p>
        </div>
      </div>
    );
  }

  // Scroll the first highlight (or the chunk) into view.
  const scrollToFirst = (el: HTMLElement | null) => {
    if (el) {
      queueMicrotask(() => {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
  };

  const before = fullText.slice(0, chunkStart);
  const chunkText = fullText.slice(chunkStart, chunkStart + chunk.length);
  const after = fullText.slice(chunkStart + chunk.length);

  // If we have inner ranges, render the chunk with strong inner marks
  // wrapped in a softer outer mark to keep the chunk visible. If not,
  // mark the whole chunk strongly (same look as the old single-mark).
  const innerHighlighted = ranges && ranges.length > 0
    ? renderWithInnerHighlights(chunkText, ranges, "inner-strong")
    : chunkText;

  return (
    <p class="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
      {before}
      <mark
        id="cited-chunk"
        ref={scrollToFirst}
        class={ranges && ranges.length > 0
          ? "bg-emerald-900/30 text-emerald-100 px-0.5 rounded"
          : "bg-emerald-900/70 text-emerald-100 px-1 rounded"}
      >
        {innerHighlighted}
      </mark>
      {after}
    </p>
  );
}

/** Render `text` with multiple `<mark>` regions at the given byte
 *  ranges. Ranges are assumed sorted and non-overlapping (the
 *  server-side extractor merges adjacent ones already). */
function renderWithInnerHighlights(
  text: string,
  ranges: Array<{ start: number; end: number }>,
  variant: "inner-strong" | "inner-soft",
): preact.JSX.Element[] {
  const cls = variant === "inner-strong"
    ? "bg-emerald-400/40 text-emerald-50 px-0.5 rounded font-medium"
    : "bg-emerald-700/40 text-emerald-100 px-0.5 rounded";
  const out: preact.JSX.Element[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    const start = Math.max(0, Math.min(text.length, r.start));
    const end = Math.max(start, Math.min(text.length, r.end));
    if (start > cursor) {
      out.push(<span key={`pre-${i}`}>{text.slice(cursor, start)}</span>);
    }
    if (end > start) {
      out.push(
        <mark key={`hl-${i}`} class={cls}>
          {text.slice(start, end)}
        </mark>,
      );
    }
    cursor = end;
  });
  if (cursor < text.length) {
    out.push(<span key="tail">{text.slice(cursor)}</span>);
  }
  return out;
}

/**
 * Locate the chunk in the full text. We try an exact match first, then a
 * whitespace-tolerant match (chunks emitted by RecursiveCharacterTextSplitter
 * usually preserve whitespace, but PDFs sometimes vary).
 */
function locateChunk(full: string, chunk: string): number {
  if (!chunk) return -1;
  const direct = full.indexOf(chunk);
  if (direct >= 0) return direct;
  // Match collapsing all runs of whitespace.
  const normFull = full.replace(/\s+/g, " ");
  const normChunk = chunk.replace(/\s+/g, " ").trim();
  const idx = normFull.indexOf(normChunk);
  if (idx < 0) return -1;
  // Translate normalised idx back to the original string by counting
  // characters in `full` up to `idx` matches in `normFull`.
  let origIdx = 0;
  let normIdx = 0;
  while (origIdx < full.length && normIdx < idx) {
    if (/\s/.test(full[origIdx])) {
      // Skip extra whitespace beyond the single space we kept.
      while (origIdx < full.length && /\s/.test(full[origIdx])) origIdx++;
      normIdx += 1; // counted as one space in normFull
    } else {
      origIdx += 1;
      normIdx += 1;
    }
  }
  return origIdx;
}
