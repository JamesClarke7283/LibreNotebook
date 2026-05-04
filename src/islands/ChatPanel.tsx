// Centre pane: streaming chat against the notebook's RAG chain.
//
// Replies arrive as NDJSON (one JSON object per line). We accumulate
// `citations` and `content` on the in-flight assistant message, render
// `[N]` markers inline as hover popovers showing the chunk preview, and
// open the SourceViewer drawer on click — there the full source is shown
// with the cited chunk highlighted in context.

import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { ChatMessage, Citation } from "../lib/types.ts";
import {
  ArrowRightIcon,
  MoreVerticalIcon,
  SparklesIcon,
} from "../components/Icons.tsx";
import { SourceViewer } from "./SourceViewer.tsx";

interface Props {
  notebookId: string;
  notebookTitle: string;
  notebookCreated: string;
  sourceCount: number;
  initialMessages: ChatMessage[];
}

type StreamEvent =
  | { type: "citations"; citations: Citation[] }
  | { type: "token"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

export function ChatPanel(props: Props) {
  const messages = useSignal<ChatMessage[]>(props.initialMessages);
  const draft = useSignal("");
  const streaming = useSignal(false);
  const openCitation = useSignal<Citation | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    queueMicrotask(() => {
      const el = scrollerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
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
    <section class="rounded-xl bg-zinc-900/60 border border-zinc-800 flex flex-col min-h-[70vh]">
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

        {messages.value.length === 0
          ? (
            <div class="text-center max-w-md mx-auto mt-8 text-zinc-300">
              <h3 class="text-2xl font-medium mb-1">{props.notebookTitle}</h3>
              <p class="text-xs text-zinc-500">
                {props.sourceCount}{" "}
                {props.sourceCount === 1 ? "source" : "sources"} ·{" "}
                {props.notebookCreated}
              </p>
              <p class="mt-8 text-sm text-zinc-400">
                Add a source on the left, then ask a question down here.
              </p>
            </div>
          )
          : (
            <ul class="space-y-4 max-w-3xl mx-auto">
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

      <div class="border-t border-zinc-800/60 p-3">
        <div class="flex items-end gap-2 rounded-2xl bg-zinc-950 border border-zinc-800 px-3 py-2">
          <textarea
            placeholder="Start typing…"
            value={draft.value}
            onInput={(e) =>
              (draft.value = (e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={onKeyDown}
            rows={1}
            class="flex-1 bg-transparent text-sm text-zinc-100 outline-none resize-none max-h-40"
          />
          <span class="text-xs text-zinc-500">
            {props.sourceCount}{" "}
            {props.sourceCount === 1 ? "source" : "sources"}
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
    </section>
  );
}

function MessageBubble(
  { m, onOpenCitation }: {
    m: ChatMessage;
    onOpenCitation: (c: Citation) => void;
  },
) {
  const userClass =
    "bg-zinc-800/80 text-zinc-100 ml-auto max-w-[80%]";
  const aiClass =
    "bg-zinc-900 border border-zinc-800 text-zinc-200 mr-auto max-w-[90%]";
  return (
    <li class="flex">
      <div
        class={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
          m.role === "user" ? userClass : aiClass
        }`}
      >
        {m.content
          ? renderWithCitations(m.content, m.citations ?? [], onOpenCitation)
          : <span class="opacity-60 inline-block animate-pulse">…</span>}
      </div>
    </li>
  );
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

  // Trim chunk preview so the popover stays compact.
  const preview = citation.content.length > 360
    ? citation.content.slice(0, 360).trimEnd() + "…"
    : citation.content;

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
