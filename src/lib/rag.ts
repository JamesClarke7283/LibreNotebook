// Retrieval-augmented chat chain. Pulls top-k relevant chunks from the
// notebook's vector store, builds a grounded prompt asking the LLM to
// cite chunks inline as `[N]`, and streams an NDJSON response that
// carries both the citation metadata and the answer tokens.
//
// When the configured chat model is vision-capable, we also attach
// images extracted from the cited sources to the user message so the
// model can "look at" the figures from PDFs / webpages while answering.
// Text is the only thing that gets embedded; images ride along
// in-context.
//
// Wire format (one JSON object per line, terminated by '\n'):
//
//   {"type":"citations","citations":[{index,sourceId,sourceName,content}, …]}
//   {"type":"token","text":"…"}            // many of these
//   {"type":"done"}
//   {"type":"error","error":"…"}           // on failure (instead of done)

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import type { Document } from "@langchain/core/documents";
import { buildChatModel } from "./llm.ts";
import { buildEmbeddings } from "./embeddings.ts";
import { similaritySearch } from "./vectorstore.ts";
import { getSource, imagesDir } from "./storage.ts";
import { getLogger } from "./logger.ts";
import type { AppSettings, ChatMessage, Citation } from "./types.ts";

const log = getLogger("rag");

const SYSTEM_PROMPT =
  `You are LibreNotebook, an open-source NotebookLM-style assistant.
Answer the user's question using ONLY the context excerpts below. Each
excerpt is prefixed with a numeric tag like [1], [2]. When you use
information from an excerpt you MUST cite it inline using that tag, e.g.
"the sky appears blue [1] because of Rayleigh scattering [2]". Cite the
specific tag(s) for every factual claim.

When a key phrase or sentence directly grounds a claim in your answer,
QUOTE IT VERBATIM from the excerpt (don't paraphrase) — this lets the
UI highlight the exact source span the user is reading.

You may also receive figures from those sources as images. When useful,
incorporate what you see in the images into your answer. Cite the source
they came from with the same [N] markers.

If the context does not contain the answer, say you don't have enough
information in the saved sources to answer.`;

/** Total images we'll attach to a single chat turn (token-budget guard). */
const MAX_IMAGES_PER_TURN = 6;
/** Per-source cap so one image-heavy source can't crowd out others. */
const MAX_IMAGES_PER_SOURCE = 3;

export interface RagStreamHandle {
  stream: ReadableStream<Uint8Array>;
  citations: Citation[];
}

interface ImagePart {
  type: "image_url";
  image_url: { url: string };
}

/**
 * Read each cited source, pull a few images off it, and return them as
 * data-URL `image_url` content parts that LangChain can hand to either
 * ChatOpenAI or ChatOllama. Returns an empty array when the LLM doesn't
 * support vision.
 */
async function gatherSourceImages(
  notebookId: string,
  citations: Citation[],
  hasVision: boolean,
): Promise<ImagePart[]> {
  if (!hasVision || citations.length === 0) return [];
  const seen = new Set<string>();
  const parts: ImagePart[] = [];
  for (const c of citations) {
    if (seen.has(c.sourceId)) continue;
    seen.add(c.sourceId);
    const src = await getSource(notebookId, c.sourceId);
    if (!src?.images?.length) continue;
    const dir = imagesDir(notebookId, c.sourceId);
    for (const img of src.images.slice(0, MAX_IMAGES_PER_SOURCE)) {
      if (parts.length >= MAX_IMAGES_PER_TURN) break;
      try {
        const bytes = await readFile(join(dir, img.filename));
        const mime = img.filename.endsWith(".png")
          ? "image/png"
          : img.filename.endsWith(".webp")
          ? "image/webp"
          : img.filename.endsWith(".gif")
          ? "image/gif"
          : "image/jpeg";
        const base64 = uint8ToBase64(bytes);
        parts.push({
          type: "image_url",
          image_url: { url: `data:${mime};base64,${base64}` },
        });
      } catch {
        // Missing or unreadable image — skip silently.
      }
    }
    if (parts.length >= MAX_IMAGES_PER_TURN) break;
  }
  return parts;
}

// ---------------------------------------------------------------- spans

/** Normalise a string for fuzzy matching: lowercase, collapse runs of
 *  whitespace, drop most punctuation (but keep word boundaries). */
function normaliseForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a chunk into sentence-ish segments. We keep the original
 *  byte ranges so we can highlight the exact slice in the user's
 *  source viewer. Splits on `.`, `?`, `!`, newlines — preserving the
 *  punctuation in the output range. */
function sentenceSpans(
  text: string,
): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "." || c === "?" || c === "!" || c === "\n") {
      const end = i + 1;
      const slice = text.slice(start, end).trim();
      if (slice.length > 0) {
        out.push({ start, end, text: slice });
      }
      start = end;
    }
  }
  if (start < text.length) {
    const slice = text.slice(start).trim();
    if (slice.length > 0) {
      out.push({ start, end: text.length, text: slice });
    }
  }
  return out;
}

/** Extract 4-grams (4-word sequences) from a normalised string. */
function fourgrams(s: string): Set<string> {
  const words = s.split(" ").filter((w) => w.length > 0);
  const out = new Set<string>();
  for (let i = 0; i + 4 <= words.length; i++) {
    out.add(words.slice(i, i + 4).join(" "));
  }
  return out;
}

/**
 * Compute citation ranges by finding sentences in each cited chunk
 * that share at least one 4-gram with the assistant's answer. Pure
 * heuristic — no LLM call, no extra latency. Works well when the
 * assistant quotes verbatim (which the system prompt now nudges it
 * to do); falls back to empty ranges when the answer is fully
 * paraphrased (UI then highlights the whole chunk like before).
 */
export function extractCitationRanges(
  chunk: string,
  answer: string,
): Array<{ start: number; end: number }> {
  if (!chunk || !answer) return [];
  const normAnswer = normaliseForMatch(answer);
  if (!normAnswer) return [];
  const answerGrams = fourgrams(normAnswer);
  if (answerGrams.size === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  for (const sent of sentenceSpans(chunk)) {
    const normSent = normaliseForMatch(sent.text);
    if (!normSent) continue;
    const sentGrams = fourgrams(normSent);
    let hit = false;
    for (const g of sentGrams) {
      if (answerGrams.has(g)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      ranges.push({ start: sent.start, end: sent.end });
    }
  }

  // Merge adjacent or overlapping ranges so the UI doesn't render
  // two `<mark>`s with a single space between them.
  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 2) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

function uint8ToBase64(bytes: Uint8Array): string {
  // Avoid `String.fromCharCode(...bytes)` exploding the call stack on
  // big buffers by chunking.
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(s);
}

export async function streamRagAnswer(
  settings: AppSettings,
  notebookId: string,
  history: ChatMessage[],
  question: string,
): Promise<RagStreamHandle> {
  const llm = await buildChatModel(settings.llm);
  const embeddings = buildEmbeddings(settings.embedding);

  // Retrieval (skipped gracefully when the notebook has no sources yet
  // OR the embedding server is unreachable).
  let docs: Document[] = [];
  try {
    docs = await similaritySearch(notebookId, embeddings, question, 4);
  } catch (err) {
    log.warn("similaritySearch failed", {
      notebookId,
      error: err instanceof Error ? err.message : String(err),
    });
    docs = [];
  }
  log.info("RAG retrieval", {
    notebookId,
    k: docs.length,
    sources: [
      ...new Set(
        docs.map((d) => (d.metadata as { sourceId?: string }).sourceId),
      ),
    ],
  });
  const citations: Citation[] = docs.map((d, i) => ({
    index: i + 1,
    sourceId: (d.metadata as { sourceId?: string }).sourceId ?? "unknown",
    sourceName: (d.metadata as { sourceName?: string }).sourceName ??
      "Untitled source",
    content: d.pageContent,
  }));

  const context = citations.length > 0
    ? citations.map((c) => `[${c.index}] ${c.content}`).join("\n\n")
    : "(no saved sources yet — answer that the notebook has no sources)";

  const imageParts = await gatherSourceImages(
    notebookId,
    citations,
    settings.llm.hasVision,
  );
  if (imageParts.length > 0) {
    log.debug("attached source images", { count: imageParts.length });
  }

  // Build the message stack manually (rather than ChatPromptTemplate)
  // because we need a multimodal `content: [...]` array on the user
  // message — a shape ChatPromptTemplate's string templating doesn't
  // model directly.
  const messages: Array<SystemMessage | HumanMessage> = [
    new SystemMessage(`${SYSTEM_PROMPT}\n\nContext:\n${context}`),
  ];
  for (const m of history.slice(-10)) {
    if (m.role === "user") messages.push(new HumanMessage(m.content));
    else {
      // Treat assistant turns as plain SystemMessages addressed to the
      // model — close enough for short histories and avoids importing
      // AIMessage.
      messages.push(new SystemMessage(`Previous assistant: ${m.content}`));
    }
  }
  if (imageParts.length > 0) {
    messages.push(
      new HumanMessage({
        content: [
          { type: "text", text: question },
          ...imageParts,
        ],
      }),
    );
  } else {
    messages.push(new HumanMessage(question));
  }

  const parser = new StringOutputParser();
  const tokenStream = await llm.pipe(parser).stream(messages);

  const encoder = new TextEncoder();
  const writeLine = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    obj: unknown,
  ) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Emit citations first so the client can render the popover targets
      // before any [N] markers arrive. Ranges are computed and emitted
      // on a follow-up `highlights` message after the stream completes
      // (we need the full answer text to find quoted spans).
      writeLine(controller, { type: "citations", citations });
      let assembled = "";
      try {
        for await (const chunk of tokenStream) {
          if (chunk) {
            assembled += chunk;
            writeLine(controller, { type: "token", text: chunk });
          }
        }
        // Compute span highlights and mutate the citations in place
        // so the persisted message stores them too (the route handler
        // saves these citations after the stream resolves).
        for (const c of citations) {
          c.ranges = extractCitationRanges(c.content, assembled);
        }
        const totalRanges = citations.reduce(
          (a, c) => a + (c.ranges?.length ?? 0),
          0,
        );
        log.info("citation highlights computed", {
          notebookId,
          citations: citations.length,
          totalRanges,
        });
        writeLine(controller, {
          type: "highlights",
          ranges: citations.map((c) => ({
            index: c.index,
            ranges: c.ranges ?? [],
          })),
        });
        writeLine(controller, { type: "done" });
      } catch (err) {
        writeLine(controller, {
          type: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
      controller.close();
    },
  });

  return { stream, citations };
}
