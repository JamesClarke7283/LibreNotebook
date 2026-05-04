// Centre pane: streaming chat against the notebook's RAG chain.

import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { ChatMessage } from "../lib/types.ts";
import { ArrowRightIcon, MoreVerticalIcon, SparklesIcon } from "../components/Icons.tsx";

interface Props {
  notebookId: string;
  notebookTitle: string;
  notebookCreated: string;
  sourceCount: number;
  initialMessages: ChatMessage[];
}

export function ChatPanel(props: Props) {
  const messages = useSignal<ChatMessage[]>(props.initialMessages);
  const draft = useSignal("");
  const streaming = useSignal(false);
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
      let acc = "";
      // deno-lint-ignore no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        // Replace placeholder content live.
        messages.value = messages.value.map((m) =>
          m.id === placeholder.id ? { ...m, content: acc } : m
        );
        scrollToBottom();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      messages.value = messages.value.map((m) =>
        m.id === placeholder.id
          ? { ...m, content: `[error: ${msg}]` }
          : m
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
        <button class="p-1.5 rounded hover:bg-zinc-800 text-zinc-400" aria-label="More">
          <MoreVerticalIcon size={16} />
        </button>
      </header>

      <div ref={scrollerRef} class="flex-1 overflow-y-auto scroll-thin px-6 py-6 relative">
        {/* Customise pill */}
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
                <li key={m.id} class="flex">
                  <div
                    class={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-zinc-800/80 text-zinc-100 ml-auto max-w-[80%]"
                        : "bg-zinc-900 border border-zinc-800 text-zinc-200 mr-auto max-w-[90%]"
                    }`}
                  >
                    {m.content || (
                      <span class="opacity-60 inline-block animate-pulse">…</span>
                    )}
                  </div>
                </li>
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
    </section>
  );
}
