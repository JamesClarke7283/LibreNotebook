// POST a chat message. Streams an NDJSON response carrying both the
// retrieved citation metadata and the assistant's answer tokens. The
// final assistant message (text + citations) is persisted to KV.

import { define } from "../../../../utils.ts";
import {
  addMessage,
  getNotebook,
  getSettings,
  listMessages,
} from "../../../../lib/storage.ts";
import { streamRagAnswer } from "../../../../lib/rag.ts";
import type { Citation } from "../../../../lib/types.ts";
import { getLogger } from "../../../../lib/logger.ts";

const log = getLogger("chat-route");

export const handler = define.handlers({
  async POST(ctx) {
    const notebookId = ctx.params.id;
    log.debug("chat POST received", { notebookId });
    const settings = await getSettings();
    if (!settings) {
      log.debug("chat POST refused: settings missing", { notebookId });
      return new Response("Configure providers first", { status: 412 });
    }
    const nb = await getNotebook(notebookId);
    if (!nb) {
      log.debug("chat POST refused: notebook not found", { notebookId });
      return new Response("Notebook not found", { status: 404 });
    }

    let body: { message?: unknown };
    try {
      body = await ctx.req.json();
    } catch {
      log.debug("chat POST refused: invalid JSON", { notebookId });
      return new Response("Invalid JSON", { status: 400 });
    }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      log.debug("chat POST refused: empty message", { notebookId });
      return new Response("Empty message", { status: 400 });
    }

    log.debug("chat POST accepted", { notebookId, length: message.length });
    const history = await listMessages(notebookId);
    await addMessage({ notebookId, role: "user", content: message });

    const handle = await streamRagAnswer(
      settings,
      notebookId,
      history,
      message,
    );
    log.debug("chat stream opened", {
      notebookId,
      citations: handle.citations.length,
    });

    // Tee the stream so we both forward to the client and parse for
    // persistence (extracting just the assistant text).
    const [forClient, forSave] = handle.stream.tee();

    queueMicrotask(async () => {
      let text = "";
      const citations: Citation[] = [...handle.citations];
      try {
        const reader = forSave.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
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
            try {
              const m = JSON.parse(line) as
                | { type: "citations"; citations: Citation[] }
                | { type: "token"; text: string }
                | { type: "done" }
                | { type: "error"; error: string };
              if (m.type === "token") text += m.text;
            } catch {
              // ignore malformed line
            }
          }
        }
        if (text.trim()) {
          await addMessage({
            notebookId,
            role: "assistant",
            content: text,
            citations: citations.length > 0 ? citations : undefined,
          });
        }
      } catch {
        // persistence failure is non-fatal
      }
    });

    return new Response(forClient, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  },
});
