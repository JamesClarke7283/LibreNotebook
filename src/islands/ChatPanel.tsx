// Centre pane: streaming chat against the notebook's RAG chain.
//
// Replies arrive as NDJSON (one JSON object per line). We accumulate
// `citations` and `content` on the in-flight assistant message, render
// `[N]` markers inline as hover popovers showing the chunk preview, and
// open the SourceViewer drawer on click — there the full source is shown
// with the cited chunk highlighted in context.
//
// At the top of the panel we surface the auto-generated notebook summary
// (with three clickable suggested-question pills) and at the bottom we
// mount the Customise-Infographic modal that opens in response to a
// `librenotebook:studio-action` event from StudioPanel.

import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { ChatMessage, Citation, SummaryStatus } from "../lib/types.ts";
import {
  ArrowRightIcon,
  MoreVerticalIcon,
  SparklesIcon,
} from "../components/Icons.tsx";
import { SourceViewer } from "./SourceViewer.tsx";
import { MermaidView } from "./MermaidView.tsx";
import { InfographicModal } from "./InfographicModal.tsx";

interface Props {
  notebookId: string;
  notebookTitle: string;
  notebookCreated: string;
  sourceCount: number;
  initialMessages: ChatMessage[];
  initialSummary: string | null;
  initialSuggestedQuestions: string[];
  initialSummaryStatus: SummaryStatus;
  initialSummaryError: string | null;
}

type StreamEvent =
  | { type: "citations"; citations: Citation[] }
  | { type: "token"; text: string }
  | {
    type: "highlights";
    ranges: Array<
      { index: number; ranges: Array<{ start: number; end: number }> }
    >;
  }
  | { type: "done" }
  | { type: "error"; error: string };

export function ChatPanel(props: Props) {
  const messages = useSignal<ChatMessage[]>(props.initialMessages);
  const draft = useSignal("");
  const streaming = useSignal(false);
  const openCitation = useSignal<Citation | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Notebook summary state.
  const summary = useSignal<string | null>(props.initialSummary);
  const suggestedQuestions = useSignal<string[]>(
    props.initialSuggestedQuestions,
  );
  const summaryStatus = useSignal<SummaryStatus>(props.initialSummaryStatus);
  const summaryError = useSignal<string | null>(props.initialSummaryError);

  // Infographic modal visibility — flipped by the `librenotebook:studio-action`
  // event dispatched from StudioPanel when the user clicks a tile.
  const infographicOpen = useSignal(false);

  useEffect(() => {
    function onAction(e: Event) {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (detail?.key === "infographic") infographicOpen.value = true;
    }
    globalThis.addEventListener("librenotebook:studio-action", onAction);
    return () =>
      globalThis.removeEventListener("librenotebook:studio-action", onAction);
  }, []);

  // Poll /summary while the server is generating. Stops as soon as the
  // status flips to "idle" (success) or "failed".
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function tick() {
      try {
        const res = await fetch(`/api/notebooks/${props.notebookId}/summary`);
        if (res.ok && !cancelled) {
          const data = await res.json() as {
            summary: string | null;
            suggestedQuestions: string[];
            summaryStatus: SummaryStatus;
            summaryError: string | null;
          };
          summary.value = data.summary;
          suggestedQuestions.value = data.suggestedQuestions;
          summaryStatus.value = data.summaryStatus;
          summaryError.value = data.summaryError;
        }
      } catch {
        // ignore; try again next tick
      }
      if (cancelled) return;
      if (summaryStatus.value === "generating") {
        timer = setTimeout(tick, 2_000) as unknown as number;
      }
    }
    if (summaryStatus.value === "generating") tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [props.notebookId]);

  async function retrySummary() {
    summaryStatus.value = "generating";
    summaryError.value = null;
    try {
      await fetch(`/api/notebooks/${props.notebookId}/summary`, {
        method: "POST",
      });
    } catch (err) {
      summaryStatus.value = "failed";
      summaryError.value = err instanceof Error ? err.message : String(err);
    }
  }

  function scrollToBottom() {
    queueMicrotask(() => {
      const el = scrollerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function sendDirect(text: string) {
    draft.value = text;
    void send();
  }

  async function send() {
    const q = draft.value.trim();
    if (!q || streaming.value) return;
    streaming.value = true;
    draft.value = "";

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      notebookId: props.notebookId,
      role: "user",
      content: q,
      createdAt: new Date().toISOString(),
    };
    const placeholder: ChatMessage = {
      id: crypto.randomUUID(),
      notebookId: props.notebookId,
      role: "assistant",
      content: "",
      citations: [],
      createdAt: new Date().toISOString(),
    };
    messages.value = [...messages.value, userMsg, placeholder];
    scrollToBottom();

    try {
      const res = await fetch(`/api/notebooks/${props.notebookId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      if (!res.ok || !res.body) {
        throw new Error(await res.text() || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let citations: Citation[] = [];
      // deno-lint-ignore no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line.trim()) continue;
          let evt: StreamEvent;
          try {
            evt = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }
          if (evt.type === "citations") {
            citations = evt.citations;
          } else if (evt.type === "token") {
            text += evt.text;
          } else if (evt.type === "highlights") {
            // Merge per-citation ranges into the citation list. The
            // server emits this once after the full answer has streamed
            // because span detection needs the assembled text.
            const byIndex = new Map(evt.ranges.map((r) => [r.index, r.ranges]));
            citations = citations.map((c) => ({
              ...c,
              ranges: byIndex.get(c.index) ?? c.ranges,
            }));
          } else if (evt.type === "error") {
            text += `\n\n[error: ${evt.error}]`;
          }
          messages.value = messages.value.map((m) =>
            m.id === placeholder.id ? { ...m, content: text, citations } : m
          );
          scrollToBottom();
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      messages.value = messages.value.map((m) =>
        m.id === placeholder.id ? { ...m, content: `[error: ${msg}]` } : m
      );
    } finally {
      streaming.value = false;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <section class="relative rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-col min-h-[70vh]">
      <header class="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <h2 class="text-zinc-100 font-medium">Chat</h2>
        <button
          class="p-1.5 rounded hover:bg-zinc-800 text-zinc-400"
          aria-label="More"
        >
          <MoreVerticalIcon size={16} />
        </button>
      </header>

      <div
        ref={scrollerRef}
        class="flex-1 overflow-y-auto scroll-thin px-6 py-6 relative"
      >
        <div class="flex justify-end mb-4">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 text-xs text-zinc-300 border border-zinc-800 rounded-full px-3 py-1 hover:bg-zinc-800"
          >
            <SparklesIcon size={14} />
            <span>Customise</span>
          </button>
        </div>

        <div class="max-w-3xl mx-auto">
          <header class="mb-6">
            <h3 class="text-2xl font-medium text-zinc-100 mb-1">
              {props.notebookTitle}
            </h3>
            <p class="text-xs text-zinc-500">
              {props.sourceCount}{" "}
              {props.sourceCount === 1 ? "source" : "sources"} ·{" "}
              {props.notebookCreated}
            </p>
          </header>

          {
            /* Auto-summary block (NotebookLM-style overview + 3 question
              pills). The example-question pills are hidden once the
              user has sent at least one message — they're an empty-
              state affordance, not part of the ongoing chat surface. */
          }
          <SummaryBlock
            status={summaryStatus.value}
            summary={summary.value}
            error={summaryError.value}
            sourceCount={props.sourceCount}
            suggestedQuestions={messages.value.length === 0
              ? suggestedQuestions.value
              : []}
            onAskQuestion={sendDirect}
            onRetry={retrySummary}
          />

          {messages.value.length === 0 && summaryStatus.value === "idle" &&
            !summary.value && (
            <p class="mt-8 text-sm text-zinc-400 text-center">
              Add a source on the left, then ask a question down here.
            </p>
          )}

          {messages.value.length > 0 && (
            <ul class="space-y-4 mt-4">
              {messages.value.map((m) => (
                <MessageBubble
                  key={m.id}
                  m={m}
                  onOpenCitation={(c) => (openCitation.value = c)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div class="border-t border-zinc-800/60 p-3">
        <div class="flex items-end gap-2 rounded-2xl bg-zinc-950 border border-zinc-800 px-3 py-2">
          <textarea
            placeholder="Start typing…"
            value={draft.value}
            onInput={(
              e,
            ) => (draft.value = (e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={onKeyDown}
            rows={1}
            class="flex-1 bg-transparent text-sm text-zinc-100 outline-none resize-none max-h-40"
          />
          <span class="text-xs text-zinc-500">
            {props.sourceCount} {props.sourceCount === 1 ? "source" : "sources"}
          </span>
          <button
            type="button"
            onClick={send}
            disabled={streaming.value || draft.value.trim().length === 0}
            class="p-1.5 rounded-full bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowRightIcon size={16} />
          </button>
        </div>
      </div>

      {/* Drawer for the full chunk + highlighted citation. */}
      <SourceViewer
        notebookId={props.notebookId}
        citation={openCitation.value}
        onClose={() => (openCitation.value = null)}
      />

      {
        /* Customise-Infographic modal. Visibility flipped by the
          librenotebook:studio-action event from StudioPanel. */
      }
      <InfographicModal
        notebookId={props.notebookId}
        open={infographicOpen.value}
        onClose={() => (infographicOpen.value = false)}
        onFinalised={(message) => {
          messages.value = [...messages.value, message];
          infographicOpen.value = false;
          scrollToBottom();
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
//  Summary block + suggestion pills
// ---------------------------------------------------------------------------

function SummaryBlock(
  {
    status,
    summary,
    error,
    sourceCount,
    suggestedQuestions,
    onAskQuestion,
    onRetry,
  }: {
    status: SummaryStatus;
    summary: string | null;
    error: string | null;
    sourceCount: number;
    suggestedQuestions: string[];
    onAskQuestion: (q: string) => void;
    onRetry: () => void;
  },
) {
  if (status === "generating" && !summary) {
    return (
      <div class="rounded-xl bg-zinc-900/40 border border-zinc-800 p-5 my-4 flex items-center gap-3 text-zinc-300">
        <Spinner size={14} />
        <span class="text-sm">Summarising your sources…</span>
      </div>
    );
  }
  if (status === "failed" && !summary) {
    return (
      <div class="rounded-xl bg-red-950/30 border border-red-900/60 p-5 my-4 text-sm text-red-300 flex items-center justify-between gap-3">
        <span>Summary failed: {error ?? "unknown error"}</span>
        <button
          type="button"
          onClick={onRetry}
          class="text-xs text-red-200 underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!summary) return null;
  return (
    <div class="my-4 space-y-4">
      <p class="text-[15px] leading-relaxed text-zinc-200">
        {renderBoldMarkdown(summary)}
      </p>
      <div class="flex items-center gap-2 text-zinc-400">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-xs border border-zinc-800 rounded-full px-3 py-1 hover:bg-zinc-800 hover:text-zinc-200"
        >
          📌 Save to note
        </button>
        <button
          type="button"
          class="p-1.5 rounded-full hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Helpful"
        >
          👍
        </button>
        <button
          type="button"
          class="p-1.5 rounded-full hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Not helpful"
        >
          👎
        </button>
        <span class="text-[11px] text-zinc-500 ml-auto">
          based on {sourceCount} source{sourceCount === 1 ? "" : "s"}
        </span>
      </div>
      {suggestedQuestions.length > 0 && (
        <ul class="space-y-2">
          {suggestedQuestions.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => onAskQuestion(q)}
                class="w-full text-left text-sm text-zinc-200 px-4 py-3 rounded-xl bg-zinc-800/40 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Tiny markdown renderer: only handles `**bold**` runs. Returns Preact
 * children rather than dangerous HTML to keep XSS off the table.
 */
function renderBoldMarkdown(text: string): preact.ComponentChildren {
  const out: preact.ComponentChild[] = [];
  let i = 0;
  let key = 0;
  const re = /\*\*(.+?)\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > i) out.push(text.slice(i, m.index));
    out.push(<strong key={`b${key++}`}>{m[1]}</strong>);
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg
      class="animate-spin"
      width={size}
      height={size}
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

function MessageBubble(
  { m, onOpenCitation }: {
    m: ChatMessage;
    onOpenCitation: (c: Citation) => void;
  },
) {
  const userClass = "bg-zinc-800/80 text-zinc-100 ml-auto max-w-[80%]";
  const aiClass =
    "bg-zinc-900 border border-zinc-800 text-zinc-200 mr-auto max-w-[90%]";
  const segments = m.content ? splitOutMermaidBlocks(m.content) : [];
  return (
    <li class="flex">
      <div
        class={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
          m.role === "user" ? userClass : aiClass
        }`}
      >
        {m.content
          ? segments.map((seg, idx) =>
            seg.kind === "mermaid"
              ? <MermaidView key={`mer${idx}`} code={seg.text} />
              : (
                <span key={`txt${idx}`}>
                  {renderWithCitations(
                    seg.text,
                    m.citations ?? [],
                    onOpenCitation,
                  )}
                </span>
              )
          )
          : <span class="opacity-60 inline-block animate-pulse">…</span>}
      </div>
    </li>
  );
}

/**
 * Split a streamed message into a sequence of plain-text and mermaid
 * segments. Recognises ```mermaid ... ``` fences (with or without a
 * trailing language line) and treats everything else as plain text that
 * still flows through `renderWithCitations`.
 */
function splitOutMermaidBlocks(
  text: string,
): Array<{ kind: "text" | "mermaid"; text: string }> {
  const out: Array<{ kind: "text" | "mermaid"; text: string }> = [];
  const re = /```mermaid\s*\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: "text", text: text.slice(last, m.index) });
    }
    out.push({ kind: "mermaid", text: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push({ kind: "text", text: text.slice(last) });
  }
  return out;
}

/**
 * Replace `[N]` markers in the streamed text with interactive citation
 * badges. Unknown indices are left as-is.
 */
function renderWithCitations(
  text: string,
  citations: Citation[],
  onOpen: (c: Citation) => void,
): preact.ComponentChildren {
  const out: preact.ComponentChild[] = [];
  let last = 0;
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const idx = parseInt(m[1], 10);
    const c = citations.find((x) => x.index === idx);
    if (c) {
      out.push(
        <CitationBadge
          key={`c${key++}`}
          citation={c}
          onOpen={() => onOpen(c)}
        />,
      );
    } else {
      out.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CitationBadge(
  { citation, onOpen }: { citation: Citation; onOpen: () => void },
) {
  const hover = useSignal(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Build the popover preview. If the server attached span ranges
  // (the assistant quoted verbatim), highlight just those spans with
  // a tiny bit of surrounding context — gives the user a focused
  // pointer to the relevant sentences instead of dumping the full
  // chunk. When ranges are absent, fall back to the old 360-char
  // truncated chunk preview.
  const preview = (() => {
    const ranges = (citation.ranges ?? []).slice().sort((a, b) =>
      a.start - b.start
    );
    if (ranges.length === 0) {
      return citation.content.length > 360
        ? citation.content.slice(0, 360).trimEnd() + "…"
        : citation.content;
    }
    const PAD = 40;
    const out: preact.JSX.Element[] = [];
    let cursor = 0;
    ranges.forEach((r, i) => {
      const start = Math.max(0, r.start);
      const end = Math.min(citation.content.length, r.end);
      const sliceStart = Math.max(cursor, start - PAD);
      if (sliceStart > cursor) {
        // Gap between the previous span and this one — show an ellipsis.
        if (i > 0) out.push(<span key={`g${i}`}>…</span>);
      }
      if (start > sliceStart) {
        out.push(
          <span key={`ctx${i}`}>
            {citation.content.slice(sliceStart, start)}
          </span>,
        );
      }
      out.push(
        <mark
          key={`hl${i}`}
          class="bg-emerald-400/40 text-emerald-50 px-0.5 rounded font-medium"
        >
          {citation.content.slice(start, end)}
        </mark>,
      );
      cursor = end;
    });
    // Tail context after the last span.
    const tailEnd = Math.min(citation.content.length, cursor + PAD);
    if (tailEnd > cursor) {
      out.push(
        <span key="tail">{citation.content.slice(cursor, tailEnd)}</span>,
      );
      if (tailEnd < citation.content.length) {
        out.push(<span key="ellipsis">…</span>);
      }
    }
    return <>{out}</>;
  })();

  return (
    <span class="relative inline-block align-baseline" ref={wrapRef}>
      <button
        type="button"
        onClick={onOpen}
        onMouseEnter={() => (hover.value = true)}
        onMouseLeave={() => (hover.value = false)}
        onFocus={() => (hover.value = true)}
        onBlur={() => (hover.value = false)}
        class="inline-flex items-center justify-center align-text-top mx-0.5 px-1.5 min-w-[18px] h-[18px] rounded-full text-[10px] font-medium leading-none bg-emerald-900/60 text-emerald-200 border border-emerald-700/60 hover:bg-emerald-800/80 hover:text-white"
        aria-label={`Citation ${citation.index}: ${citation.sourceName}. Click to open in source.`}
        title={`${citation.sourceName} — click to read in source`}
      >
        {citation.index}
      </button>
      {hover.value && (
        <span
          class="absolute z-30 left-0 top-full mt-1 w-80 max-w-[80vw] rounded-lg bg-zinc-950 border border-zinc-700 shadow-xl p-3 text-left whitespace-normal pointer-events-none"
          role="tooltip"
        >
          <span class="block text-[10px] uppercase tracking-wide text-emerald-400 mb-1">
            [{citation.index}] {citation.sourceName}
          </span>
          <span class="block text-[11px] text-zinc-300 leading-relaxed max-h-40 overflow-hidden">
            {preview}
          </span>
          <span class="block text-[10px] text-zinc-500 mt-2">
            Click to open the full source
          </span>
        </span>
      )}
    </span>
  );
}
