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

    let body: { message?: unknown; replyToId?: unknown };
    try {
      body = await ctx.req.json();
    } catch {
      log.debug("chat POST refused: invalid JSON", { notebookId });
      return new Response("Invalid JSON", { status: 400 });
    }

    // Two modes:
    //   1. Normal send — body has `message`. We persist a new user
    //      message and an assistant message replying to it.
    //   2. Retry — body has `replyToId` pointing at an EXISTING user
    //      message. We DON'T persist a new user message; we just
    //      generate another assistant reply linked to the same
    //      `replyToId`. The UI groups all assistants sharing a
    //      `replyToId` and lets the user page through them.
    const retryReplyToId = typeof body.replyToId === "string"
      ? body.replyToId
      : null;
    const inboundMessage = typeof body.message === "string"
      ? body.message.trim()
      : "";

    const history = await listMessages(notebookId);

    let userMsgId: string;
    let messageText: string;

    if (retryReplyToId) {
      const target = history.find(
        (m) => m.id === retryReplyToId && m.role === "user",
      );
      if (!target) {
        log.debug("chat POST refused: retry target not found", {
          notebookId,
          replyToId: retryReplyToId,
        });
        return new Response("Retry target not found", { status: 404 });
      }
      userMsgId = target.id;
      messageText = target.content;
      log.debug("chat POST accepted (retry)", {
        notebookId,
        replyToId: userMsgId,
        length: messageText.length,
      });
    } else {
      if (!inboundMessage) {
        log.debug("chat POST refused: empty message", { notebookId });
        return new Response("Empty message", { status: 400 });
      }
      log.debug("chat POST accepted", {
        notebookId,
        length: inboundMessage.length,
      });
      const userMsg = await addMessage({
        notebookId,
        role: "user",
        content: inboundMessage,
      });
      userMsgId = userMsg.id;
      messageText = inboundMessage;
    }

    const handle = await streamRagAnswer(
      settings,
      notebookId,
      history,
      messageText,
    );
    log.debug("chat stream opened", {
      notebookId,
      replyToId: userMsgId,
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
            // Link the assistant reply to the user message it answers,
            // so the UI can group alternative retries together.
            replyToId: userMsgId,
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
