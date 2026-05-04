// POST a chat message. Streams the assistant reply as plain-text chunks.
// The user message and the assistant reply are persisted to KV.

import { define } from "../../../../utils.ts";
import {
  addMessage,
  getNotebook,
  getSettings,
  listMessages,
} from "../../../../lib/storage.ts";
import { streamRagAnswer } from "../../../../lib/rag.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const settings = await getSettings();
    if (!settings) {
      return new Response("Configure providers first", { status: 412 });
    }
    const notebookId = ctx.params.id;
    const nb = await getNotebook(notebookId);
    if (!nb) return new Response("Notebook not found", { status: 404 });

    let body: { message?: unknown };
    try {
      body = await ctx.req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return new Response("Empty message", { status: 400 });

    const history = await listMessages(notebookId);
    await addMessage({ notebookId, role: "user", content: message });

    const upstream = await streamRagAnswer(
      settings,
      notebookId,
      history,
      message,
    );

    // Tee the stream so we can both forward to the client and accumulate
    // the assistant's full reply for persistence.
    const [forClient, forSave] = upstream.tee();

    queueMicrotask(async () => {
      const reader = forSave.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      try {
        // deno-lint-ignore no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
        }
        if (acc.trim()) {
          await addMessage({
            notebookId,
            role: "assistant",
            content: acc,
          });
        }
      } catch {
        // Persistence failure is non-fatal for the user-facing stream.
      }
    });

    return new Response(forClient, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  },
});
